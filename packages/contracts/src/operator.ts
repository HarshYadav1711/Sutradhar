import { z } from 'zod';

import { paginatedSchema } from './common.js';

export const ConversationStatusSchema = z.enum([
  'IDLE',
  'COLLECTING_BOOKING_DETAILS',
  'AWAITING_BOOKING_CONFIRMATION',
  'BOOKED',
  'AWAITING_RESCHEDULE_CONFIRMATION',
  'HANDED_OFF',
  'CLOSED',
]);

export const OperatorOverviewSchema = z.object({
  activeConversations: z.number().int().min(0),
  confirmedBookings: z.number().int().min(0),
  pendingActions: z.number().int().min(0),
  openHandoffs: z.number().int().min(0),
  failedWebhookEvents: z.number().int().min(0),
  generatedAt: z.string().min(1),
});

export type OperatorOverview = z.infer<typeof OperatorOverviewSchema>;

export const OperatorCustomerSummarySchema = z.object({
  id: z.string().min(1),
  whatsappNumber: z.string().nullable(),
  name: z.string().nullable(),
});

export const OperatorConversationListItemSchema = z.object({
  id: z.string().min(1),
  status: ConversationStatusSchema,
  currentIntent: z.string().nullable(),
  detectedLanguage: z.string().nullable(),
  lastActivityAt: z.string().min(1),
  createdAt: z.string().min(1),
  customer: OperatorCustomerSummarySchema,
  activeBookingId: z.string().nullable(),
  activeBookingReference: z.string().nullable(),
  pendingActionId: z.string().nullable(),
});

export const OperatorConversationListResponseSchema = paginatedSchema(
  OperatorConversationListItemSchema,
);

export type OperatorConversationListResponse = z.infer<
  typeof OperatorConversationListResponseSchema
>;

export const OperatorMessageSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  messageType: z.enum(['TEXT', 'UNSUPPORTED', 'SYSTEM']),
  content: z.string(),
  createdAt: z.string().min(1),
  externalMessageId: z.string().nullable(),
});

export const OperatorPendingActionSchema = z.object({
  id: z.string().min(1),
  actionType: z.enum(['CREATE_BOOKING', 'RESCHEDULE_BOOKING']),
  status: z.enum(['PENDING', 'COMMITTED', 'CANCELLED', 'EXPIRED']),
  expiresAt: z.string().min(1),
  proposalSummary: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const OperatorBookingSummarySchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  status: z.string().min(1),
  serviceName: z.string().min(1),
  startsAt: z.string().min(1),
  quantity: z.number().int().min(1),
  address: z.string().min(1),
  estimatedPriceMinor: z.number().int().min(0),
});

export const OperatorConversationDetailSchema = z.object({
  id: z.string().min(1),
  status: ConversationStatusSchema,
  currentIntent: z.string().nullable(),
  detectedLanguage: z.string().nullable(),
  compactSummary: z.string().nullable(),
  structuredState: z.record(z.string(), z.unknown()),
  lastActivityAt: z.string().min(1),
  createdAt: z.string().min(1),
  customer: OperatorCustomerSummarySchema,
  activeBooking: OperatorBookingSummarySchema.nullable(),
  pendingAction: OperatorPendingActionSchema.nullable(),
  messages: z.array(OperatorMessageSchema),
});

export type OperatorConversationDetail = z.infer<typeof OperatorConversationDetailSchema>;

export const OperatorOperationalEventSchema = z.object({
  id: z.string().min(1),
  eventType: z.string().min(1),
  detail: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const OperatorToolExecutionSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(['SUCCESS', 'ERROR', 'VALIDATION_ERROR']),
  durationMs: z.number().int().min(0),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const OperatorConversationTraceSchema = z.object({
  conversationId: z.string().min(1),
  operationalEvents: z.array(OperatorOperationalEventSchema),
  toolExecutions: z.array(OperatorToolExecutionSchema),
});

export type OperatorConversationTrace = z.infer<typeof OperatorConversationTraceSchema>;

export const OperatorBookingListItemSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  status: z.string().min(1),
  customer: OperatorCustomerSummarySchema,
  serviceName: z.string().min(1),
  startsAt: z.string().min(1),
  quantity: z.number().int().min(1),
  address: z.string().min(1),
  estimatedPriceMinor: z.number().int().min(0),
  confirmedAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const OperatorBookingListResponseSchema = paginatedSchema(OperatorBookingListItemSchema);
export type OperatorBookingListResponse = z.infer<typeof OperatorBookingListResponseSchema>;

export const OperatorBookingDetailSchema = OperatorBookingListItemSchema.extend({
  serviceId: z.string().min(1),
  availabilitySlotId: z.string().min(1),
  endsAt: z.string().min(1),
  timezone: z.string().min(1),
});

export type OperatorBookingDetail = z.infer<typeof OperatorBookingDetailSchema>;

export const HandoffStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
export const HandoffPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const OperatorHandoffListItemSchema = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  status: HandoffStatusSchema,
  priority: HandoffPrioritySchema,
  reason: z.string().min(1),
  summary: z.string().min(1),
  conversationId: z.string().min(1),
  bookingId: z.string().nullable(),
  customer: OperatorCustomerSummarySchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const OperatorHandoffListResponseSchema = paginatedSchema(OperatorHandoffListItemSchema);
export type OperatorHandoffListResponse = z.infer<typeof OperatorHandoffListResponseSchema>;

export const OperatorHandoffDetailSchema = OperatorHandoffListItemSchema;
export type OperatorHandoffDetail = z.infer<typeof OperatorHandoffDetailSchema>;

export const OperatorHandoffUpdateRequestSchema = z.object({
  status: HandoffStatusSchema.optional(),
  priority: HandoffPrioritySchema.optional(),
}).refine((value) => value.status !== undefined || value.priority !== undefined, {
  message: 'At least one of status or priority is required',
});

export type OperatorHandoffUpdateRequest = z.infer<typeof OperatorHandoffUpdateRequestSchema>;
