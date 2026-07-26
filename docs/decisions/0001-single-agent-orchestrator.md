# 0001. Single agent orchestrator

## Status

Accepted

## Context

Sutradhar must turn WhatsApp (and simulator) conversations into bookings, reschedules, and human handoffs. The work spans language understanding, tool calls, structured state, and policy checks. It is tempting to split this into multiple specialised agents (for example, intake, booking, and escalation agents) to make the architecture look more advanced.

The product need is a single operational conversation with shared state: one customer thread, one pending action, one active booking, and one confirmation decision. Extra agent boundaries would invent coordination problems without a product requirement for independent goals, parallel planning, or multi-party negotiation.

## Decision

Use one bounded orchestrating agent.

The agent includes a model provider interface, context builder, tool registry, bounded execution loop, conversation state machine, pending-action policy, deterministic confirmation policy, handoff policy, tool execution logging, and model/tool error handling.

The loop has a strict maximum number of model decisions per inbound message (recommended: 5). Outcomes are typed: tool call, customer response, human handoff, or controlled failure.

Do not add multiple agents merely to appear more sophisticated.

## Consequences

- Conversation state and pending actions stay in one place, which simplifies confirmation gating and auditability.
- Tool surface stays small and shared.
- Failure modes are easier to reason about: one loop limit, one context budget, one outcome per turn path.
- Scaling later can still introduce specialised workers if real concurrency or ownership boundaries appear; that is not needed for the initial product.
- Complexity that would otherwise live in inter-agent messaging must live in clear policies and typed tools instead.

## Alternatives considered

- **Multi-agent graph (intake / booking / escalation agents)**: rejected for the initial product. It adds handoff protocols and duplicated context without improving the booking confirmation safety model.
- **Framework-heavy multi-agent orchestration libraries**: rejected as unnecessary for a single bounded loop with a small tool set.
- **Pure rule engine with no model**: rejected because natural language, Hinglish, and contextual references need language interpretation; rules alone are a poor fit for open customer phrasing.
