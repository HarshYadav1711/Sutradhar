import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import { type ConfirmationPolicy, confirmationPolicy } from '../domain/confirmation-policy.js';
import { type HandoffPolicy, handoffPolicy } from '../domain/handoff-policy.js';
import {
  evaluatePendingActionGate,
  explicitConfirmationPrompt,
  pendingCancelledPrompt,
  pendingExpiredPrompt,
} from '../domain/pending-action-gate.js';
import { PendingActionExecutor } from '../domain/pending-action-executor.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolExecutionContext } from '../tools/types.js';
import { ContextBuilder } from './context-builder.js';
import {
  assertKnownConversationStatus,
  canTransitionConversationStatus,
  transitionConversationStatus,
  type ConversationStatusName,
  type ConversationTransitionEvent,
} from './conversation-state.js';
import type { ModelMessage, ModelProvider, ModelToolCall } from './model/types.js';
import type { OperationalEventType } from './operational-events.js';
import {
  bookingCommittedMessage,
  controlledFailureMessage,
  detectLanguageStyle,
  rescheduleCommittedMessage,
  sanitizeCustomerResponse,
} from './response-policy.js';
import {
  appendCompactSummary,
  mergeStructuredState,
  readStructuredState,
} from './summary.js';

export const MAX_AGENT_STEPS = 5;
export const MAX_CONSECUTIVE_TOOL_FAILURES = 2;

export type InboundMessageInput = {
  /** Customer WhatsApp number or simulator identity. */
  customerKey: string;
  text: string;
  externalMessageId?: string | null;
  customerName?: string | null;
  channel?: 'whatsapp' | 'simulator' | 'test';
  now?: Date;
  requestId?: string;
};

export type AgentProcessingOutcome =
  | 'CUSTOMER_RESPONSE'
  | 'HUMAN_HANDOFF'
  | 'CONTROLLED_FAILURE'
  | 'DUPLICATE_IGNORED';

export type AgentProcessingResult = {
  outcome: AgentProcessingOutcome;
  conversationId: string;
  customerId: string;
  inboundMessageId: string;
  outboundMessageId: string | null;
  outboundText: string | null;
  conversationStatus: ConversationStatusName;
  bookingId: string | null;
  bookingReference: string | null;
  handoffId: string | null;
  handoffReference: string | null;
  pendingActionId: string | null;
  stepsUsed: number;
  operationalEvents: Array<{ eventType: OperationalEventType; detail: string | null }>;
  duplicated: boolean;
};

export type AgentOrchestratorOptions = {
  timeZone?: string;
  currency?: string;
  maxSteps?: number;
  confirmation?: ConfirmationPolicy;
  handoff?: HandoffPolicy;
  pendingExecutor?: PendingActionExecutor;
  contextBuilder?: ContextBuilder;
};

type LoopToolFailure = {
  toolName: string;
  count: number;
};

/**
 * Single bounded orchestrating agent for inbound customer messages.
 */
export class AgentOrchestrator {
  private readonly timeZone: string;
  private readonly currency: string;
  private readonly maxSteps: number;
  private readonly confirmation: ConfirmationPolicy;
  private readonly handoff: HandoffPolicy;
  private readonly pendingExecutor: PendingActionExecutor;
  private readonly contextBuilder: ContextBuilder;

  constructor(
    private readonly db: PrismaClient,
    private readonly model: ModelProvider,
    private readonly tools: ToolRegistry,
    options: AgentOrchestratorOptions = {},
  ) {
    this.timeZone = options.timeZone ?? 'Asia/Kolkata';
    this.currency = options.currency ?? 'INR';
    this.maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
    this.confirmation = options.confirmation ?? confirmationPolicy;
    this.handoff = options.handoff ?? handoffPolicy;
    this.pendingExecutor =
      options.pendingExecutor ?? new PendingActionExecutor(db, { timeZone: this.timeZone });
    this.contextBuilder = options.contextBuilder ?? new ContextBuilder(db, tools);
  }

  async processMessage(input: InboundMessageInput): Promise<AgentProcessingResult> {
    const now = input.now ?? new Date();
    const languageStyle = detectLanguageStyle(input.text);
    const recordedEvents: AgentProcessingResult['operationalEvents'] = [];

    const customer = await this.loadOrCreateCustomer(input);
    const conversation = await this.loadOrCreateConversation(customer.id, now);

    if (input.externalMessageId) {
      const existing = await this.db.message.findUnique({
        where: { externalMessageId: input.externalMessageId },
      });
      if (existing) {
        await this.recordEvent(conversation.id, 'DUPLICATE_INBOUND_IGNORED', 'Duplicate external message id', {
          externalMessageId: input.externalMessageId,
        });
        recordedEvents.push({
          eventType: 'DUPLICATE_INBOUND_IGNORED',
          detail: 'Duplicate external message id',
        });

        const latestOutbound = await this.db.message.findFirst({
          where: {
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            createdAt: { gte: existing.createdAt },
          },
          orderBy: { createdAt: 'asc' },
        });

        const current = await this.db.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        });

        return {
          outcome: 'DUPLICATE_IGNORED',
          conversationId: conversation.id,
          customerId: customer.id,
          inboundMessageId: existing.id,
          outboundMessageId: latestOutbound?.id ?? null,
          outboundText: latestOutbound?.content ?? null,
          conversationStatus: assertKnownConversationStatus(current.status),
          bookingId: current.activeBookingId,
          bookingReference: null,
          handoffId: null,
          handoffReference: null,
          pendingActionId: null,
          stepsUsed: 0,
          operationalEvents: recordedEvents,
          duplicated: true,
        };
      }
    }

    const inbound = await this.db.message.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: input.externalMessageId ?? null,
        direction: 'INBOUND',
        messageType: 'TEXT',
        content: input.text,
        metadata: {
          channel: input.channel ?? 'test',
          ...(input.requestId ? { requestId: input.requestId } : {}),
        },
      },
    });

    await this.db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastActivityAt: now,
        detectedLanguage: languageStyle === 'hinglish' ? 'hinglish' : 'en',
      },
    });

    const escalationSignal = this.handoff.detect(input.text);
    if (escalationSignal?.kind === 'complaint') {
      await this.pushEvent(
        recordedEvents,
        conversation.id,
        'COMPLAINT_SIGNAL_DETECTED',
        escalationSignal.reason,
      );
    }
    if (escalationSignal?.kind === 'refund') {
      await this.pushEvent(
        recordedEvents,
        conversation.id,
        'REFUND_SIGNAL_DETECTED',
        escalationSignal.reason,
      );
    }
    if (escalationSignal?.kind === 'unsupported_service') {
      await this.pushEvent(
        recordedEvents,
        conversation.id,
        'UNSUPPORTED_SERVICE_SIGNAL',
        escalationSignal.reason,
      );
    }

    const pendingGate = await this.handlePendingActionGate({
      conversationId: conversation.id,
      customerId: customer.id,
      inboundMessageId: inbound.id,
      messageText: input.text,
      languageStyle,
      now,
      recordedEvents,
    });

    if (pendingGate) {
      return pendingGate;
    }

    return this.runAgentLoop({
      conversationId: conversation.id,
      customerId: customer.id,
      inboundMessageId: inbound.id,
      inboundText: input.text,
      languageStyle,
      now,
      recordedEvents,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
  }

  private async handlePendingActionGate(input: {
    conversationId: string;
    customerId: string;
    inboundMessageId: string;
    messageText: string;
    languageStyle: 'en' | 'hinglish';
    now: Date;
    recordedEvents: AgentProcessingResult['operationalEvents'];
  }): Promise<AgentProcessingResult | null> {
    const pending = await this.db.pendingAction.findFirst({
      where: {
        conversationId: input.conversationId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending) {
      return null;
    }

    const expired = pending.expiresAt.getTime() <= input.now.getTime();
    const confirmationDecision = this.confirmation.evaluate(input.messageText);
    const gate = evaluatePendingActionGate({
      confirmationDecision,
      message: input.messageText,
      expired,
    });

    if (gate === 'EXPIRED') {
      await this.db.pendingAction.updateMany({
        where: { id: pending.id, status: 'PENDING' },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      await this.applyConversationEvent(input.conversationId, 'PENDING_SUPERSEDED', input.now);
      await this.pushEvent(
        input.recordedEvents,
        input.conversationId,
        'PENDING_ACTION_EXPIRED',
        pending.id,
      );
      const outboundText = pendingExpiredPrompt(input.languageStyle);
      return this.finalizeDirectResponse({
        ...input,
        outboundText,
        outcome: 'CUSTOMER_RESPONSE',
        pendingActionId: pending.id,
        stepsUsed: 0,
      });
    }

    if (gate === 'COMMIT') {
      const committed = await this.pendingExecutor.commit({
        pendingActionId: pending.id,
        confirmationMessageId: input.inboundMessageId,
        now: input.now,
      });

      const event: ConversationTransitionEvent =
        committed.type === 'CREATE_BOOKING' ? 'BOOKING_CONFIRMED' : 'RESCHEDULE_CONFIRMED';
      await this.applyConversationEvent(input.conversationId, event, input.now);

      const outboundText =
        committed.type === 'CREATE_BOOKING'
          ? bookingCommittedMessage({
              reference: committed.booking.reference,
              languageStyle: input.languageStyle,
            })
          : rescheduleCommittedMessage({
              reference: committed.booking.reference,
              languageStyle: input.languageStyle,
            });

      await this.pushEvent(
        input.recordedEvents,
        input.conversationId,
        committed.type === 'CREATE_BOOKING' ? 'BOOKING_COMMITTED' : 'RESCHEDULE_COMMITTED',
        committed.booking.reference,
        { bookingId: committed.booking.id },
      );

      await this.updateSummary(
        input.conversationId,
        committed.type === 'CREATE_BOOKING'
          ? `Booking confirmed ${committed.booking.reference}`
          : `Reschedule confirmed ${committed.booking.reference}`,
      );

      return this.finalizeDirectResponse({
        ...input,
        outboundText,
        outcome: 'CUSTOMER_RESPONSE',
        bookingId: committed.booking.id,
        bookingReference: committed.booking.reference,
        pendingActionId: pending.id,
        stepsUsed: 0,
      });
    }

    if (gate === 'CANCEL') {
      await this.pendingExecutor.cancel(pending.id);
      const rejectEvent: ConversationTransitionEvent =
        pending.actionType === 'RESCHEDULE_BOOKING' ? 'RESCHEDULE_REJECTED' : 'BOOKING_REJECTED';
      await this.applyConversationEvent(input.conversationId, rejectEvent, input.now);
      await this.pushEvent(
        input.recordedEvents,
        input.conversationId,
        'BOOKING_REJECTED',
        pending.id,
      );
      await this.updateSummary(input.conversationId, 'Customer rejected pending proposal');

      return this.finalizeDirectResponse({
        ...input,
        outboundText: pendingCancelledPrompt(input.languageStyle),
        outcome: 'CUSTOMER_RESPONSE',
        pendingActionId: pending.id,
        stepsUsed: 0,
      });
    }

    if (gate === 'ASK_EXPLICIT_CONFIRMATION') {
      await this.pushEvent(
        input.recordedEvents,
        input.conversationId,
        'CONFIRMATION_REQUESTED',
        'Ambiguous reply while pending action is open',
      );
      return this.finalizeDirectResponse({
        ...input,
        outboundText: explicitConfirmationPrompt(input.languageStyle),
        outcome: 'CUSTOMER_RESPONSE',
        pendingActionId: pending.id,
        stepsUsed: 0,
      });
    }

    // SUPERSEDE: cancel safely, then continue into the model loop.
    await this.pendingExecutor.cancel(pending.id);
    await this.applyConversationEvent(input.conversationId, 'PENDING_SUPERSEDED', input.now);
    await this.pushEvent(
      input.recordedEvents,
      input.conversationId,
      'PENDING_ACTION_SUPERSEDED',
      pending.id,
    );
    await this.updateSummary(input.conversationId, 'Pending proposal superseded by a new request');
    return null;
  }

  private async runAgentLoop(input: {
    conversationId: string;
    customerId: string;
    inboundMessageId: string;
    inboundText: string;
    languageStyle: 'en' | 'hinglish';
    now: Date;
    requestId?: string;
    recordedEvents: AgentProcessingResult['operationalEvents'];
  }): Promise<AgentProcessingResult> {
    const toolContext: ToolExecutionContext = {
      db: this.db,
      conversationId: input.conversationId,
      customerId: input.customerId,
      now: input.now,
      timeZone: this.timeZone,
      currency: this.currency,
    };

    const built = await this.contextBuilder.build(input.conversationId, {
      timeZone: this.timeZone,
      currency: this.currency,
      now: input.now,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    const workingMessages: ModelMessage[] = [...built.recentMessages];
    let stepsUsed = 0;
    let consecutiveFailures: LoopToolFailure | null = null;
    let lastHandoff: { id: string; reference: string } | null = null;
    let lastPendingActionId: string | null = null;

    while (stepsUsed < this.maxSteps) {
      stepsUsed += 1;

      const modelResult = await this.model.complete({
        systemInstruction: built.systemInstruction,
        conversationState: built.conversationState,
        recentMessages: workingMessages,
        tools: built.tools,
        metadata: built.metadata,
      });

      if (!modelResult.ok) {
        await this.pushEvent(
          input.recordedEvents,
          input.conversationId,
          'MODEL_PROVIDER_FAILURE',
          modelResult.errorMessage,
          { errorCode: modelResult.errorCode },
        );
        const outboundText = controlledFailureMessage('provider_failure', input.languageStyle);
        await this.updateSummary(input.conversationId, 'Model provider failure');
        return this.finalizeDirectResponse({
          conversationId: input.conversationId,
          customerId: input.customerId,
          inboundMessageId: input.inboundMessageId,
          languageStyle: input.languageStyle,
          now: input.now,
          recordedEvents: input.recordedEvents,
          outboundText,
          outcome: 'CONTROLLED_FAILURE',
          pendingActionId: lastPendingActionId,
          stepsUsed,
        });
      }

      if (modelResult.toolCalls.length > 0) {
        workingMessages.push({
          role: 'assistant',
          content: modelResult.text?.trim() ? modelResult.text : '',
        });

        for (const toolCall of modelResult.toolCalls) {
          const executed = await this.executeValidatedToolCall(toolCall, toolContext, input);
          workingMessages.push({
            role: 'tool',
            content: JSON.stringify(executed.payload),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          });

          if (!executed.ok) {
            if (
              consecutiveFailures &&
              consecutiveFailures.toolName === toolCall.name
            ) {
              consecutiveFailures.count += 1;
            } else {
              consecutiveFailures = { toolName: toolCall.name, count: 1 };
            }

            if (executed.malformed) {
              await this.pushEvent(
                input.recordedEvents,
                input.conversationId,
                'MALFORMED_TOOL_CALL',
                executed.errorMessage,
                { toolName: toolCall.name },
              );
            }

            if (consecutiveFailures.count >= MAX_CONSECUTIVE_TOOL_FAILURES) {
              await this.pushEvent(
                input.recordedEvents,
                input.conversationId,
                'REPEATED_TOOL_FAILURE',
                `${toolCall.name} failed ${consecutiveFailures.count} times`,
              );
              const outboundText = controlledFailureMessage(
                executed.malformed ? 'malformed_tool' : 'repeated_tool_failure',
                input.languageStyle,
              );
              await this.updateSummary(input.conversationId, 'Repeated tool failure');
              return this.finalizeDirectResponse({
                conversationId: input.conversationId,
                customerId: input.customerId,
                inboundMessageId: input.inboundMessageId,
                languageStyle: input.languageStyle,
                now: input.now,
                recordedEvents: input.recordedEvents,
                outboundText,
                outcome: 'CONTROLLED_FAILURE',
                pendingActionId: lastPendingActionId,
                stepsUsed,
              });
            }
          } else {
            consecutiveFailures = null;
            if (executed.pendingActionId) {
              lastPendingActionId = executed.pendingActionId;
            }
            if (executed.handoff) {
              lastHandoff = executed.handoff;
              this.handoff.assertSafeHandoffResult({
                refundOrCompensationApproved: false,
              });
            }
            if (executed.eventType) {
              await this.pushEvent(
                input.recordedEvents,
                input.conversationId,
                executed.eventType,
                executed.detail,
                executed.metadata,
              );
            }
          }
        }

        // Refresh structured conversation state snapshot for subsequent model turns.
        const refreshed = await this.contextBuilder.build(input.conversationId, {
          timeZone: this.timeZone,
          currency: this.currency,
          now: input.now,
          ...(input.requestId ? { requestId: input.requestId } : {}),
        });
        built.conversationState = refreshed.conversationState;
        continue;
      }

      const outboundText = sanitizeCustomerResponse(modelResult.text);
      const safeText =
        outboundText.trim() === ''
          ? controlledFailureMessage('provider_failure', input.languageStyle)
          : outboundText;

      if (lastHandoff) {
        let handoffText = safeText;
        if (!handoffText.includes(lastHandoff.reference)) {
          handoffText = `${handoffText}\nReference: ${lastHandoff.reference}`.trim();
        }
        await this.updateSummary(
          input.conversationId,
          `Human handoff created ${lastHandoff.reference}`,
        );
        return this.finalizeDirectResponse({
          conversationId: input.conversationId,
          customerId: input.customerId,
          inboundMessageId: input.inboundMessageId,
          languageStyle: input.languageStyle,
          now: input.now,
          recordedEvents: input.recordedEvents,
          outboundText: handoffText,
          outcome: 'HUMAN_HANDOFF',
          handoffId: lastHandoff.id,
          handoffReference: lastHandoff.reference,
          pendingActionId: lastPendingActionId,
          stepsUsed,
        });
      }

      await this.syncStructuredStateFromTools(input.conversationId, input.inboundText, input.now);
      await this.updateSummary(
        input.conversationId,
        `Agent replied (${assertKnownConversationStatus(
          (
            await this.db.conversation.findUniqueOrThrow({
              where: { id: input.conversationId },
            })
          ).status,
        )})`,
      );

      return this.finalizeDirectResponse({
        conversationId: input.conversationId,
        customerId: input.customerId,
        inboundMessageId: input.inboundMessageId,
        languageStyle: input.languageStyle,
        now: input.now,
        recordedEvents: input.recordedEvents,
        outboundText: safeText,
        outcome: 'CUSTOMER_RESPONSE',
        pendingActionId: lastPendingActionId,
        stepsUsed,
      });
    }

    await this.pushEvent(
      input.recordedEvents,
      input.conversationId,
      'MAX_AGENT_STEPS_REACHED',
      `Reached ${this.maxSteps} model decisions`,
    );
    await this.updateSummary(input.conversationId, 'Max agent steps reached');
    return this.finalizeDirectResponse({
      conversationId: input.conversationId,
      customerId: input.customerId,
      inboundMessageId: input.inboundMessageId,
      languageStyle: input.languageStyle,
      now: input.now,
      recordedEvents: input.recordedEvents,
      outboundText: controlledFailureMessage('max_steps', input.languageStyle),
      outcome: 'CONTROLLED_FAILURE',
      pendingActionId: lastPendingActionId,
      handoffId: lastHandoff?.id ?? null,
      handoffReference: lastHandoff?.reference ?? null,
      stepsUsed,
    });
  }

  private async executeValidatedToolCall(
    toolCall: ModelToolCall,
    toolContext: ToolExecutionContext,
    input: {
      conversationId: string;
      recordedEvents: AgentProcessingResult['operationalEvents'];
    },
  ): Promise<{
    ok: boolean;
    malformed: boolean;
    payload: unknown;
    errorMessage: string;
    pendingActionId?: string;
    handoff?: { id: string; reference: string };
    eventType?: OperationalEventType;
    detail?: string | null;
    metadata?: Record<string, unknown>;
  }> {
    if (!toolCall.name || typeof toolCall.name !== 'string') {
      return {
        ok: false,
        malformed: true,
        payload: { error: 'Missing tool name' },
        errorMessage: 'Missing tool name',
      };
    }

    if (!this.tools.has(toolCall.name)) {
      const result = await this.tools.execute(toolCall.name, toolCall.arguments ?? {}, toolContext);
      return {
        ok: false,
        malformed: true,
        payload: {
          ok: false,
          errorCode: result.ok ? 'UNEXPECTED' : result.errorCode,
          errorMessage: result.ok ? 'Unexpected success' : result.errorMessage,
        },
        errorMessage: result.ok ? 'Unknown tool' : result.errorMessage,
      };
    }

    if (
      toolCall.arguments === null ||
      typeof toolCall.arguments !== 'object' ||
      Array.isArray(toolCall.arguments)
    ) {
      return {
        ok: false,
        malformed: true,
        payload: { error: 'Tool arguments must be an object' },
        errorMessage: 'Tool arguments must be an object',
      };
    }

    const result = await this.tools.execute(toolCall.name, toolCall.arguments, toolContext);
    await this.pushEvent(
      input.recordedEvents,
      input.conversationId,
      'TOOL_EXECUTED',
      toolCall.name,
      {
        ok: result.ok,
        toolExecutionId: result.toolExecutionId,
        durationMs: result.durationMs,
      },
    );

    if (!result.ok) {
      return {
        ok: false,
        malformed: result.errorCode === 'VALIDATION_ERROR' || result.errorCode === 'TOOL_NOT_FOUND',
        payload: {
          ok: false,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          validationIssues: result.validationIssues ?? null,
        },
        errorMessage: result.errorMessage,
      };
    }

    const data = result.data as Record<string, unknown>;
    const mapped = this.mapToolSuccessEvent(toolCall.name, data);
    const pendingActionId =
      typeof data.pendingActionId === 'string' ? data.pendingActionId : undefined;
    const handoff =
      typeof data.handoffId === 'string' && typeof data.reference === 'string'
        ? { id: data.handoffId, reference: data.reference }
        : undefined;

    return {
      ok: true,
      malformed: false,
      payload: { ok: true, data },
      errorMessage: '',
      ...(pendingActionId ? { pendingActionId } : {}),
      ...(handoff ? { handoff } : {}),
      ...mapped,
    };
  }

  private mapToolSuccessEvent(
    toolName: string,
    data: Record<string, unknown>,
  ): {
    eventType?: OperationalEventType;
    detail?: string | null;
    metadata?: Record<string, unknown>;
  } {
    switch (toolName) {
      case 'search_services':
        return {
          eventType: 'SERVICE_CATALOGUE_SEARCHED',
          detail: `count=${String(data.count ?? '')}`,
        };
      case 'check_availability': {
        const matched = Array.isArray(data.matched) ? data.matched.length : 0;
        const alternatives = Array.isArray(data.alternatives) ? data.alternatives.length : 0;
        if (matched === 0) {
          return {
            eventType: 'NO_AVAILABILITY_ALTERNATIVES_OFFERED',
            detail: `alternatives=${alternatives}`,
          };
        }
        return {
          eventType: 'AVAILABILITY_CHECKED',
          detail: `matched=${matched}`,
        };
      }
      case 'prepare_booking':
        return {
          eventType: 'CONFIRMATION_REQUESTED',
          detail: typeof data.pendingActionId === 'string' ? data.pendingActionId : null,
        };
      case 'prepare_reschedule':
        return {
          eventType: 'RESCHEDULE_PROPOSAL_CREATED',
          detail: typeof data.pendingActionId === 'string' ? data.pendingActionId : null,
        };
      case 'create_handoff':
        return {
          eventType: 'HUMAN_HANDOFF_CREATED',
          detail: typeof data.reference === 'string' ? data.reference : null,
          metadata: {
            handoffId: data.handoffId,
            refundOrCompensationApproved: data.refundOrCompensationApproved === true,
          },
        };
      default:
        return {};
    }
  }

  private async syncStructuredStateFromTools(
    conversationId: string,
    inboundText: string,
    now: Date,
  ): Promise<void> {
    const conversation = await this.db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const existing = readStructuredState(conversation.structuredState);
    const status = assertKnownConversationStatus(conversation.status);

    let intent = conversation.currentIntent;
    if (/\b(book|repair|service|servicing|chahiye|ho sakta)\b/i.test(inboundText)) {
      intent = intent ?? 'booking';
      if (status === 'IDLE' && canTransitionConversationStatus(status, 'BOOKING_INTENT')) {
        await this.applyConversationEvent(conversationId, 'BOOKING_INTENT', now);
      }
    }

    await this.db.conversation.update({
      where: { id: conversationId },
      data: {
        currentIntent: intent,
        lastActivityAt: now,
        structuredState: mergeStructuredState(
          existing,
          intent ? { lastIntent: intent } : {},
        ) as Prisma.InputJsonValue,
      },
    });
  }

  private async applyConversationEvent(
    conversationId: string,
    event: ConversationTransitionEvent,
    now: Date,
  ): Promise<void> {
    const conversation = await this.db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const from = assertKnownConversationStatus(conversation.status);
    if (!canTransitionConversationStatus(from, event)) {
      // Tools may already have moved status (prepare_booking etc.). Skip if already aligned.
      return;
    }
    const next = transitionConversationStatus(from, event);
    await this.db.conversation.update({
      where: { id: conversationId },
      data: {
        status: next,
        lastActivityAt: now,
      },
    });
  }

  private async loadOrCreateCustomer(input: InboundMessageInput) {
    const existing = await this.db.customer.findUnique({
      where: { whatsappNumber: input.customerKey },
    });
    if (existing) {
      if (input.customerName && !existing.name) {
        return this.db.customer.update({
          where: { id: existing.id },
          data: { name: input.customerName },
        });
      }
      return existing;
    }

    return this.db.customer.create({
      data: {
        whatsappNumber: input.customerKey,
        name: input.customerName ?? null,
      },
    });
  }

  private async loadOrCreateConversation(customerId: string, now: Date) {
    const active = await this.db.conversation.findFirst({
      where: {
        customerId,
        status: { not: 'CLOSED' },
      },
      orderBy: { lastActivityAt: 'desc' },
    });

    if (active) {
      return active;
    }

    return this.db.conversation.create({
      data: {
        customerId,
        status: 'IDLE',
        structuredState: {},
        lastActivityAt: now,
      },
    });
  }

  private async finalizeDirectResponse(input: {
    conversationId: string;
    customerId: string;
    inboundMessageId: string;
    languageStyle: 'en' | 'hinglish';
    now: Date;
    recordedEvents: AgentProcessingResult['operationalEvents'];
    outboundText: string;
    outcome: AgentProcessingOutcome;
    bookingId?: string | null;
    bookingReference?: string | null;
    handoffId?: string | null;
    handoffReference?: string | null;
    pendingActionId?: string | null;
    stepsUsed: number;
  }): Promise<AgentProcessingResult> {
    const text = sanitizeCustomerResponse(input.outboundText);
    const outbound = await this.db.message.create({
      data: {
        conversationId: input.conversationId,
        direction: 'OUTBOUND',
        messageType: 'TEXT',
        content: text,
        metadata: {
          outcome: input.outcome,
        },
      },
    });

    await this.db.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastActivityAt: input.now,
        detectedLanguage: input.languageStyle === 'hinglish' ? 'hinglish' : 'en',
      },
    });

    const conversation = await this.db.conversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      include: { activeBooking: true },
    });

    const pending = await this.db.pendingAction.findFirst({
      where: { conversationId: input.conversationId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    return {
      outcome: input.outcome,
      conversationId: input.conversationId,
      customerId: input.customerId,
      inboundMessageId: input.inboundMessageId,
      outboundMessageId: outbound.id,
      outboundText: text,
      conversationStatus: assertKnownConversationStatus(conversation.status),
      bookingId: input.bookingId ?? conversation.activeBookingId,
      bookingReference: input.bookingReference ?? conversation.activeBooking?.reference ?? null,
      handoffId: input.handoffId ?? null,
      handoffReference: input.handoffReference ?? null,
      pendingActionId: input.pendingActionId ?? pending?.id ?? null,
      stepsUsed: input.stepsUsed,
      operationalEvents: input.recordedEvents,
      duplicated: false,
    };
  }

  private async updateSummary(conversationId: string, line: string): Promise<void> {
    const conversation = await this.db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const compactSummary = appendCompactSummary(conversation.compactSummary, line);
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { compactSummary },
    });
  }

  private async pushEvent(
    sink: AgentProcessingResult['operationalEvents'],
    conversationId: string,
    eventType: OperationalEventType,
    detail?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.recordEvent(conversationId, eventType, detail, metadata);
    sink.push({ eventType, detail: detail ?? null });
  }

  private async recordEvent(
    conversationId: string,
    eventType: OperationalEventType,
    detail?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.operationalEvent.create({
      data: {
        conversationId,
        eventType,
        detail: detail ?? null,
        ...(metadata
          ? { metadata: metadata as Prisma.InputJsonValue }
          : {}),
      },
    });
  }
}
