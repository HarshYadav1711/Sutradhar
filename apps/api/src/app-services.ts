import type { AppConfig } from './config.js';
import type { PrismaClient } from './db/client.js';
import { AgentOrchestrator } from './agent/orchestrator.js';
import { OllamaModelProvider } from './agent/model/ollama-provider.js';
import { ScriptedModelProvider } from './agent/model/scripted-provider.js';
import type { ModelProvider } from './agent/model/types.js';
import { createAgentToolRegistry } from './tools/index.js';
import {
  PendingActionExpiryService,
  PendingActionExpiryWorker,
} from './domain/pending-action-expiry.js';
import { OperatorQueryService } from './services/operator-query-service.js';
import { SimulatorService } from './services/simulator-service.js';
import { WhatsAppClient } from './whatsapp/client.js';
import { WebhookInboxService } from './whatsapp/inbox.js';
import { WebhookInboxWorker } from './whatsapp/worker.js';

export type AppServices = {
  config: AppConfig;
  db: PrismaClient;
  model: ModelProvider;
  orchestrator: AgentOrchestrator;
  simulator: SimulatorService;
  operator: OperatorQueryService;
  whatsappClient: WhatsAppClient | null;
  webhookInbox: WebhookInboxService;
  webhookWorker: WebhookInboxWorker;
  pendingActionExpiry: PendingActionExpiryService;
  pendingActionExpiryWorker: PendingActionExpiryWorker;
};

export function createModelProvider(config: AppConfig, override?: ModelProvider): ModelProvider {
  if (override) {
    return override;
  }

  if (config.LLM_PROVIDER === 'scripted') {
    return new ScriptedModelProvider([], {
      env: { NODE_ENV: config.NODE_ENV, SUTRADHAR_ALLOW_SCRIPTED_MODEL: 'true' },
    });
  }

  return new OllamaModelProvider({
    baseUrl: config.OLLAMA_BASE_URL,
    model: config.OLLAMA_MODEL,
    timeoutMs: config.OLLAMA_TIMEOUT_MS,
  });
}

export function createWhatsAppClient(
  config: AppConfig,
  override?: WhatsAppClient | null,
): WhatsAppClient | null {
  if (override !== undefined) {
    return override;
  }
  if (!config.WHATSAPP_ENABLED) {
    return null;
  }

  return new WhatsAppClient({
    accessToken: config.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    graphVersion: config.META_GRAPH_VERSION,
    timeoutMs: config.WHATSAPP_REQUEST_TIMEOUT_MS,
    maxRetries: config.WHATSAPP_MAX_RETRIES,
  });
}

export function createAppServices(input: {
  config: AppConfig;
  db: PrismaClient;
  model?: ModelProvider;
  orchestrator?: AgentOrchestrator;
  whatsappClient?: WhatsAppClient | null;
  startWorker?: boolean;
}): AppServices {
  const model = createModelProvider(input.config, input.model);
  const tools = createAgentToolRegistry();
  const orchestrator =
    input.orchestrator ??
    new AgentOrchestrator(input.db, model, tools, {
      timeZone: input.config.BUSINESS_TIMEZONE,
      currency: input.config.BUSINESS_CURRENCY,
    });

  const whatsappClient = createWhatsAppClient(input.config, input.whatsappClient);
  const webhookInbox = new WebhookInboxService(input.db, orchestrator, whatsappClient, {
    maxAttempts: input.config.WHATSAPP_WEBHOOK_MAX_ATTEMPTS,
    staleProcessingMs: input.config.WHATSAPP_WEBHOOK_STALE_MS,
    baseBackoffMs: input.config.WHATSAPP_WEBHOOK_BASE_BACKOFF_MS,
    maxBackoffMs: input.config.WHATSAPP_WEBHOOK_MAX_BACKOFF_MS,
  });
  const pendingActionExpiry = new PendingActionExpiryService(input.db);
  const pendingActionExpiryWorker = new PendingActionExpiryWorker(pendingActionExpiry, {
    intervalMs: input.config.PENDING_ACTION_EXPIRY_SWEEP_MS,
    enabled: input.startWorker !== false,
  });
  const webhookWorker = new WebhookInboxWorker(webhookInbox, {
    pollIntervalMs: input.config.WHATSAPP_WEBHOOK_POLL_MS,
    concurrency: input.config.WORKER_CONCURRENCY,
    enabled: input.config.WHATSAPP_ENABLED && input.startWorker !== false,
    onTickExtras: async () => {
      await pendingActionExpiry.expireDue();
    },
  });

  return {
    config: input.config,
    db: input.db,
    model,
    orchestrator,
    simulator: new SimulatorService(input.db, orchestrator, {
      timeZone: input.config.BUSINESS_TIMEZONE,
    }),
    operator: new OperatorQueryService(input.db),
    whatsappClient,
    webhookInbox,
    webhookWorker,
    pendingActionExpiry,
    pendingActionExpiryWorker,
  };
}
