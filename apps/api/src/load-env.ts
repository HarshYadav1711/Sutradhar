import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

/**
 * Load environment from apps/api/.env first, then repository-root .env.
 *
 * apps/api/.env overrides existing process env in non-production so a developer
 * .env file wins over stale shell exports. Root .env only fills missing keys.
 * In production, real process environment always wins (no override).
 */
export function loadEnvFiles(): void {
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = path.resolve(apiRoot, '../..');
  const apiEnvPath = path.join(apiRoot, '.env');
  const rootEnvPath = path.join(repoRoot, '.env');

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const allowOverride = nodeEnv !== 'production';

  loadDotenv({ path: apiEnvPath, override: allowOverride });
  loadDotenv({ path: rootEnvPath, override: false });
}

loadEnvFiles();
