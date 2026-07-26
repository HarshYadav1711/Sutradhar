import { z } from 'zod';

export const HealthResponseSchema = z.object({
  service: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().min(1),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
