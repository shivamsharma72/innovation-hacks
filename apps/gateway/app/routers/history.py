"""Chat history router — list sessions and retrieve messages."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_jwt import get_auth0_payload
from app.db import get_db
from app.models import ChatMessage, ChatSession
from app.services.users import get_or_create_user

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
async def list_sessions(
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    user = await get_or_create_user(session, sub, payload.get("email"))

    result = await session.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.last_message_at.desc())
        .limit(50)
    )
    sessions = result.scalars().all()
    return {
        "sessions": [
            {
                "id": s.id,
                "title": s.title,
                "created_at": s.created_at.isoformat(),
                "last_message_at": s.last_message_at.isoformat(),
            }
            for s in sessions
        ]
    }


@router.get("/{session_id}")
async def get_session(
    session_id: int,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    user = await get_or_create_user(session, sub, payload.get("email"))

    # Ownership check
    chat_session_result = await session.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    chat_session = chat_session_result.scalar_one_or_none()
    if not chat_session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    messages_result = await session.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = messages_result.scalars().all()

    return {
        "session": {
            "id": chat_session.id,
            "title": chat_session.title,
            "created_at": chat_session.created_at.isoformat(),
        },
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ],
    }


@router.delete("/{session_id}")
async def delete_session(
    session_id: int,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    user = await get_or_create_user(session, sub, payload.get("email"))

    chat_session_result = await session.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    chat_session = chat_session_result.scalar_one_or_none()
    if not chat_session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")

    # Delete messages first
    msgs = await session.execute(
        select(ChatMessage).where(ChatMessage.session_id == session_id)
    )
    for m in msgs.scalars().all():
        await session.delete(m)

    await session.delete(chat_session)
    await session.commit()
    return {"ok": True}
