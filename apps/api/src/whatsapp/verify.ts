import { timingSafeEqual } from 'node:crypto';

export type WhatsAppVerifyQuery = {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
};

/**
 * Validates Meta webhook verification query parameters.
 * Does not log the verify token.
 */
export function verifyWhatsAppSubscription(
  query: WhatsAppVerifyQuery,
  expectedToken: string,
): { ok: true; challenge: string } | { ok: false; code: string; message: string } {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode !== 'subscribe') {
    return { ok: false, code: 'INVALID_HUB_MODE', message: 'Invalid hub.mode' };
  }

  if (typeof challenge !== 'string') {
    return { ok: false, code: 'MISSING_CHALLENGE', message: 'Missing hub.challenge' };
  }

  if (typeof token !== 'string' || !expectedToken) {
    return { ok: false, code: 'INVALID_VERIFY_TOKEN', message: 'Invalid verify token' };
  }

  const left = Buffer.from(token);
  const right = Buffer.from(expectedToken);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, code: 'INVALID_VERIFY_TOKEN', message: 'Invalid verify token' };
  }

  return { ok: true, challenge };
}
