import { describe, expect, it } from 'vitest';

import { WhatsAppClient, WhatsAppClientError } from '../src/whatsapp/client.js';

describe('WhatsAppClient', () => {
  it('sends the official Graph messages payload shape', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new WhatsAppClient({
      accessToken: 'secret-token-should-not-leak',
      phoneNumberId: '123456',
      graphVersion: 'v21.0',
      maxRetries: 0,
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    });

    const result = await client.sendText({ to: '919811122233', body: 'Hello' });
    expect(result.messageId).toBe('wamid.OUT1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/123456/messages');

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-token-should-not-leak');
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919811122233',
      type: 'text',
      text: {
        preview_url: false,
        body: 'Hello',
      },
    });
  });

  it('parses Meta errors and does not retry ordinary permission failures', async () => {
    let attempts = 0;
    const client = new WhatsAppClient({
      accessToken: 'secret-token',
      phoneNumberId: '123456',
      graphVersion: 'v21.0',
      maxRetries: 2,
      fetchImpl: (async () => {
        attempts += 1;
        return new Response(
          JSON.stringify({
            error: {
              message: 'Unsupported post request',
              type: 'OAuthException',
              code: 100,
              fbtrace_id: 'TRACE',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    });

    await expect(client.sendText({ to: '9198', body: 'Hi' })).rejects.toMatchObject({
      name: 'WhatsAppClientError',
      retryable: false,
      statusCode: 400,
    });
    expect(attempts).toBe(1);
  });

  it('retries transient 429 failures', async () => {
    let attempts = 0;
    const client = new WhatsAppClient({
      accessToken: 'secret-token',
      phoneNumberId: '123456',
      graphVersion: 'v21.0',
      maxRetries: 1,
      fetchImpl: (async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ error: { message: 'rate limited', code: 4 } }), {
            status: 429,
          });
        }
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.RETRY' }] }), { status: 200 });
      }) as typeof fetch,
    });

    const result = await client.sendText({ to: '9198', body: 'Hi' });
    expect(result.messageId).toBe('wamid.RETRY');
    expect(attempts).toBe(2);
  });

  it('does not include access tokens in error logs', async () => {
    const lines: Array<Record<string, unknown>> = [];
    const client = new WhatsAppClient({
      accessToken: 'super-secret-access-token',
      phoneNumberId: '123456',
      graphVersion: 'v21.0',
      maxRetries: 0,
      logger: {
        info: () => undefined,
        error: (obj) => {
          lines.push(obj);
        },
      },
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: 'fail', code: 1 } }), {
          status: 500,
        })) as typeof fetch,
    });

    await expect(client.sendText({ to: '9198', body: 'Hi' })).rejects.toBeInstanceOf(
      WhatsAppClientError,
    );
    expect(JSON.stringify(lines)).not.toContain('super-secret-access-token');
  });
});
