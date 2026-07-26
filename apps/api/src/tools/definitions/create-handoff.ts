import { z } from 'zod';

import { DomainNotFoundError } from '../../domain/errors.js';
import { createHandoffReference } from '../../domain/references.js';
import type { AgentTool } from '../types.js';

const inputSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  summary: z.string().trim().min(3).max(2000),
  bookingId: z.string().min(1).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
});

function normalizeReason(reason: string): string {
  return reason.trim().toLowerCase().replace(/\s+/g, ' ');
}

export const createHandoffTool: AgentTool<typeof inputSchema, unknown> = {
  name: 'create_handoff',
  description:
    'Create a human handoff for complaints, refunds, damage, or uncertain situations. Never approves refunds or compensation.',
  inputSchema,
  async execute(input, context) {
    const now = context.now ?? new Date();
    const timeZone = context.timeZone ?? process.env.BUSINESS_TIMEZONE ?? 'Asia/Kolkata';
    const normalizedReason = normalizeReason(input.reason);

    const conversation = await context.db.conversation.findUnique({
      where: { id: context.conversationId },
    });
    if (!conversation) {
      throw new DomainNotFoundError('Conversation not found');
    }

    if (input.bookingId) {
      const booking = await context.db.booking.findUnique({
        where: { id: input.bookingId },
      });
      if (!booking) {
        throw new DomainNotFoundError('Related booking not found');
      }
      if (booking.customerId !== context.customerId) {
        throw new DomainNotFoundError('Related booking not found');
      }
    }

    const openHandoffs = await context.db.humanHandoff.findMany({
      where: {
        conversationId: context.conversationId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const existing = openHandoffs.find(
      (handoff) => normalizeReason(handoff.reason) === normalizedReason,
    );

    if (existing) {
      return {
        handoffId: existing.id,
        reference: existing.reference,
        status: existing.status,
        priority: existing.priority,
        reason: existing.reason,
        summary: existing.summary,
        reused: true,
        refundOrCompensationApproved: false,
      };
    }

    let created;
    let attempts = 0;
    while (attempts < 5) {
      attempts += 1;
      const reference = createHandoffReference(now, timeZone);
      try {
        created = await context.db.humanHandoff.create({
          data: {
            reference,
            conversationId: context.conversationId,
            bookingId: input.bookingId ?? null,
            reason: input.reason.trim(),
            summary: input.summary.trim(),
            priority: input.priority ?? 'NORMAL',
            status: 'OPEN',
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

    if (!created) {
      throw new Error('Unable to allocate a unique handoff reference');
    }

    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: {
        status: 'HANDED_OFF',
        lastActivityAt: now,
        currentIntent: 'handoff',
      },
    });

    return {
      handoffId: created.id,
      reference: created.reference,
      status: created.status,
      priority: created.priority,
      reason: created.reason,
      summary: created.summary,
      reused: false,
      refundOrCompensationApproved: false,
    };
  },
};
