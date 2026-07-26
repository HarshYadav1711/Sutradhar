import Fastify from 'fastify';

import { createAppServices, type AppServices } from './app-services.js';
import { loadConfig, type AppConfig } from './config.js';
import { createPrismaClient, type PrismaClient } from './db/client.js';
import type { ModelProvider } from './agent/model/types.js';
import type { AgentOrchestrator } from './agent/orchestrator.js';
import type { WhatsAppClient } from './whatsapp/client.js';
import { registerSecurityHooks } from './http/security.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerOperatorRoutes } from './routes/operator.js';
import { registerSimulatorRoutes } from './routes/simulator.js';
import { registerWhatsAppWebhookRoutes } from './routes/whatsapp-webhook.js';

export type BuildAppOptions = {
  logger?: boolean | { level?: string };
  config?: AppConfig;
  db?: PrismaClient;
  model?: ModelProvider;
  orchestrator?: AgentOrchestrator;
  whatsappClient?: WhatsAppClient | null;
  startWorker?: boolean;
  services?: AppServices;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig(process.env);
  const db = options.db ?? createPrismaClient(config.DATABASE_URL);
  const services =
    options.services ??
    createAppServices({
      config,
      db,
      ...(options.model ? { model: options.model } : {}),
      ...(options.orchestrator ? { orchestrator: options.orchestrator } : {}),
      ...(options.whatsappClient !== undefined ? { whatsappClient: options.whatsappClient } : {}),
      ...(options.startWorker !== undefined ? { startWorker: options.startWorker } : {}),
    });

  const app = Fastify({
    logger:
      options.logger === undefined
        ? {
            level: config.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers["x-hub-signature-256"]',
                'config.WHATSAPP_ACCESS_TOKEN',
                'config.META_APP_SECRET',
                'config.WHATSAPP_VERIFY_TOKEN',
                'config.ADMIN_API_TOKEN',
                '*.accessToken',
                '*.appSecret',
                '*.verifyToken',
              ],
              remove: true,
            },
          }
        : options.logger,
    bodyLimit: 32 * 1024,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  app.decorate('services', services);

  await registerSecurityHooks(app, { corsOrigin: config.CORS_ORIGIN });
  await registerHealthRoutes(app, {
    config: services.config,
    db: services.db,
    model: services.model,
  });
  await registerSimulatorRoutes(app, {
    config: services.config,
    simulator: services.simulator,
  });
  await registerOperatorRoutes(app, {
    config: services.config,
    operator: services.operator,
  });
  await registerWhatsAppWebhookRoutes(app, {
    config: services.config,
    inbox: services.webhookInbox,
  });

  app.addHook('onReady', async () => {
    services.webhookWorker.start();
  });

  app.addHook('onClose', async () => {
    await services.webhookWorker.stop();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled request error');
    const statusCode =
      typeof error === 'object' &&
      error &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (!reply.sent) {
      void reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
        error: {
          code:
            typeof error === 'object' &&
            error &&
            'code' in error &&
            typeof (error as { code?: unknown }).code === 'string'
              ? (error as { code: string }).code
              : 'INTERNAL_ERROR',
          message:
            statusCode >= 500
              ? 'Internal server error'
              : error instanceof Error
                ? error.message
                : 'Request failed',
          ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
        },
      });
    }
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}
