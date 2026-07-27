import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, ReadyResponseSchema } from '@sutradhar/contracts';

import { buildApp, type App } from '../../src/app.js';
import { ConfigurationError, loadConfig, loadTestConfig } from '../../src/config.js';
import { ScriptedModelProvider } from '../../src/agent/model/scripted-provider.js';
import type { PrismaClient } from '../../src/db/client.js';
import { maskWhatsAppNumber } from '../../src/http/privacy.js';
import { toPublicErrorBody } from '../../src/http/errors.js';
import { createTestDatabase } from '../helpers/db.js';

describe('Security and configuration', () => {
  let app: App;
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;
  let databaseUrl: string;

  beforeAll(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    databaseUrl = database.databaseUrl;

    const config = loadTestConfig({
      DATABASE_URL: databaseUrl,
      ADMIN_API_TOKEN: 'stage9-admin-token',
      CORS_ORIGIN: 'http://localhost:5173,http://127.0.0.1:5173',
      RATE_LIMIT_MAX: 200,
      BODY_LIMIT_BYTES: 2048,
    });

    app = await buildApp({
      config,
      db: prisma,
      model: new ScriptedModelProvider(
        [{ text: 'ok', toolCalls: [], finishReason: 'stop', model: 'scripted' }],
        { env: { NODE_ENV: 'test' } },
      ),
      logger: false,
      startWorker: false,
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (cleanup) {
      await cleanup();
    }
  });

  it('rejects WhatsApp credentials when WhatsApp is disabled but incomplete enablement fails', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        WHATSAPP_ENABLED: 'true',
        META_GRAPH_VERSION: '',
        WHATSAPP_ACCESS_TOKEN: '',
        WHATSAPP_PHONE_NUMBER_ID: '',
        WHATSAPP_VERIFY_TOKEN: '',
        META_APP_SECRET: '',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects insecure production startup without ADMIN_API_TOKEN', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl,
        ADMIN_API_TOKEN: '',
        WHATSAPP_ENABLED: 'false',
        LLM_PROVIDER: 'ollama',
      }),
    ).toThrow(/ADMIN_API_TOKEN/);
  });

  it('rejects scripted LLM provider in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl,
        ADMIN_API_TOKEN: 'prod-token-value',
        LLM_PROVIDER: 'scripted',
        WHATSAPP_ENABLED: 'false',
      }),
    ).toThrow(/scripted/);
  });

  it('sets security headers on responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBeDefined();
  });

  it('reflects allowlisted CORS origins and omits disallowed origins', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('assigns request ids and echoes them on errors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/operator/overview',
      headers: { 'x-request-id': 'req-stage9-fixed' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['x-request-id']).toBe('req-stage9-fixed');
    const body = ErrorEnvelopeSchema.parse(response.json());
    expect(body.error.requestId).toBe('req-stage9-fixed');
  });

  it('rejects oversized JSON bodies', async () => {
    const oversized = { text: 'x'.repeat(5000), customerKey: 'sim:size' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/simulator/messages',
      headers: { 'content-type': 'application/json' },
      payload: oversized,
    });
    expect(response.statusCode).toBe(413);
  });

  it('rejects unsupported content types on mutating routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/simulator/messages',
      headers: { 'content-type': 'text/html' },
      payload: '<html></html>',
    });
    expect(response.statusCode).toBe(415);
    const body = ErrorEnvelopeSchema.parse(response.json());
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('masks WhatsApp numbers for list privacy helpers', () => {
    expect(maskWhatsAppNumber('+919876543210')).toBe('••••3210');
    expect(maskWhatsAppNumber(null)).toBeNull();
  });

  it('redacts secrets from public error bodies', () => {
    const body = toPublicErrorBody({
      statusCode: 500,
      message: 'failed with token secret-value-abc and more',
      nodeEnv: 'development',
      secrets: ['secret-value-abc'],
      requestId: 'r1',
    });
    expect(body.error.message).toContain('[REDACTED]');
    expect(body.error.message).not.toContain('secret-value-abc');
  });

  it('GET /ready reports worker and ollama without failing WhatsApp-disabled local mode', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    const body = ReadyResponseSchema.parse(response.json());
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.worker.ok).toBe(true);
    expect(body.checks.worker.detail).toMatch(/disabled/i);
    expect(body.checks.ollama.ok).toBe(true);
    expect(body.checks.whatsapp.enabled).toBe(false);
    expect(body.checks.whatsapp.ok).toBe(true);
    expect(body.status === 'ready' || body.status === 'degraded').toBe(true);
  });

  it('masks WhatsApp numbers in operator list responses', async () => {
    const customer = await prisma.customer.create({
      data: {
        whatsappNumber: '+919811122233',
        name: null,
      },
    });
    await prisma.conversation.create({
      data: {
        customerId: customer.id,
        status: 'IDLE',
        structuredState: {},
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/operator/conversations',
      headers: { authorization: 'Bearer stage9-admin-token' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ customer: { whatsappNumber: string | null } }>;
    };
    const match = body.items.find((item) => item.customer.whatsappNumber === '••••2233');
    expect(match).toBeDefined();
    expect(body.items.some((item) => item.customer.whatsappNumber === '+919811122233')).toBe(
      false,
    );
  });
});
