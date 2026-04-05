import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import init_db
from app.routers import chat, health, hitl, me

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    s = get_settings()
    if not s.mcp_google_workspace_url.strip():
        logger.warning(
            "MCP_GOOGLE_WORKSPACE_URL is unset — no gws__ (Google Workspace) tools in chat. "
            "If workspace-mcp runs in Docker on your machine, add e.g. "
            "MCP_GOOGLE_WORKSPACE_URL=http://127.0.0.1:8002/mcp to apps/gateway/.env "
            "when the gateway runs on the host (not inside compose)."
        )
    if not s.mcp_canvas_url.strip():
        logger.warning(
            "MCP_CANVAS_URL is unset — no canvas__ tools; Canvas in chat requires Canvas MCP."
        )
    yield


app = FastAPI(title="Academic Copilot Gateway", lifespan=lifespan)

settings = get_settings()
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(me.router)
app.include_router(chat.router)
app.include_router(hitl.router)
