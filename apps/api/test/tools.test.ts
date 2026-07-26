import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/db/client.js';
import { createAgentToolRegistry, AGENT_TOOL_NAMES } from '../src/tools/index.js';
import { createTestDatabase } from './helpers/db.js';
import { dateKeyInTimeZone, seedConversationFixture } from './helpers/fixtures.js';

describe('agent tools', () => {
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

  it('registers only the agent-visible tools and not commit_pending_action', () => {
    const registry = createAgentToolRegistry();
    expect(registry.list().map((tool) => tool.name).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(registry.has('commit_pending_action')).toBe(false);
    expect(registry.has('cancel_pending_action')).toBe(false);
  });

  it('search_services returns real catalogue entries and empty results honestly', async () => {
    const fixture = await seedConversationFixture(prisma, now);

    const all = await fixture.registry.execute('search_services', {}, fixture.context);
    expect(all.ok).toBe(true);
    if (!all.ok) {
      throw new Error(all.errorMessage);
    }
    const allData = all.data as { count: number; services: Array<{ id: string; basePriceMinor: number }> };
    expect(allData.count).toBe(5);
    expect(allData.services[0]?.id).toBeTruthy();
    expect(allData.services[0]?.basePriceMinor).toBeGreaterThan(0);

    const empty = await fixture.registry.execute(
      'search_services',
      { query: 'spaceship repair' },
      fixture.context,
    );
    expect(empty.ok).toBe(true);
    if (!empty.ok) {
      throw new Error(empty.errorMessage);
    }
    expect((empty.data as { count: number }).count).toBe(0);
  });

  it('check_availability returns database slots and alternatives without inventing data', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const date = dateKeyInTimeZone(fixture.unavailableSlot.startsAt);

    const result = await fixture.registry.execute(
      'check_availability',
      {
        serviceId: fixture.service.id,
        date,
        timePreference: 'afternoon',
      },
      fixture.context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }

    const data = result.data as {
      matched: unknown[];
      alternatives: Array<{ id: string; status: string }>;
    };

    expect(data.matched).toEqual([]);
    expect(data.alternatives.length).toBeGreaterThan(0);
    expect(data.alternatives.every((slot) => slot.status === 'AVAILABLE')).toBe(true);

    const ids = new Set(
      (
        await prisma.availabilitySlot.findMany({
          where: { serviceId: fixture.service.id, status: 'AVAILABLE' },
          select: { id: true },
        })
      ).map((slot) => slot.id),
    );
    expect(data.alternatives.every((slot) => ids.has(slot.id))).toBe(true);
  });

  it('get_customer_profile and save_customer_details update only validated fields', async () => {
    const fixture = await seedConversationFixture(prisma, now);

    const profile = await fixture.registry.execute('get_customer_profile', {}, fixture.context);
    expect(profile.ok).toBe(true);
    if (!profile.ok) {
      throw new Error(profile.errorMessage);
    }

    const saved = await fixture.registry.execute(
      'save_customer_details',
      {
        name: 'Ananya Updated',
        defaultAddress: '',
      },
      fixture.context,
    );
    expect(saved.ok).toBe(false);

    const updated = await fixture.registry.execute(
      'save_customer_details',
      {
        name: 'Ananya Updated',
      },
      fixture.context,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      throw new Error(updated.errorMessage);
    }

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: fixture.customer.id },
    });
    expect(customer.name).toBe('Ananya Updated');
    expect(customer.defaultAddress).toBe(fixture.customer.defaultAddress);
  });

  it('prepare_booking creates a pending proposal with catalogue pricing', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const before = await prisma.booking.count();

    const result = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 2,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }

    const data = result.data as {
      pendingActionId: string;
      estimatedPriceMinor: number;
      bookingCreated: boolean;
      proposalSummary: string;
    };

    expect(data.bookingCreated).toBe(false);
    expect(data.estimatedPriceMinor).toBe(fixture.service.basePriceMinor * 2);
    expect(data.proposalSummary).toContain('Reply yes to confirm');
    expect(await prisma.booking.count()).toBe(before);

    const pending = await prisma.pendingAction.findUniqueOrThrow({
      where: { id: data.pendingActionId },
    });
    expect(pending.status).toBe('PENDING');
    expect(pending.actionType).toBe('CREATE_BOOKING');
  });

  it('prepare_reschedule requires ownership and does not mutate the booking yet', async () => {
    const fixture = await seedConversationFixture(prisma, now);

    const booking = await prisma.booking.create({
      data: {
        reference: 'BK-TOOL-1001',
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

    await prisma.availabilitySlot.update({
      where: { id: fixture.availableSlot.id },
      data: { status: 'BOOKED' },
    });

    const result = await fixture.registry.execute(
      'prepare_reschedule',
      {
        bookingId: booking.id,
        newAvailabilitySlotId: fixture.alternativeSlot.id,
      },
      fixture.context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.availabilitySlotId).toBe(fixture.availableSlot.id);
    expect(reloaded.status).toBe('CONFIRMED');
  });

  it('create_handoff returns a reference and never approves refunds', async () => {
    const fixture = await seedConversationFixture(prisma, now);

    const first = await fixture.registry.execute(
      'create_handoff',
      {
        reason: 'Customer wants a refund after damage',
        summary: 'AC damage complaint with refund request.',
        priority: 'HIGH',
      },
      fixture.context,
    );

    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.errorMessage);
    }

    const firstData = first.data as {
      reference: string;
      reused: boolean;
      refundOrCompensationApproved: boolean;
    };
    expect(firstData.reference.startsWith('HO-')).toBe(true);
    expect(firstData.reused).toBe(false);
    expect(firstData.refundOrCompensationApproved).toBe(false);

    const second = await fixture.registry.execute(
      'create_handoff',
      {
        reason: 'Customer wants a refund after damage',
        summary: 'Follow-up on the same unresolved refund request.',
      },
      fixture.context,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error(second.errorMessage);
    }
    expect((second.data as { reference: string; reused: boolean }).reference).toBe(
      firstData.reference,
    );
    expect((second.data as { reused: boolean }).reused).toBe(true);
  });

  it('records a ToolExecution for every tool invocation', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const before = await prisma.toolExecution.count({
      where: { conversationId: fixture.conversation.id },
    });

    await fixture.registry.execute('search_services', { query: 'ac' }, fixture.context);
    await fixture.registry.execute('get_customer_profile', {}, fixture.context);
    await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.unavailableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );

    const after = await prisma.toolExecution.count({
      where: { conversationId: fixture.conversation.id },
    });
    expect(after - before).toBe(3);
  });
});
