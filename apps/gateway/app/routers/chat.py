from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth_jwt import get_auth0_payload
from app.canvas_mcp_util import mcp_canvas_request_headers
from app.config import get_settings
from app.crypto_util import decrypt_secret
from app.db import get_db
from app.agent.graph import run_readonly_agent
from app.models import CanvasCredential, User
from app.services.users import get_or_create_user

router = APIRouter(tags=["chat"])


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=12000)


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    """Prior turns so follow-ups like \"send it\" keep context (user + assistant only)."""

    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=40)


@router.post("/chat")
async def chat(
    body: ChatBody,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")

    user = await get_or_create_user(session, sub, payload.get("email"))
    if not user.onboarding_complete:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Complete Canvas onboarding first.",
        )

    r = await session.execute(
        select(CanvasCredential).where(CanvasCredential.user_id == user.id)
    )
    cred = r.scalar_one_or_none()
    if not cred:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No Canvas credentials stored.",
        )

    try:
        token_plain = decrypt_secret(settings.encryption_key, cred.token_encrypted)
    except Exception:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Could not decrypt stored Canvas token.",
        )

    canvas_hdrs = mcp_canvas_request_headers(
        api_token=token_plain,
        domain=cred.canvas_domain,
        api_url=None,
    )
    if not canvas_hdrs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid Canvas domain on file.",
        )

    history_payload = [
        {"role": h.role, "content": h.content} for h in body.history
    ]
    out = await run_readonly_agent(
        {
            "auth0_sub": sub,
            "user_id": user.id,
            "message": body.message.strip(),
            "history": history_payload,
            "canvas_mcp_headers": canvas_hdrs,
        }
    )
    payload: dict = {
        "reply_text": out.get("reply_text", ""),
        "sources": out.get("sources", []),
    }
    if settings.chat_include_tool_trace:
        payload["tool_trace"] = out.get("tool_trace") or []
    return payload
