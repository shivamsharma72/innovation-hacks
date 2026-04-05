"""
User memory layer: persists per-user facts extracted from conversations.

read_memory  — called at the start of each request; injects remembered facts into the system prompt.
write_memory — called fire-and-forget after each response; extracts new facts with a cheap LLM call.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlmodel import select

from app.models import UserMemory

logger = logging.getLogger(__name__)

_EXTRACT_SYSTEM = (
    "Extract structured facts from this academic assistant conversation. "
    "Return ONLY a JSON object with any of these keys where you have clear evidence: "
    "top_courses (list of course names the user asked about), "
    "preferred_schedule_view (one of: daily, weekly, monthly), "
    "frequent_contacts (list of email addresses or names mentioned), "
    "communication_style (one of: formal, casual). "
    "Include only keys with strong evidence. Return {} if nothing to extract."
)


async def read_memory(session: AsyncSession, user_id: int) -> str:
    """Return a compact memory string to inject into the system prompt, or '' if none."""
    result = await session.execute(
        select(UserMemory)
        .where(UserMemory.user_id == user_id)
        .order_by(UserMemory.updated_at.desc())
    )
    rows = result.scalars().all()
    if not rows:
        return ""

    parts: list[str] = []
    for row in rows:
        try:
            val = json.loads(row.value_json)
            parts.append(f"{row.key}: {json.dumps(val)}")
        except (json.JSONDecodeError, TypeError):
            parts.append(f"{row.key}: {row.value_json}")

    return "[User memory] " + " | ".join(parts)


async def write_memory(
    factory: async_sessionmaker[AsyncSession],
    user_id: int,
    conversation_text: str,
    client: AsyncOpenAI,
    model: str,
) -> None:
    """Extract and upsert memory facts from a completed conversation. Never raises."""
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {"role": "user", "content": conversation_text[:6000]},
            ],
            max_tokens=256,
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        facts: dict[str, Any] = json.loads(raw)
        if not isinstance(facts, dict) or not facts:
            return

        async with factory() as session:
            for key, value in facts.items():
                value_json = json.dumps(value)
                existing = await session.execute(
                    select(UserMemory).where(
                        UserMemory.user_id == user_id,
                        UserMemory.key == key,
                    )
                )
                row = existing.scalar_one_or_none()
                if row:
                    row.value_json = value_json
                    row.updated_at = datetime.utcnow()
                    session.add(row)
                else:
                    session.add(
                        UserMemory(user_id=user_id, key=key, value_json=value_json)
                    )
            await session.commit()
    except Exception:
        logger.debug("write_memory failed (non-critical)", exc_info=True)
