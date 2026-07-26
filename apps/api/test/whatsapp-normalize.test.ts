import { describe, expect, it } from 'vitest';

import { normalizeWhatsAppWebhookPayload } from '../src/whatsapp/normalize.js';

describe('WhatsApp webhook normalisation', () => {
  it('normalises inbound text messages', () => {
    const events = normalizeWhatsAppWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'ENTRY',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'PHONE' },
                contacts: [{ profile: { name: 'Ananya' }, wa_id: '919811122233' }],
                messages: [
                  {
                    from: '919811122233',
                    id: 'wamid.TEXT1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'I need AC servicing' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'text_message',
      externalKey: 'msg:wamid.TEXT1',
      externalMessageId: 'wamid.TEXT1',
      waId: '919811122233',
      profileName: 'Ananya',
      text: 'I need AC servicing',
    });
  });

  it('treats status events separately from customer messages', () => {
    const events = normalizeWhatsAppWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.STATUS1',
                    status: 'delivered',
                    timestamp: '1700000001',
                    recipient_id: '919811122233',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('status_event');
    expect(events[0]).toMatchObject({
      externalKey: 'status:wamid.STATUS1:delivered',
      status: 'delivered',
    });
  });

  it('marks unsupported media without claiming understanding', () => {
    const events = normalizeWhatsAppWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '919811122233',
                    id: 'wamid.IMAGE1',
                    type: 'image',
                    image: { id: 'media-1' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events[0]).toMatchObject({
      kind: 'unsupported_message',
      messageType: 'image',
      externalMessageId: 'wamid.IMAGE1',
    });
  });

  it('handles unknown payload shapes without throwing', () => {
    expect(() => normalizeWhatsAppWebhookPayload(null)).not.toThrow();
    expect(() => normalizeWhatsAppWebhookPayload('nope')).not.toThrow();
    expect(() => normalizeWhatsAppWebhookPayload({ object: 'other' })).not.toThrow();
    const events = normalizeWhatsAppWebhookPayload({ hello: 'world' });
    expect(events[0]?.kind).toBe('ignored');
  });
});
