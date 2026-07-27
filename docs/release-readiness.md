# Release readiness audit

Date: 2026-07-28  
Scope: Sutradhar local product prototype (WhatsApp-native service operations agent)  
Auditor stance: release-candidate and public-share review for correctness, consistency, scope discipline, and reviewer experience  

This document records audits and clean-install rehearsals. It does **not** claim that Sutradhar is production-ready, multi-tenant, horizontally scaled, or fully hardened for public internet operation.

## Checks performed

### Repository hygiene

| Check | Result |
|-------|--------|
| Assignment / hiring / evaluation language outside `AGENTS.md` | Cleared from product docs and test framing |
| Pyrock.ai / founder / deadline product copy | None in README, UI, or product docs |
| Generated placeholder / lorem text | None found |
| Commented-out code / unexplained TODOs | None found |
| Tracked secrets / `.env` | None; `.env.example` present; `verify:clean-repo` passed |
| Committed database files | None (`*.db` gitignored) |
| Fake metrics / testimonials / deployment claims | None; overview returns operational counts only |
| Copied SaaS / template branding | Not present |

### TypeScript and builds

| Check | Result |
|-------|--------|
| Strict TypeScript baseline | Enabled |
| Unexplained `any` | None found in app sources |
| Contracts build after deleting `dist` | Fixed earlier (`tsc -b --force`) |
| Lint / typecheck / test / build / `npm run check` | Pass (2026-07-28 public-share review) |

### Agent safety

| Check | Result |
|-------|--------|
| Model cannot commit booking / reschedule directly | Pass |
| Confirmation policy deterministic | Pass (tightened short-phrase list) |
| Maximum steps enforced | Pass — `MAX_AGENT_STEPS = 5` |
| Commit failure after inbound persist | **Fixed** — domain errors cancel pending and return honest customer copy |
| Prepare + handoff leaving confirmable pending | **Fixed** — handoff cancels pendings; prepare refuses `HANDED_OFF` |
| Atomic slot claim on commit | **Fixed** — `UPDATE … WHERE status = 'AVAILABLE'` |
| Pending cancel scoped by action type | **Fixed** — prepare cancels all `PENDING` rows for the conversation |
| Expiry sweep vs conversation status | **Fixed** — sweep clears `AWAITING_*` when no pending remains |
| Reschedule of cancelled/completed bookings | **Fixed** — only `CONFIRMED` / `RESCHEDULED` |
| Tool `quantity` string coercion | **Fixed** — `z.coerce.number()` |

### WhatsApp / security

| Check | Result |
|-------|--------|
| Official Cloud API + signature validation | Pass |
| Normalize failure silently acked | **Fixed** — returns 500 |
| Unsupported media send-before-persist | **Fixed** — inbound persisted first; duplicates skip send |
| Stale PROCESSING forever / dual-complete | **Fixed** — dead-letter at max attempts; complete only while still `PROCESSING` |
| Non-deterministic ignored webhook keys | **Fixed** — stable SHA-256 keys |
| Shared rate limit starving webhooks | **Fixed** — `/webhooks/whatsapp` allowlisted |
| Verify token in request logs | **Fixed** — query path redacted |
| Unauthenticated DB wipe via simulator reset | **Fixed** — requires admin token when configured; disabled in production |
| Production with simulator enabled | **Fixed** — config rejects `ENABLE_SIMULATOR=true` in production |

### Documentation / DX

| Check | Result |
|-------|--------|
| `.env` path for clean clone | **Fixed** — docs use `apps/api/.env`; loader also accepts root `.env` |
| Chat `/reset` wiping demo bookings | **Fixed** — `/reset` starts a fresh conversation only; `demo:reset` reseeds |
| Dual SQLite writers (`dev` + `chat`) | **Fixed** — chat starts with `startWorker: false` |

## Public-share review findings (2026-07-28)

Reviewed as agent infrastructure, TypeScript backend, Meta webhook, security, founder, and clean-setup perspectives.

### Blocking (fixed)

1. Commit failure after inbound write left sticky pendings and no customer-visible recovery.
2. Same model turn could prepare a booking then hand off while leaving a confirmable pending.
3. Unauthenticated `POST /api/simulator/reset` could wipe the database when the simulator was enabled.
4. Docs told developers to copy `.env` at the repo root; Prisma/workspace scripts expect `apps/api/.env`.
5. Chat `/reset` called full reseed while demo docs described a “fresh thread”.

### Important (fixed)

1. Slot claim was a non-atomic read-then-update; now conditional `AVAILABLE` → `BOOKED`.
2. Pending cancel was type-scoped; opposite-type pendings could linger.
3. Expiry worker did not clear awaiting-confirmation conversation status.
4. Reschedule allowed non-active booking statuses.
5. Unsupported-media path could double-send on retry.
6. Stale webhook recovery could leave events stuck or complete after reclaim.
7. Ignored webhook keys used `Date.now()` and defeated Meta retry dedupe.
8. Global rate limit applied to Meta webhooks.
9. Normalize exceptions were acked with HTTP 200.
10. `hub.verify_token` could appear in request logs.
11. Confirmation accepted overly short phrases (`y`, `ha`, `ji`, bare `book`).
12. Chat opened a second worker against the same SQLite file during `npm run dev`.

### Minor (documented / deferred)

- Unused repository class layer remains (test-only); not deleted in this pass to avoid a broad rewrite.
- Booking status vocabulary is still duplicated across Prisma / routes / contracts (`z.string()` in places).
- Dashboard tests cover auth/client primitives more than full view behaviour.
- Soft slot holds (`HELD`) remain unused; capacity is claimed at commit time only.
- Numbered titles remain inside the safety regression suite for navigation; framing is product-neutral.

### Intentional limitations (not defects)

- Local SQLite prototype; concurrency default 1; not multi-tenant or horizontally scaled.
- Shared `ADMIN_API_TOKEN`, not per-user identity.
- WhatsApp text-first; media is not treated as understood content.
- Live reply quality depends on local Ollama tool-calling (`qwen3:4b` recommended).
- `PENDING_CONFIRMATION` remains on the Prisma booking enum for schema continuity; runtime bookings are created as `CONFIRMED` after policy commit.
- No hosted deployment or secret manager.
- Baseline HTTP hardening only — not a full production security programme.
- Simulator message routes remain unauthenticated when enabled (local DX); production forbids the simulator entirely. Reset is admin-gated when a token is configured.

## Test and build results (post-fix)

| Command | Result |
|---------|--------|
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` | **154** API + **10** dashboard tests passed |
| `npm run build` | Pass |
| `npm run check` | Pass (clean-repo, lint, typecheck, coverage tests, build) |

## Demonstrated user flows

Earlier rehearsal (separate `rehearsal.db`) confirmed:

- Booking `BK-20260728-7999` only after explicit confirmation
- Handoff `HO-20260728-8879` without refund approval
- Operator overview without invented analytics

Live Ollama quality still depends on the installed model. Prefer `qwen3:4b`.

## Manual Meta steps still required

Only when `WHATSAPP_ENABLED=true`:

1. Meta app + Cloud API test number
2. Env: `META_GRAPH_VERSION`, tokens, phone number id, verify token, app secret
3. Public HTTPS tunnel to `/webhooks/whatsapp`
4. Subscribe message webhooks; validate signature with a real payload
5. Rotate temporary Meta tokens

Details: [meta-whatsapp-setup.md](meta-whatsapp-setup.md).

## Production readiness statement

Sutradhar is a working local product prototype suitable for demonstration of confirmation-gated bookings, handoffs, operator inspection, and official WhatsApp Cloud API integration when configured.

It is **not** claimed to be production-ready. Do not treat green local checks as clearance for unattended public deployment.

## Exact commands for the final live demo

Use Node.js 24 (see `.nvmrc`).

```bash
# 0. Install
npm ci
cp .env.example apps/api/.env
```

Edit `apps/api/.env`:

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

Then `/reset` (fresh conversation; keeps bookings) or a new customer, and:

```text
The last technician damaged my AC and nobody responded. I want a refund.
```

```bash
# 5. Operator console
# Open http://localhost:5173 and sign in with ADMIN_API_TOKEN
# Inspect Conversations → operational trace, Bookings, Handoffs

# Optional full catalogue reseed (does wipe operational rows)
npm run demo:reset
```

Offline verification (no Ollama / Meta required):

```bash
npm run check
```
