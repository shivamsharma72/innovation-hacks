"""
LangGraph wrapper around the OpenAI tool loop.

Write actions will add an interrupt node here; read-only paths go straight through.
"""

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.agent.openai_tools import run_agent_conversation


class AgentState(TypedDict, total=False):
    auth0_sub: str
    user_id: int
    message: str
    history: list[dict[str, str]]
    # Per-request Canvas MCP auth (python canvas-mcp: X-Canvas-Token / X-Canvas-URL).
    canvas_mcp_headers: dict[str, str]
    reply_text: str
    sources: list[str]
    tool_trace: list[dict[str, object]]


async def agent_node(state: AgentState) -> dict:
    reply, sources, tool_trace = await run_agent_conversation(
        state["message"],
        history=state.get("history"),
        canvas_mcp_headers=state.get("canvas_mcp_headers"),
    )
    return {"reply_text": reply, "sources": sources, "tool_trace": tool_trace}


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("agent", agent_node)
    g.add_edge(START, "agent")
    g.add_edge("agent", END)
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
