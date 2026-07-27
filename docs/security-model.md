# Security model

Sutradhar’s security posture is appropriate for a local prototype and Meta test integration. This document describes implemented controls and known limits. It does not claim production readiness.

## Trust boundaries

| Boundary | Rule |
|----------|------|
| Language model | May interpret language and select tools within the registered tool surface |
| Confirmation policy | Owns commit/cancel decisions for pending booking actions |
| Pending-action executor | Performs transactional commits; not exposed as an LLM tool |
| WhatsApp webhook | Requires enabled mode, raw-body signature validation, and inbox persistence |
| Operator API | Requires configured admin bearer token |
| Simulator | Available only when `ENABLE_SIMULATOR=true`; shares the real business core |

High-impact writes (booking create/reschedule) require an explicit customer affirmative after a proposal.

## Webhook signature

When `WHATSAPP_ENABLED=true`:

- `POST /webhooks/whatsapp` preserves the raw body.
- `X-Hub-Signature-256` is validated with `META_APP_SECRET`.
- Missing or invalid signatures are rejected.

Verification (`GET`) checks `hub.mode` and `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN` and returns `hub.challenge` exactly when valid.

## Idempotency

- Inbound Meta message IDs are unique in storage.
- Duplicate webhook events are acknowledged but not processed twice.
- Pending-action commits are version/status guarded so the same confirmation cannot create two bookings.
- Outbound WhatsApp delivery skips re-send when the outbound message already has a Meta message id.

## Admin token

- Operator routes require `Authorization: Bearer <ADMIN_API_TOKEN>`.
- Empty token configuration returns `503 ADMIN_TOKEN_UNCONFIGURED` (no insecure default secret).
- Production configuration validation requires a non-empty admin token.
- Comparison uses a constant-time check.

This is a shared operator secret, not per-user authentication.

## Secret handling

- Configuration is validated in one module; feature-gated fields apply only when enabled.
- Logs redact authorization headers, WhatsApp access tokens, app secrets, verify tokens, and admin tokens.
- Error responses avoid leaking secrets and omit stack traces in production responses.
- Operator traces do not expose system prompts or hidden model reasoning.
- Operator list views mask WhatsApp numbers; detail views keep full identifiers when needed.
- `.env` is gitignored; `scripts/verify-clean-repo.mjs` checks that `.env` is not tracked and scans for obvious committed secret patterns.

## HTTP baseline

Implemented Fastify protections include:

- Helmet security headers
- Strict CORS allowlist from `CORS_ORIGIN`
- Rate limiting (health/ready excluded from the shared budget)
- Body size limits
- Request IDs
- Content-type checks on mutating routes

## Reliability controls related to safety

- Bounded agent loop (max 5 steps)
- Pending-action expiry (lazy + periodic sweep)
- Webhook stale-processing recovery and capped retries with backoff
- Transient Meta retries only; permanent Meta failures are not retried indefinitely
- Graceful shutdown with a timeout

## Known prototype limitations

- Not a multi-tenant authorization system
- Admin bearer token is shared among operators
- SQLite and default worker concurrency `1` limit write parallelism
- Local Ollama quality varies by model and host
- Meta temporary tokens expire
- Tunnel-based webhook URLs change and must be updated manually
- Coverage and hardening are practical floors, not a complete threat model
- `npm audit` may still report issues in Prisma CLI transitive dependencies; forcing downgrades can break the toolchain (see decision 0005)

Passing tests and clean-repo checks does not mean the application is secure for public internet production use.
