"""
LangGraph agent graph.

Topology:
  START → intent_router → (conditional)
    - if needs_canvas AND needs_gws  → parallel_agent → synthesizer → END
    - otherwise                      → agent (single loop)         → END

The 'agent' node handles all single-domain queries (canvas-only, gws-only, or
pure-knowledge) exactly as before — unchanged behaviour for the common case.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.openai_tools import run_agent_conversation
from app.config import get_settings
from app.text_sanitize import strip_markdown_for_speech

logger = logging.getLogger(__name__)


class AgentState(TypedDict, total=False):
    auth0_sub: str
    user_id: int
    session_id: int
    message: str
    history: list[dict[str, str]]
    canvas_mcp_headers: dict[str, str]
    reply_text: str
    sources: list[str]
    tool_trace: list[dict[str, object]]
    # Parallel agent fields
    needs_canvas: bool
    needs_gws: bool
    canvas_result: str
    gws_result: str
    # Injected by caller for memory / HITL
    db_session: Any  # AsyncSession | None — not serialisable, passed in-process only
    # Authenticated user's Google email (from Auth0 JWT) — required by every gws__ tool call
    user_email: str
    # Real-time tool-status callback (voice SSE stream)
    status_callback: Any  # Callable | None — not serialisable
    # Voice / SSE stream: tighter tool payloads and plain spoken replies
    voice_mode: bool


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

async def intent_router_node(state: AgentState) -> dict:
    """Cheap LLM call to decide which MCP servers are needed."""
    settings = get_settings()
    if not settings.openai_api_key:
        return {"needs_canvas": True, "needs_gws": False}

    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        resp = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Classify the user query. "
                        "Return ONLY valid JSON with two boolean keys: "
                        "needs_canvas (true if the query needs Canvas LMS data: courses, "
                        "assignments, grades, discussions, submissions), "
                        "needs_gws (true if it needs Google Workspace: Gmail, Calendar, "
                        "Drive, Tasks, Docs, Sheets, Contacts). "
                        "Example: {\"needs_canvas\": true, \"needs_gws\": false}"
                    ),
                },
                {"role": "user", "content": state.get("message", "")},
            ],
            max_tokens=40,
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        parsed = json.loads(raw)
        return {
            "needs_canvas": bool(parsed.get("needs_canvas", True)),
            "needs_gws": bool(parsed.get("needs_gws", False)),
        }
    except Exception:
        logger.debug("intent_router failed, defaulting to canvas-only", exc_info=True)
        return {"needs_canvas": True, "needs_gws": False}


async def agent_node(state: AgentState) -> dict:
    """Single-domain sequential agent (existing behaviour, untouched logic)."""
    reply, sources, tool_trace = await run_agent_conversation(
        state["message"],
        history=state.get("history"),
        canvas_mcp_headers=state.get("canvas_mcp_headers"),
        user_id=state.get("user_id"),
        user_email=state.get("user_email"),
        db_session=state.get("db_session"),
        status_callback=state.get("status_callback"),
        voice_mode=bool(state.get("voice_mode")),
    )
    return {"reply_text": reply, "sources": sources, "tool_trace": tool_trace}


async def parallel_agent_node(state: AgentState) -> dict:
    """Fan-out: run canvas and gws tool loops concurrently, store raw results."""
    vm = bool(state.get("voice_mode"))

    async def _canvas_loop() -> str:
        text, _, _ = await run_agent_conversation(
            state["message"],
            history=state.get("history"),
            canvas_mcp_headers=state.get("canvas_mcp_headers"),
            user_id=state.get("user_id"),
            user_email=state.get("user_email"),
            db_session=state.get("db_session"),
            tool_prefix_filter="canvas__",
            voice_mode=vm,
        )
        return text

    async def _gws_loop() -> str:
        text, _, _ = await run_agent_conversation(
            state["message"],
            history=state.get("history"),
            canvas_mcp_headers=state.get("canvas_mcp_headers"),
            user_id=state.get("user_id"),
            user_email=state.get("user_email"),
            db_session=state.get("db_session"),
            tool_prefix_filter="gws__",
            voice_mode=vm,
        )
        return text

    canvas_result, gws_result = await asyncio.gather(
        _canvas_loop(), _gws_loop()
    )
    return {"canvas_result": canvas_result, "gws_result": gws_result, "sources": ["mcp_canvas", "mcp_google"]}


async def synthesizer_node(state: AgentState) -> dict:
    """Merge canvas_result + gws_result into a single reply."""
    settings = get_settings()
    vm = bool(state.get("voice_mode"))
    if not settings.openai_api_key:
        combined = f"Canvas: {state.get('canvas_result', '')}\n\nWorkspace: {state.get('gws_result', '')}"
        reply0 = strip_markdown_for_speech(combined) if vm else combined
        return {"reply_text": reply0}

    try:
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        sys_syn = (
            "You are a concise academic assistant. "
            "Synthesize the two data sources below into one clear, "
            "helpful answer to the user's question. "
            "Do not repeat raw data — summarise and connect insights."
        )
        if vm:
            sys_syn += (
                " The user may hear this via text-to-speech: use plain sentences only, "
                "no markdown headings or bullet stars, and keep it brief."
            )
        resp = await client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": sys_syn,
                },
                {
                    "role": "user",
                    "content": (
                        f"Question: {state.get('message', '')}\n\n"
                        f"CANVAS DATA:\n{state.get('canvas_result', '(none)')}\n\n"
                        f"GOOGLE WORKSPACE DATA:\n{state.get('gws_result', '(none)')}"
                    ),
                },
            ],
            max_tokens=1024,
        )
        reply = (resp.choices[0].message.content or "").strip()
    except Exception:
        logger.exception("synthesizer_node LLM call failed")
        reply = (
            f"Canvas: {state.get('canvas_result', '')}\n\n"
            f"Workspace: {state.get('gws_result', '')}"
        )

    if vm:
        reply = strip_markdown_for_speech(reply)
    return {"reply_text": reply}


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

def _route_entry(state: AgentState) -> str:
    """Always classify intent so Canvas+Workspace parallel routing stays correct."""
    return "intent_router"


def _route_after_intent(state: AgentState) -> str:
    if state.get("needs_canvas") and state.get("needs_gws"):
        return "parallel_agent"
    return "agent"


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_graph():
    g = StateGraph(AgentState)

    g.add_node("intent_router", intent_router_node)
    g.add_node("agent", agent_node)
    g.add_node("parallel_agent", parallel_agent_node)
    g.add_node("synthesizer", synthesizer_node)

    g.add_conditional_edges(START, _route_entry, {
        "agent": "agent",
        "intent_router": "intent_router",
    })
    g.add_conditional_edges("intent_router", _route_after_intent, {
        "agent": "agent",
        "parallel_agent": "parallel_agent",
    })
    g.add_edge("agent", END)
    g.add_edge("parallel_agent", "synthesizer")
    g.add_edge("synthesizer", END)

    return g.compile()


_compiled = None


def get_compiled_graph():
    global _compiled
    if _compiled is None:
        _compiled = build_graph()
    return _compiled


async def run_readonly_agent(state: AgentState) -> AgentState:
    graph = get_compiled_graph()
    out = await graph.ainvoke(state)
    return out  # type: ignore[return-value]
