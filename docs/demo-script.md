# Three-minute demo script

Goal: show confirmation-gated bookings, inspectable tool execution, contextual reschedule, and human handoff using local tooling.

Assumes `.env` has `WHATSAPP_ENABLED=false`, `ENABLE_SIMULATOR=true`, a non-empty `ADMIN_API_TOKEN`, and seeded data.

## 1. Start Ollama, API, and dashboard (about 30 seconds)

```bash
ollama serve
ollama pull qwen3:4b
npm run db:generate
npm exec -w @sutradhar/api -- prisma migrate deploy
npm run db:seed
npm run dev
```

Open the dashboard at http://localhost:5173 and sign in with `ADMIN_API_TOKEN`.

## 2. Show health and readiness

```bash
curl http://localhost:4000/health
curl http://localhost:4000/ready
```

Point out: `/health` is liveness; `/ready` shows database, worker (disabled/healthy with WhatsApp off), Ollama, and WhatsApp disabled without treating that as failure.

## 3. Send a Hinglish service request

In another terminal:

```bash
npm run chat
```

Customer:

```text
Kal shaam AC servicing ho sakta hai?
```

Show that the agent asks only for missing details (for example location / quantity) in a natural style.

Provide:

```text
Sector 62, Noida. Do AC hain.
```

## 4. Show tool execution

In the dashboard, open the new conversation → operational trace.

Point to tool executions such as `search_services`, `check_availability`, and `prepare_booking`, including status and duration. Emphasize that `prepare_booking` has not created a `Booking` row yet.

## 5. Confirm booking

In chat:

```text
Haan, kar do
```

Only now should a booking reference appear.

## 6. Show database-backed booking

In the dashboard Bookings view (or conversation detail), show the confirmed booking reference and slot. Optionally:

```bash
npm run db:studio
```

and inspect the `Booking` table for the same reference.

## 7. Reschedule contextually

In chat:

```text
Actually make it 7.
```

Show a reschedule proposal and awaiting-confirmation state, then:

```text
yes
```

Confirm the booking’s slot changed only after confirmation.

## 8. Trigger a complaint handoff

Start a fresh thread with `/reset` in chat (keeps existing bookings/handoffs) or a new customer key, then:

```text
The last technician damaged my AC and nobody responded. I want a refund.
```

Show a handoff in the dashboard. Point out the agent does not approve the refund.

## 9. Architecture in one breath

Close with three decisions:

1. One bounded agent, not a multi-agent graph.
2. Confirmation-gated writes: the model prepares, policy commits.
3. Local Ollama + official WhatsApp Cloud API when enabled; simulator shares the same core without Meta.

Total talking time target: about three minutes once processes are warm.
