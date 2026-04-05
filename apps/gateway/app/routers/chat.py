from datetime import datetime
from typing import Literal, Optional

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
from app.models import CanvasCredential, ChatMessage, ChatSession, User
from app.services.users import get_or_create_user

router = APIRouter(tags=["chat"])


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=12000)


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=40)
    session_id: Optional[int] = None


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

    # --- Chat session / history persistence ---
    chat_session: ChatSession | None = None
    server_history: list[dict] | None = None

    if body.session_id:
        # Load existing session (ownership check)
        sess_result = await session.execute(
            select(ChatSession).where(
                ChatSession.id == body.session_id,
                ChatSession.user_id == user.id,
            )
        )
        chat_session = sess_result.scalar_one_or_none()
        if chat_session:
            msgs_result = await session.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == chat_session.id)
                .order_by(ChatMessage.created_at.asc())
            )
            server_history = [
                {"role": m.role, "content": m.content}
                for m in msgs_result.scalars().all()
            ]

    if not chat_session:
        # Create new session titled from first 80 chars of message
        chat_session = ChatSession(
            user_id=user.id,
            title=body.message.strip()[:80],
        )
        session.add(chat_session)
        await session.flush()  # get the id

    history_payload = server_history if server_history is not None else [
        {"role": h.role, "content": h.content} for h in body.history
    ]

    out = await run_readonly_agent(
        {
            "auth0_sub": sub,
            "user_id": user.id,
            "session_id": chat_session.id,
            "message": body.message.strip(),
            "history": history_payload,
            "canvas_mcp_headers": canvas_hdrs,
            "db_session": session,
            "user_email": payload.get("email") or "",
        }
    )

    reply_text: str = out.get("reply_text", "")

    # Persist the two new messages
    session.add(ChatMessage(session_id=chat_session.id, role="user", content=body.message.strip()))
    session.add(ChatMessage(session_id=chat_session.id, role="assistant", content=reply_text))
    chat_session.last_message_at = datetime.utcnow()
    session.add(chat_session)
    await session.commit()

    response_payload: dict = {
        "reply_text": reply_text,
        "sources": out.get("sources", []),
        "session_id": chat_session.id,
    }
    if settings.chat_include_tool_trace:
        response_payload["tool_trace"] = out.get("tool_trace") or []
    return response_payload
