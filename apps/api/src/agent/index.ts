export type { ModelProvider } from './model/types.js';
export type {
  ModelCompleteOptions,
  ModelErrorResult,
  ModelFinishReason,
  ModelHealthStatus,
  ModelMessage,
  ModelRequest,
  ModelRequestMetadata,
  ModelResult,
  ModelSuccessResult,
  ModelToolCall,
  ModelToolDefinition,
  ModelUsage,
} from './model/types.js';

export { OllamaModelProvider, mapModelRequestToOllamaPayload } from './model/ollama-provider.js';
export { ScriptedModelProvider } from './model/scripted-provider.js';
export type { ScriptedModelResponse } from './model/scripted-provider.js';
export { toolToModelDefinition, zodSchemaToParameters } from './model/tool-schema.js';

export { ContextBuilder, DEFAULT_RECENT_MESSAGE_LIMIT } from './context-builder.js';
export type { BuiltAgentContext, ContextBuilderOptions } from './context-builder.js';
export { AGENT_SYSTEM_INSTRUCTION } from './system-instruction.js';
