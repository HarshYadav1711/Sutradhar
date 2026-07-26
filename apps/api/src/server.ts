import 'dotenv/config';

import { buildApp } from './app.js';
import { databaseLifecycle } from './db/lifecycle.js';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 4000;

async function start(): Promise<void> {
  databaseLifecycle.start();
  const app = await buildApp();
  const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const host = process.env.HOST ?? DEFAULT_HOST;

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${process.env.PORT ?? ''}`);
  }

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');

    try {
      await app.close();
      await databaseLifecycle.stop();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await app.listen({ port, host });
    app.log.info({ port, host }, 'API listening');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start API');
    await databaseLifecycle.stop();
    process.exit(1);
  }
}

void start();
