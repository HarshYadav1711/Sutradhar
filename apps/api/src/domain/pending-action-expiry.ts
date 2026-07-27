import type { PrismaClient } from '../db/client.js';

/**
 * Marks pending actions past their expiry time.
 * Used both lazily (on confirmation gate) and by a periodic sweep.
 */
export class PendingActionExpiryService {
  constructor(private readonly db: PrismaClient) {}

  async expireDue(now = new Date()): Promise<number> {
    const result = await this.db.pendingAction.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
        version: { increment: 1 },
      },
    });
    return result.count;
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
