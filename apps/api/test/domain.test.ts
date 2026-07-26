import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedDatabase } from '../src/db/seed.js';
import { DomainConflictError } from '../src/domain/errors.js';
import { createRepositories } from '../src/repositories/index.js';
import type { PrismaClient } from '../src/db/client.js';
import { createTestDatabase } from './helpers/db.js';

describe('domain persistence', () => {
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

  it('enforces unique external message IDs', async () => {
    const repos = createRepositories(prisma);
    const customer = await repos.customers.create({
      name: 'Message Test Customer',
      whatsappNumber: '+919700000001',
    });
    const conversation = await repos.conversations.create({
      customerId: customer.id,
    });

    await repos.messages.create({
      conversationId: conversation.id,
      externalMessageId: 'wamid.TEST_UNIQUE_1',
      direction: 'INBOUND',
      content: 'Hello',
    });

    await expect(
      repos.messages.create({
        conversationId: conversation.id,
        externalMessageId: 'wamid.TEST_UNIQUE_1',
        direction: 'INBOUND',
        content: 'Duplicate',
      }),
    ).rejects.toBeInstanceOf(DomainConflictError);
  });

  it('rejects duplicate booking references', async () => {
    const repos = createRepositories(prisma);
    await seedDatabase(prisma, { now: new Date('2026-07-27T04:00:00.000Z') });

    const customer = await prisma.customer.findFirstOrThrow();
    const service = await prisma.service.findFirstOrThrow();
    const slots = await prisma.availabilitySlot.findMany({
      where: { status: 'AVAILABLE' },
      orderBy: { startsAt: 'asc' },
      take: 2,
    });

    expect(slots.length).toBeGreaterThanOrEqual(2);

    const firstSlot = slots[0];
    const secondSlot = slots[1];
    if (!firstSlot || !secondSlot) {
      throw new Error('Expected two available slots');
    }

    await repos.bookings.create({
      reference: 'BK-DEMO-0001',
      customerId: customer.id,
      serviceId: service.id,
      availabilitySlotId: firstSlot.id,
      quantity: 1,
      address: 'Sector 62, Noida',
      estimatedPriceMinor: service.basePriceMinor,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    });

    await expect(
      repos.bookings.create({
        reference: 'BK-DEMO-0001',
        customerId: customer.id,
        serviceId: service.id,
        availabilitySlotId: secondSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
        estimatedPriceMinor: service.basePriceMinor,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(DomainConflictError);
  });

  it('creates future availability slots relative to seed time', async () => {
    const seedNow = new Date('2026-07-27T04:00:00.000Z');
    const result = await seedDatabase(prisma, { now: seedNow });

    expect(result.serviceCount).toBe(5);
    expect(result.unavailableSlotCount).toBeGreaterThan(0);

    const futureSlots = await prisma.availabilitySlot.findMany({
      where: {
        startsAt: { gt: seedNow },
      },
    });

    expect(futureSlots.length).toBe(result.slotCount);
    expect(futureSlots.every((slot) => slot.startsAt.getTime() > seedNow.getTime())).toBe(true);
    expect(futureSlots.some((slot) => slot.status === 'UNAVAILABLE')).toBe(true);
    expect(futureSlots.every((slot) => slot.timezone === 'Asia/Kolkata')).toBe(true);
  });

  it('persists required relationships across customer, conversation, booking, and handoff', async () => {
    const repos = createRepositories(prisma);
    await seedDatabase(prisma, { now: new Date('2026-07-27T04:00:00.000Z') });

    const customer = await prisma.customer.findFirstOrThrow();
    const service = await prisma.service.findFirstOrThrow({
      where: { slug: 'standard-ac-servicing' },
    });
    const slot = await prisma.availabilitySlot.findFirstOrThrow({
      where: {
        serviceId: service.id,
        status: 'AVAILABLE',
      },
      orderBy: { startsAt: 'asc' },
    });

    const booking = await repos.bookings.create({
      reference: 'BK-REL-1001',
      customerId: customer.id,
      serviceId: service.id,
      availabilitySlotId: slot.id,
      quantity: 2,
      address: customer.defaultAddress ?? 'Sector 62, Noida',
      estimatedPriceMinor: service.basePriceMinor * 2,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    });

    const conversation = await repos.conversations.create({
      customerId: customer.id,
      status: 'BOOKED',
      currentIntent: 'booking',
      detectedLanguage: 'en',
      structuredState: {
        serviceId: service.id,
        quantity: 2,
      },
      activeBookingId: booking.id,
      compactSummary: 'Confirmed AC servicing for two units.',
    });

    const message = await repos.messages.create({
      conversationId: conversation.id,
      externalMessageId: 'wamid.REL_FLOW_1',
      direction: 'INBOUND',
      content: 'Yes, confirm it.',
    });

    const handoff = await repos.humanHandoffs.create({
      reference: 'HO-REL-1001',
      conversationId: conversation.id,
      bookingId: booking.id,
      reason: 'Customer requested a callback before the visit',
      summary: 'Booking confirmed; customer asked for a human callback.',
      priority: 'NORMAL',
    });

    const loadedConversation = await repos.conversations.findById(conversation.id);
    const loadedBooking = await repos.bookings.findByReference(booking.reference);

    expect(message.conversationId).toBe(conversation.id);
    expect(loadedConversation?.activeBookingId).toBe(booking.id);
    expect(loadedConversation?.customer.id).toBe(customer.id);
    expect(loadedBooking?.service.slug).toBe('standard-ac-servicing');
    expect(loadedBooking?.availabilitySlot.id).toBe(slot.id);
    expect(handoff.bookingId).toBe(booking.id);
  });
});
