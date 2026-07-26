import type { AppConfig } from './config.js';
import type { PrismaClient } from './db/client.js';
import { AgentOrchestrator } from './agent/orchestrator.js';
import { OllamaModelProvider } from './agent/model/ollama-provider.js';
import { ScriptedModelProvider } from './agent/model/scripted-provider.js';
import type { ModelProvider } from './agent/model/types.js';
import { createAgentToolRegistry } from './tools/index.js';
import { OperatorQueryService } from './services/operator-query-service.js';
import { SimulatorService } from './services/simulator-service.js';

export type AppServices = {
  config: AppConfig;
  db: PrismaClient;
  model: ModelProvider;
  orchestrator: AgentOrchestrator;
  simulator: SimulatorService;
  operator: OperatorQueryService;
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
  });
}

export function createAppServices(input: {
  config: AppConfig;
  db: PrismaClient;
  model?: ModelProvider;
  orchestrator?: AgentOrchestrator;
}): AppServices {
  const model = createModelProvider(input.config, input.model);
  const tools = createAgentToolRegistry();
  const orchestrator =
    input.orchestrator ??
    new AgentOrchestrator(input.db, model, tools, {
      timeZone: input.config.BUSINESS_TIMEZONE,
      currency: input.config.BUSINESS_CURRENCY,
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
  };
}
