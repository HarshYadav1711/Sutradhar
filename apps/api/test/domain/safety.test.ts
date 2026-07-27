import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfirmationPolicy } from '../../src/domain/confirmation-policy.js';
import { DomainConflictError, DomainExpiredError } from '../../src/domain/errors.js';
import { PendingActionExecutor } from '../../src/domain/pending-action-executor.js';
import type { PrismaClient } from '../../src/db/client.js';
import { createTestDatabase } from '../helpers/db.js';
import { seedConversationFixture } from '../helpers/fixtures.js';

describe('confirmation-gated write safety', () => {
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;
  const now = new Date('2026-07-27T04:00:00.000Z');
  const policy = new ConfirmationPolicy();

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

  it('prepare_booking does not create a booking', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const before = await prisma.booking.count();

    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );

    expect(prepared.ok).toBe(true);
    expect(await prisma.booking.count()).toBe(before);
  });

  it('ambiguous confirmation does not commit', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.errorMessage);
    }

    const decision = policy.evaluate('okay I will check');
    expect(decision).toBe('AMBIGUOUS');

    const pendingActionId = (prepared.data as { pendingActionId: string }).pendingActionId;
    const pending = await prisma.pendingAction.findUniqueOrThrow({ where: { id: pendingActionId } });
    expect(pending.status).toBe('PENDING');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('explicit rejection cancels the action', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.errorMessage);
    }

    expect(policy.evaluate('mat karo')).toBe('REJECTED');

    const executor = new PendingActionExecutor(prisma, { timeZone: 'Asia/Kolkata' });
    const pendingActionId = (prepared.data as { pendingActionId: string }).pendingActionId;
    await executor.cancel(pendingActionId);

    const pending = await prisma.pendingAction.findUniqueOrThrow({ where: { id: pendingActionId } });
    expect(pending.status).toBe('CANCELLED');
    expect(await prisma.booking.count()).toBe(0);
  });

  it('expired actions cannot commit', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.errorMessage);
    }

    const pendingActionId = (prepared.data as { pendingActionId: string }).pendingActionId;
    await prisma.pendingAction.update({
      where: { id: pendingActionId },
      data: { expiresAt: new Date(now.getTime() - 1000) },
    });

    const confirmation = await prisma.message.create({
      data: {
        conversationId: fixture.conversation.id,
        direction: 'INBOUND',
        content: 'yes',
      },
    });

    const executor = new PendingActionExecutor(prisma, { timeZone: 'Asia/Kolkata' });
    await expect(
      executor.commit({
        pendingActionId,
        confirmationMessageId: confirmation.id,
        now,
      }),
    ).rejects.toBeInstanceOf(DomainExpiredError);

    expect(await prisma.booking.count()).toBe(0);
    const pending = await prisma.pendingAction.findUniqueOrThrow({ where: { id: pendingActionId } });
    expect(pending.status).toBe('EXPIRED');
  });

  it('repeated confirmation cannot create duplicate bookings', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.errorMessage);
    }

    const pendingActionId = (prepared.data as { pendingActionId: string }).pendingActionId;
    const confirmation = await prisma.message.create({
      data: {
        conversationId: fixture.conversation.id,
        direction: 'INBOUND',
        content: 'confirm it',
      },
    });

    const executor = new PendingActionExecutor(prisma, { timeZone: 'Asia/Kolkata' });
    const first = await executor.commit({
      pendingActionId,
      confirmationMessageId: confirmation.id,
      now,
    });
    expect(first.booking.reference.startsWith('BK-')).toBe(true);
    expect(await prisma.booking.count()).toBe(1);

    await expect(
      executor.commit({
        pendingActionId,
        confirmationMessageId: confirmation.id,
        now,
      }),
    ).rejects.toBeInstanceOf(DomainConflictError);

    expect(await prisma.booking.count()).toBe(1);
  });

  it('unavailable slots cannot be prepared', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const result = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.unavailableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected unavailable slot preparation to fail');
    }
    expect(result.errorCode).toBe('DOMAIN_VALIDATION');
    expect(await prisma.pendingAction.count()).toBe(0);
  });

  it('prices come from stored service data', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const result = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 3,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }

    expect((result.data as { estimatedPriceMinor: number }).estimatedPriceMinor).toBe(
      fixture.service.basePriceMinor * 3,
    );
  });

  it('rescheduling cannot silently alter another customer booking', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const otherCustomer = await prisma.customer.create({
      data: {
        whatsappNumber: '+919900000099',
        name: 'Other Customer',
      },
    });

    const foreignBooking = await prisma.booking.create({
      data: {
        reference: 'BK-FOREIGN-1',
        customerId: otherCustomer.id,
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Another address',
        estimatedPriceMinor: fixture.service.basePriceMinor,
        status: 'CONFIRMED',
        confirmedAt: now,
      },
    });

    const result = await fixture.registry.execute(
      'prepare_reschedule',
      {
        bookingId: foreignBooking.id,
        newAvailabilitySlotId: fixture.alternativeSlot.id,
      },
      fixture.context,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected foreign booking reschedule to fail');
    }
    expect(result.errorCode).toBe('DOMAIN_VALIDATION');

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: foreignBooking.id } });
    expect(reloaded.availabilitySlotId).toBe(fixture.availableSlot.id);
  });

  it('handoff creation is idempotent for the same unresolved reason', async () => {
    const fixture = await seedConversationFixture(prisma, now);

    const first = await fixture.registry.execute(
      'create_handoff',
      {
        reason: 'Refund request for damaged AC',
        summary: 'Customer asked for a refund.',
      },
      fixture.context,
    );
    const second = await fixture.registry.execute(
      'create_handoff',
      {
        reason: 'Refund request for damaged AC',
        summary: 'Customer repeated the refund request.',
      },
      fixture.context,
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error('Expected handoff calls to succeed');
    }

    expect((second.data as { reference: string }).reference).toBe(
      (first.data as { reference: string }).reference,
    );
    expect(await prisma.humanHandoff.count()).toBe(1);
  });

  it('every execution creates a ToolExecution record', async () => {
    const fixture = await seedConversationFixture(prisma, now);
    const result = await fixture.registry.execute('search_services', {}, fixture.context);
    expect(result.toolExecutionId).toBeTruthy();

    const execution = await prisma.toolExecution.findUniqueOrThrow({
      where: { id: result.toolExecutionId },
    });
    expect(execution.toolName).toBe('search_services');
    expect(execution.status).toBe('SUCCESS');
    expect(execution.durationMs).toBeGreaterThanOrEqual(0);
  });
});
