# Sutradhar Project Context

## Purpose of this document

This file is the permanent engineering and product context for the repository.

Read it before planning, modifying, generating, reviewing, or refactoring any code. Every implementation decision must remain consistent with it unless the repository owner explicitly changes the scope.

Do not reinterpret the product into a generic chatbot, a multi-agent demonstration, a CRM clone, a RAG application, or a broad SaaS platform.

## Original request

The only explicit project request received from the founder was:

"Make some project based out of WhatsApp in Meta Business Suite and share by tonight."

The request does not explicitly require:

- Multiple agents
- Retrieval-augmented generation
- A vector database
- Payments
- Authentication for customers
- A mobile application
- A full CRM
- Instagram or Messenger support
- Voice processing
- Production hosting
- A particular LLM vendor
- A particular agent framework

Do not invent requirements that were not requested.

The project should nevertheless demonstrate the engineering capabilities relevant to an Agentic AI Engineer role:

- TypeScript development
- Agent harness design
- Tool-call orchestration
- Context and memory management
- Webhooks and asynchronous APIs
- Meta WhatsApp Business integration
- Business workflow automation
- Safe and inspectable agent behaviour
- Realistic failure handling
- End-to-end ownership

## Product

The project is named Sutradhar.

Sutradhar is a WhatsApp-native service operations agent for local service businesses.

It converts natural customer conversations into structured and verified business actions.

A customer can message:

"I need AC servicing tomorrow evening in Sector 62."

Sutradhar should:

1. Understand the service request.
2. Identify which required details are missing.
3. Ask only for those missing details.
4. Search the configured service catalogue.
5. Check real availability from the local database.
6. Prepare a booking proposal.
7. Present the proposal to the customer.
8. Wait for explicit customer confirmation.
9. Commit the booking only after confirmation.
10. Preserve the booking and conversation state.
11. Support contextual follow-ups such as "Actually make it 7."
12. Escalate complaints, refund requests, damage reports, unsupported services, and uncertain situations to a human.

This is an operational agent, not an FAQ bot.

## Primary demonstration

The polished demonstration must cover these behaviours.

### Scenario 1: New booking

Customer:

"Hi, I need AC servicing tomorrow evening."

The agent asks for the location and any other genuinely missing information.

The customer provides:

"Sector 62, Noida. I have two ACs."

The agent searches services, checks availability, and presents a booking proposal.

The booking must not be committed yet.

The customer replies:

"Yes, confirm it."

The system confirms the booking and returns a real database-generated booking reference.

### Scenario 2: Contextual rescheduling

After a booking is created, the customer says:

"Actually make it 7."

The agent understands that "it" refers to the active booking.

It checks whether 7:00 PM is available, prepares a rescheduling proposal, and asks for confirmation before changing the booking.

### Scenario 3: Hinglish

The customer says:

"Kal shaam washing machine repair ho sakta hai?"

The agent should understand the request and respond naturally in the same conversational style while maintaining structured English-language internal state.

### Scenario 4: Human escalation

The customer says:

"The last technician damaged my AC and nobody responded. I want a refund."

The system must not invent compensation, approve a refund, or promise an outcome.

It must create a human handoff containing:

- Handoff reference
- Customer
- Reason
- Related booking when available
- Concise conversation summary
- Priority
- Current status

### Scenario 5: No availability

When no requested slot exists, the system must offer real alternatives returned by a tool.

It must never fabricate availability.

## Product positioning

The repository must feel like a genuine product that could continue beyond its first implementation.

Do not mention:

- Pyrock.ai
- An internship
- An assignment
- A founder request
- A hiring process
- A deadline
- Candidate selection
- Evaluation criteria
- "Built as a task"
- "Submission"

The README and interface should describe the product on its own merits.

## Core design principle

The language model may interpret language and choose tools.

The language model must not have direct authority to perform high-impact writes.

For booking creation and booking changes, use a two-phase action model:

1. The agent prepares a pending action.
2. The customer receives a clear summary.
3. The next customer message is evaluated by a deterministic confirmation policy.
4. Only an explicit affirmative response commits the pending action.

The commit operation should be performed by an internal policy-controlled executor, not by a publicly exposed LLM tool.

Examples of explicit confirmation may include:

- yes
- confirm
- confirm it
- book it
- go ahead
- yes please
- haan
- han
- kar do
- confirm kar do

Ambiguous responses such as "maybe", "okay I will check", or unrelated messages must not commit an action.

When the response is unclear, ask for an explicit confirmation.

## Agent architecture

Use one orchestrating agent.

Do not create multiple agents merely to make the architecture look more advanced.

The agent consists of:

- A model provider interface
- A context builder
- A tool registry
- A bounded execution loop
- A conversation state machine
- A pending-action policy
- A deterministic confirmation policy
- A handoff policy
- Tool execution logging
- Model and tool error handling

The agent loop must have a strict maximum number of steps.

Recommended maximum: 5 model decisions per incoming message.

The agent must produce one of these typed outcomes:

- Tool call
- Customer response
- Human handoff
- Controlled failure

Do not store or display hidden chain-of-thought.

The dashboard may show operational events such as:

- Booking intent detected
- Missing location requested
- Service catalogue searched
- Availability checked
- Confirmation requested
- Booking committed
- Human handoff created

## Tools

Expose a small, typed tool surface.

Required agent tools:

- search_services
- check_availability
- get_customer_profile
- save_customer_details
- prepare_booking
- prepare_reschedule
- create_handoff

Internal operations that must not be directly exposed to the model:

- commit_pending_action
- cancel_pending_action
- mark_webhook_processed
- retry_webhook_event
- send_whatsapp_response

Every tool must have:

- A stable name
- A focused description
- A Zod input schema
- A typed result
- Deterministic implementation
- Explicit error handling
- Execution logging
- Idempotency where relevant

Tool inputs must be validated before database access.

## Conversation state

Use an explicit state machine rather than relying entirely on chat history.

Recommended states:

- IDLE
- COLLECTING_BOOKING_DETAILS
- AWAITING_BOOKING_CONFIRMATION
- BOOKED
- AWAITING_RESCHEDULE_CONFIRMATION
- HANDED_OFF
- CLOSED

Structured state should include relevant fields such as:

- Current intent
- Service ID
- Requested date
- Preferred time or period
- Quantity
- Address
- Active booking ID
- Pending action ID
- Detected language
- Last activity time

Conversation context sent to the model should contain:

- A concise system instruction
- Structured conversation state
- Customer profile
- Active booking when relevant
- Pending action when relevant
- A compact conversation summary
- Only the most recent useful messages
- Available tools

Do not send an unlimited raw history to the model.

## Technology baseline

Use only stable, actively maintained, free and non-preview technologies.

Required baseline:

- Node.js 24 LTS
- TypeScript in strict mode
- Native ECMAScript modules
- npm workspaces
- Fastify 5
- Zod
- Prisma ORM stable release
- Local SQLite database
- React 19
- Vite stable release
- Vitest
- Native fetch
- Ollama local API
- Meta WhatsApp Cloud API
- Cloudflare Quick Tunnel for webhook development
- GitHub Actions for repository checks

Install current stable, non-prerelease package versions compatible with Node.js 24.

Pin installed dependencies and commit package-lock.json.

Do not use:

- Alpha, beta, canary, RC, nightly, early-access, or preview dependencies
- Deprecated packages
- Unmaintained WhatsApp automation libraries
- whatsapp-web.js
- Baileys
- Selenium-based WhatsApp automation
- Browser-session scraping
- Unofficial WhatsApp Web reverse engineering
- LangChain merely for one model request
- LangGraph for a single bounded agent
- A vector database without an actual retrieval need
- Paid APIs
- Paid databases
- Services requiring a payment card
- Vendor-specific code throughout the domain layer

## LLM provider

The default provider must be Ollama running locally.

Recommended default model:

qwen3:4b

Use Ollama's native chat and tool-calling interface.

Implement a provider abstraction so a different OpenAI-compatible provider could be added later, but do not require or configure a paid provider in the initial project.

Required providers:

- OllamaProvider for actual local execution
- ScriptedModelProvider only for automated tests

The scripted provider must never be presented as the real AI implementation.

When Ollama is unavailable, return a clear health or runtime error. Do not silently fake an AI response.

## Meta WhatsApp integration

Use the official Meta WhatsApp Cloud API through direct HTTPS requests.

Do not depend on unofficial WhatsApp libraries.

Required webhook behaviour:

GET /webhooks/whatsapp

- Validate hub.mode
- Validate hub.verify_token
- Return hub.challenge exactly when valid
- Reject invalid verification attempts

POST /webhooks/whatsapp

- Preserve the raw request body
- Validate X-Hub-Signature-256 using META_APP_SECRET
- Normalise supported incoming message events
- Deduplicate events using the Meta message ID
- Persist accepted webhook events before processing
- Return a successful acknowledgement promptly
- Process events through a durable local inbox worker
- Record failures and retry only when safe

Use a database-backed webhook inbox instead of requiring Redis.

Supported initial message type:

- Text

Unsupported media should receive a clear response or create a handoff. Do not pretend that media was understood.

Outgoing WhatsApp responses must use the official messages endpoint through native fetch.

The Graph API version must come from configuration.

Do not bury or hardcode a stale version throughout the codebase.

## Local simulator

The complete core workflow must function without Meta configuration.

Provide:

- A local HTTP simulator endpoint
- A small interactive terminal chat command
- Real use of the same orchestrator, tools, policy layer, and database used by WhatsApp
- No separate fake business implementation

The simulator exists so agent behaviour can be developed and demonstrated even when webhook configuration is unavailable.

Meta-specific credentials must only become required when WHATSAPP_ENABLED=true.

## Database entities

At minimum, model:

- Customer
- Service
- AvailabilitySlot
- Booking
- Conversation
- Message
- PendingAction
- ToolExecution
- HumanHandoff
- WebhookEvent

Important constraints:

- External WhatsApp message IDs must be unique.
- Booking references must be unique.
- Handoff references must be unique.
- Pending actions must have statuses and expiry times.
- Tool executions must record tool name, validated input, outcome, duration, and error when relevant.
- Webhook events must record status, attempt count, and failure information.
- Store timestamps consistently.
- Store the configured business timezone separately from UTC timestamps.
- Use transactions for booking and pending-action commits.

## Seed data

Seed realistic service-business data suitable for an Indian demonstration.

Suggested services:

- Standard AC servicing
- AC deep cleaning
- Washing machine inspection
- Refrigerator inspection
- General appliance visit

Use INR for configured service prices.

Generate availability slots relative to the seed date so the demonstration does not become stale.

Do not seed fake customer testimonials, fake user counts, fake revenue, or fake production metrics.

## API

Provide clear versioned or consistently namespaced routes.

Required categories:

- Health and readiness
- Local simulator
- Conversations
- Conversation detail
- Operational trace
- Bookings
- Human handoffs
- WhatsApp webhook
- Development reset or reseed command

Protect operator-facing APIs with a configured admin token.

Do not expose secrets or internal model prompts through API responses.

## Operator console

Build a minimal, serious operator console.

The interface should feel like a focused early-stage product, not an assignment dashboard or template.

Required views:

- Overview
- Conversations
- Conversation detail
- Operational trace
- Bookings
- Human handoffs

The console should show:

- Customer identifier
- Conversation status
- Current intent
- Detected language
- Active booking
- Pending action
- Recent messages
- Agent operational events
- Tool executions
- Tool duration and status
- Open handoffs
- Booking status

Use simple polling rather than adding WebSockets without a need.

Visual direction:

- Clean and restrained
- High information density without clutter
- Responsive
- Accessible
- Strong typography
- Consistent spacing
- Neutral base palette
- No decorative AI imagery
- No robot illustrations
- No copied SaaS template
- No icon library unless an icon is functionally necessary
- No emojis in the product interface

## Security and reliability

Implement:

- Strict environment validation
- Secret redaction from logs
- Meta webhook signature validation
- Webhook idempotency
- Request identifiers
- Structured logs
- CORS allowlist
- Security headers
- Rate limiting where appropriate
- HTTP timeouts
- Retry policies only for transient failures
- Graceful shutdown
- Admin API authentication
- Input size limits
- Tool-loop limit
- Pending-action expiry
- Database transactions
- Clear degraded health when Ollama or WhatsApp is unavailable

Never log:

- Access tokens
- App secrets
- Complete environment variables
- Authorization headers

## Testing

Tests must not require:

- Meta credentials
- Ollama
- A network connection
- Paid infrastructure

Use temporary SQLite test databases and the scripted model provider.

Required test areas:

- Webhook verification
- Webhook signature acceptance and rejection
- Event normalisation
- Duplicate webhook handling
- Service search
- Availability lookup
- Booking proposal creation
- Booking rejection before confirmation
- Explicit confirmation
- Ambiguous confirmation rejection
- Booking commit
- Rescheduling proposal
- Rescheduling commit
- Contextual follow-up
- Hinglish request flow
- No-availability alternatives
- Complaint handoff
- Refund handoff
- Tool validation errors
- Tool execution logging
- Maximum agent steps
- Model provider failure
- WhatsApp delivery failure
- Pending-action expiry

Use deterministic model responses in tests.

Do not assert that nondeterministic natural-language wording must be exactly identical unless the wording itself is a policy requirement.

## Repository quality

Use:

- Strict TypeScript
- No unexplained any
- Small, focused modules
- Dependency injection at integration boundaries
- Repository interfaces where they improve testability
- Clear error types
- Consistent naming
- Useful comments only where intent is not obvious
- No comments that merely repeat the code
- No dead code
- No commented-out code
- No placeholder services
- No fake implementation presented as complete
- No TODO left without an issue or explicit explanation
- No unnecessary abstraction layers

Every stage must leave the repository runnable.

## Documentation voice

Documentation should sound like an engineer describing a product they understand.

Avoid phrases such as:

- revolutionary
- cutting-edge
- seamless
- game-changing
- leverage the power of AI
- state-of-the-art
- enterprise-grade
- robust and scalable, unless specifically demonstrated
- production-ready, unless every production dependency is genuinely addressed

Prefer concrete engineering judgement:

- What was built
- Why a decision was made
- What trade-off was accepted
- What is deterministic
- What remains limited
- What would change at larger scale

The README must:

- Have no emojis
- Have no decorative drawings
- Have no badges unless they provide genuine repository information
- Not mention an assignment
- Not exaggerate maturity
- Include product purpose, architecture, setup, demo flows, safety model, tests, decisions, and limitations
- Reflect only functionality that actually exists

## Environment variables

Use a validated configuration similar to:

NODE_ENV=development
PORT=4000
DATABASE_URL=file:./dev.db
BUSINESS_TIMEZONE=Asia/Kolkata
BUSINESS_CURRENCY=INR
CORS_ORIGIN=http://localhost:5173
ADMIN_API_TOKEN=
ENABLE_SIMULATOR=true

LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b

WHATSAPP_ENABLED=false
META_GRAPH_VERSION=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_VERIFY_TOKEN=
META_APP_SECRET=

Fields that are irrelevant when a feature is disabled must not prevent local startup.

## Definition of done

The initial release is complete only when:

1. A clean clone installs with npm install or npm ci.
2. Database generation, migration, and seeding succeed.
3. The API starts.
4. The dashboard starts.
5. The local terminal simulator completes a booking flow.
6. The booking cannot be created before explicit confirmation.
7. The booking appears in the database and dashboard after confirmation.
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
19. The repository contains no assignment or hiring language.
20. The final demo can be completed using only free, local, or official test resources.

## Change discipline

Before changing code:

1. Read this file.
2. Inspect the existing implementation.
3. Identify the smallest coherent change.
4. Preserve working behaviour.
5. Do not rewrite unrelated files.
6. Do not change architecture silently.
7. Do not claim completion before running checks.

At the end of every requested stage, report:

- Files created
- Files modified
- Architectural decisions
- Commands run
- Test results
- Remaining limitations
- Anything that requires manual action

Do not create Git commits automatically.