import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrismaClient, type PrismaClient } from '../../src/db/client.js';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

function toSqliteUrl(dbPath: string): string {
  const normalized = path.resolve(dbPath).replace(/\\/g, '/');
  return `file:${normalized}`;
}

function resolvePrismaCli(): string {
  return require.resolve('prisma/build/index.js');
}

export async function createTestDatabase(): Promise<{
  prisma: PrismaClient;
  databaseUrl: string;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sutradhar-db-'));
  const dbPath = path.join(directory, 'test.db');
  const databaseUrl = toSqliteUrl(dbPath);

  execFileSync(process.execPath, [resolvePrismaCli(), 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: 'pipe',
  });

  const prisma = createPrismaClient(databaseUrl);

  return {
    prisma,
    databaseUrl,
    cleanup: async () => {
      await prisma.$disconnect();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
