import { Prisma } from '../generated/prisma/client.js';

import { DomainConflictError } from '../domain/errors.js';
import type {
  CreateBookingInput,
  CreateConversationInput,
  CreateCustomerInput,
  CreateHandoffInput,
  CreateMessageInput,
  CreatePendingActionInput,
  CreateToolExecutionInput,
  CreateWebhookEventInput,
  Database,
} from './types.js';

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class CustomerRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateCustomerInput) {
    return this.db.customer.create({
      data: {
        whatsappNumber: input.whatsappNumber ?? null,
        name: input.name ?? null,
        preferredLanguage: input.preferredLanguage ?? null,
        defaultAddress: input.defaultAddress ?? null,
      },
    });
  }

  findByWhatsappNumber(whatsappNumber: string) {
    return this.db.customer.findUnique({
      where: { whatsappNumber },
    });
  }
}

export class ServiceRepository {
  constructor(private readonly db: Database) {}

  findActive() {
    return this.db.service.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  findBySlug(slug: string) {
    return this.db.service.findUnique({
      where: { slug },
    });
  }
}

export class AvailabilitySlotRepository {
  constructor(private readonly db: Database) {}

  findFutureAvailable(now = new Date()) {
    return this.db.availabilitySlot.findMany({
      where: {
        status: 'AVAILABLE',
        startsAt: { gt: now },
      },
      orderBy: { startsAt: 'asc' },
      include: { service: true },
    });
  }

  countFuture(now = new Date()) {
    return this.db.availabilitySlot.count({
      where: {
        startsAt: { gt: now },
      },
    });
  }
}

export class BookingRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateBookingInput) {
    try {
      return await this.db.booking.create({
        data: {
          reference: input.reference,
          customerId: input.customerId,
          serviceId: input.serviceId,
          availabilitySlotId: input.availabilitySlotId,
          quantity: input.quantity,
          address: input.address,
          estimatedPriceMinor: input.estimatedPriceMinor,
          status: input.status,
          confirmedAt: input.confirmedAt ?? null,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainConflictError(`Booking reference already exists: ${input.reference}`);
      }
      throw error;
    }
  }

  findByReference(reference: string) {
    return this.db.booking.findUnique({
      where: { reference },
      include: {
        customer: true,
        service: true,
        availabilitySlot: true,
      },
    });
  }
}

export class ConversationRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateConversationInput) {
    return this.db.conversation.create({
      data: {
        customerId: input.customerId,
        status: input.status ?? 'IDLE',
        currentIntent: input.currentIntent ?? null,
        detectedLanguage: input.detectedLanguage ?? null,
        structuredState: input.structuredState ?? {},
        compactSummary: input.compactSummary ?? null,
        activeBookingId: input.activeBookingId ?? null,
      },
    });
  }

  findById(id: string) {
    return this.db.conversation.findUnique({
      where: { id },
      include: {
        customer: true,
        activeBooking: true,
      },
    });
  }
}

export class MessageRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateMessageInput) {
    try {
      return await this.db.message.create({
        data: {
          conversationId: input.conversationId,
          externalMessageId: input.externalMessageId ?? null,
          direction: input.direction,
          messageType: input.messageType ?? 'TEXT',
          content: input.content,
          ...(input.metadata === undefined || input.metadata === null
            ? {}
            : { metadata: input.metadata }),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainConflictError(
          `External message ID already exists: ${input.externalMessageId ?? ''}`,
        );
      }
      throw error;
    }
  }
}

export class PendingActionRepository {
  constructor(private readonly db: Database) {}

  create(input: CreatePendingActionInput) {
    return this.db.pendingAction.create({
      data: {
        conversationId: input.conversationId,
        actionType: input.actionType,
        payload: input.payload,
        status: input.status ?? 'PENDING',
        expiresAt: input.expiresAt,
        proposalMessageId: input.proposalMessageId ?? null,
      },
    });
  }

  /**
   * Commits a pending action only when status and version still match.
   * Protects against double execution of high-impact writes.
   */
  async commitIfCurrent(input: {
    pendingActionId: string;
    expectedVersion: number;
    confirmationMessageId: string;
    apply: (tx: Database) => Promise<void>;
  }) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.pendingAction.updateMany({
        where: {
          id: input.pendingActionId,
          status: 'PENDING',
          version: input.expectedVersion,
        },
        data: {
          status: 'COMMITTED',
          confirmationMessageId: input.confirmationMessageId,
          version: { increment: 1 },
        },
      });

      if (updated.count !== 1) {
        throw new DomainConflictError('Pending action could not be committed');
      }

      await input.apply(tx as unknown as Database);
    });
  }
}

export class ToolExecutionRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateToolExecutionInput) {
    return this.db.toolExecution.create({
      data: {
        conversationId: input.conversationId,
        toolName: input.toolName,
        validatedInput: input.validatedInput,
        status: input.status,
        durationMs: input.durationMs,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        ...(input.output === undefined || input.output === null ? {} : { output: input.output }),
      },
    });
  }
}

export class HumanHandoffRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateHandoffInput) {
    try {
      return await this.db.humanHandoff.create({
        data: {
          reference: input.reference,
          conversationId: input.conversationId,
          bookingId: input.bookingId ?? null,
          reason: input.reason,
          summary: input.summary,
          priority: input.priority ?? 'NORMAL',
          status: input.status ?? 'OPEN',
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainConflictError(`Handoff reference already exists: ${input.reference}`);
      }
      throw error;
    }
  }
}

export class WebhookEventRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateWebhookEventInput) {
    try {
      return await this.db.webhookEvent.create({
        data: {
          externalKey: input.externalKey,
          eventType: input.eventType,
          payload: input.payload,
          status: input.status ?? 'RECEIVED',
          attemptCount: input.attemptCount ?? 0,
          nextAttemptAt: input.nextAttemptAt ?? null,
          failureCode: input.failureCode ?? null,
          failureMessage: input.failureMessage ?? null,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainConflictError(`Webhook event key already exists: ${input.externalKey}`);
      }
      throw error;
    }
  }
}

export function createRepositories(db: Database) {
  return {
    customers: new CustomerRepository(db),
    services: new ServiceRepository(db),
    availabilitySlots: new AvailabilitySlotRepository(db),
    bookings: new BookingRepository(db),
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    pendingActions: new PendingActionRepository(db),
    toolExecutions: new ToolExecutionRepository(db),
    humanHandoffs: new HumanHandoffRepository(db),
    webhookEvents: new WebhookEventRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
