import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@sutradhar/contracts';

import { APP_VERSION } from '../version.js';

const SERVICE_NAME = 'sutradhar-api';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const payload = HealthResponseSchema.parse({
      service: SERVICE_NAME,
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
    });

    return payload;
  });
}
