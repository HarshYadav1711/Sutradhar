# Local development

This guide covers running Sutradhar on a developer machine without Meta credentials.

## Prerequisites

- Node.js 24
- npm
- Ollama installed and able to serve models
- Git

## Install

From the repository root:

```bash
npm ci
cp .env.example .env
```

Set at least:

```env
ADMIN_API_TOKEN=dev-admin-token-change-me
WHATSAPP_ENABLED=false
ENABLE_SIMULATOR=true
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
DATABASE_URL=file:./prisma/dev.db
CORS_ORIGIN=http://localhost:5173
```

Optional dashboard override:

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
```

## Database

Generate the Prisma client, apply migrations, and seed Indian service-catalogue demo data:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

Notes:

- `npm run db:migrate` runs `prisma migrate dev` inside `@sutradhar/api`.
- To apply committed migrations without creating a new migration name:

```bash
npm exec -w @sutradhar/api -- prisma migrate deploy
npm run db:seed
```

- `npm run db:reset` recreates the SQLite database and reseeds it.
- `npm run demo:reset` reseeds demo data without changing migrations.
- Do not commit `.env` or `*.db` files.

## Ollama

```bash
ollama serve
ollama pull qwen3:4b
```

Confirm the model is listed:

```bash
ollama list
```

If Ollama is down, the API still starts, but `/ready` reports degraded status and live agent turns return a controlled failure instead of inventing a reply.

## Start the stack

```bash
npm run dev
```

Services:

| Service | URL |
|---------|-----|
| API | http://localhost:4000 |
| Dashboard | http://localhost:5173 |

Checks:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/ready
```

## Simulator paths

### Terminal chat

```bash
npm run chat
```

Uses the in-process Fastify app, the same orchestrator/tools/policies/database as WhatsApp, and default customer key `simulator:local-demo` (override with `SIMULATOR_CUSTOMER_KEY` if configured).

### HTTP simulator

```bash
curl -s http://localhost:4000/api/simulator/messages \
  -H "content-type: application/json" \
  -d "{\"customerKey\":\"simulator:docs\",\"text\":\"I need AC servicing tomorrow evening\",\"startFresh\":true}"
```

Reset simulator conversation state for a customer through the API when needed via `POST /api/simulator/reset` (admin not required for simulator routes; simulator must be enabled).

## Operator console

1. Open http://localhost:5173
2. Enter the `ADMIN_API_TOKEN` value
3. Use Overview, Conversations, Bookings, and Handoffs
4. Open a conversation to inspect messages and the operational trace

If `ADMIN_API_TOKEN` is empty, operator routes return `503 ADMIN_TOKEN_UNCONFIGURED`.

## Useful scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | API + dashboard |
| `npm run chat` | Terminal simulator |
| `npm run demo:reset` | Reseed demo catalogue/slots |
| `npm test` | Offline test suite |
| `npm run test:coverage` | API coverage + dashboard tests |
| `npm run check` | Clean-repo, lint, typecheck, coverage, build |
| `npm run build` | Production builds for contracts, API, dashboard |
| `npm run verify:clean-repo` | Tracked `.env` / placeholder hygiene check |

## Project layout

- `apps/api` — Fastify API, agent, Prisma, WhatsApp, simulator
- `apps/dashboard` — React operator console
- `packages/contracts` — shared Zod schemas
- `docs/` — architecture, behaviour, security, Meta setup, demo, troubleshooting

## Without WhatsApp

Keep `WHATSAPP_ENABLED=false`. Webhook routes respond `503 WHATSAPP_DISABLED`. The worker is reported as disabled/healthy on `/ready`. Full booking, reschedule, and handoff demos still work through the simulator.
