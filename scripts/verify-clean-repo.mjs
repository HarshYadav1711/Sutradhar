#!/usr/bin/env node
/**
 * Clean-repository verification for Sutradhar.
 * Checks tracked-file hygiene. Does not claim the repository is "secure" or "production-ready".
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_ENV_EXAMPLE_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'BUSINESS_TIMEZONE',
  'BUSINESS_CURRENCY',
  'CORS_ORIGIN',
  'ADMIN_API_TOKEN',
  'ENABLE_SIMULATOR',
  'LLM_PROVIDER',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'WHATSAPP_ENABLED',
  'META_GRAPH_VERSION',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'META_APP_SECRET',
];

/** Patterns that look like real committed secrets (not empty placeholders). */
const OBVIOUS_SECRET_PATTERNS = [
  { name: 'OpenAI-style key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub PAT', regex: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

const SKIP_PATH_FRAGMENTS = [
  'node_modules/',
  'coverage/',
  'dist/',
  '.git/',
  'package-lock.json',
  'apps/api/src/generated/',
];

function gitTrackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.split('\0').filter((value) => value.length > 0);
  } catch {
    // Not a git checkout (or git unavailable): fall back to scanning known sensitive paths only.
    return [];
  }
}

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
}

function ok(message) {
  process.stdout.write(`OK: ${message}\n`);
}

function main() {
  let failures = 0;
  const tracked = gitTrackedFiles();

  const trackedEnv = tracked.filter(
    (file) =>
      /(^|\/)\.env$/.test(file) ||
      (/(^|\/)\.env\./.test(file) && !file.endsWith('.example')),
  );
  if (trackedEnv.length > 0) {
    failures += 1;
    fail(`.env files must not be tracked: ${trackedEnv.join(', ')}`);
  } else {
    ok('No tracked .env files');
  }

  const examplePath = path.join(root, '.env.example');
  if (!existsSync(examplePath)) {
    failures += 1;
    fail('.env.example is missing');
  } else {
    const example = readFileSync(examplePath, 'utf8');
    const missing = REQUIRED_ENV_EXAMPLE_KEYS.filter((key) => {
      const pattern = new RegExp(`^${key}=`, 'm');
      return !pattern.test(example);
    });
    if (missing.length > 0) {
      failures += 1;
      fail(`.env.example missing keys: ${missing.join(', ')}`);
    } else {
      ok(`.env.example includes ${REQUIRED_ENV_EXAMPLE_KEYS.length} required keys`);
    }
  }

  const scanTargets =
    tracked.length > 0
      ? tracked.filter(
          (file) =>
            !SKIP_PATH_FRAGMENTS.some((fragment) => file.includes(fragment)) &&
            !file.endsWith('.png') &&
            !file.endsWith('.jpg') &&
            !file.endsWith('.db'),
        )
      : ['.env.example', 'AGENTS.md', 'package.json'];

  const hits = [];
  for (const relative of scanTargets) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) {
      continue;
    }
    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of OBVIOUS_SECRET_PATTERNS) {
      if (pattern.regex.test(content)) {
        hits.push(`${relative} (${pattern.name})`);
      }
    }
  }

  if (hits.length > 0) {
    failures += 1;
    fail(`Obvious secret-like material found in tracked files:\n  - ${hits.join('\n  - ')}`);
  } else {
    ok('No obvious committed secret patterns detected in scanned tracked files');
  }

  process.stdout.write(
    '\nThis script checks repository hygiene only. Passing does not mean the application is secure or production-ready.\n',
  );

  if (failures > 0) {
    process.exitCode = 1;
    process.stderr.write(`\nClean-repo verification failed with ${failures} issue(s).\n`);
    return;
  }

  process.stdout.write('\nClean-repo verification passed.\n');
}

main();
