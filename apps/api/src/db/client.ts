import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { PrismaClient } from '../generated/prisma/client.js';

export type { PrismaClient };

export function resolveDatabaseUrl(explicitUrl?: string): string {
  const url = explicitUrl ?? process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

export function createPrismaClient(databaseUrl = resolveDatabaseUrl()): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}
