import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates Meta X-Hub-Signature-256 against the exact raw request body.
 * Uses constant-time comparison.
 */
export function verifyWhatsAppSignature(input: {
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  appSecret: string;
}): boolean {
  const header = input.signatureHeader?.trim();
  if (!header || !header.toLowerCase().startsWith('sha256=')) {
    return false;
  }
  if (!input.appSecret) {
    return false;
  }

  const providedHex = header.slice('sha256='.length).trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(providedHex) || providedHex.length !== 64) {
    return false;
  }

  const expectedHex = createHmac('sha256', input.appSecret)
    .update(input.rawBody)
    .digest('hex');

  const provided = Buffer.from(providedHex, 'utf8');
  const expected = Buffer.from(expectedHex, 'utf8');
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

/**
 * Test-only helper to build a valid Meta signature header.
 * Do not use this to bypass validation in production paths.
 */
export function createTestWhatsAppSignature(
  rawBody: Buffer | string,
  appSecret: string,
): string {
  const digest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return `sha256=${digest}`;
}
