import type { PrismaClient } from '../db/client.js';
import { seedDatabase } from '../db/seed.js';
import type { AgentOrchestrator } from '../agent/orchestrator.js';
import type { SimulatorMessageRequest } from '@sutradhar/contracts';

export class SimulatorService {
  constructor(
    private readonly db: PrismaClient,
    private readonly orchestrator: AgentOrchestrator,
    private readonly options: { timeZone?: string } = {},
  ) {}

  async sendMessage(input: SimulatorMessageRequest & { requestId?: string }) {
    if (input.startFresh) {
      await this.startFreshConversation(input.customerKey);
    }

    return this.orchestrator.processMessage({
      customerKey: input.customerKey,
      text: input.text,
      channel: 'simulator',
      ...(input.customerName ? { customerName: input.customerName } : {}),
      ...(input.externalMessageId ? { externalMessageId: input.externalMessageId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  }

  async startFreshConversation(customerKey: string): Promise<void> {
    const customer = await this.db.customer.findUnique({
      where: { whatsappNumber: customerKey },
    });
    if (!customer) {
      return;
    }

    const now = new Date();
    await this.db.$transaction(async (tx) => {
      const conversations = await tx.conversation.findMany({
        where: {
          customerId: customer.id,
          status: { not: 'CLOSED' },
        },
        select: { id: true },
      });

      const conversationIds = conversations.map((row) => row.id);
      if (conversationIds.length === 0) {
        return;
      }

      await tx.pendingAction.updateMany({
        where: {
          conversationId: { in: conversationIds },
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          version: { increment: 1 },
        },
      });

      await tx.conversation.updateMany({
        where: { id: { in: conversationIds } },
        data: {
          status: 'CLOSED',
          lastActivityAt: now,
        },
      });
    });
  }

  async resetDemo(now = new Date()) {
    const result = await seedDatabase(this.db, {
      now,
      ...(this.options.timeZone ? { timezone: this.options.timeZone } : {}),
    });

    return {
      ok: true as const,
      timezone: result.timezone,
      serviceCount: result.serviceCount,
      slotCount: result.slotCount,
      availableSlotCount: result.availableSlotCount,
      unavailableSlotCount: result.unavailableSlotCount,
      demoCustomerId: result.demoCustomerId,
      resetAt: now.toISOString(),
    };
  }
}
