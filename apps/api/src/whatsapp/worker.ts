import type { WebhookInboxService } from './inbox.js';

export type WebhookInboxWorkerOptions = {
  pollIntervalMs?: number;
  concurrency?: number;
  enabled?: boolean;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    error: (obj: Record<string, unknown>, msg?: string) => void;
    warn?: (obj: Record<string, unknown>, msg?: string) => void;
  };
  onTickExtras?: () => Promise<void>;
};

export type WorkerStatus = {
  healthy: boolean;
  detail: string;
  running: boolean;
  enabled: boolean;
  inFlight: number;
};

/**
 * In-process polling worker for the WhatsApp webhook inbox.
 * Concurrency defaults to 1 for SQLite safety.
 */
export class WebhookInboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickInFlight = false;
  private activeTasks = 0;
  private consecutiveTickFailures = 0;
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private readonly enabled: boolean;

  constructor(
    private readonly inbox: WebhookInboxService,
    options: WebhookInboxWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.enabled = options.enabled ?? true;
    if (options.onTickExtras) {
      this.onTickExtras = options.onTickExtras;
    }
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  private readonly onTickExtras?: () => Promise<void>;
  private readonly logger?: WebhookInboxWorkerOptions['logger'];

  start(): void {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.timer.unref?.();
    this.logger?.info(
      { concurrency: this.concurrency, pollIntervalMs: this.pollIntervalMs },
      'Webhook inbox worker started',
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const deadline = Date.now() + 30_000;
    while ((this.tickInFlight || this.activeTasks > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  getStatus(): WorkerStatus {
    if (!this.enabled) {
      return {
        healthy: true,
        detail: 'disabled (WhatsApp off)',
        running: false,
        enabled: false,
        inFlight: this.activeTasks,
      };
    }

    if (!this.running) {
      return {
        healthy: false,
        detail: 'not running',
        running: false,
        enabled: true,
        inFlight: this.activeTasks,
      };
    }

    if (this.consecutiveTickFailures >= 5) {
      return {
        healthy: false,
        detail: `degraded after ${this.consecutiveTickFailures} consecutive tick failures`,
        running: true,
        enabled: true,
        inFlight: this.activeTasks,
      };
    }

    return {
      healthy: true,
      detail: `running concurrency=${this.concurrency}`,
      running: true,
      enabled: true,
      inFlight: this.activeTasks,
    };
  }

  async tick(): Promise<void> {
    if (!this.running || this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    try {
      if (this.onTickExtras) {
        await this.onTickExtras();
      }

      const slots = Math.max(1, this.concurrency);
      const tasks: Promise<void>[] = [];
      for (let i = 0; i < slots; i += 1) {
        tasks.push(this.processOneGuarded());
      }
      await Promise.all(tasks);
      this.consecutiveTickFailures = 0;
    } catch (error) {
      this.consecutiveTickFailures += 1;
      this.logger?.error(
        {
          err: error instanceof Error ? { name: error.name, message: error.message } : error,
          consecutiveTickFailures: this.consecutiveTickFailures,
        },
        'Webhook inbox worker tick failed',
      );
    } finally {
      this.tickInFlight = false;
    }
  }

  private async processOneGuarded(): Promise<void> {
    this.activeTasks += 1;
    try {
      // Drain a small number per slot without holding the event loop forever.
      for (let i = 0; i < 3; i += 1) {
        if (!this.running) {
          break;
        }
        const processed = await this.inbox.processOne();
        if (!processed) {
          break;
        }
      }
    } finally {
      this.activeTasks -= 1;
    }
  }
}
