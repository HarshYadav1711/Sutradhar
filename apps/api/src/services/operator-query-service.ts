import type { PrismaClient } from '../db/client.js';
import type {
  OperatorBookingDetail,
  OperatorBookingListResponse,
  OperatorConversationDetail,
  OperatorConversationListResponse,
  OperatorConversationTrace,
  OperatorHandoffDetail,
  OperatorHandoffListResponse,
  OperatorHandoffUpdateRequest,
  OperatorOverview,
} from '@sutradhar/contracts';

function toIso(date: Date): string {
  return date.toISOString();
}

function proposalSummaryFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>).proposalSummary;
  return typeof value === 'string' ? value : null;
}

function structuredStateRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export class OperatorQueryService {
  constructor(private readonly db: PrismaClient) {}

  async getOverview(now = new Date()): Promise<OperatorOverview> {
    const [
      activeConversations,
      confirmedBookings,
      pendingActions,
      openHandoffs,
      failedWebhookEvents,
    ] = await Promise.all([
      this.db.conversation.count({
        where: { status: { not: 'CLOSED' } },
      }),
      this.db.booking.count({
        where: { status: { in: ['CONFIRMED', 'RESCHEDULED'] } },
      }),
      this.db.pendingAction.count({
        where: {
          status: 'PENDING',
          expiresAt: { gt: now },
        },
      }),
      this.db.humanHandoff.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.db.webhookEvent.count({
        where: { status: { in: ['FAILED', 'DEAD_LETTER'] } },
      }),
    ]);

    return {
      activeConversations,
      confirmedBookings,
      pendingActions,
      openHandoffs,
      failedWebhookEvents,
      generatedAt: now.toISOString(),
    };
  }

  async listConversations(input: {
    page: number;
    pageSize: number;
    status?: string;
  }): Promise<OperatorConversationListResponse> {
    const where = input.status ? { status: input.status as never } : {};
    const total = await this.db.conversation.count({ where });
    const rows = await this.db.conversation.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        customer: true,
        pendingActions: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        currentIntent: row.currentIntent,
        detectedLanguage: row.detectedLanguage,
        lastActivityAt: toIso(row.lastActivityAt),
        createdAt: toIso(row.createdAt),
        customer: {
          id: row.customer.id,
          whatsappNumber: row.customer.whatsappNumber,
          name: row.customer.name,
        },
        activeBookingId: row.activeBookingId,
        pendingActionId: row.pendingActions[0]?.id ?? null,
      })),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    };
  }

  async getConversation(conversationId: string): Promise<OperatorConversationDetail | null> {
    const row = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
        activeBooking: {
          include: {
            service: true,
            availabilitySlot: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 200,
        },
        pendingActions: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!row) {
      return null;
    }

    const pending = row.pendingActions[0];

    return {
      id: row.id,
      status: row.status,
      currentIntent: row.currentIntent,
      detectedLanguage: row.detectedLanguage,
      compactSummary: row.compactSummary,
      structuredState: structuredStateRecord(row.structuredState),
      lastActivityAt: toIso(row.lastActivityAt),
      createdAt: toIso(row.createdAt),
      customer: {
        id: row.customer.id,
        whatsappNumber: row.customer.whatsappNumber,
        name: row.customer.name,
      },
      activeBooking: row.activeBooking
        ? {
            id: row.activeBooking.id,
            reference: row.activeBooking.reference,
            status: row.activeBooking.status,
            serviceName: row.activeBooking.service.name,
            startsAt: toIso(row.activeBooking.availabilitySlot.startsAt),
            quantity: row.activeBooking.quantity,
            address: row.activeBooking.address,
            estimatedPriceMinor: row.activeBooking.estimatedPriceMinor,
          }
        : null,
      pendingAction: pending
        ? {
            id: pending.id,
            actionType: pending.actionType,
            status: pending.status,
            expiresAt: toIso(pending.expiresAt),
            proposalSummary: proposalSummaryFromPayload(pending.payload),
            createdAt: toIso(pending.createdAt),
          }
        : null,
      messages: row.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        messageType: message.messageType,
        content: message.content,
        createdAt: toIso(message.createdAt),
        externalMessageId: message.externalMessageId,
      })),
    };
  }

  async getConversationTrace(conversationId: string): Promise<OperatorConversationTrace | null> {
    const conversation = await this.db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conversation) {
      return null;
    }

    const [operationalEvents, toolExecutions] = await Promise.all([
      this.db.operationalEvent.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: {
          id: true,
          eventType: true,
          detail: true,
          createdAt: true,
        },
      }),
      this.db.toolExecution.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: {
          id: true,
          toolName: true,
          status: true,
          durationMs: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      conversationId,
      operationalEvents: operationalEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        detail: event.detail,
        createdAt: toIso(event.createdAt),
      })),
      toolExecutions: toolExecutions.map((execution) => ({
        id: execution.id,
        toolName: execution.toolName,
        status: execution.status,
        durationMs: execution.durationMs,
        errorCode: execution.errorCode,
        errorMessage: execution.errorMessage,
        createdAt: toIso(execution.createdAt),
      })),
    };
  }

  async listBookings(input: {
    page: number;
    pageSize: number;
    status?: string;
  }): Promise<OperatorBookingListResponse> {
    const where = input.status ? { status: input.status as never } : {};
    const total = await this.db.booking.count({ where });
    const rows = await this.db.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        customer: true,
        service: true,
        availabilitySlot: true,
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        customer: {
          id: row.customer.id,
          whatsappNumber: row.customer.whatsappNumber,
          name: row.customer.name,
        },
        serviceName: row.service.name,
        startsAt: toIso(row.availabilitySlot.startsAt),
        quantity: row.quantity,
        address: row.address,
        estimatedPriceMinor: row.estimatedPriceMinor,
        confirmedAt: row.confirmedAt ? toIso(row.confirmedAt) : null,
        createdAt: toIso(row.createdAt),
      })),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    };
  }

  async getBooking(bookingId: string): Promise<OperatorBookingDetail | null> {
    const row = await this.db.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        service: true,
        availabilitySlot: true,
      },
    });
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      customer: {
        id: row.customer.id,
        whatsappNumber: row.customer.whatsappNumber,
        name: row.customer.name,
      },
      serviceName: row.service.name,
      serviceId: row.serviceId,
      availabilitySlotId: row.availabilitySlotId,
      startsAt: toIso(row.availabilitySlot.startsAt),
      endsAt: toIso(row.availabilitySlot.endsAt),
      timezone: row.availabilitySlot.timezone,
      quantity: row.quantity,
      address: row.address,
      estimatedPriceMinor: row.estimatedPriceMinor,
      confirmedAt: row.confirmedAt ? toIso(row.confirmedAt) : null,
      createdAt: toIso(row.createdAt),
    };
  }

  async listHandoffs(input: {
    page: number;
    pageSize: number;
    status?: string;
  }): Promise<OperatorHandoffListResponse> {
    const where = input.status ? { status: input.status as never } : {};
    const total = await this.db.humanHandoff.count({ where });
    const rows = await this.db.humanHandoff.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        conversation: {
          include: { customer: true },
        },
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        priority: row.priority,
        reason: row.reason,
        summary: row.summary,
        conversationId: row.conversationId,
        bookingId: row.bookingId,
        customer: {
          id: row.conversation.customer.id,
          whatsappNumber: row.conversation.customer.whatsappNumber,
          name: row.conversation.customer.name,
        },
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
    };
  }

  async getHandoff(handoffId: string): Promise<OperatorHandoffDetail | null> {
    const row = await this.db.humanHandoff.findUnique({
      where: { id: handoffId },
      include: {
        conversation: {
          include: { customer: true },
        },
      },
    });
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      priority: row.priority,
      reason: row.reason,
      summary: row.summary,
      conversationId: row.conversationId,
      bookingId: row.bookingId,
      customer: {
        id: row.conversation.customer.id,
        whatsappNumber: row.conversation.customer.whatsappNumber,
        name: row.conversation.customer.name,
      },
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  async updateHandoff(
    handoffId: string,
    patch: OperatorHandoffUpdateRequest,
  ): Promise<OperatorHandoffDetail | null> {
    const existing = await this.db.humanHandoff.findUnique({
      where: { id: handoffId },
      select: { id: true },
    });
    if (!existing) {
      return null;
    }

    await this.db.humanHandoff.update({
      where: { id: handoffId },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.priority ? { priority: patch.priority } : {}),
      },
    });

    return this.getHandoff(handoffId);
  }
}
