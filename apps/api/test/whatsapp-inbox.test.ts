import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentOrchestrator } from '../src/agent/orchestrator.js';
import { ScriptedModelProvider } from '../src/agent/model/scripted-provider.js';
import type { PrismaClient } from '../src/db/client.js';
import { createAgentToolRegistry } from '../src/tools/index.js';
import { WhatsAppClient, WhatsAppClientError } from '../src/whatsapp/client.js';
import { WebhookInboxService } from '../src/whatsapp/inbox.js';
import { createTestDatabase } from './helpers/db.js';

describe('WhatsApp durable inbox worker', () => {
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  function createInbox(input?: {
    fetchImpl?: typeof fetch;
    responses?: Array<{ text: string; toolCalls: []; finishReason: 'stop'; model: string }>;
    maxAttempts?: number;
    staleProcessingMs?: number;
  }) {
    const model = new ScriptedModelProvider(
      input?.responses ?? [
        { text: 'How can I help?', toolCalls: [], finishReason: 'stop', model: 'scripted' },
      ],
      { env: { NODE_ENV: 'test' } },
    );
    const orchestrator = new AgentOrchestrator(prisma, model, createAgentToolRegistry(), {
      timeZone: 'Asia/Kolkata',
    });
    const whatsapp = new WhatsAppClient({
      accessToken: 'token',
      phoneNumberId: 'phone',
      graphVersion: 'v21.0',
      maxRetries: 0,
      fetchImpl:
        input?.fetchImpl ??
        ((async () =>
          new Response(
            JSON.stringify({ messages: [{ id: `wamid.OUT.${crypto.randomUUID()}` }] }),
            {
              status: 200,
            },
          )) as typeof fetch),
    });
    return new WebhookInboxService(prisma, orchestrator, whatsapp, {
      maxAttempts: input?.maxAttempts ?? 3,
      staleProcessingMs: input?.staleProcessingMs ?? 30,
      baseBackoffMs: 1,
      maxBackoffMs: 10,
    });
  }

  it('processes an enqueued text event through the orchestrator', async () => {
    const inbox = createInbox();
    await inbox.enqueueNormalizedEvents([
      {
        kind: 'text_message',
        externalKey: 'msg:wamid.WORKER1',
        externalMessageId: 'wamid.WORKER1',
        waId: '919800000001',
        profileName: 'Test User',
        text: 'Need AC help',
        timestamp: '1',
        phoneNumberId: 'PHONE',
        metadata: {},
      },
    ]);

    expect(await inbox.processOne()).toBe(true);
    const event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'msg:wamid.WORKER1' },
    });
    expect(event.status).toBe('PROCESSED');
    expect(await prisma.message.count({ where: { externalMessageId: 'wamid.WORKER1' } })).toBe(1);
  });

  it('retries transient delivery failures and eventually dead-letters permanent ones', async () => {
    let calls = 0;
    const transientInbox = createInbox({
      maxAttempts: 2,
      fetchImpl: (async () => {
        calls += 1;
        throw new WhatsAppClientError({
          message: 'timeout',
          code: 'WHATSAPP_TIMEOUT',
          retryable: true,
        });
      }) as typeof fetch,
    });

    await transientInbox.enqueueNormalizedEvents([
      {
        kind: 'text_message',
        externalKey: 'msg:wamid.RETRY1',
        externalMessageId: 'wamid.RETRY1',
        waId: '919800000002',
        profileName: null,
        text: 'Hello',
        timestamp: null,
        phoneNumberId: null,
        metadata: {},
      },
    ]);

    await transientInbox.processOne(new Date());
    let event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'msg:wamid.RETRY1' },
    });
    expect(event.status).toBe('FAILED');
    expect(event.attemptCount).toBe(1);
    expect(event.nextAttemptAt).toBeTruthy();

    await transientInbox.processOne(new Date(event.nextAttemptAt!.getTime() + 1));
    event = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'msg:wamid.RETRY1' },
    });
    expect(event.status).toBe('DEAD_LETTER');
    expect(calls).toBe(2);

    const permanentInbox = createInbox({
      maxAttempts: 5,
      fetchImpl: (async () => {
        throw new WhatsAppClientError({
          message: 'permission denied',
          code: 'META_10',
          statusCode: 403,
          retryable: false,
        });
      }) as typeof fetch,
    });

    await permanentInbox.enqueueNormalizedEvents([
      {
        kind: 'text_message',
        externalKey: 'msg:wamid.PERM1',
        externalMessageId: 'wamid.PERM1',
        waId: '919800000003',
        profileName: null,
        text: 'Hello',
        timestamp: null,
        phoneNumberId: null,
        metadata: {},
      },
    ]);

    await permanentInbox.processOne(new Date());
    const permanent = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'msg:wamid.PERM1' },
    });
    expect(permanent.status).toBe('DEAD_LETTER');
    expect(permanent.failureCode).toBe('META_10');
  });

  it('recovers stale PROCESSING events for retry', async () => {
    const inbox = createInbox({ staleProcessingMs: 20 });
    await prisma.webhookEvent.create({
      data: {
        externalKey: 'msg:wamid.STALE1',
        eventType: 'text_message',
        payload: {
          kind: 'text_message',
          externalKey: 'msg:wamid.STALE1',
          externalMessageId: 'wamid.STALE1',
          waId: '919800000004',
          profileName: null,
          text: 'Recover me',
          timestamp: null,
          phoneNumberId: null,
          metadata: {},
        },
        status: 'PROCESSING',
        attemptCount: 1,
        updatedAt: new Date(Date.now() - 1000),
      },
    });

    // Force updatedAt into the past (Prisma @updatedAt may overwrite on create).
    await prisma.$executeRaw`
      UPDATE "WebhookEvent"
      SET "updatedAt" = datetime('now', '-2 minutes')
      WHERE "externalKey" = 'msg:wamid.STALE1'
    `;

    const recovered = await inbox.recoverStaleProcessing(new Date());
    expect(recovered).toBe(1);

    const stale = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'msg:wamid.STALE1' },
    });
    expect(stale.status).toBe('FAILED');
    expect(stale.failureCode).toBe('STALE_PROCESSING');

    const processed = await inbox.processOne(new Date());
    expect(processed).toBe(true);
    const after = await prisma.webhookEvent.findUniqueOrThrow({
      where: { externalKey: 'msg:wamid.STALE1' },
    });
    expect(after.status).toBe('PROCESSED');
  });
});
