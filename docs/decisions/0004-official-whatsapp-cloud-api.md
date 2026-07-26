# 0004. Official WhatsApp Cloud API

## Status

Accepted

## Context

Sutradhar is WhatsApp-native. Integration options include the official Meta WhatsApp Cloud API and unofficial WhatsApp Web automation libraries that drive a browser session or reverse-engineered client protocol.

Unofficial automation can appear faster to prototype, but it is brittle, often against platform terms, hard to secure, and unsuitable as a durable product foundation. The product also needs webhook verification, signature validation, idempotent event handling, and a path that works with Meta Business tooling.

Local development must still work when Meta credentials are absent, through a simulator that shares the same business core.

## Decision

Use the official Meta WhatsApp Cloud API through direct HTTPS requests with native fetch.

Do not depend on unofficial WhatsApp libraries, WhatsApp Web session scraping, or browser automation clients.

Webhook behaviour:

- GET verification validates mode and verify token, then returns the challenge exactly when valid.
- POST handling preserves the raw body, validates `X-Hub-Signature-256`, normalises supported text events, deduplicates by Meta message ID, persists events before processing, acknowledges promptly, and processes through a database-backed inbox worker.

Graph API version comes from configuration. Meta credentials are required only when `WHATSAPP_ENABLED=true`.

## Consequences

- Integration aligns with Meta's supported Business API path and signature model.
- Setup requires Meta app configuration, tokens, and a publicly reachable webhook during WhatsApp-enabled development (for example, a tunnel).
- Unsupported media must be handled explicitly rather than scraped from a web client.
- The simulator remains available so core booking behaviour can be developed without WhatsApp credentials.
- Delivery and webhook failures become ordinary HTTP and inbox concerns instead of browser-session failures.

## Alternatives considered

- **whatsapp-web.js, Baileys, or similar unofficial clients**: rejected due to fragility, unsupported status, and poor fit for durable webhook-based operations.
- **Selenium or browser-session scraping of WhatsApp Web**: rejected as unreliable and inappropriate for a service operations product.
- **Third-party WhatsApp BSP SDKs as a hard dependency**: not required for the initial product; direct Cloud API access keeps the integration explicit and inspectable.
- **WhatsApp-only development with no simulator**: rejected because local demos and tests must work without Meta configuration.
