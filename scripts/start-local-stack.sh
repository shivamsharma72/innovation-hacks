#!/usr/bin/env bash
# Run Workspace MCP (:8002), Canvas MCP (:3001), gateway (:8000), then Next.js (:3000).
# Press Ctrl+C to stop all child processes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

echo "==> Workspace MCP (http://127.0.0.1:8002/mcp)"
"$ROOT/scripts/run-workspace-mcp-local.sh" &
PIDS+=($!)

echo "==> Canvas MCP (http://127.0.0.1:3001/mcp)"
"$ROOT/scripts/run-canvas-mcp-local.sh" &
PIDS+=($!)

echo "Waiting for MCP servers to listen…"
sleep 4

GW="$ROOT/apps/gateway"
if [[ ! -x "$GW/.venv/bin/python" ]]; then
  echo "Gateway venv missing. Run: cd apps/gateway && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi

echo "==> Gateway (http://127.0.0.1:8000)"
(
  cd "$GW"
  # shellcheck disable=SC1091
  source .venv/bin/activate
  exec uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
PIDS+=($!)

sleep 2

echo "==> Web (http://localhost:3000)"
cd "$ROOT/apps/web"
npm run dev
