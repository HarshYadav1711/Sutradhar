import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema, ReadyResponseSchema } from '@sutradhar/contracts';

import type { AppConfig } from '../config.js';
import type { PrismaClient } from '../db/client.js';
import type { ModelProvider } from '../agent/model/types.js';
import type { WebhookInboxWorker } from '../whatsapp/worker.js';
import { APP_VERSION } from '../version.js';
import { sendError } from '../http/errors.js';

const SERVICE_NAME = 'sutradhar-api';

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    db: PrismaClient;
    model: ModelProvider;
    worker: WebhookInboxWorker;
  },
): Promise<void> {
  // Liveness only — do not probe dependencies here.
  app.get('/health', async () => {
    return HealthResponseSchema.parse({
      service: SERVICE_NAME,
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
    });
  });

  app.get('/ready', async (request, reply) => {
    let databaseOk: boolean;
    let databaseDetail: string;
    try {
      await deps.db.$queryRaw`SELECT 1`;
      databaseOk = true;
      databaseDetail = 'connected';
    } catch (error) {
      databaseOk = false;
      databaseDetail = error instanceof Error ? error.message : 'database check failed';
    }

    const workerStatus = deps.worker.getStatus();
    const workerOk = workerStatus.healthy;
    const workerDetail = workerStatus.detail;

    const llmHealth = await deps.model.health();
    const ollamaOk =
      deps.config.LLM_PROVIDER === 'scripted' ? true : llmHealth.healthy;
    const ollamaDetail =
      deps.config.LLM_PROVIDER === 'scripted'
        ? 'scripted test provider'
        : llmHealth.detail;

    const whatsappEnabled = deps.config.WHATSAPP_ENABLED;
    let whatsappOk = true;
    let whatsappDetail = 'disabled';
    if (whatsappEnabled) {
      const configured = Boolean(
        deps.config.WHATSAPP_ACCESS_TOKEN &&
          deps.config.WHATSAPP_PHONE_NUMBER_ID &&
          deps.config.META_GRAPH_VERSION &&
          deps.config.META_APP_SECRET &&
          deps.config.WHATSAPP_VERIFY_TOKEN,
      );
      whatsappOk = configured;
      whatsappDetail = configured ? 'configured' : 'missing required credentials';
    }

    const simulatorEnabled = deps.config.ENABLE_SIMULATOR;

    let status: 'ready' | 'degraded' | 'not_ready' = 'ready';
    if (!databaseOk) {
      status = 'not_ready';
    } else if (!workerOk || !ollamaOk || (whatsappEnabled && !whatsappOk)) {
      status = 'degraded';
    }

    const payload = ReadyResponseSchema.parse({
      service: SERVICE_NAME,
      status,
      timestamp: new Date().toISOString(),
      checks: {
        database: { ok: databaseOk, detail: databaseDetail },
        worker: { ok: workerOk, detail: workerDetail },
        ollama: {
          ok: ollamaOk,
          detail: ollamaDetail,
        },
        whatsapp: {
          ok: whatsappOk,
          enabled: whatsappEnabled,
          detail: whatsappDetail,
        },
        simulator: {
          ok: true,
          enabled: simulatorEnabled,
          detail: simulatorEnabled ? 'enabled' : 'disabled',
        },
      },
    });

    if (status === 'not_ready') {
      return sendError(reply, request, 503, 'NOT_READY', 'Service is not ready');
    }

    return reply.code(200).send(payload);
  });
}
