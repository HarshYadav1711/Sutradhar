import Fastify from 'fastify';

import { createAppServices, type AppServices } from './app-services.js';
import { loadConfig, type AppConfig } from './config.js';
import { createPrismaClient, type PrismaClient } from './db/client.js';
import type { ModelProvider } from './agent/model/types.js';
import type { AgentOrchestrator } from './agent/orchestrator.js';
import type { WhatsAppClient } from './whatsapp/client.js';
import { toPublicErrorBody } from './http/errors.js';
import { createLoggerOptions } from './http/logging.js';
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
  const config = options.config ?? loadConfig();
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

  const app =
    options.logger === undefined
      ? Fastify({
          logger: createLoggerOptions(config),
          bodyLimit: config.BODY_LIMIT_BYTES,
          requestIdHeader: 'x-request-id',
          genReqId: () => crypto.randomUUID(),
        })
      : options.logger === false
        ? Fastify({
            logger: false,
            bodyLimit: config.BODY_LIMIT_BYTES,
            requestIdHeader: 'x-request-id',
            genReqId: () => crypto.randomUUID(),
          })
        : Fastify({
            logger:
              typeof options.logger === 'object'
                ? { ...createLoggerOptions(config), ...options.logger }
                : createLoggerOptions(config),
            bodyLimit: config.BODY_LIMIT_BYTES,
            requestIdHeader: 'x-request-id',
            genReqId: () => crypto.randomUUID(),
          });

  app.decorate('services', services);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await registerSecurityHooks(app, { config });
  await registerHealthRoutes(app, {
    config: services.config,
    db: services.db,
    model: services.model,
    worker: services.webhookWorker,
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
    services.pendingActionExpiryWorker.start();
    services.webhookWorker.start();
  });

  app.addHook('onClose', async () => {
    await services.webhookWorker.stop();
    await services.pendingActionExpiryWorker.stop();
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    const code =
      typeof error === 'object' &&
      error &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;

    // Log structured fields only — never attach full conversation payloads at info.
    request.log.error(
      {
        err: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : 'Unknown error',
          code,
          statusCode,
        },
        requestId: request.id,
      },
      'Unhandled request error',
    );

    if (!reply.sent) {
      const body = toPublicErrorBody({
        ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
        statusCode: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
        ...(code ? { code } : {}),
        message: error instanceof Error ? error.message : 'Request failed',
        nodeEnv: config.NODE_ENV,
        secrets: [
          config.WHATSAPP_ACCESS_TOKEN,
          config.META_APP_SECRET,
          config.ADMIN_API_TOKEN,
          config.WHATSAPP_VERIFY_TOKEN,
        ],
      });
      void reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send(body);
    }
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send(
      toPublicErrorBody({
        ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Route not found',
        nodeEnv: config.NODE_ENV,
      }),
    );
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}
