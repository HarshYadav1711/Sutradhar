import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apiRoot, '../..');

loadDotenv({ path: path.join(apiRoot, '.env') });
loadDotenv({ path: path.join(repoRoot, '.env') });

// prisma generate must work without a local .env (CI, fresh clones).
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
