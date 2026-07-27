import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import { parseCorsOrigins, type AppConfig } from '../config.js';

export type SecurityRegistrationOptions = {
  config: AppConfig;
};

/**
 * Registers maintained Fastify security plugins: Helmet, CORS, and rate limiting.
 */
export async function registerSecurityHooks(
  app: FastifyInstance,
  options: SecurityRegistrationOptions,
): Promise<void> {
  const { config } = options;
  const allowedOrigins = parseCorsOrigins(config.CORS_ORIGIN);

  await app.register(helmet, {
    // Operator console is a separate origin; CSP is not required for this JSON API.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    global: true,
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Non-browser clients (curl, Meta webhooks, local scripts) send no Origin.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    // Health probes should not consume the shared budget.
    allowList: (request) => {
      const url = request.url.split('?')[0] ?? request.url;
      return url === '/health' || url === '/ready' || url === '/webhooks/whatsapp';
    },
    errorResponseBuilder: (request, context) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded, retry after ${Math.ceil(context.ttl / 1000)} seconds`,
        ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
      },
    }),
  });

  // Reject unexpected Content-Type early (before body parsers).
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'OPTIONS' || request.method === 'HEAD') {
      return;
    }

    const contentType = request.headers['content-type'];
    if (!contentType) {
      return;
    }

    const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    const allowed =
      normalized === 'application/json' ||
      normalized === 'application/x-www-form-urlencoded' ||
      normalized === 'text/plain';

    if (!allowed) {
      return reply.code(415).send({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Unsupported Content-Type',
          ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
        },
      });
    }
  });
}
