import asyncio
import json
import logging
from typing import Any

from openai import AsyncOpenAI

from app.canvas_mcp_util import mcp_canvas_request_headers
from app.config import Settings, get_settings
from app.mcp_runtime import build_mcp_runtime

logger = logging.getLogger(__name__)

_TRACE_ARGS_MAX = 800
_TRACE_RESULT_MAX = 600


_AUTH_SNIPPET_MAX = 650

_AUTH_FAILURE_MARKERS = (
    "authentication failed",
    "no authorization code",
    "not authenticated",
    "unauthorized",
    "invalid_grant",
    "invalid_client",
    "oauth",
    "access denied",
    "re-authenticat",
    "login required",
    "token has been expired",
    "token expired",
    "refresh token",
    "revoked",
    "401",
    "403 forbidden",
    "403",
    "invalid access token",
)


def _looks_like_auth_failure(text: str) -> bool:
    if not text:
        return False
    sample = text[:12_000].lower()
    return any(m in sample for m in _AUTH_FAILURE_MARKERS)


def _auth_abort_message(
    *,
    tool_name: str,
    source: str,
    tool_text: str,
    settings: Settings,
) -> str:
    snippet = tool_text.strip().split("\n")[0][: _AUTH_SNIPPET_MAX]
    browser = (settings.mcp_workspace_browser_url or "").strip()
    if not browser:
        browser = "http://localhost:8002"
    if tool_name.startswith("gws__") or source == "mcp_google":
        return (
            "**Google Workspace MCP is not authenticated** (or the session expired). "
            "Stop here—no need to retry the same tools until sign-in works.\n\n"
            f"1. Open **`{browser}/oauth/google/authorize`** (or `{browser}` and click "
            "**Sign in with Google**) so the browser gets a full OAuth URL — long links "
            "copied from chat are often truncated and cause Google error `missing response_type`.\n"
            "2. Ensure `http://localhost:8002/oauth2callback` is allowed in Google Cloud "
            "for your OAuth client.\n\n"
            f"Server detail: {snippet}"
        )
    if tool_name.startswith("canvas__") or source == "mcp_canvas":
        return (
            "**Canvas MCP rejected the request** (token, URL, or permissions). "
            "The gateway sends `X-Canvas-Token` and `X-Canvas-URL` (…/api/v1) to the "
            "Canvas MCP server—ensure onboarding Canvas token/domain are valid.\n\n"
            f"Detail: {snippet}"
        )
    return (
        "**Authentication or access error** from a connected service. "
        "Fix sign-in or tokens, then try again.\n\n"
        f"Detail: {snippet}"
    )


def _preview_json(data: Any, max_len: int = _TRACE_ARGS_MAX) -> str:
    try:
        s = json.dumps(data, default=str)
    except (TypeError, ValueError):
        s = str(data)
    if len(s) > max_len:
        return s[:max_len] + "…"
    return s


def _history_as_messages(
    history: list[dict[str, str]] | None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not history:
        return out
    for item in history[-36:]:
        role = item.get("role")
        content = (item.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        out.append({"role": role, "content": content[:12000]})
    return out


async def run_agent_conversation(
    user_message: str,
    *,
    history: list[dict[str, str]] | None = None,
    canvas_mcp_headers: dict[str, str] | None = None,
) -> tuple[str, list[str], list[dict[str, Any]]]:
    settings = get_settings()
    if not settings.openai_api_key:
        return (
            "OpenAI is not configured (set OPENAI_API_KEY on the gateway).",
            [],
            [],
        )

    canvas_mcp = bool(settings.mcp_canvas_url.strip())
    gws_mcp = bool(settings.mcp_google_workspace_url.strip())

    canvas_headers = canvas_mcp_headers
    if canvas_mcp and canvas_headers is None:
        canvas_headers = mcp_canvas_request_headers(
            api_token=settings.canvas_api_token,
            domain=settings.canvas_domain,
            api_url=settings.canvas_api_url,
        )

    mcp_runtime = None
    if canvas_mcp or gws_mcp:
        try:
            mcp_runtime = await build_mcp_runtime(
                canvas_url=settings.mcp_canvas_url or None,
                google_url=settings.mcp_google_workspace_url or None,
                canvas_http_headers=canvas_headers if canvas_mcp else None,
                max_tools=settings.mcp_max_tools,
                desc_max_chars=settings.mcp_tool_description_max_chars,
            )
        except Exception:
            logger.exception(
                "Failed to connect to MCP servers; no tools available for this request"
            )
            mcp_runtime = None

    tools = list(mcp_runtime.tools) if mcp_runtime else []
    if not tools:
        hint = []
        if not canvas_mcp and not gws_mcp:
            hint.append("Set MCP_CANVAS_URL and/or MCP_GOOGLE_WORKSPACE_URL in the gateway.")
        else:
            hint.append(
                "MCP URLs are set but no tools were loaded — check that Canvas and "
                "Workspace MCP servers are running and reachable from the gateway."
            )
        return (
            "No MCP tools are available. " + " ".join(hint),
            [],
            [],
        )

    mcp_names = {t["function"]["name"] for t in tools}
    mcp_has_canvas = any(n.startswith("canvas__") for n in mcp_names)

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    model = settings.openai_model
    system = (
        "You are a concise academic assistant. "
        "Use the tools to fetch real data; never invent due dates or grades. "
        "If a source is missing, say so briefly. "
        "All Canvas data must come from canvas__* tools (Canvas MCP). "
        "Do not claim you cannot access Canvas if canvas__ tools are listed—call them. "
        "Match the user's question to the tool names and descriptions you were given "
        "(e.g. courses vs assignments vs discussions). "
        "Google (Gmail, Calendar, Drive, …) uses gws__* tools (Workspace MCP). "
        "When the user asks to send or draft email, search mail, or use Google Workspace "
        "actions, use the relevant gws__* tools—do not refuse if those tools exist. "
        "Use tool descriptions and parameters exactly; ask for missing details "
        "(recipient, subject, body) before calling send/create tools. "
        "If no gws__ tools appear in this session, say Google Workspace MCP is not "
        "connected and suggest opening the Workspace MCP URL to sign in. "
        "For schedule questions, prefer Canvas plus gws__ calendar tools when available. "
        "If the user only asks about email or Gmail, call only gws__ Gmail tools unless "
        "they also asked about courses, assignments, grades, or their schedule. "
        "You receive prior user/assistant turns: use them for follow-ups "
        "(e.g. \"send it\" = send the email already drafted) without re-asking for details. "
        "If any tool result clearly indicates OAuth, login, or authentication failure, "
        "explain that once and stop—do not call the same failing tool repeatedly."
    )
    if canvas_mcp and not mcp_has_canvas:
        system += (
            " Note: MCP_CANVAS_URL is configured but no canvas__ tools were registered—"
            "Canvas MCP may have failed to connect; say Canvas MCP is unavailable."
        )

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        *_history_as_messages(history),
        {"role": "user", "content": user_message},
    ]
    sources: list[str] = []
    tool_trace: list[dict[str, Any]] = []
    max_rounds = max(4, min(64, settings.openai_max_tool_rounds))

    try:
        for round_idx in range(max_rounds):
            resp = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=tools,
                tool_choice="auto",
            )
            choice = resp.choices[0]
            msg = choice.message
            if msg.tool_calls:
                messages.append(
                    {
                        "role": "assistant",
                        "content": msg.content or "",
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments or "{}",
                                },
                            }
                            for tc in msg.tool_calls
                        ],
                    }
                )

                async def _run_tool_call(
                    tool_name: str, args_obj: dict[str, Any]
                ) -> tuple[str, str]:
                    if mcp_runtime and (
                        tool_name.startswith("canvas__")
                        or tool_name.startswith("gws__")
                    ):
                        hit = await mcp_runtime.dispatch_mcp(tool_name, args_obj)
                        if hit is not None:
                            return hit
                    return (
                        f"No MCP route for `{tool_name}`. Only canvas__ and gws__ tools are supported.",
                        "error",
                    )

                parsed_args: list[dict[str, Any]] = []
                tasks = []
                for tc in msg.tool_calls:
                    raw_args = tc.function.arguments or "{}"
                    try:
                        args_obj = (
                            json.loads(raw_args) if raw_args.strip() else {}
                        )
                    except json.JSONDecodeError:
                        args_obj = {}
                    parsed_args.append(args_obj)
                    tasks.append(_run_tool_call(tc.function.name, args_obj))

                results = await asyncio.gather(*tasks)
                zipped = list(
                    zip(msg.tool_calls, parsed_args, results, strict=True)
                )
                auth_abort: str | None = None
                for tc, args_obj, (text, src) in zipped:
                    if src not in sources:
                        sources.append(src)
                    rp = text
                    if len(rp) > _TRACE_RESULT_MAX:
                        rp = rp[:_TRACE_RESULT_MAX] + "…"
                    entry = {
                        "round": round_idx,
                        "tool": tc.function.name,
                        "arguments_preview": _preview_json(args_obj),
                        "source": src,
                        "result_preview": rp,
                    }
                    tool_trace.append(entry)
                    logger.info(
                        "agent tool_call round=%s tool=%s source=%s",
                        round_idx,
                        tc.function.name,
                        src,
                    )
                    if _looks_like_auth_failure(text) and auth_abort is None:
                        if (
                            tc.function.name.startswith("gws__")
                            or tc.function.name.startswith("canvas__")
                            or src in ("mcp_google", "mcp_canvas")
                        ):
                            auth_abort = _auth_abort_message(
                                tool_name=tc.function.name,
                                source=src,
                                tool_text=text,
                                settings=settings,
                            )
                            logger.warning(
                                "agent auth abort round=%s tool=%s",
                                round_idx,
                                tc.function.name,
                            )

                for tc, _args, (text, _src) in zipped:
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": text,
                        }
                    )

                if auth_abort is not None:
                    return auth_abort, sources, tool_trace

                continue

            text = (msg.content or "").strip()
            return (
                text or "(empty model response)",
                sources,
                tool_trace,
            )

        return (
            "Too many tool rounds — try a shorter request or fewer actions at once.",
            sources,
            tool_trace,
        )
    finally:
        if mcp_runtime:
            await mcp_runtime.aclose()
