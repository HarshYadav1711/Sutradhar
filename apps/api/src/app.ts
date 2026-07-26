import Fastify from 'fastify';

import { registerHealthRoute } from './routes/health.js';

export type BuildAppOptions = {
  logger?: boolean | { level?: string };
};

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger:
      options.logger === undefined
        ? {
            level: process.env.LOG_LEVEL ?? 'info',
          }
        : options.logger,
  });

  await registerHealthRoute(app);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
