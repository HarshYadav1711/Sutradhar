import type { WebhookInboxService } from './inbox.js';

export type WebhookInboxWorkerOptions = {
  pollIntervalMs?: number;
  enabled?: boolean;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    error: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

/**
 * In-process polling worker for the WhatsApp webhook inbox.
 */
export class WebhookInboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickInFlight = false;
  private readonly pollIntervalMs: number;
  private readonly enabled: boolean;

  constructor(
    private readonly inbox: WebhookInboxService,
    options: WebhookInboxWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.enabled = options.enabled ?? true;
  }

  start(): void {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    // Avoid keeping the event loop alive solely for the poller in tests/scripts.
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.tickInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async tick(): Promise<void> {
    if (!this.running || this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    try {
      // Process a small batch per tick to drain backlog without blocking forever.
      for (let i = 0; i < 5; i += 1) {
        const processed = await this.inbox.processOne();
        if (!processed) {
          break;
        }
      }
    } catch (error) {
      // Keep the worker alive; individual event failures are recorded on the row.
      void error;
    } finally {
      this.tickInFlight = false;
    }
  }
}
