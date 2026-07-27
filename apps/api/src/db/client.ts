import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { PrismaClient } from '../generated/prisma/client.js';

export type { PrismaClient };

export function resolveDatabaseUrl(explicitUrl: string): string {
  if (!explicitUrl || explicitUrl.trim() === '') {
    throw new Error('DATABASE_URL is required — pass it from loadConfig()');
  }
  return explicitUrl;
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: resolveDatabaseUrl(databaseUrl) });
  return new PrismaClient({ adapter });
}
