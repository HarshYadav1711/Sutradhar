# Sutradhar

Sutradhar is a WhatsApp-native service operations agent for local service businesses.

It turns natural customer conversations into structured, verified business actions: service search, availability checks, booking proposals, confirmed bookings, contextual reschedules, and human handoffs.

It is an operational agent, not an FAQ bot. The language model may interpret language and choose tools. It does not have direct authority to commit high-impact writes.

## What it does

A customer can message:

> Hi, I need AC servicing tomorrow evening.

Sutradhar asks only for missing details (for example, location and quantity), searches the configured catalogue, checks real availability in SQLite, and presents a booking proposal. Nothing is booked yet.

The customer replies:

> Yes, confirm it.

Only then does a deterministic confirmation policy commit the pending action and return a database-generated booking reference.

Later:

> Actually make it 7.

The agent resolves the active booking, checks whether 7:00 PM is available, proposes a reschedule, and again waits for explicit confirmation.

Complaints, refund requests, and damage reports create human handoffs. The system does not invent compensation or approve refunds.

## Realistic conversation

Customer: Kal shaam washing machine repair ho sakta hai?

Agent: Haan, location aur machine details bataiye.

Customer: Sector 62, Noida.

Agent: [searches services, checks availability] Sector 62 ke liye kal shaam ka slot mil sakta hai. Proposal: Washing machine inspection, tomorrow evening, Sector 62. Confirm karne ke liye "haan" ya "confirm" likhein.

Customer: Haan, kar do.

System: Booking committed with a real reference such as `BK-...`.

Internal structured state stays in English even when the customer writes in Hinglish.

## Confirmation-gated actions

Booking creation and rescheduling use a two-phase model:

1. Tools such as `prepare_booking` or `prepare_reschedule` create a pending action.
2. The customer receives a clear proposal summary.
3. The next message is evaluated by a deterministic confirmation policy.
4. Only an explicit affirmative commits the action through an internal executor.

Explicit affirmatives include phrases such as `yes`, `confirm`, `book it`, `go ahead`, `haan`, `kar do`, and `haan kar do`. Ambiguous replies such as `maybe` do not commit. Commit and cancel are not exposed as model tools.

## Why one agent

Sutradhar runs one bounded orchestrating agent. The product is a single customer thread with shared state: one pending action, one active booking, one confirmation decision. Multiple peer agents would add coordination without improving the confirmation safety model. See [docs/decisions/0001-single-agent-orchestrator.md](docs/decisions/0001-single-agent-orchestrator.md).

## Tool boundary

Agent-exposed tools:

- `search_services`
- `check_availability`
- `get_customer_profile`
- `save_customer_details`
- `prepare_booking`
- `prepare_reschedule`
- `create_handoff`

Internal operations (not model tools):

- `commit_pending_action`
- `cancel_pending_action`
- webhook inbox processing
- WhatsApp outbound delivery

The agent loop allows at most five model decisions per inbound message.

## Local Ollama

Default runtime LLM provider is local [Ollama](https://ollama.com/) using the native chat and tool-calling API. Recommended model: `qwen3:4b`.

If Ollama is unavailable, `/ready` reports degraded status and the agent returns a controlled failure. Responses are not silently faked. Automated tests use `ScriptedModelProvider` only; that provider is not the product AI path.

## Meta WhatsApp Cloud API

WhatsApp uses the official Meta Cloud API over HTTPS (`fetch`). Unofficial WhatsApp Web libraries are not used.

When `WHATSAPP_ENABLED=false` (default), the full booking core runs through the local simulator and terminal chat without Meta credentials. When enabled, webhook verification, `X-Hub-Signature-256` validation, inbox deduplication, and outbound messages are required. Details: [docs/meta-whatsapp-setup.md](docs/meta-whatsapp-setup.md).

## What is local, simulated, or Meta-dependent

| Component | Mode |
|-----------|------|
| API, SQLite, tools, policies, orchestrator | Local |
| Operator dashboard | Local |
| Terminal chat / HTTP simulator | Local simulation of the customer channel |
| Ollama model | Local process |
| WhatsApp webhooks and outbound messages | Meta Cloud API (test infrastructure when enabled) |
| Automated tests | Offline; temporary SQLite; scripted model |

This repository is a working local product prototype. It is not described as production-ready, and no production deployment is included.

## Requirements

- Node.js 24
- npm
- Ollama (for live agent demos)
- Optional: Meta WhatsApp Cloud API test setup and a public tunnel for webhooks

## Setup

```bash
git clone <your-fork-or-clone-url>
cd Sutradhar
npm ci
cp .env.example apps/api/.env
```

A repository-root `.env` is also loaded as a fallback, but Prisma CLI and workspace scripts prefer `apps/api/.env`.

Edit `apps/api/.env`:

- Set a non-empty `ADMIN_API_TOKEN` for the operator console and for `POST /api/simulator/reset`.
- Leave `WHATSAPP_ENABLED=false` for local simulator demos.
- Keep `DATABASE_URL=file:./prisma/dev.db` unless you intentionally change it.

Pull the model and prepare the database:

```bash
ollama pull qwen3:4b
npm run db:generate
npm run db:migrate
npm run db:seed
```

`npm run db:migrate` runs Prisma `migrate dev` in `apps/api`. For applying already-committed migrations non-interactively:

```bash
npm exec -w @sutradhar/api -- prisma migrate deploy
npm run db:seed
```

Dashboard API base URL (optional override):

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
```

Default is `VITE_API_BASE_URL=http://127.0.0.1:4000` (prefer `127.0.0.1` over `localhost` on Windows to avoid IPv6 connection failures).

## Run locally

Terminal 1 — Ollama must already be running (`ollama serve` if needed).

```bash
npm run dev
```

This starts:

- API on `http://localhost:4000`
- Dashboard on `http://localhost:5173`

Health and readiness:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/ready
```

`/health` is process liveness only. `/ready` reports database, worker, Ollama, WhatsApp configuration, and simulator status. With WhatsApp disabled, readiness does not fail solely because Meta is unused.

## Local terminal simulator

Uses the same orchestrator, tools, policies, and database as WhatsApp.

```bash
npm run chat
```

Commands inside the chat: `/help`, `/reset` (fresh conversation for the same customer; does not wipe bookings), `/quit`.

HTTP simulator (when `ENABLE_SIMULATOR=true`):

```bash
curl -s http://localhost:4000/api/simulator/messages \
  -H "content-type: application/json" \
  -d "{\"customerKey\":\"simulator:demo\",\"text\":\"I need AC servicing tomorrow evening\",\"startFresh\":true}"
```

Reset demo catalogue data without changing migrations (`ADMIN_API_TOKEN` required when configured):

```bash
npm run demo:reset
```

## Operator dashboard

1. Open `http://localhost:5173`.
2. Sign in with the same value as `ADMIN_API_TOKEN`.
3. Inspect Overview, Conversations, Bookings, and Handoffs.
4. Open a conversation for messages, pending action state, and the operational trace (tool executions and events).

The console polls the operator API. It does not use WebSockets.

## Environment variables

Copy from `.env.example`. Do not commit `.env`.

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` / `HOST` | API listen address |
| `DATABASE_URL` | SQLite file URL for Prisma |
| `BUSINESS_TIMEZONE` | Business timezone (default `Asia/Kolkata`) |
| `BUSINESS_CURRENCY` | Catalogue currency (default `INR`) |
| `CORS_ORIGIN` | Comma-separated browser origins |
| `ADMIN_API_TOKEN` | Bearer token for operator APIs (required in production) |
| `ENABLE_SIMULATOR` | Local simulator routes and chat |
| `LLM_PROVIDER` | `ollama` (runtime) or `scripted` (tests only) |
| `OLLAMA_BASE_URL` | Ollama HTTP base |
| `OLLAMA_MODEL` | Model name |
| `OLLAMA_TIMEOUT_MS` | Ollama request timeout |
| `WHATSAPP_ENABLED` | Enable Meta webhook and outbound |
| `META_GRAPH_VERSION` | Graph API version when WhatsApp is enabled |
| `WHATSAPP_ACCESS_TOKEN` | Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending phone number id |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Optional account id |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verify token |
| `META_APP_SECRET` | App secret for signature validation |
| `WHATSAPP_REQUEST_TIMEOUT_MS` | Outbound Meta timeout |
| `WHATSAPP_MAX_RETRIES` | Transient Meta retry count |
| `WHATSAPP_WEBHOOK_*` | Inbox poll, attempts, stale recovery, backoff |
| `WORKER_CONCURRENCY` | Inbox worker concurrency (default `1` for SQLite) |
| `PENDING_ACTION_EXPIRY_SWEEP_MS` | Pending-action expiry sweep interval |
| `BODY_LIMIT_BYTES` | HTTP body limit |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Rate limiting |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown timeout |
| `LOG_LEVEL` | Pino log level |

WhatsApp credential fields are required only when `WHATSAPP_ENABLED=true`.

## WhatsApp test setup

See [docs/meta-whatsapp-setup.md](docs/meta-whatsapp-setup.md) for Meta app creation, test numbers, webhook callback URL, verify token, message subscription, signature validation, and Cloudflare Quick Tunnel notes.

## Tests

Tests do not require Ollama, Meta credentials, internet, or a shared development database.

```bash
npm test
npm run test:coverage
npm run check
```

`npm run check` runs clean-repo verification, lint, typecheck, coverage tests, and production build.

More detail: [docs/testing.md](docs/testing.md).

## Design decisions

- [Single agent orchestrator](docs/decisions/0001-single-agent-orchestrator.md)
- [Local-first Ollama provider](docs/decisions/0002-local-first-model-provider.md)
- [Confirmation-gated writes](docs/decisions/0003-confirmation-gated-writes.md)
- [Official WhatsApp Cloud API](docs/decisions/0004-official-whatsapp-cloud-api.md)
- [Security hardening notes](docs/decisions/0005-security-hardening.md)

Further reading:

- [Architecture](docs/architecture.md)
- [Agent behaviour](docs/agent-behaviour.md)
- [Security model](docs/security-model.md)
- [Local development](docs/local-development.md)
- [Demo script](docs/demo-script.md)
- [Troubleshooting](docs/troubleshooting.md)

## Known limitations

- Local prototype with SQLite; not multi-tenant and not horizontally scaled.
- Live conversation quality depends on the local Ollama model and tool-calling support.
- Initial WhatsApp support is text messages; unsupported media is not interpreted as understood content.
- Operator auth is a shared admin bearer token, not per-user identity.
- Temporary Meta access tokens expire and must be rotated during test setup.
- Public webhook reachability for WhatsApp usually depends on a tunnel whose URL can change.
- Hardening (headers, CORS, rate limits, redaction) is baseline safety, not a full production security programme.
- No hosted deployment is included in this repository.

## Practical next steps

- Add an OpenAI-compatible provider behind the existing model interface if needed.
- Replace the shared admin token with proper operator identity when multi-user access is required.
- Move from SQLite to a server database if concurrency or hosting demands it.
- Extend WhatsApp message types only with explicit handling, not by pretending media was understood.
- Add durable hosting and secret management only when operating beyond local or Meta test infrastructure.
