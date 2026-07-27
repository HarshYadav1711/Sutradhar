import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_SYSTEM_INSTRUCTION,
  mapModelRequestToOllamaPayload,
  OllamaModelProvider,
} from '../../src/agent/index.js';
import type { ModelRequest } from '../../src/agent/model/types.js';

function createRequest(): ModelRequest {
  return {
    systemInstruction: AGENT_SYSTEM_INSTRUCTION,
    conversationState: {
      status: 'COLLECTING_BOOKING_DETAILS',
      customer: { id: 'cust_1', name: 'Ananya' },
    },
    recentMessages: [
      { role: 'user', content: 'I need AC servicing tomorrow evening in Sector 62' },
    ],
    tools: [
      {
        name: 'search_services',
        description: 'Search services',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
        },
      },
    ],
    metadata: {
      conversationId: 'conv_1',
      customerId: 'cust_1',
      requestId: 'req_1',
    },
  };
}

describe('OllamaModelProvider', () => {
  it('maps requests to the native Ollama chat payload with tools and think disabled', () => {
    const payload = mapModelRequestToOllamaPayload(createRequest(), 'qwen3:4b');

    expect(payload).toMatchObject({
      model: 'qwen3:4b',
      stream: false,
      think: false,
    });
    expect(payload.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_services',
          description: 'Search services',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
          },
        },
      },
    ]);

    const messages = payload.messages as Array<{ role: string; content?: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Current structured conversation state');
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'I need AC servicing tomorrow evening in Sector 62',
    });
  });

  it('returns a timeout error when the request exceeds the configured timeout', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          reject(new DOMException('This operation was aborted', 'AbortError'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    });

    const provider = new OllamaModelProvider({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:4b',
      timeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.complete(createRequest());
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected timeout failure');
    }
    expect(result.errorCode).toBe('OLLAMA_TIMEOUT');
    expect(result.finishReason).toBe('cancelled');
  });

  it('returns a clear error for malformed provider responses', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const provider = new OllamaModelProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.complete(createRequest());
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected malformed response failure');
    }
    expect(result.errorCode).toBe('OLLAMA_MALFORMED_RESPONSE');
  });

  it('maps successful tool-call responses without logging private content in logger fields', async () => {
    const info = vi.fn();
    const fetchImpl = vi.fn(async () =>
      Response.json({
        model: 'qwen3:4b',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'search_services',
                arguments: { query: 'ac' },
              },
            },
          ],
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 11,
        eval_count: 4,
      }),
    );

    const provider = new OllamaModelProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: {
        info,
        error: vi.fn(),
      },
    });

    const result = await provider.complete(createRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls[0]).toMatchObject({
      name: 'search_services',
      arguments: { query: 'ac' },
    });

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('Sector 62');
    expect(logged).not.toContain('Ananya');
  });

  it('strips leaked thinking blocks from assistant content', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        model: 'qwen3:4b',
        message: {
          role: 'assistant',
          content:
            '<think>internal reasoning about AC servicing</think>\nSector 62 ka location bataiye.',
        },
        done: true,
        done_reason: 'stop',
      }),
    );

    const provider = new OllamaModelProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await provider.complete(createRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }
    expect(result.text).toBe('Sector 62 ka location bataiye.');
    expect(result.text).not.toContain('internal reasoning');
  });

  it('reports model-not-found through health and complete paths', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return Response.json({ models: [{ name: 'llama3.2:3b' }] });
      }
      return new Response('model not found', { status: 404 });
    });

    const provider = new OllamaModelProvider({
      model: 'qwen3:4b',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const health = await provider.health();
    expect(health.healthy).toBe(false);
    expect(health.detail).toContain('model not found');

    const result = await provider.complete(createRequest());
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected model not found failure');
    }
    expect(result.errorCode).toBe('OLLAMA_MODEL_NOT_FOUND');
  });
});
