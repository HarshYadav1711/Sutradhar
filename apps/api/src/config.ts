import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

const nonEmptyString = z.string().trim().min(1);

/**
 * Validated application configuration.
 * Optional features (WhatsApp, scripted LLM) are validated only when enabled.
 * Secrets have no insecure built-in defaults.
 */
const AppConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: nonEmptyString,
    BUSINESS_TIMEZONE: nonEmptyString.default('Asia/Kolkata'),
    BUSINESS_CURRENCY: nonEmptyString.default('INR'),
    CORS_ORIGIN: nonEmptyString.default('http://localhost:5173'),
    /** Empty means operator APIs refuse requests (503). Never defaults to a shared secret. */
    ADMIN_API_TOKEN: z.string().default(''),
    ENABLE_SIMULATOR: booleanFromEnv.default(true),
    LLM_PROVIDER: z.enum(['ollama', 'scripted']).default('ollama'),
    OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
    OLLAMA_MODEL: nonEmptyString.default('qwen3:4b'),
    OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
    WHATSAPP_ENABLED: booleanFromEnv.default(false),
    META_GRAPH_VERSION: z.string().optional().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
    META_APP_SECRET: z.string().optional().default(''),
    WHATSAPP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    WHATSAPP_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    WHATSAPP_WEBHOOK_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    WHATSAPP_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    WHATSAPP_WEBHOOK_STALE_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
    WHATSAPP_WEBHOOK_BASE_BACKOFF_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    WHATSAPP_WEBHOOK_MAX_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(3_600_000)
      .default(300_000),
    /** SQLite-safe default: process one webhook event at a time. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
    PENDING_ACTION_EXPIRY_SWEEP_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(1024 * 1024).default(32 * 1024),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
    LOG_LEVEL: nonEmptyString.default('info'),
    SIMULATOR_CUSTOMER_KEY: z.string().optional().default(''),
  })
  .superRefine((config, ctx) => {
    if (config.LLM_PROVIDER === 'scripted' && config.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'LLM_PROVIDER=scripted is not allowed in production',
      });
    }

    if (config.NODE_ENV === 'production' && config.ADMIN_API_TOKEN.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_API_TOKEN'],
        message: 'ADMIN_API_TOKEN is required in production',
      });
    }

    if (config.WHATSAPP_ENABLED) {
      const required = [
        'META_GRAPH_VERSION',
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_VERIFY_TOKEN',
        'META_APP_SECRET',
      ] as const;
      for (const key of required) {
        if (!config[key] || config[key].trim() === '') {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when WHATSAPP_ENABLED=true`,
          });
        }
      }
    }

    if (config.WHATSAPP_WEBHOOK_MAX_BACKOFF_MS < config.WHATSAPP_WEBHOOK_BASE_BACKOFF_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['WHATSAPP_WEBHOOK_MAX_BACKOFF_MS'],
        message: 'WHATSAPP_WEBHOOK_MAX_BACKOFF_MS must be >= WHATSAPP_WEBHOOK_BASE_BACKOFF_MS',
      });
    }
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;

export class ConfigurationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = AppConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'config';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigurationError(issues);
  }
  return parsed.data;
}

/**
 * Build a validated config for automated tests without touching process.env secrets.
 * Caller-supplied overrides win; WhatsApp stays disabled unless explicitly enabled.
 */
export function loadTestConfig(
  overrides: Record<string, string | number | boolean | undefined> = {},
): AppConfig {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DATABASE_URL: 'file:./prisma/test.db',
    ADMIN_API_TOKEN: 'test-admin-token',
    ENABLE_SIMULATOR: 'true',
    LLM_PROVIDER: 'scripted',
    WHATSAPP_ENABLED: 'false',
    CORS_ORIGIN: 'http://localhost:5173',
    BUSINESS_TIMEZONE: 'Asia/Kolkata',
    BUSINESS_CURRENCY: 'INR',
    LOG_LEVEL: 'silent',
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    env[key] = String(value);
  }

  return loadConfig(env);
}

export function parseCorsOrigins(corsOrigin: string): string[] {
  return corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
