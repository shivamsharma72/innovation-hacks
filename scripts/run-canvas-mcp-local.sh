#!/usr/bin/env bash
# Run Python canvas-mcp (FastMCP) on streamable HTTP for the Academic Copilot gateway.
# Gateway forwards each user's Canvas token + https://<domain>/api/v1 via request headers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/canvas-mcp"

HOST="${CANVAS_MCP_HOST:-127.0.0.1}"
PORT="${CANVAS_MCP_PORT:-3001}"

if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    echo "Stopping old listener on port $PORT (PID $pid)" >&2
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.3
fi

if [[ ! -x .venv/bin/canvas-mcp-server ]]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv .venv
    uv pip install --python .venv/bin/python -e .
  else
    python3 -m venv .venv
    .venv/bin/pip install -e .
  fi
fi

echo "Canvas MCP (python): http://${HOST}:${PORT}/mcp — install deps with: cd canvas-mcp && uv pip install -e ." >&2
exec .venv/bin/canvas-mcp-server --transport streamable-http --host "$HOST" --port "$PORT"
