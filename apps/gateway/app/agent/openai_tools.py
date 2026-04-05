import asyncio
import json
import logging
from typing import Any

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.canvas_mcp_util import mcp_canvas_request_headers
from app.config import Settings, get_settings
from app.mcp_runtime import build_mcp_runtime
from app.text_sanitize import (
    condense_tool_text,
    strip_markdown_for_speech,
    tool_result_char_budget,
)

logger = logging.getLogger(__name__)

_TRACE_ARGS_MAX = 800
_TRACE_RESULT_MAX = 600

# Human-readable labels for tool calls shown in the voice UI
TOOL_DISPLAY_LABELS: dict[str, str] = {
    # Canvas
    "canvas__list_courses":         "Checking your Canvas courses",
    "canvas__get_course":           "Reading course details",
    "canvas__list_assignments":     "Looking up assignments",
    "canvas__get_assignment":       "Reading assignment details",
    "canvas__list_submissions":     "Checking your submissions",
    "canvas__get_submission":       "Reading a submission",
    "canvas__list_announcements":   "Reading course announcements",
    "canvas__list_discussions":     "Checking discussions",
    "canvas__get_discussion":       "Reading discussion thread",
    "canvas__list_modules":         "Checking course modules",
    "canvas__list_pages":           "Reading course pages",
    "canvas__list_quizzes":         "Checking quizzes",
    "canvas__list_files":           "Browsing course files",
    "canvas__list_calendar_events": "Reading Canvas calendar",
    "canvas__list_todo_items":      "Checking Canvas to-do reminders",
    "canvas__get_my_todo_items":    "Checking Canvas to-do reminders",
    "canvas__get_my_peer_reviews_todo": "Checking Canvas peer reviews",
    "canvas__list_groups":          "Looking up course groups",
    "canvas__get_grades":           "Checking your grades",
    # GWS — Gmail
    "gws__list_messages":           "Reading your emails",
    "gws__get_message":             "Opening an email",
    "gws__search_gmail_messages":   "Searching your inbox",
    "gws__get_gmail_message_content": "Opening an email",
    "gws__send_gmail_message":      "Preparing to send email",
    "gws__search_messages":         "Searching your inbox",
    "gws__create_draft":            "Drafting an email",
    # GWS — Calendar
    "gws__list_events":             "Reading your calendar",
    "gws__get_event":               "Opening a calendar event",
    "gws__manage_event":            "Updating your calendar",
    # GWS — Tasks
    "gws__list_tasks":              "Checking your tasks",
    "gws__manage_task":             "Updating tasks",
    "gws__list_task_lists":         "Reading task lists",
    # GWS — Drive / Docs / Sheets
    "gws__list_files":              "Browsing your Google Drive",
    "gws__get_file":                "Reading a Drive file",
    "gws__search_files":            "Searching Google Drive",
    "gws__create_file":             "Creating a document",
    "gws__update_file":             "Updating a document",
    "gws__read_document":           "Reading a Google Doc",
    "gws__update_document":         "Editing a Google Doc",
    "gws__read_spreadsheet":        "Reading a spreadsheet",
    # GWS — Contacts
    "gws__search_contacts":         "Looking up contacts",
    "gws__list_contacts":           "Reading your contacts",
}


_AUTH_SNIPPET_MAX = 650

_AUTH_FAILURE_MARKERS = (
    "authentication failed",
    "no authorization code",
    "not authenticated",
    "invalid_grant",
    "invalid_client",
    # Do not use bare "oauth" — Google consent URLs contain "/oauth2/" and would false-positive.
    "oauth error",
    "oauth failed",
    "access denied",
    "login required",
    "token has been expired",
    "token expired",
    "refresh token",
    "revoked",
    "invalid access token",
    # Narrow HTTP hints (avoid bare "unauthorized" / "re-authenticat" — Workspace MCP appends those on many 403s)
    "http error: 401",
    "http 401",
    "status': 401",
    "status\": 401",
)


def _looks_like_auth_failure(text: str) -> bool:
    if not text:
        return False
    sample = text[:12_000]
    low = sample.lower()
    compact = low.replace(" ", "").replace("\n", "")

    # Workspace MCP returned an explicit consent flow with a real link — let the full tool text
    # reach the model so the user sees the authorization URL (gateway abort used only first line).
    if "action required: google authentication needed" in low:
        return False
    if "authorization url:" in low and "accounts.google.com" in low:
        return False

    # Valid OAuth session but Google refused this API call (scopes, API disabled, admin policy).
    if "caller does not have permission" in low:
        return False
    if "does not have permission" in low and "httperror403" in compact:
        return False
    if "accessnotconfigured" in compact:
        return False
    if "insufficient authentication scopes" in low:
        return True

    if any(m in low for m in _AUTH_FAILURE_MARKERS):
        return True
    # Legacy / broad phrases only when clearly token/session (not Google Docs 403, etc.)
    if "re-authenticat" in low and (
        "invalid_grant" in low
        or "invalid_client" in low
        or "http error: 401" in compact
        or "token expired" in low
        or "login required" in low
    ):
        return True
    if low.startswith("http error: 401") or " http error: 401" in low:
        return True
    return False


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
            f"1. Open [{browser}/oauth/google/authorize]({browser}/oauth/google/authorize) "
            f"(or {browser} and click **Sign in with Google**) so the browser gets a full OAuth URL — "
            "long links copied from chat are often truncated and cause Google error `missing response_type`.\n"
            "2. Ensure `http://localhost:8002/oauth2callback` is allowed in Google Cloud "
            "for your OAuth client.\n"
            "3. If you use Calendar/Drive/Gmail after only signing in to some scopes, "
            "complete consent again and accept **all** permissions Google shows.\n\n"
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
    user_id: int | None = None,
    user_email: str | None = None,  # Auth0 email → injected as user_google_email for gws__ tools
    db_session: AsyncSession | None = None,
    tool_prefix_filter: str | None = None,
    status_callback: Any | None = None,  # called with {type, tool, label} on each tool call
    voice_mode: bool = False,  # voice UI: shorter tool payloads, plain-text replies, spoken brevity
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

    # Bind Workspace MCP to one Google identity (JWT email, else USER_GOOGLE_EMAIL in .env).
    effective_user_google = (user_email or "").strip() or (
        settings.user_google_email_fallback or ""
    ).strip() or None
    if gws_mcp and not effective_user_google:
        logger.warning(
            "Google Workspace MCP is enabled but neither Auth0 email nor USER_GOOGLE_EMAIL is set; "
            "the model may pass the wrong user_google_email (e.g. a contact's address)."
        )

    canvas_headers = canvas_mcp_headers
    if canvas_mcp and canvas_headers is None:
        canvas_headers = mcp_canvas_request_headers(
            api_token=settings.canvas_api_token,
            domain=settings.canvas_domain,
            api_url=settings.canvas_api_url,
        )

    mcp_runtime = None
    _keepalive_task: asyncio.Task | None = None
    if canvas_mcp or gws_mcp:
        try:
            mcp_runtime = await build_mcp_runtime(
                canvas_url=settings.mcp_canvas_url or None,
                google_url=settings.mcp_google_workspace_url or None,
                canvas_http_headers=canvas_headers if canvas_mcp else None,
                max_tools=settings.mcp_max_tools,
                desc_max_chars=settings.mcp_tool_description_max_chars,
                gws_user_email=effective_user_google,
            )
        except Exception:
            logger.exception(
                "Failed to connect to MCP servers; no tools available for this request"
            )
            mcp_runtime = None

    # Keep MCP sessions alive while the LLM is thinking (GWS MCP has a ~10 s idle timeout).
    # Pings are sent every 5 s so the session never goes idle between tool calls.
    if mcp_runtime:
        async def _keepalive_loop():
            while True:
                await asyncio.sleep(5)
                await mcp_runtime.send_keepalive()   # type: ignore[union-attr]
        _keepalive_task = asyncio.create_task(_keepalive_loop())

    all_tools = list(mcp_runtime.tools) if mcp_runtime else []

    # Apply tool prefix filter for parallel agent sub-loops
    if tool_prefix_filter and all_tools:
        tools = [t for t in all_tools if t["function"]["name"].startswith(tool_prefix_filter)]
    else:
        tools = all_tools

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
    from datetime import date as _date
    today_str = _date.today().isoformat()   # e.g. "2026-04-05"
    system = (
        f"Today's date is {today_str}. "
        "Always use the current date when constructing time ranges for calendar, "
        "email, or task queries unless the user specifies otherwise. "
        "You are a concise academic assistant. "
        "Use the tools to fetch real data; never invent due dates or grades. "
        "If a source is missing, say so briefly. "
        "All Canvas data must come from canvas__* tools (Canvas MCP). "
        "Do not claim you cannot access Canvas if canvas__ tools are listed—call them. "
        "For tools with course_identifier, prefer the numeric course id from canvas__list_courses "
        "or the course_id printed by canvas__get_my_upcoming_assignments; short labels (e.g. SER594) "
        "can 404 if they are not the real Canvas course id. "
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
        "explain that once and stop—do not call the same failing tool repeatedly. "
        "IMPORTANT — to-do list vs Canvas todos: "
        "canvas__get_my_todo_items / canvas__list_todo_items shows upcoming Canvas ASSIGNMENT reminders — "
        "it is READ-ONLY and you CANNOT add items to it. "
        "When the user says 'add to my to-do list', 'add a task', 'add a reminder', or similar, "
        "they mean Google Tasks. Use gws__manage_task with action='create', "
        "task_list_id='@default', and the title the user specified. "
        "Do NOT call canvas__get_my_todo_items when adding tasks. "
        "Do NOT loop — if gws__manage_task with action=create succeeds or returns [HITL_PENDING], stop immediately. "
        "If a tool result contains [HITL_PENDING:...], tell the user: "
        "'I've queued this action — click the amber notification in the sidebar to approve it.' "
        "Do NOT say you are unable to perform the action. "
        "If multiple tools ran in the same turn and one result is [HITL_PENDING] while another asks for "
        "Google OAuth / People authorization: lead with the queued approval (the send or write is waiting "
        "for them in the UI). Only mention signing in to Google if a separate step truly failed for "
        "missing Workspace access—do not suggest OAuth blocks approving an email that is already queued."
    )
    if gws_mcp:
        system += (
            " Google Workspace tool quirks: "
            "Gmail: call gws__search_gmail_messages first, then gws__get_gmail_message_content "
            "using the full Message ID string from the search output (long alphanumeric id). "
            "Never use the list index (1, 2, …) as message_id; never call get_gmail_message_content "
            "in parallel with search before you have that id. "
            "For gws__get_gmail_message_content, body_format must be one of "
            "`text`, `html`, or `raw` (never `plain`). "
            "For gws__manage_drive_access, `action` must be one of: "
            "`grant`, `grant_batch`, `update`, `revoke`, `transfer_owner` (there is no `set`). "
            "If a tool result says the MCP server could not be reached, tell the user to start "
            "Workspace MCP (`./scripts/run-workspace-mcp-local.sh`, port 8002) and retry — do not "
            "retry the same tool until it is running. "
            "Gmail READ-ONLY (latest email, unread, search inbox, open a message): use ONLY "
            "gws__search_gmail_messages and gws__get_gmail_message_content (and related Gmail read tools). "
            "Do NOT call gws__search_contacts or gws__list_contacts for these requests. "
            "EMAIL RECIPIENTS (send or draft only): When the user wants to send or draft mail and the "
            "recipient address is missing or ambiguous—not when merely reading mail—resolve it before "
            "send/draft tools: gws__search_contacts or gws__list_contacts, then if needed "
            "gws__search_gmail_messages for past threads with that person; if still unclear, ask the user "
            "for the exact address. Never invent or guess email addresses. "
            "CONTACT LOOKUP BY NAME: If the user wants to find someone in their Google contacts or "
            "address book, use gws__search_contacts (preferred, pass the name as query) or gws__list_contacts. "
            "Do NOT use gws__search_gmail_messages for contact-only lookup. "
            "VOICE / SPEECH: The user message may be speech-to-text—names may appear with spurious spaces "
            "between letters or sound-alike words (e.g. 'survey' vs a person's name). Infer the intended "
            "person name and search contacts with that name, not a nonsense Gmail query."
        )
    if canvas_mcp and not mcp_has_canvas:
        system += (
            " Note: MCP_CANVAS_URL is configured but no canvas__ tools were registered—"
            "Canvas MCP may have failed to connect; say Canvas MCP is unavailable."
        )

    # Inject the authenticated user's Google email so gws__ tools receive user_google_email.
    # This is REQUIRED in OAuth 2.0 mode — every gws__ tool call must include it.
    if effective_user_google:
        system += (
            f"\n\nAUTHENTICATED USER EMAIL (Google Workspace identity): {effective_user_google}\n"
            f"CRITICAL: Every gws__* tool call MUST use user_google_email=\"{effective_user_google}\" "
            "only—the logged-in user's Google account. Never use the email of a recipient, contact, or "
            "other person as user_google_email.\n"
            f"GOOGLE TASKS: To create a task use ONLY gws__manage_task with EXACTLY these params: "
            f'action="create", task_list_id="@default", title="<task title>", user_google_email="{effective_user_google}". '
            "Do NOT call list_task_lists first. Do NOT call manage_drive_access or any other tool. "
            "task_list_id='@default' is always valid — never change it."
        )

    # Inject user memory context into system prompt
    if db_session and user_id:
        try:
            from app.memory import read_memory
            memory_str = await read_memory(db_session, user_id)
            if memory_str:
                system += f"\n\n{memory_str}"
        except Exception:
            logger.debug("Failed to read user memory", exc_info=True)

    if voice_mode:
        system += (
            "\n\nVOICE SESSION: The user sees this reply as on-screen text in the voice UI. "
            "Give a complete, useful answer (assignments with names and due dates, etc.)—do not "
            "short-change detail they need to read. "
            "Prefer plain sentences; avoid markdown headings and asterisk bullets so the transcript stays readable. "
            "A separate short line will be used for spoken audio; you do not need to optimize for brevity. "
            "The latest user message is from speech recognition—it may be imperfect; reason about likely names "
            "and intents before choosing tools."
        )

    _tool_cap = tool_result_char_budget(voice_mode=voice_mode)

    # HITL write-tool list
    hitl_tools: set[str] = set()
    if db_session and user_id:
        hitl_tools = {t.strip() for t in settings.hitl_write_tools.split(",") if t.strip()}

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        *_history_as_messages(history),
        {"role": "user", "content": user_message},
    ]
    sources: list[str] = []
    tool_trace: list[dict[str, Any]] = []
    # Cap at 8 for voice (fast responses); config can raise it for text chat
    max_rounds = max(4, min(8, settings.openai_max_tool_rounds))

    _final_reply: str = ""
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
                names_in_turn = {tc.function.name for tc in msg.tool_calls}
                # Gmail list + fetch in one model turn always race (gather runs both before the
                # model sees search output), which yields bogus message_id values and 404s—more
                # common under voice latency pressure. Force a second turn after search results.
                block_gmail_get_after_search = (
                    "gws__search_gmail_messages" in names_in_turn
                    and "gws__get_gmail_message_content" in names_in_turn
                )

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
                    if block_gmail_get_after_search and tool_name == "gws__get_gmail_message_content":
                        return (
                            "Skipped: get_gmail_message_content was bundled with search_gmail_messages "
                            "in the same assistant turn, so the real message_id was not available yet. "
                            "Read the search_gmail_messages result above, copy the full Message ID "
                            "(long alphanumeric string, not the list number 1/2/…), then call "
                            "get_gmail_message_content alone in your next turn with that message_id.",
                            "gmail_sequence",
                        )
                    # Notify caller (e.g. voice SSE stream) of in-progress tool call
                    if status_callback:
                        label = TOOL_DISPLAY_LABELS.get(
                            tool_name,
                            "Using " + tool_name.replace("canvas__", "").replace("gws__", "").replace("_", " "),
                        )
                        try:
                            status_callback({"type": "tool_call", "tool": tool_name, "label": label})
                        except Exception:
                            pass

                    # HITL: intercept write tools — queue for user approval instead of executing
                    if hitl_tools and tool_name in hitl_tools and db_session and user_id:
                        try:
                            from app.models import PendingAction
                            from app.db import session_factory as _sf
                            import json as _json
                            async with _sf()() as _s:
                                action = PendingAction(
                                    user_id=user_id,
                                    action_type=tool_name,
                                    payload_json=_json.dumps(args_obj),
                                )
                                _s.add(action)
                                await _s.commit()
                                await _s.refresh(action)
                                action_id = action.id
                            return (
                                f"[HITL_PENDING:{action_id}] This action requires your approval before execution. "
                                "Please check the pending actions panel in the UI to approve or reject.",
                                "hitl_pending",
                            )
                        except Exception:
                            logger.exception("HITL intercept failed for %s", tool_name)

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
                mcp_unreachable_abort: str | None = None
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
                    low = text.lower()
                    if (
                        src == "mcp_error"
                        and mcp_unreachable_abort is None
                        and (
                            "could not reach" in low
                            or "connection failed" in low
                            or "server unreachable" in low
                        )
                    ):
                        mcp_unreachable_abort = text.strip()

                for tc, _args, (text, _src) in zipped:
                    # Voice uses a smaller default tool cap; contact lists are often huge—do not truncate
                    # so badly that names in the roster never reach the model (causes chat vs voice mismatch).
                    _cap = _tool_cap
                    if tc.function.name in (
                        "gws__list_contacts",
                        "gws__search_contacts",
                    ):
                        _cap = max(_tool_cap, 14_000)
                    model_tool_text = condense_tool_text(
                        text, tc.function.name, max_chars=_cap
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": model_tool_text,
                        }
                    )

                if mcp_unreachable_abort is not None:
                    r = (
                        strip_markdown_for_speech(mcp_unreachable_abort)
                        if voice_mode
                        else mcp_unreachable_abort
                    )
                    return r, sources, tool_trace
                if auth_abort is not None:
                    r = strip_markdown_for_speech(auth_abort) if voice_mode else auth_abort
                    return r, sources, tool_trace

                continue

            text = (msg.content or "").strip()
            _final_reply = text or "(empty model response)"
            if voice_mode:
                _final_reply = strip_markdown_for_speech(_final_reply)
            return (_final_reply, sources, tool_trace)

        _final_reply = "Too many tool rounds — try a shorter request or fewer actions at once."
        if voice_mode:
            _final_reply = strip_markdown_for_speech(_final_reply)
        return (_final_reply, sources, tool_trace)
    finally:
        # Cancel keepalive before closing sessions
        if _keepalive_task:
            _keepalive_task.cancel()
            try:
                await _keepalive_task
            except asyncio.CancelledError:
                pass
        if mcp_runtime:
            await mcp_runtime.aclose()
        # Fire-and-forget memory write (never blocks the response)
        if db_session and user_id and _final_reply and tool_trace:
            try:
                from app.db import session_factory as _sf
                from app.memory import write_memory
                convo = f"User: {user_message}\nAssistant: {_final_reply}"
                asyncio.create_task(
                    write_memory(_sf(), user_id, convo, AsyncOpenAI(api_key=settings.openai_api_key), settings.openai_model)
                )
            except Exception:
                pass
