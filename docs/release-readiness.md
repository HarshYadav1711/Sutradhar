# Release readiness audit

Date: 2026-07-27  
Scope: Sutradhar local product prototype (WhatsApp-native service operations agent)  
Auditor stance: release-candidate review for correctness, consistency, scope discipline, and reviewer experience  

This document records an audit and clean-install rehearsal. It does **not** claim that Sutradhar is production-ready, multi-tenant, horizontally scaled, or fully hardened for public internet operation.

## Checks performed

### Repository hygiene

| Check | Result |
|-------|--------|
| Assignment / hiring / evaluation language outside `AGENTS.md` | Cleared (removed Stage 9/10 and “reviewer” framing from tests and docs) |
| Pyrock.ai / founder / deadline product copy | None in README, UI, or product docs |
| Generated placeholder / lorem text | None found |
| Commented-out code / unexplained TODOs | None found |
| Tracked secrets / `.env` | None; `.env.example` present; `verify:clean-repo` passed |
| Committed database files | None (`*.db` gitignored); rehearsal used `apps/api/prisma/rehearsal.db` separately |
| Fake metrics / testimonials / deployment claims | None; overview returns operational counts only |
| Copied SaaS / template branding | Not present; console is product-specific |
| Unused direct dependencies | No unused direct deps identified in workspace packages |
| Untracked required configuration | `.env.example` covers required keys; WhatsApp fields optional when disabled |

### TypeScript and builds

| Check | Result |
|-------|--------|
| `strict` (+ related strict options) in `tsconfig.base.json` | Enabled |
| Unexplained `any` | None found in app sources |
| ESM / NodeNext imports | Consistent |
| Contracts build after deleting `dist` | **Fixed**: stale `tsbuildinfo` previously skipped emit; contracts `build` now uses `tsc -b --force` and `clean` removes `tsconfig.tsbuildinfo` |
| Production build | Passed (`contracts`, `api`, `dashboard`) |
| Lint | Passed |
| Typecheck | Passed (after contracts fix) |

### Agent safety

| Check | Result |
|-------|--------|
| Model cannot commit booking / reschedule directly | Pass — only `prepare_*` tools exposed; commit via internal executor |
| Confirmation policy deterministic | Pass — phrase list, no LLM |
| Maximum steps enforced | Pass — `MAX_AGENT_STEPS = 5` |
| Tool results persisted | Pass — `ToolExecution` rows + operational events |
| Honest customer-visible failures | Pass — controlled failure copy; live Ollama miss returned honest failure |
| Handoffs do not promise outcomes | Pass — tool + policy assert `refundOrCompensationApproved: false` |
| Bounded context | Pass — recent message limit (12) + compact summary |
| No hidden reasoning stored/exposed | Pass — operator/trace APIs omit prompts and CoT |

### Data

| Check | Result |
|-------|--------|
| Seed creates future slots | Pass — offsets start at tomorrow (IST) |
| Reset / reseed repeatable | Pass — `db:seed` / `demo:reset` clear and recreate |
| Booking / handoff references unique | Pass — `BK-` / `HO-` + unique columns + retry on collision |
| Duplicate webhook message IDs | Pass — unique `externalMessageId` + inbox dedupe |
| Pending actions expire | Pass — TTL + lazy gate + sweep worker |
| Writes use transactions | Pass — prepare/commit paths |
| SQLite test isolation | Pass — temp DBs in Vitest helpers |

### WhatsApp

| Check | Result |
|-------|--------|
| Official Cloud API only | Pass — `fetch` to Graph; no unofficial WA libraries |
| Raw body signature validation | Pass — `X-Hub-Signature-256` HMAC + timing-safe compare |
| Prompt acknowledgement + durable inbox worker | Pass — persist then worker poll |
| Bounded transient retry | Pass — attempt/backoff caps from config |
| Local mode without Meta credentials | Pass — `WHATSAPP_ENABLED=false` |
| Graph version from config | Pass — `META_GRAPH_VERSION` wired into client |

### Dashboard

| Check | Result |
|-------|--------|
| No fake data | Pass — live operator API only |
| Empty states | Present on overview, conversations, bookings, handoffs, detail panels |
| Errors understandable | Pass — `StatePanel` + API error messages |
| Mobile layout | Pass — single-column + horizontal nav below 900px |
| Keyboard focus visible | Pass — `:focus-visible` outline |
| Secrets / prompts / reasoning | Not displayed; token in sessionStorage only |
| Handoff `CLOSED` status control | **Fixed** — select no longer falls back to `OPEN` for closed rows |
| Booking filters | **Fixed** — removed misleading `PENDING_CONFIRMATION` filter (pending proposals live on `PendingAction`) |

### Documentation

| Check | Result |
|-------|--------|
| Scripts match root `package.json` | Pass |
| Limitations honest | Pass in README |
| Demo script ~3 minutes | Present at `docs/demo-script.md` |
| Describes only implemented behaviour | Pass (spot-checked) |

## Fixes applied during this audit

1. **`@sutradhar/contracts` clean/build** — deleting `dist` while leaving `tsconfig.tsbuildinfo` caused a no-op build and broken typecheck after clean installs. Build now forces emit; clean removes the incremental cache.
2. **Handoffs console status control** — `CLOSED` rows are represented correctly in the status select (includes Closed; no false `OPEN` display).
3. **Booking status filters** — operator API and dashboard filters list only persisted booking statuses; pending confirmation is not advertised as a booking row state.
4. **Assignment-style wording** — renamed/rewrote Stage 9/10 test and doc framing to product-neutral language; regression suite file renamed to `safety-regressions.test.ts`.

## Test and build results

Clean-install rehearsal used a **separate** SQLite file (`apps/api/prisma/rehearsal.db`) so the developer `dev.db` was not wiped.

Environment note: rehearsal host ran **Node.js v22.22.3** while the repository engines field and `.nvmrc` specify **Node.js 24**. `npm ci` emitted `EBADENGINE` warnings; lint/typecheck/tests/builds still completed. Prefer Node 24 for the live demo.

| Step | Command / action | Result |
|------|------------------|--------|
| Clean | Removed `node_modules` and package `dist` outputs | OK |
| Install | `npm ci` | OK (with Node engine warning) |
| Prisma generate | `npm run db:generate` | OK |
| Migrate + seed (rehearsal DB) | `prisma migrate deploy` + `npm run db:seed` | OK |
| Lint | `npm run lint` | Pass |
| Typecheck | `npm run typecheck` | Pass (after contracts fix) |
| Tests | `npm test` | **149** API + **10** dashboard tests passed |
| Production build | `npm run build` | Pass |
| Clean-repo verify | `npm run verify:clean-repo` | Pass |
| Focused retests after fixes | dashboard suite + security + safety regressions | Pass |

## Demonstrated user flows

Exercised through the **same** Fastify app, orchestrator, tools, confirmation policy, and SQLite database used by WhatsApp (simulator routes; WhatsApp disabled).

### 1. Complete booking (confirmation-gated)

1. Customer: service request → agent asks for missing details (no booking yet).
2. Customer: address + quantity → `prepare_booking` creates a pending action; status `AWAITING_BOOKING_CONFIRMATION`; **no** `Booking` row.
3. Customer: `yes, confirm it` → deterministic policy commits → booking reference created.

Observed rehearsal record:

- Booking reference: `BK-20260728-7999`
- Status: `CONFIRMED`
- Service: Standard AC servicing
- Address: Sector 62, Noida
- Quantity: 2

Operator API listing returned the same row after commit.

### 2. Complaint / refund handoff

1. Fresh customer thread with damage + refund language.
2. `create_handoff` created an open handoff.
3. Customer-facing text did not approve a refund.

Observed rehearsal record:

- Handoff reference: `HO-20260728-8879`
- Status: `OPEN`
- Reason: Customer requested refund after damage

### 3. Live API process (simulator mode + Ollama)

API started with `WHATSAPP_ENABLED=false`, `ENABLE_SIMULATOR=true`, rehearsal DB, and local Ollama.

- `GET /health` → ok  
- `GET /ready` → ready (database ok; worker disabled/healthy; WhatsApp disabled/healthy; simulator enabled; Ollama reachable)  
- Operator overview: `confirmedBookings: 1`, `openHandoffs: 1`, no invented analytics fields  
- A live simulator ping with configured model `llama3.2:3b` (recommended `qwen3:4b` was not installed; pull failed mid-download) returned a **controlled failure** with honest customer copy rather than a fabricated reply

## Remaining limitations

- Local SQLite prototype: not multi-tenant, not horizontally scaled, single-worker webhook default.
- Live conversation quality depends on the local Ollama model and its tool-calling behaviour. Recommended model remains `qwen3:4b`.
- WhatsApp support is text-first; unsupported media is not interpreted as understood content.
- Operator auth is a shared admin bearer token, not per-user identity.
- Hardening (headers, CORS, rate limits, redaction) is baseline safety, not a full production security programme.
- No hosted deployment, secret manager, or production runbook is included.
- Prisma schema still contains a `PENDING_CONFIRMATION` booking enum member for schema continuity; the product path creates bookings only after commit as `CONFIRMED`. Confirmation state belongs on `PendingAction`.
- Repository `engines` require Node 24; this audit host used Node 22 successfully for checks but that is not the declared baseline.
- `npm audit` may still report issues in Prisma CLI transitive tooling; see `docs/decisions/0005-security-hardening.md`.

## Manual Meta steps still required

Only when enabling WhatsApp (`WHATSAPP_ENABLED=true`):

1. Create / use a Meta app with WhatsApp product access and a Cloud API test number.
2. Set `META_GRAPH_VERSION`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and `META_APP_SECRET` in `.env`.
3. Expose a public HTTPS URL (for example Cloudflare Quick Tunnel) to `GET/POST /webhooks/whatsapp`.
4. Configure the webhook verify token and subscribe to message webhooks.
5. Validate signature verification with a real signed payload and send a test text message.
6. Rotate temporary Meta tokens before they expire.

Full walkthrough: [meta-whatsapp-setup.md](meta-whatsapp-setup.md).

Local simulator demos do **not** require these steps.

## Production readiness statement

Sutradhar is a working local product prototype suitable for demonstration of confirmation-gated bookings, handoffs, operator inspection, and official WhatsApp Cloud API integration when configured.

It is **not** claimed to be production-ready. Do not treat a green local rehearsal as clearance for unattended public deployment.

## Exact commands for the final live demo

Use Node.js 24 if available. From a clean or already-installed checkout:

```bash
# 0. One-time / when dependencies change
npm ci
cp .env.example .env
```

Edit `.env` at minimum:

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

```bash
# 1. Model + database
ollama serve
ollama pull qwen3:4b
npm run db:generate
npm exec -w @sutradhar/api -- prisma migrate deploy
npm run db:seed

# 2. Start API + dashboard
npm run dev
```

In another terminal:

```bash
# 3. Health
curl http://localhost:4000/health
curl http://localhost:4000/ready

# 4. Terminal customer chat (same core as WhatsApp)
npm run chat
```

Demo dialogue (about three minutes once warm): follow [demo-script.md](demo-script.md).

```text
Kal shaam AC servicing ho sakta hai?
Sector 62, Noida. Do AC hain.
Haan, kar do
Actually make it 7.
yes
```

Then `/reset` (or a new customer) and:

```text
The last technician damaged my AC and nobody responded. I want a refund.
```

```bash
# 5. Operator console
# Open http://localhost:5173 and sign in with ADMIN_API_TOKEN
# Inspect Conversations → operational trace, Bookings, Handoffs

# Optional fresh catalogue without remigrating
npm run demo:reset
```

Offline verification (no Ollama / Meta required):

```bash
npm run check
```
