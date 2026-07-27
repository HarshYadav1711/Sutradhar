# Testing

Sutradhar tests are deterministic and offline.

## Guarantees

- No Ollama, Meta credentials, internet, paid services, or shared `dev.db`
- Temporary SQLite databases per suite
- `ScriptedModelProvider` for orchestration paths

## Layout (`apps/api/test`)

| Folder | Role |
|--------|------|
| `unit/` | Pure policy, signature, normalisation, provider helpers |
| `domain/` | Tools, pending-action safety, seed/domain constraints |
| `api/` | HTTP operator, health, security |
| `webhook/` | WhatsApp webhook HTTP + durable inbox |
| `agent/` | Orchestrator flows and numbered safety regressions |

## Local commands

```bash
npm run verify:clean-repo
npm run test:coverage
npm run check
```

`npm run check` runs clean-repo verification, lint, typecheck, coverage tests, and production build.

## Coverage floors (API `src/`)

- Statements / lines / functions: 70%
- Branches: 55%

These floors match the real suite. They are not a claim of complete coverage.

## Intentionally light areas

- `src/cli/*` and `src/server.ts` process wiring (manual / smoke)
- Generated Prisma client
- Full Ollama live inference (mocked HTTP only)
- Real Meta Graph network calls (mocked `fetch` only)
