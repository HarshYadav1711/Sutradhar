# 0005 — Security and reliability hardening

## Context

Stage 9 hardens Sutradhar without expanding product scope. The API must remain usable for local WhatsApp-disabled development while adding configuration validation, HTTP protections, structured logging redaction, readiness probes, and privacy masking for operator list views.

## Decision

- Configuration is validated in one module (`apps/api/src/config.ts`). Feature-gated fields (WhatsApp, production admin token, scripted LLM) are checked only when relevant.
- HTTP protections use maintained Fastify plugins: `@fastify/helmet`, `@fastify/cors`, and `@fastify/rate-limit`.
- Secrets have no insecure defaults. An empty `ADMIN_API_TOKEN` disables operator access with 503 rather than accepting a shared default.
- `/health` remains process liveness only. `/ready` reports database, worker, Ollama (or scripted test provider), WhatsApp configuration, and simulator status. WhatsApp disabled is healthy, not failed.
- Operator list responses mask WhatsApp numbers. Detail endpoints keep full identifiers for operational work. Webhook payloads and model prompts are not exposed through operator APIs.
- Webhook outbound delivery skips re-send when the outbound message already has a Meta message id, preventing duplicate booking confirmation deliveries on retry.
- Worker concurrency defaults to 1 for SQLite. Pending-action expiry uses both lazy evaluation and a periodic sweep.

## Dependency audit note

`npm audit` reports vulnerabilities in Prisma CLI transitive dependencies (`find-my-way` via `@prisma/dev`, and `valibot`). These sit under the Prisma development tooling chain, not the runtime API path. Forcing `npm audit fix --force` would downgrade Prisma and introduce a breaking change. They remain unresolved until an upstream Prisma release addresses them.

## Consequences

- Local development with `WHATSAPP_ENABLED=false` continues to start without Meta credentials.
- Production requires `ADMIN_API_TOKEN`.
- This hardening improves baseline safety. It does not make the system production-complete for multi-tenant or internet-facing scale.
