"""Dashboard router — aggregated Canvas data for the student dashboard."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_jwt import get_auth0_payload
from app.canvas_mcp_util import mcp_canvas_request_headers
from app.config import get_settings
from app.crypto_util import decrypt_secret
from app.db import get_db
from app.models import CanvasCredential
from app.mcp_runtime import build_mcp_runtime
from app.services.users import get_or_create_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Simple in-memory TTL cache: {user_id: (timestamp, data)}
_cache: dict[int, tuple[float, Any]] = {}
_CACHE_TTL = 300  # 5 minutes


async def _call_canvas_tool(
    tool_name: str,
    args: dict,
    canvas_hdrs: dict[str, str] | None,
    settings,
) -> str:
    """Call a single canvas tool and return the text result."""
    rt = None
    try:
        rt = await build_mcp_runtime(
            canvas_url=settings.mcp_canvas_url or None,
            google_url=None,
            canvas_http_headers=canvas_hdrs,
            max_tools=settings.mcp_max_tools,
            desc_max_chars=600,
        )
        if rt is None:
            return ""
        hit = await rt.dispatch_mcp(tool_name, args)
        return hit[0] if hit else ""
    except Exception:
        logger.debug("_call_canvas_tool failed for %s", tool_name, exc_info=True)
        return ""
    finally:
        if rt:
            await rt.aclose()


def _parse_courses(raw: str) -> list[dict]:
    """Parse list_courses text output into structured dicts."""
    courses: list[dict] = []
    current: dict = {}
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("Code:"):
            if current:
                courses.append(current)
            current = {"course_code": line[5:].strip()}
        elif line.startswith("Name:") and current:
            current["name"] = line[5:].strip()
        elif line.startswith("ID:") and current:
            current["id"] = line[3:].strip()
    if current:
        courses.append(current)
    return courses


def _count_assignments(raw: str) -> int:
    return raw.count("\nName:")


@router.get("/courses")
async def get_dashboard_courses(
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")

    user = await get_or_create_user(session, sub, payload.get("email"))
    if not user.onboarding_complete:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Complete Canvas onboarding first.")

    # Check TTL cache
    cached = _cache.get(user.id)
    if cached and (time.time() - cached[0]) < _CACHE_TTL:
        return cached[1]

    r = await session.execute(
        select(CanvasCredential).where(CanvasCredential.user_id == user.id)
    )
    cred = r.scalar_one_or_none()
    if not cred:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No Canvas credentials stored.")

    settings = get_settings()
    try:
        token = decrypt_secret(settings.encryption_key, cred.token_encrypted)
    except Exception:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not decrypt Canvas token.")

    canvas_hdrs = mcp_canvas_request_headers(
        api_token=token, domain=cred.canvas_domain, api_url=None
    )

    # Fetch course list
    courses_raw = await _call_canvas_tool("canvas__list_courses", {}, canvas_hdrs, settings)
    courses = _parse_courses(courses_raw)

    # Fetch assignment counts for up to 10 courses concurrently
    async def _get_count(course: dict) -> int:
        if not course.get("course_code"):
            return 0
        raw = await _call_canvas_tool(
            "canvas__list_assignments",
            {"course_identifier": course["course_code"]},
            canvas_hdrs,
            settings,
        )
        return _count_assignments(raw)

    top_courses = courses[:10]
    counts = await asyncio.gather(*[_get_count(c) for c in top_courses])

    enriched = []
    for course, count in zip(top_courses, counts):
        enriched.append({**course, "upcoming_assignments": count})

    total_assignments = sum(counts)
    result = {
        "courses": enriched,
        "stats": {
            "active_courses": len(courses),
            "total_upcoming_assignments": total_assignments,
        },
    }

    _cache[user.id] = (time.time(), result)
    return result
