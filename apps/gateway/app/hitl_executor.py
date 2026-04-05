"""Execute a PendingAction by replaying the stored tool call through MCP."""

from __future__ import annotations

import json
import logging

from app.config import Settings
from app.models import PendingAction
from app.mcp_runtime import build_mcp_runtime

logger = logging.getLogger(__name__)


async def execute_pending_action(
    action: PendingAction,
    canvas_hdrs: dict[str, str] | None,
    settings: Settings,
) -> str:
    """Dispatch the stored tool call and return the result text."""
    args = json.loads(action.payload_json) if action.payload_json else {}
    tool_name = action.action_type

    mcp_runtime = None
    try:
        mcp_runtime = await build_mcp_runtime(
            canvas_url=settings.mcp_canvas_url or None,
            google_url=settings.mcp_google_workspace_url or None,
            canvas_http_headers=canvas_hdrs if settings.mcp_canvas_url else None,
            max_tools=settings.mcp_max_tools,
            desc_max_chars=settings.mcp_tool_description_max_chars,
        )
        if mcp_runtime is None:
            return "MCP runtime unavailable — cannot execute action."

        result = await mcp_runtime.dispatch_mcp(tool_name, args)
        if result is None:
            return f"Tool `{tool_name}` not found in MCP runtime."
        text, _ = result
        return text
    except Exception:
        logger.exception("execute_pending_action failed for action %s", action.id)
        return "Execution failed — see gateway logs for details."
    finally:
        if mcp_runtime:
            await mcp_runtime.aclose()
