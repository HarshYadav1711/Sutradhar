export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export type ModelMessage = {
  role: ModelRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
};

export type ModelToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelRequestMetadata = {
  requestId?: string;
  conversationId?: string;
  customerId?: string;
};

export type ModelRequest = {
  systemInstruction: string;
  conversationState: Record<string, unknown>;
  recentMessages: ModelMessage[];
  tools: ModelToolDefinition[];
  metadata: ModelRequestMetadata;
};

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ModelUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ModelFinishReason = 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';

export type ModelSuccessResult = {
  ok: true;
  text: string | null;
  toolCalls: ModelToolCall[];
  usage?: ModelUsage;
  finishReason: ModelFinishReason;
  provider: string;
  model: string;
};

export type ModelErrorResult = {
  ok: false;
  errorCode: string;
  errorMessage: string;
  finishReason: 'error' | 'cancelled';
  provider: string;
  model?: string;
};

export type ModelResult = ModelSuccessResult | ModelErrorResult;

export type ModelHealthStatus = {
  healthy: boolean;
  provider: string;
  model?: string;
  baseUrl?: string;
  detail: string;
  checkedAt: string;
};

export type ModelCompleteOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest, options?: ModelCompleteOptions): Promise<ModelResult>;
  health(): Promise<ModelHealthStatus>;
}
