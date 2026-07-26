import { describe, expect, it } from 'vitest';

import { ScriptedModelProvider } from '../src/agent/index.js';
import type { ModelRequest } from '../src/agent/model/types.js';

const request: ModelRequest = {
  systemInstruction: 'test',
  conversationState: {},
  recentMessages: [{ role: 'user', content: 'hello' }],
  tools: [],
  metadata: {},
};

describe('ScriptedModelProvider', () => {
  it('returns queued responses deterministically in test env', async () => {
    const provider = new ScriptedModelProvider(
      [
        {
          text: 'first',
          toolCalls: [],
          finishReason: 'stop',
          model: 'scripted',
        },
        {
          text: null,
          toolCalls: [
            {
              id: '1',
              name: 'search_services',
              arguments: { query: 'ac' },
            },
          ],
          finishReason: 'tool_calls',
          model: 'scripted',
        },
      ],
      { env: { NODE_ENV: 'test' } },
    );

    const first = await provider.complete(request);
    const second = await provider.complete(request);

    expect(first).toMatchObject({ ok: true, text: 'first', finishReason: 'stop' });
    expect(second).toMatchObject({
      ok: true,
      finishReason: 'tool_calls',
      toolCalls: [{ name: 'search_services' }],
    });
    expect(provider.remaining()).toBe(0);
  });

  it('cannot be activated in production mode', () => {
    expect(
      () =>
        new ScriptedModelProvider(
          [
            {
              text: 'nope',
              toolCalls: [],
              finishReason: 'stop',
              model: 'scripted',
            },
          ],
          {
            env: { NODE_ENV: 'production', SUTRADHAR_ALLOW_SCRIPTED_MODEL: 'true' },
            allowInNonTestEnv: true,
          },
        ),
    ).toThrow(/cannot be activated in production/i);
  });

  it('requires an explicit test environment outside NODE_ENV=test', () => {
    expect(
      () =>
        new ScriptedModelProvider(
          [
            {
              text: 'nope',
              toolCalls: [],
              finishReason: 'stop',
              model: 'scripted',
            },
          ],
          { env: { NODE_ENV: 'development' } },
        ),
    ).toThrow(/test-only/i);
  });
});
