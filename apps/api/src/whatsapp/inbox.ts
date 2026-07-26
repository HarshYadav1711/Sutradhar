import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import type { AgentOrchestrator } from '../agent/orchestrator.js';
import type { WhatsAppClient } from './client.js';
import { WhatsAppClientError } from './client.js';
import {
  normalizeWhatsAppWebhookPayload,
  type NormalizedWhatsAppEvent,
} from './normalize.js';

export type WebhookInboxOptions = {
  maxAttempts?: number;
  staleProcessingMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
};

const UNSUPPORTED_MEDIA_REPLY =
  'I can only handle text messages right now. Please send your request as text, or ask to speak with a teammate.';

export class PermanentWebhookError extends Error {
  readonly code: string;

  constructor(message: string, code = 'PERMANENT_WEBHOOK_FAILURE') {
    super(message);
    this.name = 'PermanentWebhookError';
    this.code = code;
  }
}

export class TransientWebhookError extends Error {
  readonly code: string;

  constructor(message: string, code = 'TRANSIENT_WEBHOOK_FAILURE') {
    super(message);
    this.name = 'TransientWebhookError';
    this.code = code;
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function computeBackoffMs(
  attemptCount: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
): number {
  const exp = Math.min(baseBackoffMs * 2 ** Math.max(attemptCount - 1, 0), maxBackoffMs);
  return exp;
}

/**
 * Database-backed WhatsApp webhook inbox: persist, claim, process, retry.
 */
export class WebhookInboxService {
  private readonly maxAttempts: number;
  private readonly staleProcessingMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly db: PrismaClient,
    private readonly orchestrator: AgentOrchestrator,
    private readonly whatsapp: WhatsAppClient | null,
    options: WebhookInboxOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.staleProcessingMs = options.staleProcessingMs ?? 60_000;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 5 * 60_000;
  }

  normalize(payload: unknown): NormalizedWhatsAppEvent[] {
    return normalizeWhatsAppWebhookPayload(payload);
  }

  /**
   * Persist accepted normalised events. Duplicate external keys are skipped.
   */
  async enqueueNormalizedEvents(
    events: NormalizedWhatsAppEvent[],
  ): Promise<{ accepted: number; duplicates: number }> {
    let accepted = 0;
    let duplicates = 0;

    for (const event of events) {
      try {
        await this.db.webhookEvent.create({
          data: {
            externalKey: event.externalKey,
            eventType: event.kind,
            payload: toJsonValue(event),
            status: 'RECEIVED',
            attemptCount: 0,
            nextAttemptAt: new Date(),
          },
        });
        accepted += 1;
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          duplicates += 1;
          continue;
        }
        throw error;
      }
    }

    return { accepted, duplicates };
  }

  async recoverStaleProcessing(now = new Date()): Promise<number> {
    const staleBefore = new Date(now.getTime() - this.staleProcessingMs);
    const result = await this.db.webhookEvent.updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: staleBefore },
      },
      data: {
        status: 'FAILED',
        failureCode: 'STALE_PROCESSING',
        failureMessage: 'Recovered stale PROCESSING event for retry',
        nextAttemptAt: now,
      },
    });
    return result.count;
  }

  async claimNext(now = new Date()) {
    await this.recoverStaleProcessing(now);

    const candidate = await this.db.webhookEvent.findFirst({
      where: {
        OR: [
          {
            status: 'RECEIVED',
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: 'FAILED',
            attemptCount: { lt: this.maxAttempts },
            nextAttemptAt: { lte: now },
          },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    });

    if (!candidate) {
      return null;
    }

    const claimed = await this.db.webhookEvent.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        attemptCount: candidate.attemptCount,
      },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        failureCode: null,
        failureMessage: null,
      },
    });

    if (claimed.count !== 1) {
      return null;
    }

    return this.db.webhookEvent.findUniqueOrThrow({ where: { id: candidate.id } });
  }

  async processClaimedEvent(eventId: string, now = new Date()): Promise<void> {
    const event = await this.db.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return;
    }

    try {
      await this.processPayload(event.eventType, event.payload);
      await this.db.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          failureCode: null,
          failureMessage: null,
          nextAttemptAt: null,
        },
      });
    } catch (error) {
      await this.recordFailure(event.id, event.attemptCount, error, now);
    }
  }

  async processOne(now = new Date()): Promise<boolean> {
    const claimed = await this.claimNext(now);
    if (!claimed) {
      return false;
    }
    await this.processClaimedEvent(claimed.id, now);
    return true;
  }

  private async processPayload(eventType: string, payload: unknown): Promise<void> {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    const kind = typeof record?.kind === 'string' ? record.kind : eventType;

    if (kind === 'status_event' || kind === 'ignored') {
      return;
    }

    if (kind === 'text_message') {
      await this.processTextMessage(record!);
      return;
    }

    if (kind === 'unsupported_message') {
      await this.processUnsupportedMessage(record!);
      return;
    }

    throw new PermanentWebhookError(`Unsupported webhook event type: ${kind}`, 'UNKNOWN_EVENT_TYPE');
  }

  private async processTextMessage(event: Record<string, unknown>): Promise<void> {
    const waId = String(event.waId ?? '');
    const text = String(event.text ?? '');
    const externalMessageId = String(event.externalMessageId ?? '');
    const profileName = typeof event.profileName === 'string' ? event.profileName : null;

    if (!waId || !text || !externalMessageId) {
      throw new PermanentWebhookError('Text message payload missing required fields');
    }

    const result = await this.orchestrator.processMessage({
      customerKey: waId,
      text,
      externalMessageId,
      ...(profileName ? { customerName: profileName } : {}),
      channel: 'whatsapp',
    });

    if (result.outboundText && this.whatsapp) {
      try {
        const sent = await this.whatsapp.sendText({
          to: waId,
          body: result.outboundText,
        });

        if (sent.messageId && result.outboundMessageId) {
          try {
            await this.db.message.update({
              where: { id: result.outboundMessageId },
              data: {
                externalMessageId: sent.messageId,
                metadata: {
                  channel: 'whatsapp',
                  outboundProvider: 'meta',
                },
              },
            });
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                'code' in error &&
                (error as { code?: string }).code === 'P2002'
              )
            ) {
              throw error;
            }
          }
        }
      } catch (error) {
        if (error instanceof WhatsAppClientError && !error.retryable) {
          throw new PermanentWebhookError(error.message, error.code);
        }
        throw new TransientWebhookError(
          error instanceof Error ? error.message : 'WhatsApp delivery failed',
          error instanceof WhatsAppClientError ? error.code : 'WHATSAPP_DELIVERY_FAILED',
        );
      }
    }
  }

  private async processUnsupportedMessage(event: Record<string, unknown>): Promise<void> {
    const waId = String(event.waId ?? '');
    const externalMessageId = String(event.externalMessageId ?? '');
    const messageType = String(event.messageType ?? 'unknown');
    const profileName = typeof event.profileName === 'string' ? event.profileName : null;

    if (!waId || !externalMessageId) {
      throw new PermanentWebhookError('Unsupported message payload missing required fields');
    }

    // Persist an inbound marker through the orchestrator path only for text.
    // For media, reply with a clear limitation and record operational context via webhook event type.
    if (!this.whatsapp) {
      throw new PermanentWebhookError('WhatsApp client is not configured', 'WHATSAPP_DISABLED');
    }

    try {
      const sent = await this.whatsapp.sendText({
        to: waId,
        body: UNSUPPORTED_MEDIA_REPLY,
      });

      const customer = await this.db.customer.upsert({
        where: { whatsappNumber: waId },
        create: {
          whatsappNumber: waId,
          name: profileName,
        },
        update: {
          ...(profileName ? { name: profileName } : {}),
        },
      });

      let conversation = await this.db.conversation.findFirst({
        where: { customerId: customer.id, status: { not: 'CLOSED' } },
        orderBy: { lastActivityAt: 'desc' },
      });

      if (!conversation) {
        conversation = await this.db.conversation.create({
          data: {
            customerId: customer.id,
            status: 'IDLE',
            structuredState: {},
          },
        });
      }

      await this.db.message.create({
        data: {
          conversationId: conversation.id,
          externalMessageId,
          direction: 'INBOUND',
          messageType: 'UNSUPPORTED',
          content: `[unsupported:${messageType}]`,
          metadata: {
            channel: 'whatsapp',
            messageType,
          },
        },
      });

      await this.db.message.create({
        data: {
          conversationId: conversation.id,
          externalMessageId: sent.messageId,
          direction: 'OUTBOUND',
          messageType: 'TEXT',
          content: UNSUPPORTED_MEDIA_REPLY,
          metadata: {
            channel: 'whatsapp',
            reason: 'unsupported_inbound_type',
            inboundType: messageType,
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        // Duplicate inbound media event already handled.
        return;
      }
      if (error instanceof WhatsAppClientError && !error.retryable) {
        throw new PermanentWebhookError(error.message, error.code);
      }
      throw new TransientWebhookError(
        error instanceof Error ? error.message : 'Unsupported message handling failed',
        error instanceof WhatsAppClientError ? error.code : 'UNSUPPORTED_HANDLING_FAILED',
      );
    }
  }

  private async recordFailure(
    eventId: string,
    attemptCount: number,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const permanent =
      error instanceof PermanentWebhookError ||
      (error instanceof WhatsAppClientError && !error.retryable);

    const code =
      error instanceof PermanentWebhookError || error instanceof TransientWebhookError
        ? error.code
        : error instanceof WhatsAppClientError
          ? error.code
          : 'WEBHOOK_PROCESSING_ERROR';
    const message = error instanceof Error ? error.message : 'Webhook processing failed';

    if (permanent || attemptCount >= this.maxAttempts) {
      await this.db.webhookEvent.update({
        where: { id: eventId },
        data: {
          status: 'DEAD_LETTER',
          failureCode: code,
          failureMessage: message,
          nextAttemptAt: null,
        },
      });
      return;
    }

    await this.db.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        failureCode: code,
        failureMessage: message,
        nextAttemptAt: new Date(
          now.getTime() + computeBackoffMs(attemptCount, this.baseBackoffMs, this.maxBackoffMs),
        ),
      },
    });
  }
}
