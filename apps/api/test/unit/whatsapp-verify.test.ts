import { describe, expect, it } from 'vitest';

import { verifyWhatsAppSubscription } from '../../src/whatsapp/verify.js';

describe('WhatsApp webhook verification helper', () => {
  it('returns the challenge for a valid subscribe request', () => {
    const result = verifyWhatsAppSubscription(
      {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'expected',
        'hub.challenge': '12345',
      },
      'expected',
    );
    expect(result).toEqual({ ok: true, challenge: '12345' });
  });

  it('rejects invalid mode and token', () => {
    expect(
      verifyWhatsAppSubscription(
        {
          'hub.mode': 'unsubscribe',
          'hub.verify_token': 'expected',
          'hub.challenge': '12345',
        },
        'expected',
      ).ok,
    ).toBe(false);

    expect(
      verifyWhatsAppSubscription(
        {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong',
          'hub.challenge': '12345',
        },
        'expected',
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_VERIFY_TOKEN' });
  });
});
