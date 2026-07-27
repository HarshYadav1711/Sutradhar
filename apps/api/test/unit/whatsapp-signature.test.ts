import { describe, expect, it } from 'vitest';

import {
  createTestWhatsAppSignature,
  verifyWhatsAppSignature,
} from '../../src/whatsapp/signature.js';

describe('WhatsApp signature validation', () => {
  const secret = 'meta-app-secret-for-tests';
  const rawBody = '{"object":"whatsapp_business_account","entry":[]}';

  it('accepts a valid signature', () => {
    const signature = createTestWhatsAppSignature(rawBody, secret);
    expect(
      verifyWhatsAppSignature({
        rawBody,
        signatureHeader: signature,
        appSecret: secret,
      }),
    ).toBe(true);
  });

  it('rejects an invalid signature', () => {
    expect(
      verifyWhatsAppSignature({
        rawBody,
        signatureHeader: 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        appSecret: secret,
      }),
    ).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(
      verifyWhatsAppSignature({
        rawBody,
        signatureHeader: undefined,
        appSecret: secret,
      }),
    ).toBe(false);
  });

  it('rejects signatures when the body differs', () => {
    const signature = createTestWhatsAppSignature(rawBody, secret);
    expect(
      verifyWhatsAppSignature({
        rawBody: '{"object":"tampered"}',
        signatureHeader: signature,
        appSecret: secret,
      }),
    ).toBe(false);
  });
});
