"""Voice router — SSE tool-trace stream + ElevenLabs TTS."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_jwt import get_auth0_payload
from app.canvas_mcp_util import mcp_canvas_request_headers
from app.config import get_settings
from app.crypto_util import decrypt_secret
from app.db import get_db
from app.agent.graph import run_readonly_agent
from app.models import CanvasCredential, ChatMessage, ChatSession
from app.services.users import get_or_create_user
from app.text_sanitize import strip_markdown_for_speech

logger = logging.getLogger(__name__)
router = APIRouter(tags=["voice"])


# ── Shared helpers ────────────────────────────────────────────────────────────

class VoiceChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    history: list[dict] = Field(default_factory=list, max_length=40)
    session_id: Optional[int] = None


class TTSBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


async def _voice_spoken_summary(
    *,
    user_message: str,
    assistant_reply: str,
    openai_api_key: str,
    model: str,
) -> str:
    """
    Short, human TTS script — not a verbatim read of the on-screen reply.
    """
    text = (assistant_reply or "").strip()
    if not text or not openai_api_key:
        return text
    try:
        client = AsyncOpenAI(api_key=openai_api_key)
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You write words for text-to-speech only. Sound like a supportive friend, not a robot "
                        "reading a document. In 4–7 short sentences: give the gist (how many things are due, "
                        "what kind, timing / urgency if relevant), one casual nudge if deadlines are close "
                        "(e.g. worth starting soon), no URLs or course codes unless essential. "
                        "Do NOT list every assignment by name unless there are only one or two. "
                        "No markdown, bullets, numbers-as-lists, or asterisks—plain spoken English. "
                        "End with one clear question inviting next steps, e.g. what they want to do with "
                        "this info (plan time, details on one course, etc.)."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"What they asked (context):\n{user_message[:2000]}\n\n"
                        f"Assistant reply to base the speech on (summarize, do not read aloud):\n{text[:14000]}"
                    ),
                },
            ],
            max_tokens=320,
            temperature=0.65,
        )
        out = (resp.choices[0].message.content or "").strip()
        return out if out else text
    except Exception:
        logger.exception("voice_spoken_summary failed; falling back to reply text")
        return text


def _generate_preamble(message: str) -> str:
    """Heuristic preamble spoken immediately while the agent fetches data."""
    msg = message.lower()
    has_canvas = any(k in msg for k in (
        "canvas", "assignment", "course", "grade", "class", "submission",
        "quiz", "module", "announcement", "discussion", "syllabus", "due",
    ))
    has_gws = any(k in msg for k in (
        "email", "gmail", "calendar", "event", "drive", "task",
        "doc", "sheet", "contact", "schedule", "meeting", "file",
    ))
    if has_canvas and has_gws:
        return "Let me search Canvas and Google Workspace for you."
    elif has_canvas:
        return "Let me check Canvas for you."
    elif has_gws:
        return "Let me look that up in Google Workspace."
    else:
        return "Let me find that for you."


async def _resolve_chat_session_and_history(
    session: AsyncSession,
    user_id: int,
    body: VoiceChatBody,
) -> tuple[ChatSession, list[dict]]:
    """Create or load a chat session and the message history (same semantics as POST /chat)."""
    chat_session: ChatSession | None = None
    server_history: list[dict] | None = None

    if body.session_id:
        sess_result = await session.execute(
            select(ChatSession).where(
                ChatSession.id == body.session_id,
                ChatSession.user_id == user_id,
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
        chat_session = ChatSession(
            user_id=user_id,
            title=body.message.strip()[:80],
        )
        session.add(chat_session)
        await session.flush()

    history_payload = server_history if server_history is not None else [
        {"role": h.get("role"), "content": h.get("content", "")}
        for h in body.history
    ]
    return chat_session, history_payload


async def _resolve_canvas(
    session: AsyncSession, user: object, settings
) -> tuple[dict | None, str | None]:
    r = await session.execute(
        select(CanvasCredential).where(CanvasCredential.user_id == user.id)
    )
    cred = r.scalar_one_or_none()
    if not cred:
        return None, "No Canvas credentials stored."
    try:
        token_plain = decrypt_secret(settings.encryption_key, cred.token_encrypted)
    except Exception:
        return None, "Could not decrypt Canvas token."
    hdrs = mcp_canvas_request_headers(
        api_token=token_plain, domain=cred.canvas_domain, api_url=None
    )
    if not hdrs:
        return None, "Invalid Canvas domain on file."
    return hdrs, None


async def _el_stream(text: str, settings) -> "AsyncIterator[bytes]":
    """Yield ElevenLabs MP3 chunks for the given text (sentence-level)."""
    el_url = f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}/stream"
    el_hdrs = {
        "xi-api-key": settings.elevenlabs_api_key,
        "Content-Type": "application/json",
    }
    sentences = _split_sentences(text)
    async with httpx.AsyncClient(timeout=60) as client:
        for sentence in sentences:
            payload = {
                "text": sentence,
                "model_id": "eleven_turbo_v2_5",
                "output_format": "mp3_44100_128",
            }
            async with client.stream("POST", el_url, json=payload, headers=el_hdrs) as resp:
                if resp.status_code != 200:
                    err = await resp.aread()
                    logger.warning(
                        "ElevenLabs %s for %r: %s",
                        resp.status_code,
                        sentence[:60],
                        err[:200].decode("utf-8", errors="replace"),
                    )
                    continue
                async for chunk in resp.aiter_bytes(chunk_size=4096):
                    yield chunk


# ── POST /chat/tts  — standalone text-to-speech ───────────────────────────────

@router.post("/chat/tts")
async def text_to_speech(
    body: TTSBody,
    payload: dict = Depends(get_auth0_payload),
):
    """Convert text to ElevenLabs audio. Falls back to JSON if key not set."""
    _ = payload.get("sub")  # just ensure auth
    settings = get_settings()

    if not settings.elevenlabs_api_key:
        return {"error": "ElevenLabs not configured", "text": body.text}

    return StreamingResponse(
        _el_stream(body.text, settings),
        media_type="audio/mpeg",
    )


# ── POST /chat/voice/stream  — SSE: preamble + tool traces + reply ────────────

@router.post("/chat/voice/stream")
async def voice_stream(
    body: VoiceChatBody,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    """
    SSE stream:
      1. Immediately emits a preamble phrase (spoken by frontend via ElevenLabs)
      2. Emits tool_call events as the agent works
      3. Emits final reply text
    """
    settings = get_settings()
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")

    user = await get_or_create_user(session, sub, payload.get("email"))
    if not user.onboarding_complete:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Complete Canvas onboarding first.")

    canvas_hdrs, err = await _resolve_canvas(session, user, settings)
    if err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err)

    chat_session, history_payload = await _resolve_chat_session_and_history(
        session, user.id, body
    )

    preamble = _generate_preamble(body.message)
    queue: asyncio.Queue[dict] = asyncio.Queue()

    agent_task = asyncio.create_task(
        run_readonly_agent({
            "auth0_sub": sub,
            "user_id": user.id,
            "session_id": chat_session.id,
            "message": body.message.strip(),
            "history": history_payload,
            "canvas_mcp_headers": canvas_hdrs,
            "db_session": session,
            "user_email": payload.get("email") or "",
            "voice_mode": True,
            "status_callback": queue.put_nowait,
        })
    )

    async def _sse_generate():
        # 1. Preamble — emit before any tool calls so frontend can speak it
        yield f"data: {json.dumps({'type': 'preamble', 'text': preamble})}\n\n"

        # 2. Stream tool-call events while agent runs
        while not agent_task.done():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=0.1)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                pass

        # 3. Drain any remaining queued events
        while not queue.empty():
            event = queue.get_nowait()
            yield f"data: {json.dumps(event)}\n\n"

        # 4. Final reply + persist (mirror /chat)
        try:
            out = await agent_task
            reply_text = out.get("reply_text", "")
        except Exception as exc:
            logger.exception("voice_stream agent error")
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
            return

        try:
            session.add(
                ChatMessage(
                    session_id=chat_session.id,
                    role="user",
                    content=body.message.strip(),
                )
            )
            session.add(
                ChatMessage(
                    session_id=chat_session.id,
                    role="assistant",
                    content=reply_text,
                )
            )
            chat_session.last_message_at = datetime.utcnow()
            session.add(chat_session)
            await session.commit()
        except Exception:
            logger.exception("voice_stream failed to persist chat messages")
            await session.rollback()

        tts_text = reply_text
        if settings.openai_api_key and reply_text.strip():
            tts_text = await _voice_spoken_summary(
                user_message=body.message.strip(),
                assistant_reply=reply_text,
                openai_api_key=settings.openai_api_key,
                model=settings.openai_model,
            )
        tts_text = strip_markdown_for_speech(tts_text)

        yield f"data: {json.dumps({'type': 'meta', 'session_id': chat_session.id})}\n\n"
        yield f"data: {json.dumps({'type': 'reply', 'text': reply_text, 'tts_text': tts_text})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _sse_generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /chat/voice  — legacy single-shot audio endpoint ────────────────────

@router.post("/chat/voice")
async def voice_chat(
    body: VoiceChatBody,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    """Original endpoint kept for compatibility."""
    settings = get_settings()
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")

    user = await get_or_create_user(session, sub, payload.get("email"))
    if not user.onboarding_complete:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Complete Canvas onboarding first.")

    canvas_hdrs, err = await _resolve_canvas(session, user, settings)
    if err:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, err)

    chat_session, history_payload = await _resolve_chat_session_and_history(
        session, user.id, body
    )

    out = await run_readonly_agent({
        "auth0_sub": sub,
        "user_id": user.id,
        "session_id": chat_session.id,
        "message": body.message.strip(),
        "history": history_payload,
        "canvas_mcp_headers": canvas_hdrs,
        "db_session": session,
        "user_email": payload.get("email") or "",
        "voice_mode": True,
    })

    reply_text: str = out.get("reply_text", "")

    try:
        session.add(
            ChatMessage(
                session_id=chat_session.id,
                role="user",
                content=body.message.strip(),
            )
        )
        session.add(
            ChatMessage(
                session_id=chat_session.id,
                role="assistant",
                content=reply_text,
            )
        )
        chat_session.last_message_at = datetime.utcnow()
        session.add(chat_session)
        await session.commit()
    except Exception:
        logger.exception("voice_chat failed to persist chat messages")
        await session.rollback()

    if not settings.elevenlabs_api_key:
        return {"reply_text": reply_text, "audio": None, "session_id": chat_session.id}

    safe_reply = reply_text[:4000].replace("\r", "").replace("\n", " ")
    return StreamingResponse(
        _el_stream(reply_text, settings),
        media_type="audio/mpeg",
        headers={
            "X-Reply-Text": safe_reply,
            "X-Session-Id": str(chat_session.id),
        },
    )
