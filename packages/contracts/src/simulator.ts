import { z } from 'zod';

export const SimulatorMessageRequestSchema = z.object({
  customerKey: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_+:.@-]+$/, 'customerKey contains unsupported characters'),
  text: z.string().trim().min(1).max(4000),
  customerName: z.string().trim().min(1).max(120).optional(),
  externalMessageId: z.string().trim().min(1).max(128).optional(),
  /** Close active conversations for this customer and start a new one. */
  startFresh: z.boolean().optional().default(false),
});

export type SimulatorMessageRequest = z.infer<typeof SimulatorMessageRequestSchema>;

export const SimulatorMessageResponseSchema = z.object({
  conversationId: z.string().min(1),
  customerId: z.string().min(1),
  inboundMessageId: z.string().min(1),
  outboundMessageId: z.string().nullable(),
  outboundText: z.string().nullable(),
  conversationStatus: z.string().min(1),
  outcome: z.string().min(1),
  bookingId: z.string().nullable(),
  bookingReference: z.string().nullable(),
  handoffId: z.string().nullable(),
  handoffReference: z.string().nullable(),
  pendingActionId: z.string().nullable(),
  duplicated: z.boolean(),
  stepsUsed: z.number().int().min(0),
});

export type SimulatorMessageResponse = z.infer<typeof SimulatorMessageResponseSchema>;

export const DemoResetResponseSchema = z.object({
  ok: z.literal(true),
  timezone: z.string().min(1),
  serviceCount: z.number().int().min(0),
  slotCount: z.number().int().min(0),
  availableSlotCount: z.number().int().min(0),
  unavailableSlotCount: z.number().int().min(0),
  demoCustomerId: z.string().min(1),
  resetAt: z.string().min(1),
});

export type DemoResetResponse = z.infer<typeof DemoResetResponseSchema>;
