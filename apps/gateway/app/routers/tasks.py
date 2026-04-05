"""Tasks router — proxy to Google Tasks via workspace-mcp."""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_jwt import get_auth0_payload
from app.config import get_settings
from app.db import get_db
from app.mcp_runtime import build_mcp_runtime
from app.services.users import get_or_create_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["tasks"])


async def _call_gws_tool(tool_name: str, args: dict, settings) -> Any:
    rt = None
    try:
        rt = await build_mcp_runtime(
            canvas_url=None,
            google_url=settings.mcp_google_workspace_url or None,
            canvas_http_headers=None,
            max_tools=settings.mcp_max_tools,
            desc_max_chars=600,
        )
        if rt is None:
            return None
        hit = await rt.dispatch_mcp(tool_name, args)
        return hit[0] if hit else None
    except Exception:
        logger.debug("_call_gws_tool failed for %s", tool_name, exc_info=True)
        return None
    finally:
        if rt:
            await rt.aclose()


class CreateTaskBody(BaseModel):
    title: str
    due: Optional[str] = None
    notes: Optional[str] = None
    task_list_id: str = "@default"


class UpdateTaskBody(BaseModel):
    task_id: str
    status: Optional[str] = None  # "completed" | "needsAction"
    title: Optional[str] = None
    task_list_id: str = "@default"


@router.get("")
async def list_tasks(
    task_list_id: str = "@default",
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    await get_or_create_user(session, sub, payload.get("email"))

    settings = get_settings()
    result = await _call_gws_tool("gws__list_tasks", {"task_list_id": task_list_id}, settings)
    return {"tasks_raw": result or "Google Workspace MCP not connected."}


@router.post("")
async def create_task(
    body: CreateTaskBody,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    await get_or_create_user(session, sub, payload.get("email"))

    settings = get_settings()
    args: dict[str, Any] = {
        "action": "create",
        "task_list_id": body.task_list_id,
        "title": body.title,
    }
    if body.due:
        args["due"] = body.due
    if body.notes:
        args["notes"] = body.notes

    result = await _call_gws_tool("gws__manage_task", args, settings)
    return {"ok": True, "result": result}


@router.patch("/{task_id}")
async def update_task(
    task_id: str,
    body: UpdateTaskBody,
    payload: dict = Depends(get_auth0_payload),
    session: AsyncSession = Depends(get_db),
):
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing sub")
    await get_or_create_user(session, sub, payload.get("email"))

    settings = get_settings()
    args: dict[str, Any] = {
        "action": "update",
        "task_list_id": body.task_list_id,
        "task_id": task_id,
    }
    if body.status:
        args["status"] = body.status
    if body.title:
        args["title"] = body.title

    result = await _call_gws_tool("gws__manage_task", args, settings)
    return {"ok": True, "result": result}
