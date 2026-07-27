import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponseSchema, ReadyResponseSchema } from '@sutradhar/contracts';

import { buildApp, type App } from '../../src/app.js';
import { loadTestConfig } from '../../src/config.js';
import { ScriptedModelProvider } from '../../src/agent/model/scripted-provider.js';
import type { PrismaClient } from '../../src/db/client.js';
import { createTestDatabase } from '../helpers/db.js';

describe('GET /health and /ready', () => {
  let app: App;
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;

    const config = loadTestConfig({
      DATABASE_URL: database.databaseUrl,
      ADMIN_API_TOKEN: 'test-token',
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

  it('returns a valid health response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = HealthResponseSchema.parse(response.json());
    expect(body.service).toBe('sutradhar-api');
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('reports readiness checks including worker and ollama', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    const body = ReadyResponseSchema.parse(response.json());
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.worker).toBeDefined();
    expect(body.checks.ollama).toBeDefined();
    expect(body.checks.whatsapp.enabled).toBe(false);
  });
});
