import 'dotenv/config';

import { ConfigurationError, loadConfig } from './config.js';
import { buildApp } from './app.js';
import { databaseLifecycle } from './db/lifecycle.js';

async function start(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const message =
      error instanceof ConfigurationError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }

  databaseLifecycle.start(config.DATABASE_URL);
  const app = await buildApp({
    config,
    db: databaseLifecycle.prisma,
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');

    const forceExit = setTimeout(() => {
      app.log.error({ timeoutMs: config.SHUTDOWN_TIMEOUT_MS }, 'Shutdown timed out');
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref?.();

    try {
      await app.close();
      await databaseLifecycle.stop();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExit);
      app.log.error(
        {
          err: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        'Error during shutdown',
      );
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
    app.log.info(
      {
        port: config.PORT,
        host: config.HOST,
        whatsappEnabled: config.WHATSAPP_ENABLED,
        simulatorEnabled: config.ENABLE_SIMULATOR,
      },
      'API listening',
    );
  } catch (error) {
    app.log.error(
      {
        err: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      },
      'Failed to start API',
    );
    await databaseLifecycle.stop();
    process.exit(1);
  }
}

void start();
