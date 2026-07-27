/**
 * Explicit safety and integration regression suite.
 * Uses isolated SQLite and ScriptedModelProvider (not the product LLM path).
 */
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentOrchestrator } from '../../src/agent/orchestrator.js';
import { ScriptedModelProvider } from '../../src/agent/model/scripted-provider.js';
import type { ScriptedModelResponse } from '../../src/agent/model/scripted-provider.js';
import { buildApp, type App } from '../../src/app.js';
import { loadTestConfig } from '../../src/config.js';
import { ConfirmationPolicy } from '../../src/domain/confirmation-policy.js';
import { DomainExpiredError } from '../../src/domain/errors.js';
import { PendingActionExecutor } from '../../src/domain/pending-action-executor.js';
import type { PrismaClient } from '../../src/db/client.js';
import { createAgentToolRegistry } from '../../src/tools/index.js';
import { WhatsAppClient } from '../../src/whatsapp/client.js';
import { createTestDatabase } from '../helpers/db.js';
import { dateKeyInTimeZone, seedConversationFixture } from '../helpers/fixtures.js';
import { textReply, toolCall } from '../helpers/scripted.js';

const NOW = new Date('2026-07-27T04:00:00.000Z');
const ADMIN_TOKEN = 'regression-admin-token';
const APP_SECRET = 'regression-meta-app-secret';

describe('Safety regressions', () => {
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;
  let databaseUrl: string;

  beforeAll(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    databaseUrl = database.databaseUrl;
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  async function createOrchestrator(
    responses: ScriptedModelResponse[] | ((fx: Awaited<ReturnType<typeof seedConversationFixture>>) => ScriptedModelResponse[]),
  ) {
    const fixture = await seedConversationFixture(prisma, NOW);
    const queue = typeof responses === 'function' ? responses(fixture) : responses;
    const provider = new ScriptedModelProvider(queue, { env: { NODE_ENV: 'test' } });
    const orchestrator = new AgentOrchestrator(prisma, provider, createAgentToolRegistry(), {
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
    });
    return { fixture, orchestrator, provider };
  }

  it('1. booking is not persisted after prepare_booking', async () => {
    const fixture = await seedConversationFixture(prisma, NOW);
    const before = await prisma.booking.count();
    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );
    expect(prepared.ok).toBe(true);
    expect(await prisma.booking.count()).toBe(before);
    expect(await prisma.pendingAction.count({ where: { status: 'PENDING' } })).toBeGreaterThan(0);
  });

  it('2. booking is persisted after explicit confirmation', async () => {
    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposed. Reply yes to confirm.'),
    ]);

    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Book AC servicing',
      externalMessageId: 'wamid.S10_2A',
      now: NOW,
      channel: 'test',
    });
    expect(await prisma.booking.count({ where: { customerId: fixture.customer.id } })).toBe(0);

    const confirmed = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'yes',
      externalMessageId: 'wamid.S10_2B',
      now: NOW,
      channel: 'test',
    });
    expect(confirmed.bookingReference).toMatch(/^BK-/);
    expect(await prisma.booking.count({ where: { customerId: fixture.customer.id } })).toBe(1);
  });

  it('3. the same confirmation cannot create two bookings', async () => {
    const fixture = await seedConversationFixture(prisma, NOW);
    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.errorMessage);
    }
    const pendingActionId = (prepared.data as { pendingActionId: string }).pendingActionId;
    const inbound = await prisma.message.create({
      data: {
        conversationId: fixture.conversation.id,
        direction: 'INBOUND',
        messageType: 'TEXT',
        content: 'yes',
        externalMessageId: 'wamid.S10_3',
      },
    });
    const executor = new PendingActionExecutor(prisma, { timeZone: 'Asia/Kolkata' });
    const first = await executor.commit({
      pendingActionId,
      confirmationMessageId: inbound.id,
      now: NOW,
    });
    expect(first.booking.reference).toMatch(/^BK-/);

    await expect(
      executor.commit({
        pendingActionId,
        confirmationMessageId: inbound.id,
        now: NOW,
      }),
    ).rejects.toThrow();
    expect(await prisma.booking.count({ where: { customerId: fixture.customer.id } })).toBe(1);
  });

  it('4. "Maybe" does not confirm', async () => {
    expect(new ConfirmationPolicy().evaluate('Maybe')).toBe('AMBIGUOUS');

    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposed. Reply yes to confirm.'),
    ]);
    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Book it',
      externalMessageId: 'wamid.S10_4A',
      now: NOW,
      channel: 'test',
    });
    const maybe = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Maybe',
      externalMessageId: 'wamid.S10_4B',
      now: NOW,
      channel: 'test',
    });
    expect(maybe.bookingId).toBeNull();
    expect(await prisma.booking.count({ where: { customerId: fixture.customer.id } })).toBe(0);
    expect(maybe.outboundText).toMatch(/yes|confirm|haan/i);
  });

  it('5. "Haan, kar do" confirms', async () => {
    expect(new ConfirmationPolicy().evaluate('Haan, kar do')).toBe('CONFIRMED');

    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposal ready.'),
    ]);
    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'AC servicing chahiye',
      externalMessageId: 'wamid.S10_5A',
      now: NOW,
      channel: 'test',
    });
    const confirmed = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Haan, kar do',
      externalMessageId: 'wamid.S10_5B',
      now: NOW,
      channel: 'test',
    });
    expect(confirmed.bookingReference).toMatch(/^BK-/);
  });

  it('6. "Nahi, cancel" cancels', async () => {
    expect(new ConfirmationPolicy().evaluate('Nahi, cancel')).toBe('REJECTED');

    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposal ready.'),
    ]);
    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Book AC',
      externalMessageId: 'wamid.S10_6A',
      now: NOW,
      channel: 'test',
    });
    const cancelled = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Nahi, cancel',
      externalMessageId: 'wamid.S10_6B',
      now: NOW,
      channel: 'test',
    });
    expect(cancelled.bookingId).toBeNull();
    expect(await prisma.booking.count({ where: { customerId: fixture.customer.id } })).toBe(0);
    const pending = await prisma.pendingAction.findFirst({
      where: { conversationId: cancelled.conversationId },
      orderBy: { createdAt: 'desc' },
    });
    expect(pending?.status).toBe('CANCELLED');
  });

  it('7. an expired pending action cannot commit', async () => {
    const fixture = await seedConversationFixture(prisma, NOW);
    const prepared = await fixture.registry.execute(
      'prepare_booking',
      {
        serviceId: fixture.service.id,
        availabilitySlotId: fixture.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      },
      fixture.context,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) {
      throw new Error(prepared.errorMessage);
    }
    const pendingActionId = (prepared.data as { pendingActionId: string }).pendingActionId;
    await prisma.pendingAction.update({
      where: { id: pendingActionId },
      data: { expiresAt: new Date(NOW.getTime() - 60_000) },
    });
    const inbound = await prisma.message.create({
      data: {
        conversationId: fixture.conversation.id,
        direction: 'INBOUND',
        messageType: 'TEXT',
        content: 'yes',
        externalMessageId: 'wamid.S10_7',
      },
    });
    const executor = new PendingActionExecutor(prisma, { timeZone: 'Asia/Kolkata' });
    await expect(
      executor.commit({
        pendingActionId,
        confirmationMessageId: inbound.id,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DomainExpiredError);
    expect(await prisma.booking.count({ where: { customerId: fixture.customer.id } })).toBe(0);
  });

  it('8. rescheduling requires confirmation', async () => {
    const { fixture, orchestrator } = await createOrchestrator((fx) => [
      toolCall('prepare_booking', {
        serviceId: fx.service.id,
        availabilitySlotId: fx.availableSlot.id,
        quantity: 1,
        address: 'Sector 62, Noida',
      }),
      textReply('Proposed.'),
      toolCall('prepare_reschedule', {
        bookingId: 'REPLACE',
        newAvailabilitySlotId: fx.alternativeSlot.id,
      }),
      textReply('Reschedule proposed.'),
    ]);

    await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Book AC',
      externalMessageId: 'wamid.S10_8A',
      now: NOW,
      channel: 'test',
    });
    const booked = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'yes',
      externalMessageId: 'wamid.S10_8B',
      now: NOW,
      channel: 'test',
    });
    expect(booked.bookingId).toBeTruthy();

    // Rebuild orchestrator with reschedule script using the real booking id.
    const provider = new ScriptedModelProvider(
      [
        toolCall('prepare_reschedule', {
          bookingId: booked.bookingId!,
          newAvailabilitySlotId: fixture.alternativeSlot.id,
        }),
        textReply('Reschedule proposed. Reply yes to confirm.'),
      ],
      { env: { NODE_ENV: 'test' } },
    );
    const rescheduleOrchestrator = new AgentOrchestrator(
      prisma,
      provider,
      createAgentToolRegistry(),
      { timeZone: 'Asia/Kolkata', currency: 'INR' },
    );

    const proposed = await rescheduleOrchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Actually make it 7',
      externalMessageId: 'wamid.S10_8C',
      now: NOW,
      channel: 'test',
    });
    expect(proposed.conversationStatus).toBe('AWAITING_RESCHEDULE_CONFIRMATION');
    const bookingBefore = await prisma.booking.findUniqueOrThrow({
      where: { id: booked.bookingId! },
    });
    expect(bookingBefore.availabilitySlotId).toBe(fixture.availableSlot.id);

    const confirmed = await rescheduleOrchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'confirm it',
      externalMessageId: 'wamid.S10_8D',
      now: NOW,
      channel: 'test',
    });
    expect(confirmed.conversationStatus).toBe('BOOKED');
    const bookingAfter = await prisma.booking.findUniqueOrThrow({
      where: { id: booked.bookingId! },
    });
    expect(bookingAfter.availabilitySlotId).toBe(fixture.alternativeSlot.id);
  });

  it('9. a complaint creates a handoff', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => [
      toolCall('create_handoff', {
        reason: 'complaint',
        summary: 'Technician damaged the AC and nobody responded.',
        priority: 'HIGH',
      }),
      textReply('I have escalated this to a teammate. They will follow up.'),
    ]);
    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'The last technician damaged my AC and nobody responded.',
      externalMessageId: 'wamid.S10_9',
      now: NOW,
      channel: 'test',
    });
    expect(result.outcome).toBe('HUMAN_HANDOFF');
    expect(result.handoffId).toBeTruthy();
  });

  it('10. a refund request creates a handoff without approval language', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => [
      toolCall('create_handoff', {
        reason: 'refund',
        summary: 'Customer wants a refund for a prior visit.',
        priority: 'HIGH',
      }),
      textReply(
        'I cannot approve a refund here. I have created a handoff so a teammate can review it.',
      ),
    ]);
    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'I want a refund.',
      externalMessageId: 'wamid.S10_10',
      now: NOW,
      channel: 'test',
    });
    expect(result.outcome).toBe('HUMAN_HANDOFF');
    expect(result.outboundText).not.toMatch(/refund (approved|processed|issued)/i);
    expect(result.outboundText).toMatch(/cannot approve|teammate|handoff/i);
    const handoff = await prisma.humanHandoff.findUniqueOrThrow({
      where: { id: result.handoffId! },
    });
    expect(handoff.reason.toLowerCase()).toMatch(/refund/);
  });

  it('11. missing availability returns stored alternatives', async () => {
    const fixture = await seedConversationFixture(prisma, NOW);
    const result = await fixture.registry.execute(
      'check_availability',
      {
        serviceId: fixture.service.id,
        date: dateKeyInTimeZone(fixture.unavailableSlot.startsAt),
        timePreference: 'afternoon',
      },
      fixture.context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errorMessage);
    }
    const data = result.data as {
      matched: unknown[];
      alternatives: Array<{ id: string; status: string }>;
    };
    expect(data.matched).toEqual([]);
    expect(data.alternatives.length).toBeGreaterThan(0);
    expect(data.alternatives.every((slot) => slot.status === 'AVAILABLE')).toBe(true);
    const knownIds = new Set(
      (
        await prisma.availabilitySlot.findMany({
          where: { serviceId: fixture.service.id, status: 'AVAILABLE' },
          select: { id: true },
        })
      ).map((slot) => slot.id),
    );
    expect(data.alternatives.every((slot) => knownIds.has(slot.id))).toBe(true);
  });

  it('12. tool results are logged', async () => {
    const fixture = await seedConversationFixture(prisma, NOW);
    const before = await prisma.toolExecution.count({
      where: { conversationId: fixture.conversation.id },
    });
    await fixture.registry.execute('search_services', { query: 'ac' }, fixture.context);
    const after = await prisma.toolExecution.findMany({
      where: { conversationId: fixture.conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.toolName).toBe('search_services');
    expect(after[0]?.status).toBe('SUCCESS');
    expect(after[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(await prisma.toolExecution.count({ where: { conversationId: fixture.conversation.id } })).toBe(
      before + 1,
    );
  });

  it('13. maximum agent iterations are enforced', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => [
      toolCall('search_services', { query: 'ac' }, 's1'),
      toolCall('search_services', { query: 'ac' }, 's2'),
      toolCall('search_services', { query: 'ac' }, 's3'),
      toolCall('search_services', { query: 'ac' }, 's4'),
      toolCall('search_services', { query: 'ac' }, 's5'),
      textReply('should not run'),
    ]);
    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Find AC',
      externalMessageId: 'wamid.S10_13',
      now: NOW,
      channel: 'test',
    });
    expect(result.outcome).toBe('CONTROLLED_FAILURE');
    expect(result.stepsUsed).toBe(5);
    expect(
      result.operationalEvents.some((event) => event.eventType === 'MAX_AGENT_STEPS_REACHED'),
    ).toBe(true);
  });

  it('14. provider failure produces an honest controlled response', async () => {
    const { fixture, orchestrator } = await createOrchestrator(() => []);
    const result = await orchestrator.processMessage({
      customerKey: fixture.customer.whatsappNumber!,
      text: 'Need service',
      externalMessageId: 'wamid.S10_14',
      now: NOW,
      channel: 'test',
    });
    expect(result.outcome).toBe('CONTROLLED_FAILURE');
    expect(result.outboundText).toMatch(/could not|try again|unable/i);
    expect(
      result.operationalEvents.some((event) => event.eventType === 'MODEL_PROVIDER_FAILURE'),
    ).toBe(true);
  });

  describe('webhook and API regressions', () => {
    let app: App | undefined;

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('15. duplicate webhook events are acknowledged but processed once', async () => {
      const outbound: string[] = [];
      const config = loadTestConfig({
        DATABASE_URL: databaseUrl,
        ADMIN_API_TOKEN: ADMIN_TOKEN,
        WHATSAPP_ENABLED: true,
        META_GRAPH_VERSION: 'v21.0',
        WHATSAPP_ACCESS_TOKEN: 'token',
        WHATSAPP_PHONE_NUMBER_ID: 'phone',
        WHATSAPP_VERIFY_TOKEN: 'verify',
        META_APP_SECRET: APP_SECRET,
        WHATSAPP_WEBHOOK_MAX_ATTEMPTS: 3,
      });
      const whatsappClient = new WhatsAppClient({
        accessToken: 'token',
        phoneNumberId: 'phone',
        graphVersion: 'v21.0',
        maxRetries: 0,
        fetchImpl: (async (_url, init) => {
          const body = JSON.parse(String(init?.body)) as { text: { body: string } };
          outbound.push(body.text.body);
          return new Response(JSON.stringify({ messages: [{ id: `out-${outbound.length}` }] }), {
            status: 200,
          });
        }) as typeof fetch,
      });
      if (app) {
        await app.close();
      }
      app = await buildApp({
        config,
        db: prisma,
        model: new ScriptedModelProvider([textReply('Got your request.')], {
          env: { NODE_ENV: 'test' },
        }),
        whatsappClient,
        logger: false,
        startWorker: false,
      });

      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'E',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'phone' },
                  contacts: [{ profile: { name: 'A' }, wa_id: '919800011122' }],
                  messages: [
                    {
                      from: '919800011122',
                      id: 'wamid.S10_DUP',
                      timestamp: '1700000000',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      const signature = `sha256=${createHmac('sha256', APP_SECRET).update(payload).digest('hex')}`;

      const first = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        payload,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        payload,
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ ok: true, accepted: 1 });
      expect(second.json()).toMatchObject({ ok: true, accepted: 0, duplicates: 1 });

      await app.services.webhookInbox.processOne();
      await app.services.webhookInbox.processOne();
      const events = await prisma.webhookEvent.findMany({
        where: { externalKey: 'msg:wamid.S10_DUP' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.status).toBe('PROCESSED');
    });

    it('16. invalid webhook signatures are rejected', async () => {
      const config = loadTestConfig({
        DATABASE_URL: databaseUrl,
        ADMIN_API_TOKEN: ADMIN_TOKEN,
        WHATSAPP_ENABLED: true,
        META_GRAPH_VERSION: 'v21.0',
        WHATSAPP_ACCESS_TOKEN: 'token',
        WHATSAPP_PHONE_NUMBER_ID: 'phone',
        WHATSAPP_VERIFY_TOKEN: 'verify',
        META_APP_SECRET: APP_SECRET,
      });
      if (app) {
        await app.close();
      }
      app = await buildApp({
        config,
        db: prisma,
        model: new ScriptedModelProvider([textReply('unused')], { env: { NODE_ENV: 'test' } }),
        whatsappClient: null,
        logger: false,
        startWorker: false,
      });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=deadbeef',
        },
        payload: { object: 'whatsapp_business_account', entry: [] },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_SIGNATURE' } });
    });

    it('17. transient Meta failures are retried within limits', async () => {
      let attempts = 0;
      const client = new WhatsAppClient({
        accessToken: 'token',
        phoneNumberId: 'phone',
        graphVersion: 'v21.0',
        maxRetries: 2,
        fetchImpl: (async () => {
          attempts += 1;
          if (attempts < 3) {
            return new Response(JSON.stringify({ error: { message: 'rate limit', code: 4 } }), {
              status: 429,
            });
          }
          return new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] }), { status: 200 });
        }) as typeof fetch,
      });
      const result = await client.sendText({ to: '9198', body: 'hi' });
      expect(result.messageId).toBe('wamid.OK');
      expect(attempts).toBe(3);
    });

    it('18. permanent Meta failures are not retried indefinitely', async () => {
      let attempts = 0;
      const client = new WhatsAppClient({
        accessToken: 'token',
        phoneNumberId: 'phone',
        graphVersion: 'v21.0',
        maxRetries: 5,
        fetchImpl: (async () => {
          attempts += 1;
          return new Response(
            JSON.stringify({
              error: { message: 'permission denied', type: 'OAuthException', code: 190 },
            }),
            { status: 401 },
          );
        }) as typeof fetch,
      });
      await expect(client.sendText({ to: '9198', body: 'hi' })).rejects.toMatchObject({
        retryable: false,
      });
      expect(attempts).toBe(1);
    });

    it('19. operator APIs require authentication', async () => {
      const config = loadTestConfig({
        DATABASE_URL: databaseUrl,
        ADMIN_API_TOKEN: ADMIN_TOKEN,
      });
      if (app) {
        await app.close();
      }
      app = await buildApp({
        config,
        db: prisma,
        model: new ScriptedModelProvider([textReply('ok')], { env: { NODE_ENV: 'test' } }),
        logger: false,
        startWorker: false,
      });
      const missing = await app.inject({ method: 'GET', url: '/api/operator/overview' });
      expect(missing.statusCode).toBe(401);
      const wrong = await app.inject({
        method: 'GET',
        url: '/api/operator/overview',
        headers: { authorization: 'Bearer wrong' },
      });
      expect(wrong.statusCode).toBe(401);
      const ok = await app.inject({
        method: 'GET',
        url: '/api/operator/overview',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(ok.statusCode).toBe(200);
    });

    it('20. operational trace never contains the system prompt or hidden reasoning', async () => {
      const fixture = await seedConversationFixture(prisma, NOW);
      const config = loadTestConfig({
        DATABASE_URL: databaseUrl,
        ADMIN_API_TOKEN: ADMIN_TOKEN,
      });
      if (app) {
        await app.close();
      }
      app = await buildApp({
        config,
        db: prisma,
        model: new ScriptedModelProvider([textReply('What is the address?')], {
          env: { NODE_ENV: 'test' },
        }),
        logger: false,
        startWorker: false,
      });

      const sim = await app.inject({
        method: 'POST',
        url: '/api/simulator/messages',
        payload: {
          customerKey: fixture.customer.whatsappNumber,
          text: 'Need AC servicing',
          startFresh: true,
        },
      });
      expect(sim.statusCode).toBe(200);
      const conversationId = (sim.json() as { conversationId: string }).conversationId;

      const trace = await app.inject({
        method: 'GET',
        url: `/api/operator/conversations/${conversationId}/trace`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(trace.statusCode).toBe(200);
      const body = JSON.stringify(trace.json());
      expect(body).not.toMatch(/You are Sutradhar/i);
      expect(body).not.toMatch(/systemInstruction/i);
      expect(body).not.toMatch(/chain[- ]of[- ]thought|hidden reasoning|<think>/i);
      expect(trace.json()).not.toHaveProperty('prompt');
      expect(trace.json()).not.toHaveProperty('systemPrompt');
    });
  });
});
