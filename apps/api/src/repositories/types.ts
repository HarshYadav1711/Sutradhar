import type {
  BookingStatus,
  ConversationStatus,
  HandoffPriority,
  HandoffStatus,
  MessageDirection,
  MessageType,
  PendingActionStatus,
  PendingActionType,
  Prisma,
  SlotStatus,
  ToolExecutionStatus,
  WebhookProcessingStatus,
} from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';

export type Database = PrismaClient;

export type JsonValue = Prisma.InputJsonValue;

export type CreateCustomerInput = {
  whatsappNumber?: string | null;
  name?: string | null;
  preferredLanguage?: string | null;
  defaultAddress?: string | null;
};

export type CreateServiceInput = {
  name: string;
  slug: string;
  description: string;
  basePriceMinor: number;
  estimatedDurationMinutes: number;
  active?: boolean;
};

export type CreateAvailabilitySlotInput = {
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  status?: SlotStatus;
  staffDisplayName?: string | null;
};

export type CreateBookingInput = {
  reference: string;
  customerId: string;
  serviceId: string;
  availabilitySlotId: string;
  quantity: number;
  address: string;
  estimatedPriceMinor: number;
  status: BookingStatus;
  confirmedAt?: Date | null;
};

export type CreateConversationInput = {
  customerId: string;
  status?: ConversationStatus;
  currentIntent?: string | null;
  detectedLanguage?: string | null;
  structuredState?: JsonValue;
  compactSummary?: string | null;
  activeBookingId?: string | null;
};

export type CreateMessageInput = {
  conversationId: string;
  externalMessageId?: string | null;
  direction: MessageDirection;
  messageType?: MessageType;
  content: string;
  metadata?: JsonValue | null;
};

export type CreatePendingActionInput = {
  conversationId: string;
  actionType: PendingActionType;
  payload: JsonValue;
  status?: PendingActionStatus;
  expiresAt: Date;
  proposalMessageId?: string | null;
};

export type CreateToolExecutionInput = {
  conversationId: string;
  toolName: string;
  validatedInput: JsonValue;
  output?: JsonValue | null;
  status: ToolExecutionStatus;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type CreateHandoffInput = {
  reference: string;
  conversationId: string;
  bookingId?: string | null;
  reason: string;
  summary: string;
  priority?: HandoffPriority;
  status?: HandoffStatus;
};

export type CreateWebhookEventInput = {
  externalKey: string;
  eventType: string;
  payload: JsonValue;
  status?: WebhookProcessingStatus;
  attemptCount?: number;
  nextAttemptAt?: Date | null;
  failureCode?: string | null;
  failureMessage?: string | null;
};

export type {
  BookingStatus,
  ConversationStatus,
  HandoffPriority,
  HandoffStatus,
  MessageDirection,
  MessageType,
  PendingActionStatus,
  PendingActionType,
  SlotStatus,
  ToolExecutionStatus,
  WebhookProcessingStatus,
};
