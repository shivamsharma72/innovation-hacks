from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    auth0_domain: str = ""
    auth0_audience: str = ""

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    # Tool loop iterations (each assistant turn that uses tools counts as one).
    # Lower = fewer LLM calls / cost; raise via env for long multi-tool flows.
    openai_max_tool_rounds: int = 18

    # Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
    encryption_key: str = ""

    database_url: str = "sqlite+aiosqlite:///./gateway.db"

    google_client_id: str = ""
    google_client_secret: str = ""

    cors_origins: str = "http://localhost:3000"

    # Dev bypass: set SKIP_AUTH=true only on local machine
    skip_auth: bool = False

    # Streamable HTTP MCP endpoints (optional). Example Docker:
    # MCP_CANVAS_URL=http://canvas-mcp:3000/mcp
    # MCP_GOOGLE_WORKSPACE_URL=http://workspace-mcp:8000/mcp
    mcp_canvas_url: str = ""
    mcp_google_workspace_url: str = ""
    # Optional fallback for Canvas MCP (python canvas-mcp) when not using per-user DB creds:
    # CANVAS_API_URL=https://school.instructure.com/api/v1  OR  CANVAS_DOMAIN=school.instructure.com
    canvas_api_token: str = ""
    canvas_domain: str = ""
    canvas_api_url: str = ""
    mcp_max_tools: int = 120
    mcp_tool_description_max_chars: int = 400

    # Shown when Workspace MCP returns auth errors (browser URL, e.g. http://localhost:8002).
    mcp_workspace_browser_url: str = ""

    # Include per-request tool call trace in POST /chat JSON (dev / debugging).
    chat_include_tool_trace: bool = False

    # ElevenLabs TTS
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"  # default: George

    # Comma-separated OpenAI tool names that require HITL approval before execution.
    # Only truly irreversible actions (send email, delete events) need approval.
    # Task create/update is non-destructive so it is NOT gated by default.
    hitl_write_tools: str = "gws__send_gmail_message"


@lru_cache
def get_settings() -> Settings:
    return Settings()
