# Agent behaviour

This document describes the implemented orchestrator behaviour in `apps/api`.

## One orchestrating agent

Sutradhar uses a single bounded agent per inbound message. There are no peer booking/escalation agents. Shared conversation state, pending actions, and confirmation decisions stay in one place.

## Conversation state machine

Implemented statuses:

| State | Meaning |
|-------|---------|
| `IDLE` | No active booking collection |
| `COLLECTING_BOOKING_DETAILS` | Gathering required fields |
| `AWAITING_BOOKING_CONFIRMATION` | Pending create-booking action awaits explicit confirm |
| `BOOKED` | Active booking exists |
| `AWAITING_RESCHEDULE_CONFIRMATION` | Pending reschedule awaits explicit confirm |
| `HANDED_OFF` | Human handoff open |
| `CLOSED` | Conversation closed |

Structured state holds fields such as intent, service, requested date/period, quantity, address, active booking, pending action, detected language, and last activity. The model receives a compact projection of this state, not an unbounded transcript.

## Tools

Agent-exposed tools (Zod-validated, logged):

- `search_services` — catalogue search
- `check_availability` — database slots; returns stored alternatives when the preferred window is empty
- `get_customer_profile` / `save_customer_details` — profile read/update
- `prepare_booking` — creates a pending booking proposal only
- `prepare_reschedule` — creates a pending reschedule proposal only
- `create_handoff` — records a human handoff; never approves refunds or compensation

Not available to the model:

- commit / cancel of pending actions
- webhook inbox mutations
- WhatsApp send primitives as free-form tools

## Bounded loop

For each inbound message that reaches the model:

1. Build bounded context (system instruction, structured state, profile, active booking, pending action, compact summary, recent messages, tools).
2. Call the model provider.
3. Execute at most one tool batch per step, append results, continue.
4. Stop when the model returns customer text, a handoff outcome path completes, failures accumulate, or the step limit is hit.

Maximum model decisions per inbound message: **5**.

Outcomes are typed: tool work, customer response, human handoff, controlled failure, or duplicate-ignored.

## Confirmation policy

If a pending action is open, the inbound text is evaluated by a deterministic classifier before the model can drive further write preparation.

- Explicit affirmatives → internal commit executor (transactional)
- Explicit rejections → cancel pending action
- Expired pending actions → mark expired; do not commit
- Ambiguous text → ask for a clear yes/no style confirmation; do not commit

Examples of affirmatives: `yes`, `confirm it`, `book it`, `go ahead`, `haan`, `kar do`, `haan kar do`.

Examples that must not commit: `maybe`, `okay I will check`.

## Handoff policy

Complaints, refund requests, damage reports, unsupported services, and uncertain situations should create a `HumanHandoff` record with reference, reason, summary, priority, and status.

The system must not:

- approve refunds
- invent compensation
- promise outcomes it cannot fulfil

`create_handoff` returns structured data that marks refund/compensation as not approved.

## Language handling

Customers may write in English or Hinglish. The agent may reply in a matching conversational style. Structured internal state and catalogue identifiers remain English-oriented. Language detection is stored for operator visibility; it does not bypass confirmation or handoff rules.

## Context management

Context is assembled by the context builder:

- fixed system instruction
- current structured conversation state (JSON)
- customer profile and active booking when relevant
- pending action summary when relevant
- compact conversation summary
- a limited recent message window (default about a dozen turns)
- tool definitions

Unlimited raw history is not sent. Tool executions persist separately for the operator trace.

## No chain-of-thought storage

The Ollama request path disables thinking output (`think: false`). Hidden reasoning is not stored in messages, operational events, or operator traces. Traces expose operational event types and tool execution metadata (name, status, duration, errors), not system prompts or model scratchpads.

## Failure behaviour

- Model provider failure → controlled customer-facing failure message + operational event
- Repeated malformed tool calls → controlled failure; no invented success
- Empty availability → real alternatives from the database tool result, never fabricated slots
- Duplicate inbound external message IDs → ignored at the orchestration boundary after the first process
