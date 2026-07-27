import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import {
  DomainConflictError,
  DomainExpiredError,
  DomainNotFoundError,
  DomainValidationError,
} from './errors.js';
import { createBookingReference } from './references.js';

export type CreateBookingPendingPayload = {
  customerId: string;
  serviceId: string;
  availabilitySlotId: string;
  quantity: number;
  address: string;
  estimatedPriceMinor: number;
  proposalSummary: string;
};

export type ReschedulePendingPayload = {
  customerId: string;
  bookingId: string;
  newAvailabilitySlotId: string;
  proposalSummary: string;
};

export type PendingActionPayload = CreateBookingPendingPayload | ReschedulePendingPayload;

function isCreateBookingPayload(payload: unknown): payload is CreateBookingPendingPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.customerId === 'string' &&
    typeof value.serviceId === 'string' &&
    typeof value.availabilitySlotId === 'string' &&
    typeof value.quantity === 'number' &&
    typeof value.address === 'string' &&
    typeof value.estimatedPriceMinor === 'number'
  );
}

function isReschedulePayload(payload: unknown): payload is ReschedulePendingPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.customerId === 'string' &&
    typeof value.bookingId === 'string' &&
    typeof value.newAvailabilitySlotId === 'string'
  );
}

export class PendingActionExecutor {
  constructor(
    private readonly db: PrismaClient,
    private readonly options: { timeZone?: string } = {},
  ) {}

  async cancel(pendingActionId: string): Promise<{ pendingActionId: string; status: 'CANCELLED' }> {
    const updated = await this.db.pendingAction.updateMany({
      where: {
        id: pendingActionId,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new DomainConflictError('Pending action could not be cancelled');
    }

    return { pendingActionId, status: 'CANCELLED' };
  }

  async commit(input: {
    pendingActionId: string;
    confirmationMessageId: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const timeZone = this.options.timeZone ?? 'Asia/Kolkata';

    const pending = await this.db.pendingAction.findUnique({
      where: { id: input.pendingActionId },
    });

    if (!pending) {
      throw new DomainNotFoundError('Pending action not found');
    }

    if (pending.status === 'COMMITTED') {
      throw new DomainConflictError('Pending action was already committed');
    }

    if (pending.status === 'CANCELLED') {
      throw new DomainConflictError('Pending action was cancelled');
    }

    if (pending.status === 'EXPIRED' || pending.expiresAt.getTime() <= now.getTime()) {
      if (pending.status === 'PENDING') {
        await this.db.pendingAction.updateMany({
          where: {
            id: pending.id,
            status: 'PENDING',
          },
          data: {
            status: 'EXPIRED',
            version: { increment: 1 },
          },
        });
      }
      throw new DomainExpiredError('Pending action has expired');
    }

    if (pending.status !== 'PENDING') {
      throw new DomainConflictError(`Pending action is ${pending.status}`);
    }

    return this.db.$transaction(async (tx) => {
      const claimed = await tx.pendingAction.updateMany({
        where: {
          id: pending.id,
          status: 'PENDING',
          version: pending.version,
        },
        data: {
          status: 'COMMITTED',
          confirmationMessageId: input.confirmationMessageId,
          version: { increment: 1 },
        },
      });

      if (claimed.count !== 1) {
        throw new DomainConflictError('Pending action could not be committed');
      }

      if (pending.actionType === 'CREATE_BOOKING') {
        return this.commitCreateBooking(tx, pending.conversationId, pending.payload, timeZone, now);
      }

      if (pending.actionType === 'RESCHEDULE_BOOKING') {
        return this.commitReschedule(tx, pending.conversationId, pending.payload, now);
      }

      throw new DomainValidationError(`Unsupported pending action type: ${pending.actionType}`);
    });
  }

  private async commitCreateBooking(
    tx: Prisma.TransactionClient,
    conversationId: string,
    rawPayload: Prisma.JsonValue,
    timeZone: string,
    now: Date,
  ) {
    if (!isCreateBookingPayload(rawPayload)) {
      throw new DomainValidationError('Invalid create booking payload');
    }

    const payload = rawPayload;
    const slot = await tx.availabilitySlot.findUnique({
      where: { id: payload.availabilitySlotId },
    });

    if (!slot || slot.serviceId !== payload.serviceId) {
      throw new DomainValidationError('Availability slot is invalid for this service');
    }

    if (slot.status !== 'AVAILABLE') {
      throw new DomainValidationError('Availability slot is no longer available');
    }

    const slotClaimed = await tx.availabilitySlot.updateMany({
      where: { id: slot.id, status: 'AVAILABLE' },
      data: { status: 'BOOKED' },
    });
    if (slotClaimed.count !== 1) {
      throw new DomainValidationError('Availability slot is no longer available');
    }

    let booking;
    let attempts = 0;
    while (attempts < 5) {
      attempts += 1;
      const reference = createBookingReference(now, timeZone);
      try {
        booking = await tx.booking.create({
          data: {
            reference,
            customerId: payload.customerId,
            serviceId: payload.serviceId,
            availabilitySlotId: payload.availabilitySlotId,
            quantity: payload.quantity,
            address: payload.address,
            estimatedPriceMinor: payload.estimatedPriceMinor,
            status: 'CONFIRMED',
            confirmedAt: now,
          },
          include: {
            service: true,
            availabilitySlot: true,
          },
        });
        break;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002' &&
          attempts < 5
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!booking) {
      throw new DomainConflictError('Unable to allocate a unique booking reference');
    }

    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'BOOKED',
        activeBookingId: booking.id,
        lastActivityAt: now,
        currentIntent: 'booking',
      },
    });

    return {
      type: 'CREATE_BOOKING' as const,
      booking: {
        id: booking.id,
        reference: booking.reference,
        status: booking.status,
        serviceId: booking.serviceId,
        availabilitySlotId: booking.availabilitySlotId,
        quantity: booking.quantity,
        address: booking.address,
        estimatedPriceMinor: booking.estimatedPriceMinor,
        confirmedAt: booking.confirmedAt?.toISOString() ?? now.toISOString(),
      },
    };
  }

  private async commitReschedule(
    tx: Prisma.TransactionClient,
    conversationId: string,
    rawPayload: Prisma.JsonValue,
    now: Date,
  ) {
    if (!isReschedulePayload(rawPayload)) {
      throw new DomainValidationError('Invalid reschedule payload');
    }

    const payload = rawPayload;
    const booking = await tx.booking.findUnique({
      where: { id: payload.bookingId },
    });

    if (!booking) {
      throw new DomainNotFoundError('Booking not found');
    }

    if (booking.customerId !== payload.customerId) {
      throw new DomainValidationError('Booking does not belong to this customer');
    }

    if (booking.status !== 'CONFIRMED' && booking.status !== 'RESCHEDULED') {
      throw new DomainValidationError('Only confirmed bookings can be rescheduled');
    }

    const conversation = await tx.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || conversation.customerId !== payload.customerId) {
      throw new DomainValidationError('Conversation does not own this booking');
    }

    const newSlot = await tx.availabilitySlot.findUnique({
      where: { id: payload.newAvailabilitySlotId },
    });

    if (!newSlot || newSlot.serviceId !== booking.serviceId) {
      throw new DomainValidationError('Replacement slot is invalid for this booking');
    }

    if (newSlot.status !== 'AVAILABLE') {
      throw new DomainValidationError('Replacement slot is no longer available');
    }

    const newSlotClaimed = await tx.availabilitySlot.updateMany({
      where: { id: newSlot.id, status: 'AVAILABLE' },
      data: { status: 'BOOKED' },
    });
    if (newSlotClaimed.count !== 1) {
      throw new DomainValidationError('Replacement slot is no longer available');
    }

    if (booking.availabilitySlotId !== newSlot.id) {
      await tx.availabilitySlot.update({
        where: { id: booking.availabilitySlotId },
        data: { status: 'AVAILABLE' },
      });
    }

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: {
        availabilitySlotId: newSlot.id,
        status: 'RESCHEDULED',
        confirmedAt: now,
      },
      include: {
        service: true,
        availabilitySlot: true,
      },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'BOOKED',
        activeBookingId: updated.id,
        lastActivityAt: now,
        currentIntent: 'reschedule',
      },
    });

    return {
      type: 'RESCHEDULE_BOOKING' as const,
      booking: {
        id: updated.id,
        reference: updated.reference,
        status: updated.status,
        serviceId: updated.serviceId,
        availabilitySlotId: updated.availabilitySlotId,
        quantity: updated.quantity,
        address: updated.address,
        estimatedPriceMinor: updated.estimatedPriceMinor,
        confirmedAt: updated.confirmedAt?.toISOString() ?? now.toISOString(),
      },
    };
  }
}
