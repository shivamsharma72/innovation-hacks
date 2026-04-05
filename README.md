# Innovation Hacks — Academic Copilot

Voice-ready academic assistant: **Next.js + Auth0** on the web, **FastAPI + LangGraph + OpenAI** gateway, **Canvas** (per-user token + optional Canvas MCP), and **Google** via **Workspace MCP** (one OAuth).

## Repo layout

| Path | Purpose |
|------|---------|
| [apps/web](apps/web) | Next.js UI — login, Canvas onboarding, chat |
| [apps/gateway](apps/gateway) | FastAPI — JWT, encrypted secrets, agent |
| [canvas-mcp](canvas-mcp) | Canvas MCP — Python FastMCP, streamable HTTP (`/mcp`) |
| [google_workspace_mcp](google_workspace_mcp) | Google Workspace MCP (Gmail, Calendar, …) |
| [docker-compose.yml](docker-compose.yml) | Optional: all services in containers |
| [scripts/](scripts/) | Helpers for **local** MCP processes |

## Quick start — everything **without Docker**

Use **four terminals**. Put shared secrets in **`apps/gateway/.env`** once (`GOOGLE_CLIENT_*`, `CANVAS_*`, `USER_GOOGLE_EMAIL`, Auth0, OpenAI, `ENCRYPTION_KEY`, …).

### 0. Auth0 (web + gateway)

- Application: Regular Web App, URLs for `http://localhost:3000`
- **API**: create an API → **Identifier** = `AUTH0_AUDIENCE` in web + gateway

### 1. Google Workspace MCP — port **8002**

Requires **[uv](https://docs.astral.sh/uv/)** in `google_workspace_mcp`:

```bash
./scripts/run-workspace-mcp-local.sh
```

Uses **`apps/gateway/.env`** for Google client id/secret and **`USER_GOOGLE_EMAIL`**. Tokens are stored under **`google_workspace_mcp/store_creds_local/`** (override with `WORKSPACE_MCP_CREDENTIALS_DIR`).

Open **`http://localhost:8002`** for the help page; complete Google OAuth when a chat tool returns an auth link.

### 2. Canvas MCP — port **3001**

```bash
./scripts/run-canvas-mcp-local.sh
```

Uses the Python server in **`canvas-mcp/`** (FastMCP + uvicorn). First run creates **`canvas-mcp/.venv`** and installs the package. The gateway sends each user’s Canvas token and **`https://<domain>/api/v1`** on every MCP request as **`X-Canvas-Token`** and **`X-Canvas-URL`** (from onboarding — no Canvas secrets need to live in the MCP process).

### 3. Gateway — port **8000**

```bash
cd apps/gateway
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # if needed; fill all required keys
```

In **`apps/gateway/.env`** set MCP endpoints for **host** networking:

```env
MCP_CANVAS_URL=http://127.0.0.1:3001/mcp
MCP_GOOGLE_WORKSPACE_URL=http://127.0.0.1:8002/mcp
MCP_WORKSPACE_BROWSER_URL=http://localhost:8002
```

Then:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Web — port **3000**

```bash
cd apps/web
cp .env.local.example .env.local
# AUTH0_* + AUTH0_AUDIENCE + GATEWAY_URL=http://127.0.0.1:8000
npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → log in → Canvas onboarding → Chat.

---

## Later: Docker (when you want one command)

```bash
# apps/gateway/.env must exist; compose overrides MCP_* URLs for in-network services
docker compose up --build
```

Gateway listens on **8000**; do **not** run host `uvicorn` on **8000** at the same time.

## Environment variables

- **Web:** see [apps/web/.env.local.example](apps/web/.env.local.example)
- **Gateway:** see [apps/gateway/.env.example](apps/gateway/.env.example)

## Writes / HITL

Read-only tools are implemented first. Any calendar/email/Canvas **write** must go through a **human approval** step (LangGraph interrupt + UI) — scaffold next.

## Google (Calendar, Gmail, …)

Use **Workspace MCP** OAuth once (e.g. `http://localhost:8002` with Docker). Put **`GOOGLE_CLIENT_ID`** / **`GOOGLE_CLIENT_SECRET`** in **`apps/gateway/.env`** and allow redirect **`http://localhost:8002/oauth2callback`** on that OAuth client. The chat agent uses **`gws__*`** tools from MCP—there is no separate “Connect Google Calendar” flow in the web app.
