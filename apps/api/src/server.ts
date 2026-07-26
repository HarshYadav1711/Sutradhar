import 'dotenv/config';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { databaseLifecycle } from './db/lifecycle.js';

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  databaseLifecycle.start(config.DATABASE_URL);
  const app = await buildApp({
    config,
    db: databaseLifecycle.prisma,
    logger: { level: config.LOG_LEVEL },
  });

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
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info({ port: config.PORT, host: config.HOST }, 'API listening');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start API');
    await databaseLifecycle.stop();
    process.exit(1);
  }
}

void start();
