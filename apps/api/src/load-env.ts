import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

/**
 * Load environment from apps/api/.env first, then repository-root .env.
 * Existing process.env values win over both files (dotenv default).
 * Root .env does not override keys already set by apps/api/.env.
 */
export function loadEnvFiles(): void {
  const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = path.resolve(apiRoot, '../..');

  loadDotenv({ path: path.join(apiRoot, '.env') });
  loadDotenv({ path: path.join(repoRoot, '.env') });
}

loadEnvFiles();
