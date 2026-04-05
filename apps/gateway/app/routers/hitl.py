"""Human-in-the-loop: list, approve, and reject pending write actions."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_jwt import get_auth0_payload
from app.canvas_mcp_util import mcp_canvas_request_headers
from app.config import get_settings
from app.crypto_util import decrypt_secret
from app.db import get_db
from app.hitl_executor import execute_pending_action
from app.models import CanvasCredential, PendingAction, User
from app.services.users import get_or_create_user

router = APIRouter(prefix="/agent", tags=["hitl"])


async def _get_pending_action(
    action_id: int,
    user: User,
    session: AsyncSession,
) -> PendingAction:
    result = await session.execute(
        select(PendingAction).where(
            PendingAction.id == action_id,
            PendingAction.user_id == user.id,
        )
    )
    action = result.scalar_one_or_none()
    if not action:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action not found.")
    return action


@router.get("/hitl/pending")
async def list_pending(
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    user = await get_or_create_user(session, sub, payload.get("email"))

    result = await session.execute(
        select(PendingAction)
        .where(PendingAction.user_id == user.id, PendingAction.status == "pending")
        .order_by(PendingAction.created_at.desc())
    )
    actions = result.scalars().all()
    return {
        "items": [
            {
                "id": a.id,
                "action_type": a.action_type,
                "payload_json": a.payload_json,
                "created_at": a.created_at.isoformat(),
            }
            for a in actions
        ]
    }


@router.post("/hitl/{action_id}/approve")
async def approve_action(
    action_id: int,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    user = await get_or_create_user(session, sub, payload.get("email"))
    action = await _get_pending_action(action_id, user, session)

    if action.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Action is already {action.status}.")

    settings = get_settings()

    # Build Canvas headers from stored credential
    canvas_hdrs = None
    cred_result = await session.execute(
        select(CanvasCredential).where(CanvasCredential.user_id == user.id)
    )
    cred = cred_result.scalar_one_or_none()
    if cred:
        try:
            token = decrypt_secret(settings.encryption_key, cred.token_encrypted)
            canvas_hdrs = mcp_canvas_request_headers(
                api_token=token,
                domain=cred.canvas_domain,
                api_url=None,
            )
        except Exception:
            pass

    result_text = await execute_pending_action(action, canvas_hdrs, settings)

    action.status = "executed"
    action.result_json = result_text[:4000]
    action.resolved_at = datetime.utcnow()
    session.add(action)
    await session.commit()

    return {"ok": True, "result": result_text}


@router.post("/hitl/{action_id}/reject")
async def reject_action(
    action_id: int,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    user = await get_or_create_user(session, sub, payload.get("email"))
    action = await _get_pending_action(action_id, user, session)

    if action.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Action is already {action.status}.")

    action.status = "rejected"
    action.resolved_at = datetime.utcnow()
    session.add(action)
    await session.commit()

    return {"ok": True}
