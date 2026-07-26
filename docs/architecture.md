# Sutradhar architecture

This document describes the intended system shape and data flow. It does not claim that every component is already implemented.

## Overview

Sutradhar is a monorepo-style Node.js application with:

- An API server (Fastify) that receives WhatsApp webhooks, simulator traffic, and operator API requests.
- One bounded orchestrating agent that interprets customer messages, calls typed tools, and returns customer responses or handoffs.
- Deterministic policy layers for confirmation, pending actions, and human escalation.
- A local SQLite database (Prisma) as the source of truth for customers, services, availability, bookings, conversations, pending actions, tool executions, handoffs, and webhook events.
- An optional operator console (React) that reads operator APIs.
- Ollama as the default local model provider, with a scripted provider for tests only.

There is one orchestrating agent. There are not multiple peer agents for booking, search, or escalation.

## Runtime packages (planned)

- API and agent runtime on Node.js 24 with TypeScript in strict mode and native ESM.
- Shared domain types, Zod schemas, and repository boundaries where they improve testability.
- Operator console built with React 19 and Vite.
- Tests with Vitest using temporary SQLite databases and scripted model responses.

## Message intake paths

### WhatsApp path

1. Meta sends a verification GET to `/webhooks/whatsapp`. The server validates mode and verify token, then returns the challenge exactly when valid.
2. Meta sends an incoming message POST to `/webhooks/whatsapp`.
3. The server preserves the raw body and validates `X-Hub-Signature-256` with the app secret when WhatsApp is enabled.
4. Supported text events are normalised. Unsupported media is answered clearly or escalated; media is not pretended to be understood.
5. Events are deduplicated by Meta message ID and persisted in a database-backed webhook inbox before processing.
6. The HTTP handler acknowledges promptly. A durable local inbox worker processes accepted events.
7. Processing failures are recorded. Retries happen only when safe.

### Simulator path

1. A local HTTP simulator endpoint or interactive terminal command accepts a customer message.
2. The same orchestrator, tools, policies, and database are used.
3. No separate fake business implementation exists for the simulator.
4. Meta credentials are required only when `WHATSAPP_ENABLED=true`.

## Orchestration data flow

For each accepted inbound customer message:

1. **Load context**: resolve or create customer and conversation; load structured conversation state, profile, active booking, pending action, compact summary, and recent useful messages.
2. **Confirmation gate (deterministic)**: if a pending action is awaiting confirmation, evaluate the message with the confirmation policy before giving the model write authority.
   - Explicit affirmative: internal executor commits the pending action transactionally and updates conversation state.
   - Explicit rejection or expiry handling: cancel or expire the pending action as policy dictates.
   - Ambiguous message: do not commit; ask for explicit confirmation or continue collection as appropriate.
3. **Bounded agent loop**: if model work is still needed, the context builder assembles a compact prompt and available tools. The loop allows a strict maximum number of model decisions per inbound message (recommended: 5).
4. **Model decision**: the provider returns one typed outcome path: tool call, customer response, human handoff signal, or controlled failure. Hidden chain-of-thought is not stored or displayed.
5. **Tool execution**: agent-exposed tools validate input with Zod, run deterministic implementations, log executions, and return typed results. Tools may read or prepare state; they do not commit high-impact booking writes.
6. **Policy outcomes**:
   - Prepare booking or reschedule creates a pending action and moves conversation state to an awaiting-confirmation state.
   - Create handoff records a human handoff and moves state to handed off when appropriate.
   - Customer response text is persisted and delivered through WhatsApp or the simulator channel.
7. **Delivery**: outbound WhatsApp uses the official Cloud API messages endpoint via native fetch. Simulator responses return on the local channel. Delivery failures are recorded without inventing success.

## Agent-exposed tools

- `search_services`
- `check_availability`
- `get_customer_profile`
- `save_customer_details`
- `prepare_booking`
- `prepare_reschedule`
- `create_handoff`

## Internal operations (not model tools)

- `commit_pending_action`
- `cancel_pending_action`
- `mark_webhook_processed`
- `retry_webhook_event`
- `send_whatsapp_response`

## Conversation state machine

Recommended states:

- `IDLE`
- `COLLECTING_BOOKING_DETAILS`
- `AWAITING_BOOKING_CONFIRMATION`
- `BOOKED`
- `AWAITING_RESCHEDULE_CONFIRMATION`
- `HANDED_OFF`
- `CLOSED`

Structured fields include intent, service, date, preferred time or period, quantity, address, active booking, pending action, detected language, and last activity time.

Context sent to the model is bounded. Unlimited raw history is not sent.

## Operator console data flow

1. Operator authenticates to operator APIs with a configured admin token.
2. Console views poll for overview, conversations, conversation detail, operational trace, bookings, and handoffs.
3. Displayed data comes from persisted entities and tool execution logs.
4. Secrets and internal model prompts are not exposed through API responses.

## Persistence

Minimum entities:

- Customer, Service, AvailabilitySlot, Booking
- Conversation, Message, PendingAction
- ToolExecution, HumanHandoff, WebhookEvent

Constraints include unique external WhatsApp message IDs, unique booking and handoff references, pending-action status and expiry, tool execution audit fields, webhook status and attempts, consistent UTC timestamps with a configured business timezone, and transactions for booking and pending-action commits.

## Configuration boundaries

- Local development can run with the simulator enabled and WhatsApp disabled.
- Ollama settings apply when the LLM provider is ollama. If Ollama is unavailable, health or runtime errors are explicit; responses are not silently faked.
- WhatsApp fields are required only when WhatsApp is enabled.
- Graph API version comes from configuration, not hardcoded scattered constants.

## Trust boundaries

- The language model chooses language interpretation and tool calls within the allowed tool surface.
- Deterministic policies own confirmation, commit, cancel, webhook acknowledgement semantics, and escalation recording rules.
- High-impact writes require the pending-action confirmation gate.
- Logs redact secrets. Environment validation is strict. Operator APIs are token-protected.
