"""
Streamable-HTTP MCP client: list tools and dispatch calls for the OpenAI tool loop.

Sessions stay open for the duration of one `run_agent_conversation` call.
"""

from __future__ import annotations

import json
import logging
import re
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import mcp.types as mcp_types
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

logger = logging.getLogger(__name__)

# OpenAI function names: conservative charset and length
_OPENAI_NAME_MAX = 64
_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")


def _sanitize_openai_fragment(name: str) -> str:
    s = _SAFE_NAME_RE.sub("_", name).strip("_")
    return s or "tool"


def _openai_tool_name(prefix: str, mcp_name: str) -> str:
    frag = _sanitize_openai_fragment(mcp_name)
    raw = f"{prefix}__{frag}"
    if len(raw) <= _OPENAI_NAME_MAX:
        return raw
    digest = str(hash(mcp_name) % 10_000_000)
    keep = _OPENAI_NAME_MAX - len(prefix) - 2 - len(digest)
    return f"{prefix}__{frag[: max(4, keep)]}_{digest}"


def _normalize_parameters(schema: dict[str, Any]) -> dict[str, Any]:
    if not schema:
        return {"type": "object", "properties": {}, "additionalProperties": True}
    out = dict(schema)
    if out.get("type") is None:
        out["type"] = "object"
    if out.get("type") == "object" and "properties" not in out:
        out["properties"] = {}
    return out


def _format_call_tool_result(result: mcp_types.CallToolResult) -> str:
    lines: list[str] = []
    for block in result.content:
        if block.type == "text":
            lines.append(block.text)
        elif block.type == "image":
            lines.append(
                f"[image omitted: mime={block.mimeType}, bytes~{len(block.data)}]"
            )
        elif block.type == "audio":
            lines.append(
                f"[audio omitted: mime={block.mimeType}, bytes~{len(block.data)}]"
            )
        elif block.type == "resource_link":
            lines.append(f"[resource: {block.uri}]")
        elif block.type == "resource":
            inner = block.resource
            txt = getattr(inner, "text", None)
            if isinstance(txt, str) and txt:
                lines.append(txt[:12_000] + ("…" if len(txt) > 12_000 else ""))
            else:
                lines.append(f"[resource uri={inner.uri}]")
        else:
            lines.append(str(block))

    if result.structuredContent is not None:
        try:
            blob = json.dumps(result.structuredContent, default=str)
        except (TypeError, ValueError):
            blob = str(result.structuredContent)
        if len(blob) > 12_000:
            blob = blob[:12_000] + "…(truncated)"
        lines.append(blob)

    if result.isError:
        prefix = "MCP tool error: "
    else:
        prefix = ""
    body = "\n".join(lines) if lines else "(empty MCP tool result)"
    return prefix + body


async def _list_all_tools(session: ClientSession) -> list[mcp_types.Tool]:
    tools: list[mcp_types.Tool] = []
    cursor: str | None = None
    while True:
        params = (
            mcp_types.PaginatedRequestParams(cursor=cursor) if cursor else None
        )
        res = await session.list_tools(params=params)
        tools.extend(res.tools)
        nxt = res.nextCursor
        if nxt is None:
            break
        cursor = str(nxt) if nxt is not None else None
    return tools


@asynccontextmanager
async def _connected_client_session(
    url: str,
    extra_headers: dict[str, str] | None = None,
):
    """Open MCP streamable-http session. Optional headers (e.g. X-Canvas-*) attach to every request."""
    client = create_mcp_http_client(headers=extra_headers)
    async with client:
        async with streamable_http_client(url, http_client=client) as (
            read_stream,
            write_stream,
            _,
        ):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                yield session


@dataclass
class McpToolRuntime:
    """Holds OpenAI tool definitions and routes tool calls to MCP sessions."""

    tools: list[dict[str, Any]]
    _routes: dict[str, tuple[ClientSession, str]] = field(default_factory=dict)
    _stack: AsyncExitStack | None = None
    _close: Callable[[], Awaitable[None]] | None = None

    async def dispatch_mcp(self, openai_name: str, arguments: dict[str, Any] | None):
        route = self._routes.get(openai_name)
        if not route:
            return None
        session, mcp_name = route
        args = arguments or {}
        result = await session.call_tool(mcp_name, args)
        text = _format_call_tool_result(result)
        label = "mcp_canvas" if openai_name.startswith("canvas__") else "mcp_google"
        return text, label

    async def aclose(self) -> None:
        if self._close:
            await self._close()
            self._close = None
        self._stack = None


async def build_mcp_runtime(
    *,
    canvas_url: str | None,
    google_url: str | None,
    canvas_http_headers: dict[str, str] | None = None,
    max_tools: int,
    desc_max_chars: int,
) -> McpToolRuntime | None:
    """Connect to configured MCP servers and merge tool lists (capped).

    Returns None if no server could be reached or no tools were registered.
    """
    tools: list[dict[str, Any]] = []
    routes: dict[str, tuple[ClientSession, str]] = {}
    stack = AsyncExitStack()
    await stack.__aenter__()

    async def _shutdown():
        await stack.aclose()

    try:

        async def _ingest(
            prefix: str,
            base_url: str,
            extra_headers: dict[str, str] | None = None,
        ) -> None:
            nonlocal tools
            try:
                session = await stack.enter_async_context(
                    _connected_client_session(base_url, extra_headers)
                )
            except Exception:
                logger.exception("MCP connect failed for %s at %s", prefix, base_url)
                return
            try:
                mcp_tools = await _list_all_tools(session)
            except Exception:
                logger.exception("MCP tools/list failed for %s", prefix)
                return
            for t in mcp_tools:
                if len(tools) >= max_tools:
                    logger.warning(
                        "MCP tool list truncated at max_tools=%s", max_tools
                    )
                    return
                o_name = _openai_tool_name(prefix, t.name)
                if o_name in routes:
                    o_name = _openai_tool_name(prefix, f"{t.name}_{len(routes)}")
                desc = (t.description or "").strip()
                if desc_max_chars > 0 and len(desc) > desc_max_chars:
                    desc = desc[:desc_max_chars] + "…"
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": o_name,
                            "description": desc
                            or f"MCP tool `{t.name}` from {prefix} server.",
                            "parameters": _normalize_parameters(t.inputSchema),
                        },
                    }
                )
                routes[o_name] = (session, t.name)

        cu = (canvas_url or "").strip()
        gu = (google_url or "").strip()
        if cu:
            await _ingest("canvas", cu, canvas_http_headers)
        if gu:
            await _ingest("gws", gu, None)
    except Exception:
        await stack.aclose()
        raise

    if not routes:
        await stack.aclose()
        return None

    rt = McpToolRuntime(tools=tools, _routes=routes, _stack=stack)
    rt._close = _shutdown
    return rt
