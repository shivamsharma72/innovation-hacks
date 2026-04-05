# Academic Copilot — Full Architecture & Status

> **What it is:** A multi-agent AI assistant for students and instructors that connects Canvas LMS and Google Workspace into a single conversational and voice interface. You can ask it about assignments, grades, emails, calendar, tasks, and more — in both text and voice.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Monorepo Layout](#2-monorepo-layout)
3. [Web Frontend (apps/web)](#3-web-frontend-appsweb)
4. [API Gateway (apps/gateway)](#4-api-gateway-appsgateway)
5. [Canvas MCP Server](#5-canvas-mcp-server)
6. [Google Workspace MCP Server](#6-google-workspace-mcp-server)
7. [Database Schema](#7-database-schema)
8. [Authentication & Auth0](#8-authentication--auth0)
9. [MCP Protocol & Session Lifecycle](#9-mcp-protocol--session-lifecycle)
10. [Agent Architecture (LangGraph)](#10-agent-architecture-langgraph)
11. [Voice Pipeline](#11-voice-pipeline)
12. [Human-in-the-Loop (HITL)](#12-human-in-the-loop-hitl)
13. [Data Flow Diagrams](#13-data-flow-diagrams)
14. [Environment Variables](#14-environment-variables)
15. [Local Development Setup](#15-local-development-setup)
16. [What Works Right Now](#16-what-works-right-now)
17. [Known Issues & Limitations](#17-known-issues--limitations)
18. [What Is Not Done Yet](#18-what-is-not-done-yet)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (port 3000)                         │
│   Next.js 15 + React 19 + Tailwind CSS + Auth0 (@auth0/nextjs-auth0)│
│                                                                      │
│  Pages: / | /chat | /voice | /dashboard | /history | /tasks         │
│  API Proxy routes → gateway on every request                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  HTTPS + Bearer JWT (Auth0)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FastAPI Gateway (port 8000)                       │
│                                                                      │
│  Auth: validates JWT against Auth0 JWKS endpoint                    │
│  Routers: /chat  /voice  /dashboard  /tasks  /history  /agent/hitl  │
│  Agent: LangGraph + OpenAI gpt-4o-mini + tool loop                  │
│  MCP Runtime: streamable-HTTP sessions to Canvas + GWS MCPs         │
│  DB: SQLite via SQLAlchemy async (gateway.db)                        │
└──────────┬───────────────────────────────┬──────────────────────────┘
           │  MCP streamable-HTTP           │  MCP streamable-HTTP
           ▼  (port 3001)                  ▼  (port 8002)
┌──────────────────────┐      ┌──────────────────────────────────────┐
│   Canvas MCP         │      │   Google Workspace MCP               │
│   (Python/FastMCP)   │      │   (Python/FastMCP)                   │
│                      │      │                                       │
│  90+ tools:          │      │  50+ tools:                          │
│  courses, assignments│      │  Gmail, Calendar, Drive,             │
│  grades, discussions │      │  Tasks, Docs, Sheets, Contacts       │
│  files, quizzes, etc │      │                                       │
│                      │      │  OAuth 2.0: credentials stored       │
│  Auth: X-Canvas-Token│      │  in store_creds_local/               │
│  header per request  │      │  (browser flow at /oauth/authorize)  │
└──────────────────────┘      └──────────────────────────────────────┘
```

---

## 2. Monorepo Layout

```
Innovation_hacks/
├── apps/
│   ├── web/                        Next.js 15 frontend
│   └── gateway/                    FastAPI backend + agent
├── canvas-mcp/                     Python Canvas MCP server (active, port 3001)
├── canvas-mcp2/                    TypeScript Canvas MCP (legacy/exploration)
├── mcp-canvas-lms/                 TypeScript Canvas MCP v2 (alternative)
├── google_workspace_mcp/           Python Google Workspace MCP (active, port 8002)
├── scripts/
│   ├── run-canvas-mcp-local.sh     Starts Canvas MCP locally
│   └── run-workspace-mcp-local.sh  Starts GWS MCP locally
├── docker-compose.yml              One-command full stack
└── ARCHITECTURE.md                 This file
```

---

## 3. Web Frontend (apps/web)

**Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Auth0 (`@auth0/nextjs-auth0`)

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `app/page.tsx` | Landing page — redirects to chat if logged in, else shows login |
| `/onboarding` | `app/onboarding/` | Canvas domain + personal access token entry (required first-time) |
| `/chat` | `app/chat/` | Full text chat with AI agent, HITL approval banner |
| `/voice` | `app/voice/` | Voice-only mode with ring visualizer and real-time SSE tool traces |
| `/dashboard` | `app/dashboard/` | Canvas course cards with upcoming assignment counts |
| `/history` | `app/history/` | Past chat sessions — click to resume |
| `/tasks` | `app/tasks/` | Google Tasks viewer with create/complete |

### Shared Layout

`app/layout.tsx` wraps all pages with `<AppLayout>` which includes:
- **Sidebar** (`src/components/layout/Sidebar.tsx`): nav links with HITL badge (polls `/api/gateway/hitl` every 30 s), user email, logout
- **AppLayout** (`src/components/layout/AppLayout.tsx`): Auth0 session check, sidebar + main content area

### Next.js API Proxy Routes

All requests to the gateway go through Next.js API routes that:
1. Verify the Auth0 session exists
2. Extract the access token
3. Forward the request to the gateway with `Authorization: Bearer <token>`

```
app/api/gateway/
├── chat/route.ts                   POST → /chat
├── voice/route.ts                  POST → /chat/voice (legacy single-shot audio)
├── voice/stream/route.ts           POST → /chat/voice/stream (SSE, passes body through)
├── voice/tts/route.ts              POST → /chat/tts (ElevenLabs TTS proxy)
├── dashboard/route.ts              GET  → /dashboard/courses
├── history/route.ts                GET  → /history
├── history/[id]/route.ts           GET  → /history/{id}
├── hitl/route.ts                   GET  → /agent/hitl/pending
├── hitl/[id]/route.ts              POST → /agent/hitl/{id}/approve|reject
├── tasks/route.ts                  GET/POST → /tasks
├── tasks/[id]/route.ts             PATCH → /tasks/{id}
└── me/canvas/route.ts              POST → /me/canvas
```

### Key Frontend Features

**Chat UI (`app/chat/ui.tsx`)**
- Message history with markdown rendering
- Tool trace display (expandable, shown when `CHAT_INCLUDE_TOOL_TRACE=true`)
- HITL approval banner: amber banner with approve/reject per pending action
- Session ID tracking — sends `session_id` in requests to resume previous conversations
- Voice mode button (🎙) — opens `/voice`

**Voice UI (`app/voice/ui.tsx`)**
- **Ring visualizer**: animated SVG circle that pulses with microphone RMS level, changes color by status (`idle`/`listening`/`processing`/`speaking`)
- **Web Speech API** (`SpeechRecognition`): Chrome/Edge only; graceful fallback message for other browsers
- **Silence detection**: RMS < 10 for 1000 ms → auto-stop recognition and send to agent
- **Barge-in**: RMS > 25 for 220 ms while agent is speaking → `stopPlayback()` immediately halts audio + sets `playbackCancelRef = true` to exit the sentence playback loop
- **ElevenLabs TTS**: sentence-level streaming pipeline — reply text is split into sentences, each fetched individually, sentence N+1 pre-fetched while sentence N plays → time-to-first-audio ≈ 300–500 ms
- **Browser TTS fallback**: if ElevenLabs key not configured, uses `window.speechSynthesis`
- **Preamble**: agent emits a context phrase ("Let me check Canvas for you") via SSE immediately; this is spoken while the agent is still fetching data
- **Tool trace panel**: live "Thinking…" indicator with strikethrough completed steps
- **Transcript sidebar**: user and agent turns with thought bubbles showing which tools were called

---

## 4. API Gateway (apps/gateway)

**Stack:** FastAPI, SQLModel, LangGraph, OpenAI SDK, `mcp` Python SDK, httpx, SQLite/aiosqlite

### Routers

| Router | Endpoints | Description |
|--------|-----------|-------------|
| `routers/chat.py` | `POST /chat` | Main text chat endpoint; runs LangGraph agent, persists session+messages |
| `routers/voice.py` | `POST /chat/voice/stream` | SSE stream: preamble → tool_call events → reply text |
| | `POST /chat/tts` | Standalone text-to-speech via ElevenLabs |
| | `POST /chat/voice` | Legacy single-shot audio (kept for compatibility) |
| `routers/dashboard.py` | `GET /dashboard/courses` | Canvas course list with upcoming assignment counts, 5-min TTL cache |
| `routers/me.py` | `GET /me` | Current user profile |
| | `POST /me/canvas` | Store Canvas domain + API token (onboarding) |
| `routers/history.py` | `GET /history` | Last 50 `ChatSession` rows for user |
| | `GET /history/{session_id}` | Full session with all messages (ownership verified) |
| `routers/hitl.py` | `GET /agent/hitl/pending` | List pending `PendingAction` rows for user |
| | `POST /agent/hitl/{id}/approve` | Execute action, mark as `executed` |
| | `POST /agent/hitl/{id}/reject` | Mark as `rejected` |
| `routers/tasks.py` | `GET /tasks` | List Google Tasks via GWS MCP |
| | `POST /tasks` | Create a task |
| | `PATCH /tasks/{task_id}` | Update a task (complete, rename, etc.) |
| `routers/health.py` | `GET /health` | Returns `{"status": "ok"}` |

### Core Modules

**`config.py`** — `Settings` (pydantic-settings, reads `.env`):
```python
auth0_domain, auth0_audience
openai_api_key, openai_model = "gpt-4o-mini", openai_max_tool_rounds = 18
encryption_key          # Fernet key for Canvas token storage
database_url            # SQLite by default
google_client_id/secret # Used by workspace-mcp OAuth
cors_origins
mcp_canvas_url, mcp_google_workspace_url
mcp_max_tools = 120, mcp_tool_description_max_chars = 400
mcp_workspace_browser_url
elevenlabs_api_key, elevenlabs_voice_id = "JBFqnCBsd6RMkjVDRZzb"
hitl_write_tools = "gws__send_gmail_message"
chat_include_tool_trace = False
skip_auth = False
```

**`auth_jwt.py`** — validates Auth0 JWTs using PyJWKClient against `/.well-known/jwks.json`

**`crypto_util.py`** — Fernet symmetric encryption for Canvas personal access tokens at rest

**`canvas_mcp_util.py`** — builds `X-Canvas-Token` and `X-Canvas-URL` headers passed to Canvas MCP per request

**`memory.py`** — user memory layer:
- `read_memory(session, user_id)` → compact string injected into LLM system prompt
- `write_memory(...)` → fire-and-forget: after each conversation, cheap GPT call extracts `top_courses`, `communication_style`, `preferred_schedule_view`, `frequent_contacts`, upserts into `UserMemory`

**`hitl_executor.py`** — rebuilds a minimal MCP runtime to execute approved `PendingAction` records

**`mcp_runtime.py`** — MCP session management:
- `build_mcp_runtime(...)` → connects to Canvas + GWS MCPs, lists all tools, keeps sessions alive in `AsyncExitStack`, returns `McpToolRuntime`
- `McpToolRuntime.dispatch_mcp(openai_name, args)` → routes tool calls; if session is dead, reconnects once transparently
- `McpToolRuntime.send_keepalive()` → sends `session.send_ping()` to all live sessions (called every 5 s to prevent server-side idle timeout)
- `McpToolRuntime.aclose()` → closes all sessions, suppresses cleanup errors from dead sessions

### Agent Architecture

Described fully in [Section 10](#10-agent-architecture-langgraph).

---

## 5. Canvas MCP Server

**Location:** `canvas-mcp/` | **Port:** 3001 | **Framework:** Python + FastMCP

The Canvas MCP server exposes 90+ tools for interacting with the Canvas LMS API. Each request carries the user's personal Canvas API token as `X-Canvas-Token` and their domain as `X-Canvas-URL` — passed by the gateway from the encrypted credential in the database. This means the Canvas MCP is stateless: it never stores credentials itself.

**Key tool categories:**

| Category | Example Tools |
|----------|--------------|
| Courses | `list_courses`, `get_course_details` |
| Assignments | `list_assignments`, `get_assignment`, `create_assignment` |
| Grades | `get_course_grades`, `get_my_submission_status` |
| Submissions | `list_submissions`, `bulk_grade_submissions` |
| Discussions | `list_discussions`, `post_discussion_entry` |
| Modules/Pages | `list_modules`, `list_pages`, `get_page` |
| Files | `list_files`, `get_file_details` |
| Calendar | `list_calendar_events` |
| Todo/Reminders | `get_my_todo_items` (READ-ONLY, Canvas assignment reminders — NOT Google Tasks) |
| Quizzes | `list_quizzes`, `get_quiz` |
| Announcements | `list_announcements`, `create_announcement` |
| Messaging | `send_conversation` |

> **Important distinction:** `canvas__get_my_todo_items` shows Canvas assignment reminders. It is read-only and has nothing to do with Google Tasks. The system prompt explicitly tells the LLM this.

---

## 6. Google Workspace MCP Server

**Location:** `google_workspace_mcp/` | **Port:** 8002 | **Framework:** Python + FastMCP

Provides 50+ tools for Gmail, Google Calendar, Drive, Tasks, Docs, Sheets, and Contacts. Uses OAuth 2.0 (browser-based consent flow at `http://localhost:8002/oauth/google/authorize`). Credentials are stored locally under `store_creds_local/`.

**Tool categories:**

| Prefix | Service | Example Tools |
|--------|---------|--------------|
| `gws__` | Gmail | `search_gmail_messages`, `get_gmail_message_content`, `send_gmail_message`, `create_draft` |
| `gws__` | Calendar | `list_events`, `get_event`, `manage_event` (create/update/delete) |
| `gws__` | Tasks | `list_task_lists`, `list_tasks`, `manage_task` (create/update/delete/move) |
| `gws__` | Drive | `list_files`, `search_files`, `get_file`, `manage_drive_access` |
| `gws__` | Docs | `read_document`, `update_document` |
| `gws__` | Sheets | `read_spreadsheet` |
| `gws__` | Contacts | `list_contacts`, `search_contacts` |

**Critical: `user_google_email` parameter**

In OAuth 2.0 mode (the default), every `gws__*` tool requires `user_google_email` as an explicit parameter. The gateway injects the authenticated user's email (from the Auth0 JWT) into the LLM system prompt so it knows to include `user_google_email="sshar386@asu.edu"` in every GWS tool call.

**Task creation — exact call:**
```python
gws__manage_task(
    action="create",
    task_list_id="@default",      # always valid for default list
    title="task title here",
    user_google_email="user@example.com"
)
```

**Session keepalive:** The GWS MCP server has a ~10-second idle session timeout. The gateway sends `send_ping()` every 5 seconds to keep the session alive during LLM thinking time (which can take 3–14+ seconds across multiple rounds).

---

## 7. Database Schema

All tables managed by SQLModel + aiosqlite (async SQLite). Migrations run at startup via `SQLModel.metadata.create_all`.

```
┌─────────────────────────────────────────────────────────────────┐
│ app_user                                                        │
│  id          INTEGER PK                                         │
│  auth0_sub   TEXT UNIQUE (e.g. "auth0|abc123")                  │
│  email       TEXT                                               │
│  onboarding_complete  BOOLEAN default False                     │
│  created_at  DATETIME                                           │
└──────────────┬──────────────────────────────────────────────────┘
               │ user_id FK
┌──────────────┴──────────────────────────────────────────────────┐
│ canvas_credential                                               │
│  id              INTEGER PK                                     │
│  user_id         FK → app_user                                  │
│  canvas_domain   TEXT (e.g. "canvas.asu.edu")                   │
│  token_encrypted TEXT (Fernet-encrypted personal access token)  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ user_memory                                                     │
│  id          INTEGER PK                                         │
│  user_id     FK → app_user                                      │
│  key         TEXT  (e.g. "top_courses", "communication_style")  │
│  value_json  TEXT                                               │
│  updated_at  DATETIME                                           │
│  UNIQUE(user_id, key)                                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ pending_action                                                  │
│  id           INTEGER PK                                        │
│  user_id      FK → app_user                                     │
│  action_type  TEXT  (e.g. "gws__send_gmail_message")            │
│  payload_json TEXT  (tool call arguments as JSON)               │
│  status       TEXT  pending | approved | rejected | executed    │
│  result_json  TEXT  (output after execution)                    │
│  created_at   DATETIME                                          │
│  resolved_at  DATETIME                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ chat_session                                                    │
│  id               INTEGER PK                                    │
│  user_id          FK → app_user                                 │
│  title            TEXT  (first 80 chars of first user message)  │
│  created_at       DATETIME                                      │
│  last_message_at  DATETIME                                      │
└──────────────┬──────────────────────────────────────────────────┘
               │ session_id FK
┌──────────────┴──────────────────────────────────────────────────┐
│ chat_message                                                    │
│  id          INTEGER PK                                         │
│  session_id  FK → chat_session                                  │
│  role        TEXT  ("user" | "assistant")                       │
│  content     TEXT                                               │
│  created_at  DATETIME                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Authentication & Auth0

### Auth0 Setup Required

| Setting | Value |
|---------|-------|
| Application type | Regular Web Application |
| Allowed Callback URLs | `http://localhost:3000/auth/callback` |
| Allowed Logout URLs | `http://localhost:3000` |
| API Audience | e.g. `https://academic-copilot/api` |
| API Scopes | `openid profile email offline_access` |

### Flow

```
1. User visits http://localhost:3000
   → Redirected to Auth0 login page

2. After login, Auth0 redirects to /auth/callback
   → @auth0/nextjs-auth0 stores session + access token

3. Every Next.js API route:
   → auth0.getSession() → check session exists
   → auth0.getAccessToken() → get Bearer JWT
   → Forward request to gateway with Authorization: Bearer <token>

4. Gateway (auth_jwt.py):
   → Fetches Auth0 JWKS public keys
   → Validates JWT signature, audience, expiry
   → Extracts `sub` (user ID) and `email`
   → Creates/loads User row in DB

5. All subsequent operations use user.id (integer) for DB queries
```

### Canvas Onboarding

Required before the agent can access Canvas data:
1. User navigates to `/onboarding`
2. Enters Canvas domain (e.g. `canvas.asu.edu`) and personal access token
3. `POST /me/canvas` → gateway encrypts token with Fernet → stores in `canvas_credential`
4. Sets `user.onboarding_complete = True`
5. All Canvas MCP requests now include `X-Canvas-Token` and `X-Canvas-URL` headers

### Google Workspace Sign-In

Separate from the app — handled entirely by the Google Workspace MCP server:
1. Navigate to `http://localhost:8002/oauth/google/authorize` in browser
2. Complete Google OAuth consent
3. Credentials stored in `google_workspace_mcp/store_creds_local/`
4. GWS tools are now available in all agent sessions

---

## 9. MCP Protocol & Session Lifecycle

### What is MCP?

The **Model Context Protocol** (MCP) is an open standard that lets AI models use tools exposed by servers. The gateway is an MCP *client*; Canvas MCP and Google Workspace MCP are *servers*. Transport used: **streamable HTTP** (HTTP POST for requests, SSE GET for server→client pushes).

### Session Lifecycle

```
Gateway startup (per run_agent_conversation call):

1. build_mcp_runtime() called
   └─ For each MCP server:
      a. POST /mcp → create session (server assigns session ID)
      b. GET  /mcp → open SSE stream (background reader task)
      c. POST /mcp (initialize) → MCP handshake
      d. POST /mcp (list_tools) → get all tool definitions
      e. Session kept alive in AsyncExitStack
      f. Session stored in _live_sessions[url]

2. Every 5 seconds (keepalive task):
   └─ session.send_ping() → POST /mcp (ping)
   └─ Server responds → SSE stream stays alive
   └─ Prevents ~10 s server-side idle timeout (GWS MCP)

3. dispatch_mcp(tool_name, args) called per tool use:
   └─ Look up session from _live_sessions
   └─ session.call_tool(mcp_name, args) → POST /mcp
   └─ If session dead: reconnect once, retry tool call
   └─ Returns (result_text, "mcp_canvas"|"mcp_google")

4. run_agent_conversation() finally block:
   └─ Cancel keepalive task
   └─ mcp_runtime.aclose()
      └─ stack.aclose() → DELETE /mcp (terminate sessions)
```

### Why Per-Request Sessions (Not Shared Pool)

Each `run_agent_conversation` creates its own MCP sessions because:
- Canvas MCP credentials (`X-Canvas-Token`) are per-user
- Sessions need to live only as long as one conversation turn
- Keeps isolation: one user's failing session doesn't affect others

---

## 10. Agent Architecture (LangGraph)

### Graph Topology

```
START
  │
  ├─ voice_mode=True ────────────────────────────→ agent_node → END
  │
  └─ voice_mode=False → intent_router_node
                               │
              ┌────────────────┴────────────────┐
              │ needs_canvas AND needs_gws        │ otherwise
              ▼                                  ▼
       parallel_agent_node                  agent_node → END
              │
              ▼
       synthesizer_node → END
```

**`intent_router_node`** (text chat only, skipped for voice):
- Cheap LLM call (gpt-4o-mini, max_tokens=40)
- Returns `{needs_canvas: bool, needs_gws: bool}`
- If both true → fan out to parallel agents

**`agent_node`** (sequential, handles most queries):
- Calls `run_agent_conversation()`
- Full tool loop: up to 8 rounds (voice) / 18 rounds (text) of LLM + tool calls
- Returns `reply_text, sources, tool_trace`

**`parallel_agent_node`** (when both Canvas and GWS needed):
- Runs two filtered `run_agent_conversation` calls concurrently via `asyncio.gather`
- Canvas loop: only `canvas__*` tools
- GWS loop: only `gws__*` tools
- Returns `canvas_result` + `gws_result`

**`synthesizer_node`** (after parallel):
- Single LLM call combining both results into one coherent answer

### Tool Loop (`run_agent_conversation`)

```
1. Build system prompt (with user email, task guidance, memory context)
2. Build messages: system + history (last 36 turns, 12k chars each) + user message
3. For each round (max 8 voice / 18 text):
   a. POST to OpenAI with tools list
   b. If LLM returns tool_calls:
      - Fire status_callback (for voice SSE "Using X…" display)
      - Check HITL: if write-gated tool → save PendingAction, inject [HITL_PENDING:id]
      - asyncio.gather all tool calls (parallel dispatch)
      - Check for auth failure → abort with guidance message
      - Add tool results to messages
      - Continue loop
   c. If LLM returns text → done, return reply_text
4. If loop exhausted → "Too many tool rounds" error
5. Finally: cancel keepalive, close MCP sessions, fire-and-forget memory write
```

### System Prompt Key Sections

```
You are a concise academic assistant. Use tools to fetch real data; never invent data.

Canvas → canvas__* tools.
Google Workspace → gws__* tools.

AUTHENTICATED USER EMAIL: {user_email}
CRITICAL: Every gws__* tool call MUST include user_google_email="{user_email}".

GOOGLE TASKS: Use ONLY gws__manage_task(action="create", task_list_id="@default",
              title="...", user_google_email="...") — never manage_drive_access.

Canvas to-do ≠ Google Tasks:
  canvas__get_my_todo_items = READ-ONLY Canvas assignment reminders.
  For "add a task" → Google Tasks → gws__manage_task.

If [HITL_PENDING:id] returned → tell user to approve in sidebar.
```

### AgentState (LangGraph TypedDict)

```python
class AgentState(TypedDict, total=False):
    auth0_sub: str
    user_id: int
    session_id: int
    message: str
    history: list[dict]
    canvas_mcp_headers: dict
    user_email: str           # Auth0 email → injected into every gws__ call
    reply_text: str
    sources: list[str]
    tool_trace: list[dict]
    needs_canvas: bool        # set by intent_router
    needs_gws: bool
    canvas_result: str        # set by parallel_agent
    gws_result: str
    db_session: Any           # AsyncSession — not serializable, in-process only
    status_callback: Any      # Callable for voice SSE events
    voice_mode: bool          # True → skip intent_router
```

---

## 11. Voice Pipeline

### Architecture

```
User speaks
    │  (Web Speech API, Chrome/Edge only)
    ▼
SpeechRecognition (continuous=true)
    │  silence > 1000 ms or manual send
    ▼
sendToAgent(transcript)
    │
    ├─ POST /api/gateway/voice/stream (SSE)
    │       │
    │       ├─ event: preamble  {"text": "Let me check Canvas for you."}
    │       │       └─ playElevenLabs(preamble)  ← starts immediately, concurrent
    │       │
    │       ├─ event: tool_call {"tool": "gws__list_tasks", "label": "Checking your tasks"}
    │       │       └─ setThinkingSteps([...])  ← shown in UI
    │       │
    │       ├─ event: reply     {"text": "You have 3 tasks due..."}
    │       │
    │       └─ event: [DONE]
    │
    └─ await preamble audio finishes
       then playElevenLabs(replyText) ← sentence-by-sentence pipeline
```

### ElevenLabs TTS Pipeline (sentence streaming)

```
replyText = "You have 3 assignments due. The first is a quiz on Friday."

splitSentences(replyText)
  → ["You have 3 assignments due.", "The first is a quiz on Friday."]

Round 0: fetch TTS for sentence[0]   ← start immediately
Round 1: await sentence[0] blob      ← play sentence[0]
         fetch TTS for sentence[1]   ← start during playback
Round 2: await sentence[1] blob      ← play sentence[1] (no gap)
```

Time-to-first-audio ≈ 300–500 ms (one sentence) vs 2–5 s (whole reply).

### Barge-In

While agent is speaking (`status === "speaking"`), the Web Audio API AnalyserNode continuously measures RMS:
- If RMS > 25 for 220 ms → `stopPlayback()`
  - Sets `playbackCancelRef.current = true`
  - Pauses `<audio>` element
  - Resolves `ttsResolveRef` (unblocks `playBlob` promise)
  - The sentence loop checks `playbackCancelRef` → breaks immediately
  - Cancels `window.speechSynthesis`
- After loop exits, `startListening()` is called → picks up user's new utterance

### Voice SSE Backend

`POST /chat/voice/stream`:
1. Generates a preamble phrase from the user's message topic
2. Creates `asyncio.Queue` for status events
3. Starts `run_readonly_agent(...)` as an asyncio task with `status_callback=queue.put_nowait`
4. Streams SSE: preamble → tool_calls (as they happen) → reply → `[DONE]`
5. `status_callback` in `run_agent_conversation` fires before each tool call with `{type, tool, label}`

### Tool Display Labels

Human-readable tool labels shown in voice UI while agent works:

| Tool | Label |
|------|-------|
| `canvas__list_courses` | "Checking your Canvas courses" |
| `canvas__list_assignments` | "Looking up assignments" |
| `canvas__get_grades` | "Checking your grades" |
| `gws__list_messages` | "Reading your emails" |
| `gws__list_events` | "Reading your calendar" |
| `gws__manage_task` | "Updating tasks" |
| `gws__list_files` | "Browsing your Google Drive" |

---

## 12. Human-in-the-Loop (HITL)

### How It Works

Only irreversible write actions require approval before execution. Currently only `gws__send_gmail_message` is HITL-gated (configurable via `HITL_WRITE_TOOLS` env var).

```
1. LLM decides to call gws__send_gmail_message

2. _run_tool_call() detects tool in hitl_tools set
   └─ Creates PendingAction row (status="pending", payload_json=args)
   └─ Returns synthetic result: "[HITL_PENDING:42] This action requires your approval"

3. LLM sees HITL_PENDING message
   └─ Tells user: "I've queued this action — click the amber notification to approve it."

4. Sidebar badge turns amber (polls /agent/hitl/pending every 30 s)
   └─ Shows pending actions with tool name + arguments preview

5. User clicks Approve:
   └─ POST /agent/hitl/42/approve
   └─ hitl_executor.py rebuilds MCP runtime, dispatches the tool call
   └─ PendingAction updated: status="executed", result_json=response

6. User clicks Reject:
   └─ POST /agent/hitl/42/reject
   └─ PendingAction updated: status="rejected"
```

### HITL Gated Tools (default)

```
gws__send_gmail_message    Send email (irreversible)
```

Previously gated but removed (non-destructive):
- `gws__manage_event` — calendar changes are visible and reversible
- `gws__manage_task` — task creation/update is reversible

---

## 13. Data Flow Diagrams

### Text Chat Request

```
Browser
  POST /api/gateway/chat
  {message, history, session_id}
        │
        ▼ (Next.js API route adds Bearer token)
Gateway /chat
  1. Validate JWT → get user
  2. Check onboarding_complete
  3. Decrypt Canvas token
  4. Load/create ChatSession
  5. run_readonly_agent({message, history, user_email, ...})
        │
        ▼ LangGraph
  intent_router (or skip for voice)
        │
  agent_node
    └─ build_mcp_runtime (Canvas + GWS sessions)
    └─ keepalive task started (5 s pings)
    └─ Tool loop (up to 18 rounds):
         OpenAI API → tool_calls → dispatch_mcp → results
    └─ keepalive task cancelled
    └─ MCP sessions closed
        │
        ▼
  reply_text, sources, tool_trace
        │
  6. Write ChatMessage(user) + ChatMessage(assistant)
  7. Update ChatSession.last_message_at
  8. Return {reply_text, sources, session_id}
        │
        ▼
Browser shows reply
```

### Voice SSE Request

```
Browser
  POST /api/gateway/voice/stream
  {message, history, session_id}
        │
        ▼
Gateway /chat/voice/stream
  1. Validate JWT, resolve Canvas creds
  2. preamble = _generate_preamble(message)
  3. queue = asyncio.Queue()
  4. agent_task = create_task(run_readonly_agent({..., status_callback=queue.put_nowait, voice_mode=True}))
  5. SSE stream:
       EMIT: {type:"preamble", text:"Let me check Canvas for you."}
       LOOP: drain queue → EMIT: {type:"tool_call", tool:..., label:...}
       AWAIT: agent_task completes
       EMIT: {type:"reply", text:"..."}
       EMIT: [DONE]
        │
        ▼
Browser:
  on preamble → playElevenLabs(preamble) (non-blocking)
  on tool_call → update thinking steps UI
  on reply → store replyText
  after [DONE] → await preamble, then playElevenLabs(replyText) sentence by sentence
```

---

## 14. Environment Variables

### apps/gateway/.env

```bash
# Auth0 (required)
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_AUDIENCE=https://your-api-identifier

# OpenAI (required)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOOL_ROUNDS=18

# Encryption (required) — generate with:
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=...

# Database (optional, defaults to SQLite)
DATABASE_URL=sqlite+aiosqlite:///./gateway.db

# CORS
CORS_ORIGINS=http://localhost:3000

# MCP servers
MCP_CANVAS_URL=http://127.0.0.1:3001/mcp
MCP_GOOGLE_WORKSPACE_URL=http://127.0.0.1:8002/mcp
MCP_WORKSPACE_BROWSER_URL=http://localhost:8002
MCP_MAX_TOOLS=120
MCP_TOOL_DESCRIPTION_MAX_CHARS=400

# ElevenLabs TTS (optional — falls back to browser TTS if not set)
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb

# HITL — comma-separated tool names that need approval before execution
HITL_WRITE_TOOLS=gws__send_gmail_message

# Dev only
SKIP_AUTH=false
CHAT_INCLUDE_TOOL_TRACE=false
```

### apps/web/.env.local

```bash
# Auth0 (required) — same tenant as gateway
AUTH0_SECRET=<32+ random bytes>       # openssl rand -hex 32
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_AUDIENCE=https://your-api-identifier

# Gateway URL
GATEWAY_URL=http://localhost:8000
```

### google_workspace_mcp (set in run script or Docker)

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PORT=8002
WORKSPACE_MCP_BASE_URI=http://localhost
WORKSPACE_MCP_STATELESS_MODE=false
MCP_ENABLE_OAUTH21=false
```

---

## 15. Local Development Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- An Auth0 account (free tier works)
- A Google Cloud project with OAuth 2.0 credentials (redirect: `http://localhost:8002/oauth2callback`)
- An OpenAI API key
- A Canvas personal access token from your institution's Canvas instance

### Step-by-step

```bash
# 1. Clone and enter repo
cd Innovation_hacks

# 2. Start Google Workspace MCP (Terminal 1)
./scripts/run-workspace-mcp-local.sh
# → Open http://localhost:8002/oauth/google/authorize in browser to sign in

# 3. Start Canvas MCP (Terminal 2)
./scripts/run-canvas-mcp-local.sh

# 4. Set up gateway (Terminal 3)
cd apps/gateway
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Create .env with variables from Section 14
uvicorn app.main:app --reload --port 8000

# 5. Set up web app (Terminal 4)
cd apps/web
npm install
# Create .env.local with variables from Section 14
npm run dev

# 6. Open http://localhost:3000
#    → Auth0 login → Canvas onboarding → start chatting
```

### Verify Everything Works

```bash
# Health check
curl http://localhost:8000/health
# → {"status":"ok"}

# Canvas MCP tools loaded
curl http://localhost:8000/chat \
  -H "Authorization: Bearer <token>" \
  -d '{"message":"list my courses","history":[]}'

# GWS tools
curl http://localhost:8000/chat \
  -H "Authorization: Bearer <token>" \
  -d '{"message":"what emails do I have?","history":[]}'
```

### Docker (one command)

```bash
# Copy .env to root and run:
docker-compose up
# All services start on their respective ports
```

---

## 16. What Works Right Now

### ✅ Core Chat

- [x] Auth0 login → JWT → gateway authentication
- [x] Canvas onboarding (domain + token, Fernet encrypted)
- [x] Text chat with LangGraph agent
- [x] Canvas tool calls (courses, assignments, grades, discussions, files, etc.)
- [x] GWS tool calls (Gmail search, read, calendar, tasks, drive) — **requires Google sign-in at localhost:8002 first**
- [x] Chat session persistence (create, continue, title from first message)
- [x] Chat history page (list sessions, load full transcript)
- [x] User memory layer (extracts preferences, injects into system prompt)
- [x] Parallel agent for multi-domain queries (Canvas + GWS simultaneously)
- [x] Intent router (routes to parallel agent if both Canvas and GWS needed)

### ✅ Voice

- [x] Web Speech API microphone input (Chrome/Edge)
- [x] Silence detection (1000 ms threshold)
- [x] SSE-based voice pipeline (preamble → tool traces → reply)
- [x] ElevenLabs TTS with sentence-level streaming (time-to-first-audio ~300–500 ms)
- [x] Browser TTS fallback when ElevenLabs not configured
- [x] Barge-in: user speaking interrupts AI immediately (RMS > 25 for 220 ms)
- [x] Preamble phrases ("Let me check Canvas for you") spoken while agent fetches data
- [x] Live tool trace display in UI ("Checking your assignments…")
- [x] Ring visualizer (pulsing with mic level, color changes by status)
- [x] Transcript sidebar with thought bubbles

### ✅ Dashboard

- [x] Canvas course grid
- [x] Per-course upcoming assignment count
- [x] 5-minute TTL cache per user

### ✅ Tasks

- [x] List Google Tasks
- [x] Create new task
- [x] Update/complete task

### ✅ HITL

- [x] Email send intercepted, saved as PendingAction
- [x] Sidebar badge shows pending count (polls every 30 s)
- [x] Approve → executes tool call
- [x] Reject → marks rejected

### ✅ Infrastructure

- [x] MCP keepalive pings (prevents GWS 10 s idle timeout)
- [x] Transparent session reconnect on dead session
- [x] `user_google_email` injected into system prompt for all GWS calls
- [x] Explicit task creation instructions in system prompt (prevents wrong-tool selection)
- [x] `max_rounds` cap: 8 for voice (fast), 18 for text chat

---

## 17. Known Issues & Limitations

### MCP Session Reliability

**Issue:** The GWS MCP server (`fastmcp`) has a ~10-second session idle timeout. The keepalive pings (every 5 s) mitigate this, but edge cases remain:
- If the Python asyncio event loop is blocked for >5 s (unlikely but possible under load), a ping might be delayed
- Reconnect logic exists as fallback but can sometimes fail

**Workaround:** The reconnect mechanism retries once if a session dies. If it fails again, the LLM receives a "MCP connection failed" error and should report it to the user.

### Wrong Tool Selection (Rare)

**Issue:** GPT-4o-mini with 120+ tools occasionally picks semantically wrong tools (e.g., `manage_drive_access` for task creation before the system prompt fix).

**Mitigation:** The system prompt now explicitly names the exact tool and parameters for common operations. Still, with very unusual phrasings, the LLM might mis-select.

**Future fix:** Switch to GPT-4o (stronger instruction following) or reduce the active tool set per query.

### Browser TTS Fallback Quality

The browser's `speechSynthesis` API varies significantly across platforms. On macOS, it sounds OK; on Windows, it can be robotic. ElevenLabs is strongly recommended.

### Voice: Chrome/Edge Only

Web Speech API (`SpeechRecognition`) is not available in Firefox or Safari. The UI shows a fallback message but there's no transcription alternative.

### Canvas Credential Per-User

Each user must complete onboarding with their own Canvas domain and personal access token. There's no "institution-level" credential sharing — by design, for privacy.

### No Real-Time Streaming from LLM

The LLM generates the full reply before it's sent. For text chat, there's no token-by-token streaming. For voice, the preamble phrase compensates for the perceived latency, but the reply itself only plays after the full LLM response is ready.

---

## 18. What Is Not Done Yet

### High Priority

- [ ] **GPT-4o upgrade**: The current `gpt-4o-mini` model is weaker at following complex tool-use instructions with 120+ tools. Switching to `gpt-4o` or `gpt-4.1` would improve reliability significantly
- [ ] **LLM reply streaming**: Stream OpenAI tokens to the frontend in real-time for text chat (reduces perceived latency). For voice, stream sentences to TTS as they complete
- [ ] **GWS MCP stateless mode**: Setting `WORKSPACE_MCP_STATELESS_MODE=true` would eliminate session timeout issues entirely, but requires verifying the Python MCP SDK client handles it correctly
- [ ] **Error recovery UI**: When the agent says "MCP connection failed", show a helpful reconnect button rather than a confusing error message

### Medium Priority

- [ ] **File upload**: Allow users to upload PDFs/documents and ask questions about them (RAG pipeline)
- [ ] **Canvas assignment submission**: Submit assignments via agent (requires scope/token update)
- [ ] **Email composition UI**: Rich email drafting interface in HITL approval modal (preview, edit body before sending)
- [ ] **Dashboard real-time updates**: WebSocket or periodic refresh for assignment due date countdowns
- [ ] **Multi-user Google Workspace**: Currently one Google account per machine; proper per-user OAuth with database-stored refresh tokens
- [ ] **Proper DB migrations**: Currently uses `create_all` at startup; production needs Alembic
- [ ] **Rate limiting**: No rate limits on any gateway endpoints; easy to DoS

### Low Priority / Nice to Have

- [ ] **Firefox/Safari voice**: Use OpenAI Whisper API as transcription fallback for browsers without SpeechRecognition
- [ ] **Mobile responsive**: The voice UI and sidebar aren't optimized for mobile viewports
- [ ] **Dark/light mode toggle**: Currently dark-only
- [ ] **Export chat**: Download conversation as PDF or markdown
- [ ] **Canvas instructor features**: The Canvas MCP exposes instructor tools (grade submissions, create assignments, bulk operations) but the agent system prompt doesn't currently enable them
- [ ] **Notifications**: Push notifications for upcoming Canvas deadlines or new emails
- [ ] **Offline mode**: Cache last-known Canvas data for offline access
- [ ] **Multi-language TTS**: ElevenLabs supports multiple languages but the voice UI is English-only
- [ ] **Agent memory persistence across devices**: `UserMemory` is stored in the DB but isn't surfaced in the UI; no way to view/edit it

---

*Last updated: April 2026*
*Project: Academic Copilot — Innovation Hacks*
