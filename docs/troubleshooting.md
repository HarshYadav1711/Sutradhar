# Troubleshooting

## Ollama not running

Symptoms: `/ready` shows Ollama unhealthy; chat returns a controlled failure.

Fix:

```bash
ollama serve
curl http://127.0.0.1:11434/api/tags
```

Confirm `OLLAMA_BASE_URL` in `.env` matches the running server (default `http://127.0.0.1:11434`).

## Model not pulled

Symptoms: Ollama reachable but `/ready` reports the configured model is missing.

Fix:

```bash
ollama pull qwen3:4b
ollama list
```

Ensure `OLLAMA_MODEL` matches a listed tag (default `qwen3:4b`).

## SQLite migration issue

Symptoms: API fails on startup or Prisma errors about missing tables / migrations.

Fix:

```bash
npm run db:generate
npm exec -w @sutradhar/api -- prisma migrate deploy
npm run db:seed
```

If the local database is disposable:

```bash
npm run db:reset
```

Confirm `DATABASE_URL` points at the intended file (default `file:./prisma/dev.db` relative to the API package).

## Meta verification failure

Symptoms: Meta webhook setup cannot verify the callback.

Checks:

- API is running and publicly reachable through the tunnel
- Callback URL ends with `/webhooks/whatsapp`
- `WHATSAPP_ENABLED=true`
- `WHATSAPP_VERIFY_TOKEN` exactly matches Meta’s verify token
- Tunnel targets the API port (`4000`), not the dashboard (`5173`)

Local probe:

```bash
curl "http://localhost:4000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=12345"
```

Expect the challenge body when configuration is correct.

## Invalid signature

Symptoms: `POST /webhooks/whatsapp` returns `401` with `INVALID_SIGNATURE` or `MISSING_SIGNATURE`.

Checks:

- `META_APP_SECRET` matches the Meta app secret
- Proxies are not altering the raw body
- You are not signing with the verify token or access token by mistake

## Webhook not arriving

Checks:

- Meta webhook subscribed to `messages`
- Current tunnel URL is saved in Meta (quick tunnels change on restart)
- App is in a mode that delivers to your test number
- Local firewall / tunnel process still running
- Sutradhar logs show whether POSTs reach the process at all

Fallback: use `npm run chat` while debugging transport.

## Temporary access token expiry

Symptoms: inbound may work (webhook uses app secret) but outbound WhatsApp sends fail.

Fix: generate a fresh token in Meta API Setup, update `WHATSAPP_ACCESS_TOKEN`, restart the API. Prefer a long-lived token for extended testing when available.

## Test recipient issue

Symptoms: Cloud API accepts outbound sends but the phone never shows the message.

Fix: ensure your WhatsApp number is added as a allowed test recipient for the Meta test number, and that you are messaging the correct test business number.

## Cloudflare tunnel URL change

Quick tunnels issue a new hostname when restarted.

Fix:

1. Restart `cloudflared tunnel --url http://localhost:4000`
2. Copy the new HTTPS URL
3. Update Meta webhook callback to `https://<new-host>/webhooks/whatsapp`
4. Re-verify

## Duplicate webhook behaviour

Symptoms: Meta retries and you worry about double bookings.

Expected behaviour:

- Duplicate Meta message IDs are accepted with `duplicates` counted and not re-enqueued as new work
- Orchestration ignores duplicate inbound external message IDs
- Confirmation commits are guarded so one pending action cannot create two bookings

## Dashboard authentication failure

| Response | Meaning |
|----------|---------|
| `401 UNAUTHORIZED` | Missing/wrong bearer token in the dashboard sign-in field |
| `503 ADMIN_TOKEN_UNCONFIGURED` | `.env` has empty `ADMIN_API_TOKEN` |

Fix: set `ADMIN_API_TOKEN` in API `.env`, restart API, sign in with the exact same value. Confirm `VITE_API_BASE_URL` points at the API (`http://localhost:4000`) and `CORS_ORIGIN` includes `http://localhost:5173`.
