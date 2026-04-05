"""
Human-in-the-loop placeholder for calendar / Gmail / Canvas writes.

Flow (to implement): LangGraph interrupt → persist pending payload →
POST /agent/hitl/{id}/approve | /reject from UI after user reviews exact JSON.
"""

from fastapi import APIRouter, Depends

from app.auth_jwt import get_auth0_payload

router = APIRouter(prefix="/agent", tags=["agent"])


@router.get("/hitl/pending")
async def list_pending(payload: dict = Depends(get_auth0_payload)):
    _ = payload.get("sub")
    return {
        "items": [],
        "message": "No pending write actions. Read-only agent is active; approve/reject endpoints will be wired for writes.",
    }
