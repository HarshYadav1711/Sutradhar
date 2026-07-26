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

const AppConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: z.string().min(1),
    BUSINESS_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
    BUSINESS_CURRENCY: z.string().min(1).default('INR'),
    CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    ADMIN_API_TOKEN: z.string().default(''),
    ENABLE_SIMULATOR: booleanFromEnv.default(true),
    LLM_PROVIDER: z.enum(['ollama', 'scripted']).default('ollama'),
    OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
    OLLAMA_MODEL: z.string().min(1).default('qwen3:4b'),
    WHATSAPP_ENABLED: booleanFromEnv.default(false),
    META_GRAPH_VERSION: z.string().optional().default(''),
    WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().default(''),
    WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
    META_APP_SECRET: z.string().optional().default(''),
    LOG_LEVEL: z.string().min(1).default('info'),
  })
  .superRefine((config, ctx) => {
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
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = AppConfigSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  return parsed.data;
}
