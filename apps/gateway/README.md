# Academic Copilot — API gateway

FastAPI service: Auth0 JWT validation, encrypted Canvas tokens, LangGraph-wrapped OpenAI tool loop (Canvas + optional Google Calendar).

## Run locally

```bash
cd apps/gateway
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env — set AUTH0_*, ENCRYPTION_KEY, OPENAI_API_KEY
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Auth0

Create an **API** in Auth0 with an **Identifier** = `AUTH0_AUDIENCE`. Your Next.js app must request this audience so `/auth/access-token` works for BFF routes.

## With Next.js

Set `GATEWAY_URL=http://127.0.0.1:8000` in `apps/web/.env.local` so API routes can proxy to this service.
