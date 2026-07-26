# 0003. Confirmation-gated writes

## Status

Accepted

## Context

Booking creation and booking changes are high-impact writes. Language models can misread intent, over-agree, or treat ambiguous replies as consent. If the model can directly commit bookings through a tool, a single misinterpreted message can create or change real records.

Customers need a clear proposal and an explicit chance to confirm. Operators need an inspectable trail that separates "proposed" from "committed".

## Decision

Use a two-phase pending-action model for booking creation and booking changes:

1. The agent prepares a pending action through tools such as `prepare_booking` or `prepare_reschedule`.
2. The customer receives a clear summary of the proposed change.
3. The next customer message is evaluated by a deterministic confirmation policy.
4. Only an explicit affirmative response commits the pending action.

Commit and cancel are internal, policy-controlled operations. They are not exposed as model tools.

Explicit affirmatives may include phrases such as yes, confirm, confirm it, book it, go ahead, haan, han, kar do, and confirm kar do. Ambiguous replies such as maybe, okay I will check, or unrelated messages must not commit. When unclear, ask for explicit confirmation.

Pending actions have statuses and expiry times. Commits use database transactions.

## Consequences

- The model may draft proposals and gather details, but cannot unilaterally finalise bookings.
- Confirmation behaviour is testable without asserting exact natural-language wording beyond policy requirements.
- Conversation states such as awaiting booking or reschedule confirmation become first-class.
- Some latency is added: every commit needs a confirmation turn.
- Expired or abandoned proposals need explicit cleanup behaviour.

## Alternatives considered

- **Model-exposed `commit_booking` tool**: rejected because it gives the model direct write authority over high-impact state.
- **Treat soft acknowledgements as confirmation**: rejected because ambiguous language would create false bookings.
- **Human approval for every booking**: rejected for the initial local-service flow; customer confirmation is the primary gate, with human handoff reserved for complaints, refunds, damage, unsupported cases, and uncertainty.
- **Commit immediately after proposal generation**: rejected because customers must see and accept the proposal first.
