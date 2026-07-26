import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearOperatorToken, writeOperatorToken } from '../api/auth';
import { ApiClientError, OperatorApiClient } from '../api/client';

describe('OperatorApiClient', () => {
  afterEach(() => {
    clearOperatorToken();
    vi.unstubAllGlobals();
  });

  it('sends bearer auth and parses overview responses', async () => {
    writeOperatorToken('test-token');
    const fetchImpl = vi.fn(async () =>
      Response.json({
        activeConversations: 2,
        confirmedBookings: 1,
        pendingActions: 0,
        openHandoffs: 1,
        failedWebhookEvents: 0,
        generatedAt: '2026-07-27T04:00:00.000Z',
      }),
    );

    const client = new OperatorApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const overview = await client.getOverview();
    expect(overview.activeConversations).toBe(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-token');
  });

  it('maps error envelopes and clears token on unauthorized', async () => {
    writeOperatorToken('bad-token');
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 },
      ),
    );

    const client = new OperatorApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthorized,
    });

    await expect(client.getOverview()).rejects.toBeInstanceOf(ApiClientError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not include the token in thrown error messages', async () => {
    writeOperatorToken('super-secret-operator-token');
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
        { status: 401 },
      ),
    );
    const client = new OperatorApiClient({
      baseUrl: 'http://localhost:4000',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    try {
      await client.getOverview();
      expect.unreachable('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect(String(error)).not.toContain('super-secret-operator-token');
    }
  });
});
