import { z } from 'zod';

import type { CreateBookingPendingPayload } from '../../domain/pending-action-executor.js';
import { DomainNotFoundError, DomainValidationError } from '../../domain/errors.js';
import { formatInrFromMinor } from '../../domain/references.js';
import { formatSlotLabel } from '../../domain/time.js';
import type { AgentTool } from '../types.js';

const PENDING_TTL_MS = 30 * 60 * 1000;

const inputSchema = z.object({
  serviceId: z.string().min(1),
  availabilitySlotId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
  address: z.string().trim().min(3).max(300),
});

export const prepareBookingTool: AgentTool<typeof inputSchema, unknown> = {
  name: 'prepare_booking',
  description:
    'Validate booking details and create a pending booking proposal. Does not create a Booking record.',
  inputSchema,
  async execute(input, context) {
    const now = context.now ?? new Date();
    const timeZone = context.timeZone ?? 'Asia/Kolkata';

    const service = await context.db.service.findFirst({
      where: { id: input.serviceId, active: true },
    });
    if (!service) {
      throw new DomainNotFoundError('Service not found');
    }

    const slot = await context.db.availabilitySlot.findUnique({
      where: { id: input.availabilitySlotId },
    });
    if (!slot) {
      throw new DomainNotFoundError('Availability slot not found');
    }
    if (slot.serviceId !== service.id) {
      throw new DomainValidationError('Availability slot does not belong to the selected service');
    }
    if (slot.status !== 'AVAILABLE') {
      throw new DomainValidationError('Availability slot is not available');
    }
    if (slot.startsAt.getTime() <= now.getTime()) {
      throw new DomainValidationError('Availability slot is not in the future');
    }

    const estimatedPriceMinor = service.basePriceMinor * input.quantity;
    const slotLabel = formatSlotLabel(slot.startsAt, timeZone);
    const proposalSummary = [
      `Service: ${service.name}`,
      `When: ${slotLabel}`,
      `Quantity: ${input.quantity}`,
      `Address: ${input.address}`,
      `Estimated price: ${formatInrFromMinor(estimatedPriceMinor)}`,
      'Reply yes to confirm this booking.',
    ].join('\n');

    const payload: CreateBookingPendingPayload = {
      customerId: context.customerId,
      serviceId: service.id,
      availabilitySlotId: slot.id,
      quantity: input.quantity,
      address: input.address.trim(),
      estimatedPriceMinor,
      proposalSummary,
    };

    const pendingAction = await context.db.$transaction(async (tx) => {
      await tx.pendingAction.updateMany({
        where: {
          conversationId: context.conversationId,
          status: 'PENDING',
          actionType: 'CREATE_BOOKING',
        },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
        },
      });

      const created = await tx.pendingAction.create({
        data: {
          conversationId: context.conversationId,
          actionType: 'CREATE_BOOKING',
          payload,
          status: 'PENDING',
          expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
        },
      });

      await tx.conversation.update({
        where: { id: context.conversationId },
        data: {
          status: 'AWAITING_BOOKING_CONFIRMATION',
          currentIntent: 'booking',
          lastActivityAt: now,
          structuredState: {
            serviceId: service.id,
            availabilitySlotId: slot.id,
            quantity: input.quantity,
            address: input.address.trim(),
            pendingActionId: created.id,
          },
        },
      });

      return created;
    });

    return {
      pendingActionId: pendingAction.id,
      actionType: pendingAction.actionType,
      status: pendingAction.status,
      expiresAt: pendingAction.expiresAt.toISOString(),
      estimatedPriceMinor,
      proposalSummary,
      bookingCreated: false,
    };
  },
};
