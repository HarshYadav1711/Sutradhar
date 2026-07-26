import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AGENT_SYSTEM_INSTRUCTION,
  ContextBuilder,
  DEFAULT_RECENT_MESSAGE_LIMIT,
} from '../src/agent/index.js';
import type { PrismaClient } from '../src/db/client.js';
import { createAgentToolRegistry } from '../src/tools/index.js';
import { createTestDatabase } from './helpers/db.js';
import { seedConversationFixture } from './helpers/fixtures.js';

describe('ContextBuilder', () => {
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;
  const now = new Date('2026-07-27T04:00:00.000Z');

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

  it('truncates recent messages to the configured limit and deduplicates consecutive repeats', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const builder = new ContextBuilder(prisma, createAgentToolRegistry());

    for (let index = 0; index < 20; index += 1) {
      await prisma.message.create({
        data: {
          conversationId: fixture.conversation.id,
          direction: index % 2 === 0 ? 'INBOUND' : 'OUTBOUND',
          content: `message-${index}`,
        },
      });
    }

    await prisma.message.create({
      data: {
        conversationId: fixture.conversation.id,
        direction: 'INBOUND',
        content: 'duplicate',
      },
    });
    await prisma.message.create({
      data: {
        conversationId: fixture.conversation.id,
        direction: 'INBOUND',
        content: 'duplicate',
      },
    });

    const context = await builder.build(fixture.conversation.id, {
      recentMessageLimit: 5,
      now,
    });

    expect(context.recentMessages.length).toBeLessThanOrEqual(5);
    expect(context.recentMessages.length).toBeLessThanOrEqual(DEFAULT_RECENT_MESSAGE_LIMIT);
    const duplicatePairs = context.recentMessages.filter(
      (message, index, all) =>
        index > 0 &&
        all[index - 1]?.role === message.role &&
        all[index - 1]?.content === message.content,
    );
    expect(duplicatePairs).toHaveLength(0);
  });

  it('includes pending action and active booking in structured state', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const builder = new ContextBuilder(prisma, createAgentToolRegistry());

    const booking = await prisma.booking.create({
      data: {
        reference: 'BK-CTX-1001',
        customerId: fixture.customer.id,
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
        estimatedPriceMinor: fixture.service.basePriceMinor,
        status: 'CONFIRMED',
        confirmedAt: now,
      },
    });

    await prisma.conversation.update({
      where: { id: fixture.conversation.id },
      data: {
        activeBookingId: booking.id,
        compactSummary: 'Customer confirmed AC servicing.',
        status: 'BOOKED',
      },
    });

    await prisma.pendingAction.create({
      data: {
        conversationId: fixture.conversation.id,
        actionType: 'RESCHEDULE_BOOKING',
        status: 'PENDING',
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        payload: {
          customerId: fixture.customer.id,
          bookingId: booking.id,
          newAvailabilitySlotId: fixture.alternativeSlot.id,
          proposalSummary: 'Move booking to evening.',
        },
      },
    });

    const context = await builder.build(fixture.conversation.id, { now });

    expect(context.systemInstruction).toBe(AGENT_SYSTEM_INSTRUCTION);
    expect(context.conversationState.activeBooking).toMatchObject({
      id: booking.id,
      reference: 'BK-CTX-1001',
    });
    expect(context.conversationState.pendingAction).toMatchObject({
      actionType: 'RESCHEDULE_BOOKING',
      proposalSummary: 'Move booking to evening.',
    });
    expect(context.compactSummary).toBe('Customer confirmed AC servicing.');
    expect(context.tools.some((tool) => tool.name === 'prepare_booking')).toBe(true);
    expect(JSON.stringify(context)).not.toContain('ToolExecution');
  });
});
