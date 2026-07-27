import { randomUUID } from 'node:crypto';

import type {
  ModelCompleteOptions,
  ModelHealthStatus,
  ModelProvider,
  ModelRequest,
  ModelResult,
  ModelToolCall,
} from './types.js';

export type OllamaModelProviderOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: {
    info: (fields: Record<string, unknown>, message: string) => void;
    error: (fields: Record<string, unknown>, message: string) => void;
  };
};

type OllamaChatMessage = {
  role: string;
  content?: string;
  tool_name?: string;
  tool_calls?: Array<{
    id?: string;
    function?: {
      name?: string;
      arguments?: unknown;
    };
  }>;
};

type OllamaChatResponse = {
  model?: string;
  message?: OllamaChatMessage;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:4b';
const DEFAULT_TIMEOUT_MS = 30_000;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function mapToolCalls(message: OllamaChatMessage | undefined): ModelToolCall[] {
  if (!message?.tool_calls || message.tool_calls.length === 0) {
    return [];
  }

  return message.tool_calls.flatMap((call, index) => {
    const name = call.function?.name;
    if (!name) {
      return [];
    }

    return [
      {
        id: call.id ?? `toolcall_${index + 1}`,
        name,
        arguments: parseArguments(call.function?.arguments),
      },
    ];
  });
}

function buildOllamaMessages(request: ModelRequest): OllamaChatMessage[] {
  const stateBlock = JSON.stringify(request.conversationState);
  const systemContent = [
    request.systemInstruction,
    '',
    'Current structured conversation state (JSON):',
    stateBlock,
  ].join('\n');

  const messages: OllamaChatMessage[] = [
    {
      role: 'system',
      content: systemContent,
    },
  ];

  for (const message of request.recentMessages) {
    if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        content: message.content,
        ...(message.toolName ? { tool_name: message.toolName } : {}),
      });
      continue;
    }

    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  return messages;
}

export function mapModelRequestToOllamaPayload(
  request: ModelRequest,
  model: string,
): Record<string, unknown> {
  return {
    model,
    stream: false,
    // Do not request model thinking / chain-of-thought.
    think: false,
    messages: buildOllamaMessages(request),
    tools: request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  };
}

/**
 * Local Ollama chat provider using the native /api/chat HTTP interface.
 */
export class OllamaModelProvider implements ModelProvider {
  readonly name = 'ollama';

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: OllamaModelProviderOptions['logger'];

  constructor(options: OllamaModelProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger;
  }

  async health(): Promise<ModelHealthStatus> {
    const checkedAt = new Date().toISOString();

    try {
      const response = await this.fetchImpl(joinUrl(this.baseUrl, '/api/tags'), {
        method: 'GET',
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5_000)),
      });

      if (!response.ok) {
        return {
          healthy: false,
          provider: this.name,
          model: this.model,
          baseUrl: this.baseUrl,
          detail: `Ollama health check failed with status ${response.status}`,
          checkedAt,
        };
      }

      const body = (await response.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      const models = body.models ?? [];
      const found = models.some((entry) => {
        const name = entry.name ?? entry.model ?? '';
        return name === this.model || name.startsWith(`${this.model}:`) || name.startsWith(this.model);
      });

      if (!found) {
        return {
          healthy: false,
          provider: this.name,
          model: this.model,
          baseUrl: this.baseUrl,
          detail: `Ollama model not found: ${this.model}`,
          checkedAt,
        };
      }

      return {
        healthy: true,
        provider: this.name,
        model: this.model,
        baseUrl: this.baseUrl,
        detail: 'Ollama is reachable and the configured model is available',
        checkedAt,
      };
    } catch (error) {
      return {
        healthy: false,
        provider: this.name,
        model: this.model,
        baseUrl: this.baseUrl,
        detail:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'Ollama health check timed out'
            : 'Ollama is unreachable',
        checkedAt,
      };
    }
  }

  async complete(request: ModelRequest, options: ModelCompleteOptions = {}): Promise<ModelResult> {
    const started = Date.now();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const onExternalAbort = () => {
      controller.abort();
    };
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const payload = mapModelRequestToOllamaPayload(request, this.model);

      this.logger?.info(
        {
          provider: this.name,
          model: this.model,
          conversationId: request.metadata.conversationId,
          requestId: request.metadata.requestId,
          toolCount: request.tools.length,
          messageCount: request.recentMessages.length,
        },
        'ollama_request_started',
      );

      const response = await this.fetchImpl(joinUrl(this.baseUrl, '/api/chat'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorCode =
          response.status === 404 ? 'OLLAMA_MODEL_NOT_FOUND' : 'OLLAMA_HTTP_ERROR';
        const errorMessage =
          response.status === 404
            ? `Ollama model not found: ${this.model}`
            : `Ollama request failed with status ${response.status}`;

        this.logger?.error(
          {
            provider: this.name,
            model: this.model,
            status: response.status,
            durationMs: Date.now() - started,
            // Do not log response body; it may include prompt echoes.
            errorCode,
          },
          'ollama_request_failed',
        );

        void errorText;

        return {
          ok: false,
          errorCode,
          errorMessage,
          finishReason: 'error',
          provider: this.name,
          model: this.model,
        };
      }

      let body: OllamaChatResponse;
      try {
        body = (await response.json()) as OllamaChatResponse;
      } catch {
        return {
          ok: false,
          errorCode: 'OLLAMA_MALFORMED_RESPONSE',
          errorMessage: 'Ollama returned a malformed JSON response',
          finishReason: 'error',
          provider: this.name,
          model: this.model,
        };
      }

      if (!body.message || typeof body.message !== 'object') {
        return {
          ok: false,
          errorCode: 'OLLAMA_MALFORMED_RESPONSE',
          errorMessage: 'Ollama response did not include a message object',
          finishReason: 'error',
          provider: this.name,
          model: this.model,
        };
      }

      const toolCalls = mapToolCalls(body.message);
      const text =
        typeof body.message.content === 'string' && body.message.content.trim() !== ''
          ? body.message.content
          : null;

      const finishReason =
        toolCalls.length > 0
          ? 'tool_calls'
          : body.done_reason === 'length'
            ? 'length'
            : 'stop';

      const usage = {
        ...(typeof body.prompt_eval_count === 'number'
          ? { promptTokens: body.prompt_eval_count }
          : {}),
        ...(typeof body.eval_count === 'number' ? { completionTokens: body.eval_count } : {}),
        ...(typeof body.prompt_eval_count === 'number' && typeof body.eval_count === 'number'
          ? { totalTokens: body.prompt_eval_count + body.eval_count }
          : {}),
      };

      this.logger?.info(
        {
          provider: this.name,
          model: this.model,
          durationMs: Date.now() - started,
          finishReason,
          toolCallCount: toolCalls.length,
          hasText: Boolean(text),
        },
        'ollama_request_completed',
      );

      return {
        ok: true,
        text,
        toolCalls,
        ...(Object.keys(usage).length > 0 ? { usage } : {}),
        finishReason,
        provider: this.name,
        model: body.model ?? this.model,
      };
    } catch (error) {
      const aborted =
        (error instanceof Error && error.name === 'AbortError') ||
        options.signal?.aborted ||
        controller.signal.aborted;

      this.logger?.error(
        {
          provider: this.name,
          model: this.model,
          durationMs: Date.now() - started,
          errorCode: aborted ? 'OLLAMA_TIMEOUT' : 'OLLAMA_CONNECTION_ERROR',
        },
        'ollama_request_failed',
      );

      if (aborted) {
        return {
          ok: false,
          errorCode: 'OLLAMA_TIMEOUT',
          errorMessage: 'Ollama request timed out or was aborted',
          finishReason: 'cancelled',
          provider: this.name,
          model: this.model,
        };
      }

      return {
        ok: false,
        errorCode: 'OLLAMA_CONNECTION_ERROR',
        errorMessage: 'Unable to connect to Ollama',
        finishReason: 'error',
        provider: this.name,
        model: this.model,
      };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

export function createRequestId(): string {
  return randomUUID();
}
