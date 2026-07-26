import type { PrismaClient } from '../db/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import { AGENT_SYSTEM_INSTRUCTION } from './system-instruction.js';
import { toolToModelDefinition } from './model/tool-schema.js';
import type { ModelMessage, ModelRequest, ModelToolDefinition } from './model/types.js';

export const DEFAULT_RECENT_MESSAGE_LIMIT = 12;

export type ContextBuilderOptions = {
  recentMessageLimit?: number;
  timeZone?: string;
  now?: Date;
  currency?: string;
  requestId?: string;
};

export type BuiltAgentContext = ModelRequest & {
  compactSummary: string | null;
  currentDate: string;
  timeZone: string;
};

function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dedupeConsecutiveMessages(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    const previous = result[result.length - 1];
    if (
      previous &&
      previous.role === message.role &&
      previous.content === message.content &&
      previous.toolName === message.toolName
    ) {
      continue;
    }
    result.push(message);
  }
  return result;
}

/**
 * Builds a bounded model request context from persisted conversation state.
 */
export class ContextBuilder {
  constructor(
    private readonly db: PrismaClient,
    private readonly tools: ToolRegistry,
  ) {}

  async build(conversationId: string, options: ContextBuilderOptions = {}): Promise<BuiltAgentContext> {
    const recentMessageLimit = options.recentMessageLimit ?? DEFAULT_RECENT_MESSAGE_LIMIT;
    const timeZone = options.timeZone ?? process.env.BUSINESS_TIMEZONE ?? 'Asia/Kolkata';
    const now = options.now ?? new Date();
    const currency = options.currency ?? process.env.BUSINESS_CURRENCY ?? 'INR';

    const conversation = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
        activeBooking: {
          include: {
            service: true,
            availabilitySlot: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const pendingAction = await this.db.pendingAction.findFirst({
      where: {
        conversationId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    const recentRows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: recentMessageLimit,
      select: {
        id: true,
        direction: true,
        content: true,
        messageType: true,
        createdAt: true,
      },
    });

    const chronological = [...recentRows].reverse();
    const recentMessages = dedupeConsecutiveMessages(
      chronological.map((message) => ({
        role: message.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      })),
    );

    const toolDefinitions: ModelToolDefinition[] = this.tools
      .list()
      .map((tool) => toolToModelDefinition(tool));

    const structuredState =
      conversation.structuredState &&
      typeof conversation.structuredState === 'object' &&
      !Array.isArray(conversation.structuredState)
        ? (conversation.structuredState as Record<string, unknown>)
        : {};

    const conversationState: Record<string, unknown> = {
      conversationId: conversation.id,
      status: conversation.status,
      currentIntent: conversation.currentIntent,
      detectedLanguage: conversation.detectedLanguage,
      compactSummary: conversation.compactSummary,
      structuredState,
      currentDate: formatDateInTimeZone(now, timeZone),
      timeZone,
      currency,
      customer: {
        id: conversation.customer.id,
        name: conversation.customer.name,
        preferredLanguage: conversation.customer.preferredLanguage,
        defaultAddress: conversation.customer.defaultAddress,
        whatsappNumber: conversation.customer.whatsappNumber,
      },
    };

    if (conversation.activeBooking) {
      conversationState.activeBooking = {
        id: conversation.activeBooking.id,
        reference: conversation.activeBooking.reference,
        status: conversation.activeBooking.status,
        serviceId: conversation.activeBooking.serviceId,
        serviceName: conversation.activeBooking.service.name,
        availabilitySlotId: conversation.activeBooking.availabilitySlotId,
        startsAt: conversation.activeBooking.availabilitySlot.startsAt.toISOString(),
        quantity: conversation.activeBooking.quantity,
        address: conversation.activeBooking.address,
        estimatedPriceMinor: conversation.activeBooking.estimatedPriceMinor,
      };
    }

    if (pendingAction) {
      const payload =
        pendingAction.payload &&
        typeof pendingAction.payload === 'object' &&
        !Array.isArray(pendingAction.payload)
          ? (pendingAction.payload as Record<string, unknown>)
          : {};

      conversationState.pendingAction = {
        id: pendingAction.id,
        actionType: pendingAction.actionType,
        status: pendingAction.status,
        expiresAt: pendingAction.expiresAt.toISOString(),
        proposalSummary:
          typeof payload.proposalSummary === 'string' ? payload.proposalSummary : null,
        payload,
      };
    }

    return {
      systemInstruction: AGENT_SYSTEM_INSTRUCTION,
      conversationState,
      recentMessages,
      tools: toolDefinitions,
      metadata: {
        ...(options.requestId ? { requestId: options.requestId } : {}),
        conversationId: conversation.id,
        customerId: conversation.customerId,
      },
      compactSummary: conversation.compactSummary,
      currentDate: formatDateInTimeZone(now, timeZone),
      timeZone,
    };
  }
}
