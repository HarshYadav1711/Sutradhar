import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '@sutradhar/contracts';

import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ScriptedModelProvider } from '../src/agent/model/scripted-provider.js';
import type { PrismaClient } from '../src/db/client.js';
import { createTestDatabase } from './helpers/db.js';

describe('GET /health', () => {
  let app: App;
  let prisma: PrismaClient;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;

    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: database.databaseUrl,
      ADMIN_API_TOKEN: 'test-token',
      ENABLE_SIMULATOR: 'true',
      LLM_PROVIDER: 'scripted',
      WHATSAPP_ENABLED: 'false',
      CORS_ORIGIN: 'http://localhost:5173',
    });

    app = await buildApp({
      config,
      db: prisma,
      model: new ScriptedModelProvider(
        [{ text: 'ok', toolCalls: [], finishReason: 'stop', model: 'scripted' }],
        { env: { NODE_ENV: 'test' } },
      ),
      logger: false,
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
});
