#!/usr/bin/env bash
# Run Google Workspace MCP on :8002 (streamable HTTP). Reads Google + USER_GOOGLE_EMAIL from apps/gateway/.env when present.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WS="$ROOT/google_workspace_mcp"
cd "$WS"

CREDS_DIR="${WORKSPACE_MCP_CREDENTIALS_DIR:-$WS/store_creds_local}"
mkdir -p "$CREDS_DIR"
export WORKSPACE_MCP_CREDENTIALS_DIR="$CREDS_DIR"

if [[ -f "$ROOT/apps/gateway/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/apps/gateway/.env"
  set +a
fi

export PORT="${PORT:-8002}"
export WORKSPACE_MCP_HOST="${WORKSPACE_MCP_HOST:-0.0.0.0}"
export WORKSPACE_MCP_BASE_URI="${WORKSPACE_MCP_BASE_URI:-http://localhost}"
export WORKSPACE_EXTERNAL_URL="${WORKSPACE_EXTERNAL_URL:-http://localhost:${PORT}}"
export GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-http://localhost:${PORT}/oauth2callback}"
export MCP_ENABLE_OAUTH21=false
export WORKSPACE_MCP_STATELESS_MODE=false
export OAUTHLIB_INSECURE_TRANSPORT=1

if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    echo "Stopping old listener on port $PORT (PID $pid)" >&2
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.3
fi

# uv warns if VIRTUAL_ENV points at a different project than google_workspace_mcp/.venv
unset VIRTUAL_ENV

if ! command -v uv >/dev/null 2>&1; then
  echo "Install uv: https://docs.astral.sh/uv/ — or from google_workspace_mcp run: uv run main.py --transport streamable-http" >&2
  exit 1
fi

exec uv run main.py --transport streamable-http
