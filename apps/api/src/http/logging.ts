import type { AppConfig } from '../config.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["authorization"]',
  'req.headers["x-hub-signature-256"]',
  'headers.authorization',
  'headers["authorization"]',
  'headers["x-hub-signature-256"]',
  'config.WHATSAPP_ACCESS_TOKEN',
  'config.META_APP_SECRET',
  'config.WHATSAPP_VERIFY_TOKEN',
  'config.ADMIN_API_TOKEN',
  '*.accessToken',
  '*.appSecret',
  '*.verifyToken',
  '*.adminToken',
  '*.WHATSAPP_ACCESS_TOKEN',
  '*.META_APP_SECRET',
  '*.ADMIN_API_TOKEN',
  'err.config.headers.Authorization',
  'err.config.headers.authorization',
] as const;

export type SutradharLoggerOptions = {
  level: string;
  redact: {
    paths: string[];
    remove: true;
  };
};

/**
 * Structured Pino options for Fastify.
 * Redacts authorization headers, WhatsApp tokens, app secrets, and admin tokens.
 * Does not include hidden model reasoning fields.
 */
export function createLoggerOptions(config: AppConfig): SutradharLoggerOptions {
  return {
    level: config.LOG_LEVEL,
    redact: {
      paths: [...REDACT_PATHS],
      remove: true,
    },
  };
}

/**
 * Strip known secret substrings from free-form error messages before client exposure.
 */
export function sanitizeErrorMessageForClient(
  message: string,
  secrets: Array<string | undefined | null>,
): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (!secret || secret.trim().length < 4) {
      continue;
    }
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized;
}
