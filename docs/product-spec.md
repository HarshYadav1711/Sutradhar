# Sutradhar product specification

## Purpose

Sutradhar is a WhatsApp-native service operations agent for local service businesses. It turns natural customer conversations into structured, verified business actions such as bookings, reschedules, and human handoffs.

It is an operational agent, not an FAQ bot. The model may interpret language and choose tools. It must not have direct authority to perform high-impact writes.

## Goals

- Accept customer service requests over WhatsApp text (and a local simulator that uses the same core path).
- Collect only missing booking details, then search a configured service catalogue and real availability.
- Prepare booking and reschedule proposals, present them clearly, and commit only after explicit customer confirmation.
- Preserve conversation and booking state so contextual follow-ups work (for example, "Actually make it 7.").
- Support Hinglish customer language while keeping structured internal state in English.
- Escalate complaints, refund requests, damage reports, unsupported services, and uncertain situations to a human without inventing outcomes.
- Keep agent behaviour inspectable through operational events and tool execution records.
- Run locally with free tooling by default (Ollama, SQLite, optional WhatsApp when enabled).

## Primary users

- **Customers**: message on WhatsApp (or the local simulator) to request, confirm, or change service bookings.
- **Operators**: use a minimal console to inspect conversations, bookings, handoffs, and operational traces.

## Core user flows

### New booking

1. Customer requests a service (for example, AC servicing tomorrow evening).
2. Agent identifies missing details and asks only for those.
3. Customer supplies location and related details.
4. Agent searches services, checks availability, and presents a booking proposal.
5. Booking is not committed yet.
6. Customer gives an explicit affirmative reply.
7. System commits the booking and returns a database-generated booking reference.

### Contextual reschedule

1. After a booking exists, customer refers to it indirectly (for example, "Actually make it 7.").
2. Agent resolves the active booking, checks availability, and prepares a reschedule proposal.
3. Customer confirms explicitly.
4. System commits the change.

### Hinglish request

1. Customer writes in Hinglish.
2. Agent understands the request and replies in a matching conversational style.
3. Internal structured state remains English-language fields.

### Human escalation

1. Customer reports damage, requests a refund, or raises a complaint.
2. System does not invent compensation, approve refunds, or promise outcomes.
3. System creates a handoff with reference, customer, reason, related booking when available, summary, priority, and status.

### No availability

1. Requested slot is unavailable.
2. System offers real alternatives returned by a tool.
3. System never fabricates availability.

## Non-goals

The following are out of scope for the initial product:

- Multiple specialised agents for show
- Retrieval-augmented generation or a vector database without a concrete retrieval need
- Payments and customer authentication
- A mobile application
- A full CRM
- Instagram or Messenger channels
- Voice processing
- Unofficial WhatsApp Web automation
- Paid model providers as a required dependency
- Production hosting claims beyond what is actually implemented

## Safety model

- High-impact booking writes use a two-phase pending-action model.
- A deterministic confirmation policy commits only on explicit affirmatives.
- Ambiguous replies do not commit; the system asks for clear confirmation.
- Commit and cancel of pending actions are internal operations, not model-exposed tools.
- Unsupported media must not be treated as understood.

## Definition of done

The initial release is complete only when all of the following are true:

1. A clean clone installs with `npm install` or `npm ci`.
2. Database generation, migration, and seeding succeed.
3. The API starts.
4. The dashboard starts.
5. The local terminal simulator completes a booking flow.
6. A booking cannot be created before explicit confirmation.
7. After confirmation, the booking appears in the database and dashboard.
8. A contextual reschedule works.
9. A complaint creates a handoff.
10. Tool executions appear in the operational trace.
11. Duplicate webhook messages are not processed twice.
12. Webhook signatures are checked when WhatsApp is enabled.
13. All tests pass without external services.
14. Type checking passes.
15. Linting passes.
16. Production builds pass.
17. No secrets are committed.
18. The README matches the real implementation.
19. The repository documentation describes the product on its own merits.
20. The demo can be completed using only free, local, or official test resources.

## Status note

This document describes the intended product. Capabilities listed here are requirements for implementation stages, not claims that they already exist in the repository.
