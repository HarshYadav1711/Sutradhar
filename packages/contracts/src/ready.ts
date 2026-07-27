import { z } from 'zod';

export const ReadyCheckSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
});

export const ReadyResponseSchema = z.object({
  service: z.string().min(1),
  status: z.enum(['ready', 'degraded', 'not_ready']),
  timestamp: z.string().min(1),
  checks: z.object({
    database: ReadyCheckSchema,
    worker: ReadyCheckSchema,
    ollama: ReadyCheckSchema,
    whatsapp: ReadyCheckSchema.extend({
      enabled: z.boolean(),
    }),
    simulator: ReadyCheckSchema.extend({
      enabled: z.boolean(),
    }),
  }),
});

export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
