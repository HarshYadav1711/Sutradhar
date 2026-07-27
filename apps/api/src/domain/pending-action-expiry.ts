import type { PrismaClient } from '../db/client.js';

/**
 * Marks pending actions past their expiry time and clears awaiting-confirmation
 * conversation status when no other pending action remains.
 */
export class PendingActionExpiryService {
  constructor(private readonly db: PrismaClient) {}

  async expireDue(now = new Date()): Promise<number> {
    const due = await this.db.pendingAction.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      select: { id: true, conversationId: true },
    });

    if (due.length === 0) {
      return 0;
    }

    await this.db.pendingAction.updateMany({
      where: {
        id: { in: due.map((row) => row.id) },
        status: 'PENDING',
      },
      data: {
        status: 'EXPIRED',
        version: { increment: 1 },
      },
    });

    const conversationIds = [...new Set(due.map((row) => row.conversationId))];
    for (const conversationId of conversationIds) {
      const remaining = await this.db.pendingAction.count({
        where: { conversationId, status: 'PENDING' },
      });
      if (remaining > 0) {
        continue;
      }

      const conversation = await this.db.conversation.findUnique({
        where: { id: conversationId },
        select: { status: true, activeBookingId: true },
      });
      if (!conversation) {
        continue;
      }

      if (
        conversation.status !== 'AWAITING_BOOKING_CONFIRMATION' &&
        conversation.status !== 'AWAITING_RESCHEDULE_CONFIRMATION'
      ) {
        continue;
      }

      await this.db.conversation.update({
        where: { id: conversationId },
        data: {
          status: conversation.activeBookingId ? 'BOOKED' : 'COLLECTING_BOOKING_DETAILS',
          lastActivityAt: now,
        },
      });
    }

    return due.length;
  }
}

export type PendingActionExpiryWorkerOptions = {
  intervalMs?: number;
  enabled?: boolean;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    error?: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export class PendingActionExpiryWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = false;
  private readonly intervalMs: number;
  private readonly enabled: boolean;

  constructor(
    private readonly service: PendingActionExpiryService,
    options: PendingActionExpiryWorkerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 30_000;
    this.enabled = options.enabled ?? true;
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  private readonly logger?: PendingActionExpiryWorkerOptions['logger'];

  start(): void {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async tick(now = new Date()): Promise<number> {
    if (!this.running || this.inFlight) {
      return 0;
    }
    this.inFlight = true;
    try {
      const expired = await this.service.expireDue(now);
      if (expired > 0) {
        this.logger?.info({ expiredCount: expired }, 'Expired pending actions');
      }
      return expired;
    } catch (error) {
      this.logger?.error?.(
        {
          err: error instanceof Error ? { name: error.name, message: error.message } : error,
        },
        'Pending action expiry sweep failed',
      );
      return 0;
    } finally {
      this.inFlight = false;
    }
  }
}
