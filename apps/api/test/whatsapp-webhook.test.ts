import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ScriptedModelProvider } from '../src/agent/model/scripted-provider.js';
import type { PrismaClient } from '../src/db/client.js';
import { WhatsAppClient } from '../src/whatsapp/client.js';
import { createTestWhatsAppSignature } from '../src/whatsapp/signature.js';
import { createTestDatabase } from './helpers/db.js';

const APP_SECRET = 'test-meta-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function textPayload(messageId: string, body: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'ENTRY',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'PHONE' },
              contacts: [{ profile: { name: 'Ananya' }, wa_id: '919811122233' }],
              messages: [
                {
                  from: '919811122233',
                  id: messageId,
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsApp webhook HTTP integration', () => {
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;
  let databaseUrl: string;
  let app: App;
  let outboundCalls: Array<{ to: string; body: string }> = [];

  beforeAll(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    databaseUrl = database.databaseUrl;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (cleanup) {
      await cleanup();
    }
  });

  async function startWhatsAppApp() {
    if (app) {
      await app.close();
    }
    outboundCalls = [];

    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      ADMIN_API_TOKEN: 'admin',
      ENABLE_SIMULATOR: 'true',
      LLM_PROVIDER: 'scripted',
      WHATSAPP_ENABLED: 'true',
      META_GRAPH_VERSION: 'v21.0',
      WHATSAPP_ACCESS_TOKEN: 'access-token-secret',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      META_APP_SECRET: APP_SECRET,
      WHATSAPP_WEBHOOK_MAX_ATTEMPTS: '3',
      WHATSAPP_WEBHOOK_STALE_MS: '1000',
      CORS_ORIGIN: 'http://localhost:5173',
    });

    const whatsappClient = new WhatsAppClient({
      accessToken: config.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
      graphVersion: config.META_GRAPH_VERSION,
      maxRetries: 0,
      fetchImpl: (async (_url, init) => {
        const parsed = JSON.parse(String(init?.body)) as {
          to: string;
          text: { body: string };
        };
        outboundCalls.push({ to: parsed.to, body: parsed.text.body });
        return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT.${outboundCalls.length}` }] }), {
          status: 200,
        });
      }) as typeof fetch,
    });

    app = await buildApp({
      config,
      db: prisma,
      model: new ScriptedModelProvider(
        [
          {
            text: 'Got it. What address should we use?',
            toolCalls: [],
            finishReason: 'stop',
            model: 'scripted',
          },
        ],
        { env: { NODE_ENV: 'test' } },
      ),
      whatsappClient,
      startWorker: false,
      logger: false,
    });
  }

  it('verifies a valid webhook subscription challenge as plain text', async () => {
    await startWhatsAppApp();
    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE_TOKEN',
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.body).toBe('CHALLENGE_TOKEN');
  });

  it('rejects an invalid verification token without echoing secrets', async () => {
    await startWhatsAppApp();
    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE',
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(VERIFY_TOKEN);
    expect(response.json().error.code).toBe('INVALID_VERIFY_TOKEN');
  });

  it('accepts signed text webhooks, deduplicates, and processes through the durable worker', async () => {
    await startWhatsAppApp();
    const payload = textPayload('wamid.HTTP1', 'I need AC servicing');
    const raw = JSON.stringify(payload);
    const signature = createTestWhatsAppSignature(raw, APP_SECRET);

    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: raw,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, accepted: 1 });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: raw,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ ok: true, duplicates: 1 });

    const processed = await app.services.webhookInbox.processOne();
    expect(processed).toBe(true);

    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'msg:wamid.HTTP1' },
    });
    expect(event.status).toBe('PROCESSED');
    expect(outboundCalls.length).toBe(1);
    expect(outboundCalls[0]?.body).toMatch(/address/i);

    const inbound = await prisma.message.findUnique({
      where: { externalMessageId: 'wamid.HTTP1' },
    });
    expect(inbound?.direction).toBe('INBOUND');
  });

  it('rejects missing and invalid signatures when WhatsApp is enabled', async () => {
    await startWhatsAppApp();
    const raw = JSON.stringify(textPayload('wamid.SIG', 'hello'));

    const missing = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('MISSING_SIGNATURE');

    const invalid = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      payload: raw,
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.code).toBe('INVALID_SIGNATURE');
  });

  it('acknowledges status events without creating customer messages', async () => {
    await startWhatsAppApp();
    const beforeMessages = await prisma.message.count();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.STATUS_HTTP',
                    status: 'read',
                    recipient_id: '919811122233',
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': createTestWhatsAppSignature(raw, APP_SECRET),
      },
      payload: raw,
    });
    expect(response.statusCode).toBe(200);

    await app.services.webhookInbox.processOne();
    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'status:wamid.STATUS_HTTP:read' },
    });
    expect(event.status).toBe('PROCESSED');
    expect(event.eventType).toBe('status_event');
    expect(await prisma.message.count()).toBe(beforeMessages);
    expect(
      await prisma.message.count({
        where: { externalMessageId: 'wamid.STATUS_HTTP' },
      }),
    ).toBe(0);
  });
});
