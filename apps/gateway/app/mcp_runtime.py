"""
Streamable-HTTP MCP client: list tools and dispatch calls for the OpenAI tool loop.

Sessions are established at startup and reused across tool calls. If a session
times out between LLM rounds (GWS MCP has a ~10 s idle timeout), dispatch_mcp
reconnects transparently and retries the tool call once.
"""

from __future__ import annotations

import json
import logging
import re
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx
import mcp.types as mcp_types
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

logger = logging.getLogger(__name__)

_OPENAI_NAME_MAX = 64

_GOOGLE_MCP_HINT = (
    "Start it from the repo root: `./scripts/run-workspace-mcp-local.sh` "
    "(listens on http://127.0.0.1:8002/mcp). Docker: `docker compose up workspace-mcp`."
)


def _is_unreachable_mcp_error(exc: BaseException) -> bool:
    """True if *exc* or nested ExceptionGroup is a transport-level failure to the MCP server."""
    if isinstance(exc, (httpx.ConnectError, httpx.TimeoutException)):
        return True
    if isinstance(exc, BaseExceptionGroup):
        return any(_is_unreachable_mcp_error(e) for e in exc.exceptions)
    return False


def _mcp_unreachable_message(url: str, mcp_name: str) -> str:
    return (
        f"MCP connection failed for `{mcp_name}` — could not reach {url}. "
        f"The MCP server is not accepting connections (connection refused or timeout). "
        f"{_GOOGLE_MCP_HINT}"
    )


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
            lines.append(f"[image omitted: mime={block.mimeType}, bytes~{len(block.data)}]")
        elif block.type == "audio":
            lines.append(f"[audio omitted: mime={block.mimeType}, bytes~{len(block.data)}]")
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

    prefix = "MCP tool error: " if result.isError else ""
    body = "\n".join(lines) if lines else "(empty MCP tool result)"
    return prefix + body


async def _list_all_tools(session: ClientSession) -> list[mcp_types.Tool]:
    tools: list[mcp_types.Tool] = []
    cursor: str | None = None
    while True:
        params = mcp_types.PaginatedRequestParams(cursor=cursor) if cursor else None
        res = await session.list_tools(params=params)
        tools.extend(res.tools)
        nxt = res.nextCursor
        if nxt is None:
            break
        cursor = str(nxt)
    return tools


@asynccontextmanager
async def _connected_client_session(
    url: str,
    extra_headers: dict[str, str] | None = None,
):
    """Open one MCP streamable-HTTP session, yield it, then clean up."""
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


# openai_name → (server_url, mcp_tool_name, extra_headers)
_RouteEntry = tuple[str, str, dict[str, str] | None]


@dataclass
class McpToolRuntime:
    """
    Holds tool definitions and routes calls to MCP sessions.

    Sessions are established at build time and cached in ``_live_sessions``.
    If a session dies (server-side idle timeout), ``dispatch_mcp`` reconnects
    once and retries transparently — the LLM never sees the dead session.
    """

    tools: list[dict[str, Any]]
    # openai_name → (url, mcp_tool_name, extra_headers)
    _routes: dict[str, _RouteEntry] = field(default_factory=dict)
    # url → currently live ClientSession
    _live_sessions: dict[str, ClientSession] = field(default_factory=dict)
    _stack: AsyncExitStack | None = None
    _close: Callable[[], Awaitable[None]] | None = None
    # Authenticated user email — force-injected into every gws__ tool call so the
    # LLM cannot accidentally use a contact's or recipient's email as user_google_email.
    _gws_user_email: str | None = None

    async def _get_or_reconnect(self, url: str, extra_headers: dict[str, str] | None) -> ClientSession | None:
        """Return the live session for *url*, creating a new one if needed."""
        if url not in self._live_sessions:
            if self._stack is None:
                return None
            try:
                session = await self._stack.enter_async_context(
                    _connected_client_session(url, extra_headers)
                )
                self._live_sessions[url] = session
                logger.info("MCP reconnected url=%s", url)
            except BaseException as e:
                if _is_unreachable_mcp_error(e):
                    logger.warning(
                        "MCP unreachable url=%s (connection failed — is the MCP server running?)",
                        url,
                    )
                else:
                    logger.exception("MCP reconnect failed url=%s", url)
                return None
        return self._live_sessions.get(url)

    async def send_keepalive(self) -> None:
        """Ping all live sessions to prevent server-side idle timeout."""
        for url, session in list(self._live_sessions.items()):
            try:
                await session.send_ping()
                logger.debug("MCP keepalive ping sent url=%s", url)
            except Exception:
                logger.debug("MCP keepalive ping failed url=%s (will reconnect on next call)", url)

    async def dispatch_mcp(
        self, openai_name: str, arguments: dict[str, Any] | None
    ) -> tuple[str, str] | None:
        route = self._routes.get(openai_name)
        if not route:
            return None
        url, mcp_name, extra_headers = route
        args = dict(arguments or {})
        label = "mcp_canvas" if openai_name.startswith("canvas__") else "mcp_google"

        # Always override user_google_email for GWS tools with the authenticated user's
        # email. The LLM sometimes uses a contact's/recipient's email by mistake.
        if openai_name.startswith("gws__") and self._gws_user_email:
            args["user_google_email"] = self._gws_user_email

        for attempt in range(2):  # 0 = try existing; 1 = after reconnect
            session = await self._get_or_reconnect(url, extra_headers)
            if session is None:
                return (_mcp_unreachable_message(url, mcp_name), "mcp_error")

            try:
                result = await session.call_tool(mcp_name, args)
                return _format_call_tool_result(result), label
            except BaseException as e:
                if attempt == 0 and _is_unreachable_mcp_error(e):
                    logger.warning(
                        "MCP call failed (network) tool=%s — retrying after reconnect",
                        mcp_name,
                    )
                    self._live_sessions.pop(url, None)
                    continue
                if attempt == 0:
                    logger.warning(
                        "MCP session error (tool=%s), reconnecting…", mcp_name
                    )
                    self._live_sessions.pop(url, None)
                else:
                    if _is_unreachable_mcp_error(e):
                        logger.warning(
                            "MCP tool call failed after reconnect (unreachable) tool=%s",
                            mcp_name,
                        )
                        return (_mcp_unreachable_message(url, mcp_name), "mcp_error")
                    logger.exception(
                        "MCP tool call failed after reconnect tool=%s", mcp_name
                    )
                    return (
                        f"MCP tool call failed for `{mcp_name}` after reconnect. "
                        "The MCP server may be unavailable.",
                        "mcp_error",
                    )

        return ("MCP call unreachable", "mcp_error")  # should never reach here

    async def aclose(self) -> None:
        if self._close:
            try:
                await self._close()
            except Exception:
                logger.debug("MCP stack close raised (likely dead sessions)", exc_info=True)
            self._close = None
        self._stack = None
        self._live_sessions.clear()


async def build_mcp_runtime(
    *,
    canvas_url: str | None,
    google_url: str | None,
    canvas_http_headers: dict[str, str] | None = None,
    max_tools: int,
    desc_max_chars: int,
    gws_user_email: str | None = None,
) -> McpToolRuntime | None:
    """
    Connect to each configured MCP server, list tools, and return a runtime.

    The initial sessions are kept alive in an AsyncExitStack. If a session
    times out later (server-side idle), dispatch_mcp reconnects automatically.
    """
    tools: list[dict[str, Any]] = []
    routes: dict[str, _RouteEntry] = {}
    live_sessions: dict[str, ClientSession] = {}
    stack = AsyncExitStack()
    await stack.__aenter__()

    async def _shutdown() -> None:
        try:
            await stack.aclose()
        except Exception:
            logger.debug("MCP stack shutdown raised", exc_info=True)

    try:
        async def _ingest(
            prefix: str,
            base_url: str,
            extra_headers: dict[str, str] | None = None,
            server_cap: int | None = None,
        ) -> None:
            nonlocal tools
            try:
                session = await stack.enter_async_context(
                    _connected_client_session(base_url, extra_headers)
                )
            except BaseException as e:
                if _is_unreachable_mcp_error(e):
                    logger.warning(
                        "MCP connect failed (unreachable) for %s at %s — %s",
                        prefix,
                        base_url,
                        _GOOGLE_MCP_HINT
                        if prefix == "gws"
                        else "Ensure the MCP server is running and MCP_*_URL matches.",
                    )
                else:
                    logger.exception("MCP connect failed for %s at %s", prefix, base_url)
                return
            live_sessions[base_url] = session
            try:
                mcp_tools = await _list_all_tools(session)
            except Exception:
                logger.exception("MCP list_tools failed for %s", prefix)
                return
            cap = server_cap if server_cap is not None else max_tools
            server_registered = 0
            for t in mcp_tools:
                if server_registered >= cap:
                    dropped = len(mcp_tools) - server_registered
                    logger.warning(
                        "MCP tool cap reached (per-server cap=%d, global max=%d) for server '%s'"
                        " — %d tool(s) dropped. Raise MCP_MAX_TOOLS env var to expose more tools.",
                        cap, max_tools, prefix, dropped,
                    )
                    break
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
                            "description": desc or f"MCP tool `{t.name}` from {prefix} server.",
                            "parameters": _normalize_parameters(t.inputSchema),
                        },
                    }
                )
                routes[o_name] = (base_url, t.name, extra_headers)
                server_registered += 1

        cu = (canvas_url or "").strip()
        gu = (google_url or "").strip()
        # Use the full `max_tools` budget across servers in order: Canvas first, then
        # Google with whatever slots remain. Even splits (64+64) used to drop late-listed
        # gws tools (e.g. People contacts) when Canvas left budget unused. OpenAI still caps
        # total function tools (typically 128); keep max_tools within that limit.
        remaining = max_tools
        if cu:
            await _ingest("canvas", cu, canvas_http_headers, remaining)
            remaining = max(0, max_tools - len(tools))
        if gu:
            await _ingest("gws", gu, None, remaining)

    except Exception:
        await _shutdown()
        raise

    if not routes:
        await _shutdown()
        return None

    rt = McpToolRuntime(
        tools=tools,
        _routes=routes,
        _live_sessions=live_sessions,
        _stack=stack,
        _gws_user_email=gws_user_email,
    )
    rt._close = _shutdown
    return rt
