# Meta WhatsApp Cloud API setup

Use this only when you want live WhatsApp traffic. Local booking demos do not require Meta.

Do not put real access tokens, app secrets, or verify tokens into git. Keep them in `.env` only.

## Overview

Sutradhar integrates with the official WhatsApp Cloud API:

- `GET /webhooks/whatsapp` — subscription verification
- `POST /webhooks/whatsapp` — signed inbound events
- Outbound text via `https://graph.facebook.com/{META_GRAPH_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`

Unofficial WhatsApp Web libraries are not supported.

## 1. Create a Meta app

1. Open [Meta for Developers](https://developers.facebook.com/).
2. Create an app suitable for Business / WhatsApp use.
3. Note the **App ID** and **App Secret** (`META_APP_SECRET`).

## 2. Add the WhatsApp product

1. In the app dashboard, add **WhatsApp**.
2. Open WhatsApp → API Setup (wording varies slightly in Meta UI).
3. Note:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** → `WHATSAPP_BUSINESS_ACCOUNT_ID` (optional for this project’s core path)
   - Temporary or permanent **access token** → `WHATSAPP_ACCESS_TOKEN`
   - Graph version shown in examples → `META_GRAPH_VERSION` (for example `v21.0`)

## 3. Test number and recipients

1. Use Meta’s provided test phone number for development.
2. Add your personal WhatsApp number as an allowed test recipient when required by Meta’s test flow.
3. Incomplete recipient allowlisting is a common reason messages appear to send from the API but never arrive on the handset.

## 4. Choose a verify token

Create your own random string for webhook verification, for example a long random value.

Set the same value in:

- Meta webhook configuration (`Verify token`)
- Local `.env` as `WHATSAPP_VERIFY_TOKEN`

Do not reuse the app secret as the verify token.

## 5. Expose the local API with Cloudflare Quick Tunnel

Meta must reach your machine over HTTPS.

Example using Cloudflare’s quick tunnel against the local API port:

```bash
cloudflared tunnel --url http://localhost:4000
```

Copy the generated `https://....trycloudflare.com` URL.

Webhook callback URL:

```text
https://<your-tunnel-host>/webhooks/whatsapp
```

Notes:

- Quick tunnel URLs change when the tunnel restarts. Update the Meta webhook callback each time.
- Keep the Sutradhar API running on `PORT=4000` (or match the tunnel target).

## 6. Configure the webhook in Meta

1. WhatsApp → Configuration → Webhook.
2. Callback URL: `https://<tunnel>/webhooks/whatsapp`
3. Verify token: the same `WHATSAPP_VERIFY_TOKEN` value.
4. Subscribe to the **messages** field (minimum required for this project).
5. Save / verify. Meta sends `GET /webhooks/whatsapp` with `hub.mode`, `hub.verify_token`, and `hub.challenge`. Sutradhar returns the challenge when the token matches.

## 7. Enable WhatsApp in Sutradhar

In `.env`:

```env
WHATSAPP_ENABLED=true
META_GRAPH_VERSION=v21.0
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_VERIFY_TOKEN=
META_APP_SECRET=
```

Fill the empty values from the Meta dashboard. Restart the API after changes.

When `WHATSAPP_ENABLED=true`, configuration validation requires the Graph version, access token, phone number ID, verify token, and app secret.

## 8. Signature requirement

Every `POST /webhooks/whatsapp` must include a valid `X-Hub-Signature-256` header computed with `META_APP_SECRET` over the raw body.

Invalid or missing signatures are rejected (`401`). Do not disable signature checks for convenience in shared environments.

## 9. Access-token placement

- Store the token only in `.env` as `WHATSAPP_ACCESS_TOKEN`.
- Prefer a long-lived token for ongoing tests when Meta allows it.
- Temporary tokens expire; expired tokens produce outbound delivery failures until replaced.
- Never commit tokens, paste them into docs, or log them.

## 10. Common webhook mistakes

- Callback URL missing `/webhooks/whatsapp`
- Tunnel pointing at the dashboard port (`5173`) instead of the API (`4000`)
- Verify token mismatch between Meta and `.env`
- `WHATSAPP_ENABLED=false` while testing webhooks
- App secret mismatch → signature failures
- Subscribed to the wrong webhook fields (need `messages`)
- Tunnel URL changed after restart and Meta still points at the old host
- Expecting media messages to be fully understood (text is the supported initial type)
- Replaying the same Meta message ID: Sutradhar acknowledges duplicates but processes once

## 11. Smoke checks

Verification (as Meta would):

```bash
curl "http://localhost:4000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=12345"
```

Expect `12345` when WhatsApp is enabled and the token matches.

Readiness:

```bash
curl http://localhost:4000/ready
```

With WhatsApp enabled and credentials present, the WhatsApp check should report configured. Ollama and database still matter for overall status.

## 12. Fallback while Meta is unavailable

Keep `WHATSAPP_ENABLED=false` and use:

```bash
npm run chat
```

or the HTTP simulator. Business logic is shared; only the transport differs.
