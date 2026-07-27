import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentOrchestrator } from '../../src/agent/orchestrator.js';
import { ScriptedModelProvider } from '../../src/agent/model/scripted-provider.js';
import type { ScriptedModelResponse } from '../../src/agent/model/scripted-provider.js';
import type { PrismaClient } from '../../src/db/client.js';
import { createAgentToolRegistry } from '../../src/tools/index.js';
import { createTestDatabase } from '../helpers/db.js';
import { dateKeyInTimeZone, seedConversationFixture } from '../helpers/fixtures.js';

const NOW = new Date('2026-07-27T04:00:00.000Z');

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id = `call_${name}`,
): ScriptedModelResponse {
  return {
    text: null,
    toolCalls: [{ id, name, arguments: args }],
    finishReason: 'tool_calls',
    model: 'scripted',
  };
}

function textReply(text: string): ScriptedModelResponse {
  return {
    text,
    toolCalls: [],
    finishReason: 'stop',
    model: 'scripted',
  };
}

describe('AgentOrchestrator', () => {
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  async function createOrchestrator(
    buildResponses: (
      fixture: Awaited<ReturnType<typeof seedConversationFixture>>,
    ) => ScriptedModelResponse[],
  ) {
    const fixture = await seedConversationFixture(prisma, NOW);
    const provider = new ScriptedModelProvider(buildResponses(fixture), {
      env: { NODE_ENV: 'test' },
    });
    const orchestrator = new AgentOrchestrator(prisma, provider, createAgentToolRegistry(), {
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
    });
    return { fixture, provider, orchestrator };
  }

  it('completes a new booking only after explicit confirmation', async () => {
    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      textReply('Sure — what is the service address?'),
      toolCall('search_services', { query: 'AC servicing' }),
      toolCall('check_availability', {
        serviceId: fx.service.id,
        date: dateKeyInTimeZone(fx.availableSlot.startsAt),
        timePreference: 'evening',
      }),
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 2,
        address: 'Sector 62, Noida',
      }),
      textReply('I can book Standard AC servicing for 2 units at Sector 62, Noida. Reply yes to confirm.'),
    ]);

    const ask = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Hi, I need AC servicing tomorrow evening.',
      externalMessageId: 'wamid.BOOK_1',
      now: NOW,
      channel: 'test',
    });
    expect(ask.outcome).toBe('CUSTOMER_RESPONSE');
    expect(ask.outboundText).toMatch(/address/i);
    expect(await prisma.booking.count()).toBe(0);

    const propose = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Sector 62, Noida. I have two ACs.',
      externalMessageId: 'wamid.BOOK_2',
      now: NOW,
      channel: 'test',
    });
    expect(propose.outcome).toBe('CUSTOMER_RESPONSE');
    expect(propose.pendingActionId).toBeTruthy();
    expect(propose.conversationStatus).toBe('AWAITING_BOOKING_CONFIRMATION');
    expect(await prisma.booking.count()).toBe(0);
    expect(propose.outboundText).not.toMatch(/search_services|prepare_booking/i);
    expect(propose.outboundText).not.toMatch(/\|.+\|/);

    const confirm = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Yes, confirm it.',
      externalMessageId: 'wamid.BOOK_3',
      now: NOW,
      channel: 'test',
    });
    expect(confirm.outcome).toBe('CUSTOMER_RESPONSE');
    expect(confirm.bookingReference).toBeTruthy();
    expect(confirm.conversationStatus).toBe('BOOKED');
    expect(confirm.outboundText).toContain(confirm.bookingReference!);
    expect(await prisma.booking.count()).toBe(1);

    const events = await prisma.operationalEvent.findMany({
      where: { conversationId: fixture.conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.some((event) => event.eventType === 'CONFIRMATION_REQUESTED')).toBe(true);
    expect(events.some((event) => event.eventType === 'BOOKING_COMMITTED')).toBe(true);

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: fixture.conversation.id },
    });
    expect(conversation.compactSummary).toBeTruthy();
    expect(conversation.structuredState).toBeTruthy();
  });

  it('does not book before confirmation and rejects explicit cancellation', async () => {
    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposal ready. Reply yes to confirm.'),
    ]);

    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Book AC servicing for me at Sector 62',
      externalMessageId: 'wamid.REJ_1',
      now: NOW,
    });
    expect(await prisma.booking.count()).toBe(0);

    const rejected = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'no',
      externalMessageId: 'wamid.REJ_2',
      now: NOW,
    });
    expect(rejected.outcome).toBe('CUSTOMER_RESPONSE');
    expect(await prisma.booking.count()).toBe(0);
    expect(rejected.outboundText).toMatch(/cancel/i);

    const pending = await prisma.pendingAction.findFirst({
      where: { conversationId: fixture.conversation.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(pending?.status).toBe('CANCELLED');
  });

  it('asks for explicit confirmation on ambiguous replies', async () => {
    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposal ready. Reply yes to confirm.'),
    ]);

    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Please prepare AC booking at Sector 62',
      externalMessageId: 'wamid.AMB_1',
      now: NOW,
    });

    const ambiguous = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'maybe',
      externalMessageId: 'wamid.AMB_2',
      now: NOW,
    });

    expect(ambiguous.outboundText).toMatch(/yes|no|confirm/i);
    expect(await prisma.booking.count()).toBe(0);
    const pending = await prisma.pendingAction.findFirstOrThrow({
      where: { conversationId: fixture.conversation.id, status: 'PENDING' },
    });
    expect(pending.status).toBe('PENDING');
  });

  it('handles contextual rescheduling with confirmation', async () => {
    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposal ready. Reply yes to confirm.'),
    ]);

    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Book AC at Sector 62',
      externalMessageId: 'wamid.RS_1',
      now: NOW,
    });
    const confirmed = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'confirm',
      externalMessageId: 'wamid.RS_2',
      now: NOW,
    });
    expect(confirmed.bookingId).toBeTruthy();

    const rescheduleOrchestrator = new AgentOrchestrator(
      prisma,
      new ScriptedModelProvider(
        [
          toolCall('check_availability', {
            serviceId: fixture.service.id,
            date: dateKeyInTimeZone(fixture.alternativeSlot.startsAt),
            timePreference: 'evening',
          }),
          toolCall('prepare_reschedule', {
            bookingId: confirmed.bookingId!,
            newAvailabilitySlotId: fixture.alternativeSlot.id,
          }),
          textReply('I can move your booking to 7. Reply yes to confirm.'),
        ],
        { env: { NODE_ENV: 'test' } },
      ),
      createAgentToolRegistry(),
      { timeZone: 'Asia/Kolkata', currency: 'INR' },
    );

    const proposed = await rescheduleOrchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Actually make it 7.',
      externalMessageId: 'wamid.RS_3',
      now: NOW,
    });
    expect(proposed.conversationStatus).toBe('AWAITING_RESCHEDULE_CONFIRMATION');
    expect(await prisma.booking.count()).toBe(1);

    const rescheduled = await rescheduleOrchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'yes',
      externalMessageId: 'wamid.RS_4',
      now: NOW,
    });
    expect(rescheduled.conversationStatus).toBe('BOOKED');
    expect(rescheduled.outboundText).toContain(confirmed.bookingReference!);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: confirmed.bookingId! },
    });
    expect(booking.availabilitySlotId).toBe(fixture.alternativeSlot.id);
    expect(booking.status).toBe('RESCHEDULED');
  });

  it('handles a Hinglish booking request in matching style', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => [
      textReply('Haan, kal shaam ke liye address bataiye.'),
    ]);

    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Kal shaam washing machine repair ho sakta hai?',
      externalMessageId: 'wamid.HI_1',
      now: NOW,
    });

    expect(result.outcome).toBe('CUSTOMER_RESPONSE');
    expect(result.outboundText).toMatch(/address|bataiye|shaam/i);
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: result.conversationId },
    });
    expect(conversation.detectedLanguage).toBe('hinglish');
  });

  it('offers real alternatives when availability is empty', async () => {
    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('check_availability', {
        serviceId: fx.service.id,
        date: dateKeyInTimeZone(fx.unavailableSlot.startsAt),
        timePreference: 'afternoon',
      }),
      textReply(
        'That afternoon has no matching slot. I can share real alternatives from the schedule.',
      ),
    ]);

    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Need AC servicing that afternoon',
      externalMessageId: 'wamid.NAV_1',
      now: NOW,
    });

    expect(result.outcome).toBe('CUSTOMER_RESPONSE');
    expect(
      result.operationalEvents.some(
        (event) => event.eventType === 'NO_AVAILABILITY_ALTERNATIVES_OFFERED',
      ),
    ).toBe(true);
  });

  it('creates complaint and refund handoffs without approving outcomes', async () => {
    const complaint = await createOrchestrator(() => [
      toolCall('create_handoff', {
        reason: 'Customer complaint about technician damage and no response',
        summary: 'Customer reports AC damage and lack of response.',
        priority: 'HIGH',
      }),
      textReply('I have escalated this to a teammate. No refund has been approved.'),
    ]);

    const complaintResult = await complaint.orchestrator.processMessage({
      customerKey: complaint.fixture.customer.whatsappNumber!,
      text: 'The last technician damaged my AC and nobody responded. I want a refund.',
      externalMessageId: 'wamid.HO_1',
      now: NOW,
    });

    expect(complaintResult.outcome).toBe('HUMAN_HANDOFF');
    expect(complaintResult.handoffReference).toBeTruthy();
    expect(complaintResult.outboundText).toContain(complaintResult.handoffReference!);
    expect(complaintResult.outboundText).toMatch(/no refund has been approved|not been approved|approve nahi/i);
    expect(complaintResult.conversationStatus).toBe('HANDED_OFF');

    const refund = await createOrchestrator(() => [
      toolCall('create_handoff', {
        reason: 'Customer requested a refund',
        summary: 'Refund request for previous visit.',
        priority: 'HIGH',
      }),
      textReply('Refund request handed to the team. No compensation approved yet.'),
    ]);

    const refundResult = await refund.orchestrator.processMessage({
      customerKey: refund.fixture.customer.whatsappNumber!,
      text: 'I want a refund for the last visit',
      externalMessageId: 'wamid.HO_2',
      now: NOW,
    });
    expect(refundResult.outcome).toBe('HUMAN_HANDOFF');
    expect(refundResult.handoffReference).toBeTruthy();

    const handoff = await prisma.humanHandoff.findUniqueOrThrow({
      where: { id: refundResult.handoffId! },
    });
    expect(handoff.status).toBe('OPEN');
  });

  it('returns a controlled failure on provider outage', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => []);

    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Need AC servicing',
      externalMessageId: 'wamid.OUT_1',
      now: NOW,
    });

    expect(result.outcome).toBe('CONTROLLED_FAILURE');
    expect(result.outboundText).toMatch(/could not generate|try again/i);
    expect(
      result.operationalEvents.some((event) => event.eventType === 'MODEL_PROVIDER_FAILURE'),
    ).toBe(true);
  });

  it('handles malformed tool calls without inventing success', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => [
      {
        text: null,
        toolCalls: [
          {
            id: 'bad',
            name: 'prepare_booking',
            arguments: { serviceId: 123 } as unknown as Record<string, unknown>,
          },
        ],
        finishReason: 'tool_calls',
        model: 'scripted',
      },
      {
        text: null,
        toolCalls: [
          {
            id: 'bad2',
            name: 'prepare_booking',
            arguments: { serviceId: 123 } as unknown as Record<string, unknown>,
          },
        ],
        finishReason: 'tool_calls',
        model: 'scripted',
      },
    ]);

    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Book something',
      externalMessageId: 'wamid.BAD_1',
      now: NOW,
    });

    expect(result.outcome).toBe('CONTROLLED_FAILURE');
    expect(await prisma.booking.count()).toBe(0);
    expect(
      result.operationalEvents.some(
        (event) =>
          event.eventType === 'MALFORMED_TOOL_CALL' || event.eventType === 'REPEATED_TOOL_FAILURE',
      ),
    ).toBe(true);
  });

  it('stops at the configured maximum step count', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => [
      toolCall('search_services', { query: 'ac' }, 's1'),
      toolCall('search_services', { query: 'ac' }, 's2'),
      toolCall('search_services', { query: 'ac' }, 's3'),
      toolCall('search_services', { query: 'ac' }, 's4'),
      toolCall('search_services', { query: 'ac' }, 's5'),
      textReply('should not be used'),
    ]);

    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Find AC service',
      externalMessageId: 'wamid.MAX_1',
      now: NOW,
    });

    expect(result.outcome).toBe('CONTROLLED_FAILURE');
    expect(result.stepsUsed).toBe(5);
    expect(
      result.operationalEvents.some((event) => event.eventType === 'MAX_AGENT_STEPS_REACHED'),
    ).toBe(true);
  });

  it('protects against repeated inbound messages at the orchestration boundary', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => [
      textReply('Got it, what address should we use?'),
    ]);

    const first = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Need AC servicing',
      externalMessageId: 'wamid.DUP_1',
      now: NOW,
    });
    expect(first.duplicated).toBe(false);

    const second = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Need AC servicing',
      externalMessageId: 'wamid.DUP_1',
      now: NOW,
    });
    expect(second.outcome).toBe('DUPLICATE_IGNORED');
    expect(second.duplicated).toBe(true);
    expect(second.inboundMessageId).toBe(first.inboundMessageId);
    expect(second.outboundText).toBe(first.outboundText);

    const inboundCount = await prisma.message.count({
      where: {
        conversationId: fixture.conversation.id,
        externalMessageId: 'wamid.DUP_1',
      },
    });
    expect(inboundCount).toBe(1);
  });
});
