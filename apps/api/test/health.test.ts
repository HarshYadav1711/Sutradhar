import { afterAll, describe, expect, it } from 'vitest';

import { buildApp, type App } from '../src/app.js';
import { HealthResponseSchema } from '@sutradhar/contracts';

describe('GET /health', () => {
  let app: App;

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns a valid health response', async () => {
    app = await buildApp({ logger: false });

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
