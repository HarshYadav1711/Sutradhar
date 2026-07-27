import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DemoResetResponseSchema,
  ErrorEnvelopeSchema,
  OperatorBookingListResponseSchema,
  OperatorConversationDetailSchema,
  OperatorConversationListResponseSchema,
  OperatorConversationTraceSchema,
  OperatorHandoffDetailSchema,
  OperatorOverviewSchema,
  ReadyResponseSchema,
  SimulatorMessageResponseSchema,
} from '@sutradhar/contracts';

import { buildApp, type App } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { ScriptedModelProvider } from '../../src/agent/model/scripted-provider.js';
import type { ScriptedModelResponse } from '../../src/agent/model/scripted-provider.js';
import type { PrismaClient } from '../../src/db/client.js';
import { createTestDatabase } from '../helpers/db.js';
import { dateKeyInTimeZone, seedConversationFixture } from '../helpers/fixtures.js';

const NOW = new Date('2026-07-27T04:00:00.000Z');
const ADMIN_TOKEN = 'test-admin-token-stage6';

function textReply(text: string): ScriptedModelResponse {
  return {
    text,
    toolCalls: [],
    finishReason: 'stop',
    model: 'scripted',
  };
}

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id = `call_${name}`,
): ScriptedModelResponse {
  return {
    text: null,
    toolCalls: [{ id, name, arguments: args }],
    finishReason: 'tool_calls',
    model: 'scripted',
  };
}

describe('API integration', () => {
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;
  let databaseUrl: string;
  let app: App;

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

  async function startApp(input?: {
    enableSimulator?: boolean;
    adminToken?: string;
    responses?: ScriptedModelResponse[];
  }) {
    if (app) {
      await app.close();
    }

    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      ADMIN_API_TOKEN: input?.adminToken ?? ADMIN_TOKEN,
      ENABLE_SIMULATOR: String(input?.enableSimulator ?? true),
      LLM_PROVIDER: 'scripted',
      BUSINESS_TIMEZONE: 'Asia/Kolkata',
      BUSINESS_CURRENCY: 'INR',
      CORS_ORIGIN: 'http://localhost:5173',
      WHATSAPP_ENABLED: 'false',
    });

    const model = new ScriptedModelProvider(input?.responses ?? [textReply('Hello from simulator')], {
      env: { NODE_ENV: 'test' },
    });

    app = await buildApp({
      config,
      db: prisma,
      model,
      logger: false,
    });

    return app;
  }

  it('GET /ready reports database readiness without inventing analytics', async () => {
    await startApp({ responses: [textReply('ok')] });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    const body = ReadyResponseSchema.parse(response.json());
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.worker.ok).toBe(true);
    expect(body.checks.ollama.ok).toBe(true);
    expect(body.checks.simulator.enabled).toBe(true);
    expect(body.checks.whatsapp.enabled).toBe(false);
    expect(body.checks.whatsapp.ok).toBe(true);
  });

  it('returns 404 when simulator is disabled', async () => {
    await startApp({ enableSimulator: false });
    const response = await app.inject({
      method: 'POST',
      url: '/api/simulator/messages',
      payload: {
        customerKey: 'sim:disabled',
        text: 'hello',
      },
    });
    expect(response.statusCode).toBe(404);
    const body = ErrorEnvelopeSchema.parse(response.json());
    expect(body.error.code).toBe('SIMULATOR_DISABLED');
  });

  it('requires admin authentication for operator routes', async () => {
    await startApp();

    const missing = await app.inject({ method: 'GET', url: '/api/operator/overview' });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: '/api/operator/overview',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(wrong.statusCode).toBe(401);

    const unconfigured = await startApp({ adminToken: '' });
    const noTokenConfigured = await unconfigured.inject({
      method: 'GET',
      url: '/api/operator/overview',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(noTokenConfigured.statusCode).toBe(503);
    expect(ErrorEnvelopeSchema.parse(noTokenConfigured.json()).error.code).toBe(
      'ADMIN_TOKEN_UNCONFIGURED',
    );
  });

  it('supports simulator messaging, pagination, conversation detail, and private traces', async () => {
    const fixture = await seedConversationFixture(prisma, NOW);
    await startApp({
      responses: [
        textReply('Sure, what is the service address?'),
        toolCall('prepare_booking', {
          serviceId: fixture.service.id,
          availabilitySlotId: fixture.availableSlot.id,
          quantity: 1,
          address: 'Sector 62, Noida',
        }),
        textReply('Proposal ready. Reply yes to confirm.'),
      ],
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/simulator/messages',
      payload: {
        customerKey: fixture.customer.whatsappNumber,
        text: 'I need AC servicing tomorrow evening',
        startFresh: true,
      },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = SimulatorMessageResponseSchema.parse(first.json());
    expect(firstBody.outboundText).toMatch(/address/i);
    expect(JSON.stringify(firstBody)).not.toMatch(/AGENT_SYSTEM_INSTRUCTION|You are Sutradhar/i);

    const second = await app.inject({
      method: 'POST',
      url: '/api/simulator/messages',
      payload: {
        customerKey: fixture.customer.whatsappNumber,
        text: 'Sector 62, Noida',
      },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = SimulatorMessageResponseSchema.parse(second.json());
    expect(secondBody.conversationStatus).toBe('AWAITING_BOOKING_CONFIRMATION');

    const overview = await app.inject({
      method: 'GET',
      url: '/api/operator/overview',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(overview.statusCode).toBe(200);
    const overviewBody = OperatorOverviewSchema.parse(overview.json());
    expect(overviewBody.activeConversations).toBeGreaterThanOrEqual(1);
    expect(overviewBody.pendingActions).toBeGreaterThanOrEqual(1);
    expect(overviewBody.failedWebhookEvents).toBe(0);
    expect(overviewBody).not.toHaveProperty('trend');
    expect(overviewBody).not.toHaveProperty('conversionRate');

    const list = await app.inject({
      method: 'GET',
      url: '/api/operator/conversations?page=1&pageSize=1',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(list.statusCode).toBe(200);
    const listBody = OperatorConversationListResponseSchema.parse(list.json());
    expect(listBody.items).toHaveLength(1);
    expect(listBody.pagination.pageSize).toBe(1);
    expect(listBody.pagination.total).toBeGreaterThanOrEqual(1);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/operator/conversations/${secondBody.conversationId}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = OperatorConversationDetailSchema.parse(detail.json());
    expect(detailBody.messages.length).toBeGreaterThanOrEqual(2);
    expect(detailBody.pendingAction?.id).toBeTruthy();
    expect(JSON.stringify(detailBody)).not.toMatch(/You are Sutradhar|chain-of-thought|hidden reasoning/i);

    const trace = await app.inject({
      method: 'GET',
      url: `/api/operator/conversations/${secondBody.conversationId}/trace`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(trace.statusCode).toBe(200);
    const traceBody = OperatorConversationTraceSchema.parse(trace.json());
    expect(traceBody.operationalEvents.length).toBeGreaterThan(0);
    expect(traceBody.toolExecutions.some((row) => row.toolName === 'prepare_booking')).toBe(true);
    expect(JSON.stringify(traceBody)).not.toMatch(/OLLAMA|ACCESS_TOKEN|systemInstruction|You are Sutradhar/i);
    expect(traceBody.toolExecutions.every((row) => !('validatedInput' in row))).toBe(true);
    expect(traceBody.toolExecutions.every((row) => !('output' in row))).toBe(true);

    const bookings = await app.inject({
      method: 'GET',
      url: '/api/operator/bookings?page=1&pageSize=10&status=CONFIRMED',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(bookings.statusCode).toBe(200);
    OperatorBookingListResponseSchema.parse(bookings.json());
  });

  it('updates handoff status through the operator API', async () => {
    const fixture = await seedConversationFixture(prisma, NOW);
    await startApp({
      responses: [
        toolCall('create_handoff', {
          reason: 'Customer requested a refund',
          summary: 'Refund request from simulator integration test',
          priority: 'HIGH',
        }),
        textReply('Escalated to a teammate. No refund approved.'),
      ],
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/simulator/messages',
      payload: {
        customerKey: fixture.customer.whatsappNumber,
        text: 'I want a refund for the last visit',
        startFresh: true,
      },
    });
    expect(created.statusCode).toBe(200);
    const createdBody = SimulatorMessageResponseSchema.parse(created.json());
    expect(createdBody.handoffId).toBeTruthy();

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/operator/handoffs/${createdBody.handoffId}`,
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { status: 'IN_PROGRESS' },
    });
    expect(patched.statusCode).toBe(200);
    const patchedBody = OperatorHandoffDetailSchema.parse(patched.json());
    expect(patchedBody.status).toBe('IN_PROGRESS');
    expect(patchedBody.reference).toBe(createdBody.handoffReference);
  });

  it('resets demo data without destroying migrations', async () => {
    await seedConversationFixture(prisma, NOW);
    await startApp({ responses: [textReply('reset path')] });

    const beforeServices = await prisma.service.count();
    expect(beforeServices).toBeGreaterThan(0);

    const reset = await app.inject({
      method: 'POST',
      url: '/api/simulator/reset',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(reset.statusCode).toBe(200);
    const resetBody = DemoResetResponseSchema.parse(reset.json());
    expect(resetBody.ok).toBe(true);
    expect(resetBody.serviceCount).toBe(5);
    expect(resetBody.slotCount).toBeGreaterThan(0);

    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.booking.count()).toBe(0);
    expect(await prisma.service.count()).toBe(5);

    const futureSlots = await prisma.availabilitySlot.count({
      where: { startsAt: { gt: new Date() } },
    });
    expect(futureSlots).toBeGreaterThan(0);

    // Ensure a slot date key remains usable after reset.
    const slot = await prisma.availabilitySlot.findFirstOrThrow({
      where: { status: 'AVAILABLE' },
      orderBy: { startsAt: 'asc' },
    });
    expect(dateKeyInTimeZone(slot.startsAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects oversized simulator payloads', async () => {
    await startApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/simulator/messages',
      payload: {
        customerKey: 'sim:size',
        text: 'x'.repeat(4001),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
