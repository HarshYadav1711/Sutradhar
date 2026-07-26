import { z } from 'zod';

import type { ReschedulePendingPayload } from '../../domain/pending-action-executor.js';
import { DomainNotFoundError, DomainValidationError } from '../../domain/errors.js';
import { formatSlotLabel } from '../../domain/time.js';
import type { AgentTool } from '../types.js';

const PENDING_TTL_MS = 30 * 60 * 1000;

const inputSchema = z.object({
  bookingId: z.string().min(1),
  newAvailabilitySlotId: z.string().min(1),
});

export const prepareRescheduleTool: AgentTool<typeof inputSchema, unknown> = {
  name: 'prepare_reschedule',
  description:
    'Prepare a pending reschedule for an existing booking. Does not update the Booking record until confirmation.',
  inputSchema,
  async execute(input, context) {
    const now = context.now ?? new Date();
    const timeZone = context.timeZone ?? process.env.BUSINESS_TIMEZONE ?? 'Asia/Kolkata';

    const booking = await context.db.booking.findUnique({
      where: { id: input.bookingId },
      include: { service: true, availabilitySlot: true },
    });

    if (!booking) {
      throw new DomainNotFoundError('Booking not found');
    }

    if (booking.customerId !== context.customerId) {
      throw new DomainValidationError('Cannot reschedule another customer booking');
    }

    const conversation = await context.db.conversation.findUnique({
      where: { id: context.conversationId },
    });

    if (!conversation || conversation.customerId !== context.customerId) {
      throw new DomainValidationError('Conversation does not belong to this customer');
    }

    const newSlot = await context.db.availabilitySlot.findUnique({
      where: { id: input.newAvailabilitySlotId },
    });

    if (!newSlot) {
      throw new DomainNotFoundError('Replacement availability slot not found');
    }

    if (newSlot.serviceId !== booking.serviceId) {
      throw new DomainValidationError('Replacement slot does not match the booked service');
    }

    if (newSlot.status !== 'AVAILABLE') {
      throw new DomainValidationError('Replacement slot is not available');
    }

    if (newSlot.startsAt.getTime() <= now.getTime()) {
      throw new DomainValidationError('Replacement slot is not in the future');
    }

    const proposalSummary = [
      `Reschedule booking ${booking.reference}`,
      `Service: ${booking.service.name}`,
      `From: ${formatSlotLabel(booking.availabilitySlot.startsAt, timeZone)}`,
      `To: ${formatSlotLabel(newSlot.startsAt, timeZone)}`,
      'Reply yes to confirm this reschedule.',
    ].join('\n');

    const payload: ReschedulePendingPayload = {
      customerId: context.customerId,
      bookingId: booking.id,
      newAvailabilitySlotId: newSlot.id,
      proposalSummary,
    };

    const pendingAction = await context.db.$transaction(async (tx) => {
      await tx.pendingAction.updateMany({
        where: {
          conversationId: context.conversationId,
          status: 'PENDING',
          actionType: 'RESCHEDULE_BOOKING',
        },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
        },
      });

      const created = await tx.pendingAction.create({
        data: {
          conversationId: context.conversationId,
          actionType: 'RESCHEDULE_BOOKING',
          payload,
          status: 'PENDING',
          expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        },
      });

      await tx.conversation.update({
        where: { id: context.conversationId },
        data: {
          status: 'AWAITING_RESCHEDULE_CONFIRMATION',
          currentIntent: 'reschedule',
          activeBookingId: booking.id,
          lastActivityAt: now,
          structuredState: {
            bookingId: booking.id,
            newAvailabilitySlotId: newSlot.id,
            pendingActionId: created.id,
          },
        },
      });

      return created;
    });

    const unchanged = await context.db.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });

    return {
      pendingActionId: pendingAction.id,
      actionType: pendingAction.actionType,
      status: pendingAction.status,
      expiresAt: pendingAction.expiresAt.toISOString(),
      proposalSummary,
      bookingUpdated: unchanged.availabilitySlotId === booking.availabilitySlotId,
      bookingId: booking.id,
      bookingReference: booking.reference,
    };
  },
};
