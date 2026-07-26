import { describe, expect, it } from 'vitest';

import { formatInrFromMinor, humanizeStatus, maskCustomerLabel, maskPhone } from '../lib/format';
import { parseHashRoute, routeToHash } from '../lib/routing';

describe('format helpers', () => {
  it('formats INR from minor units', () => {
    expect(formatInrFromMinor(49900)).toContain('499');
  });

  it('masks customer labels and phone numbers', () => {
    expect(maskCustomerLabel({ id: '1', name: 'Ananya', whatsappNumber: '+919811122233' })).toBe(
      'Ananya',
    );
    expect(maskPhone('+919811122233')).toBe('••••2233');
  });

  it('humanizes status labels', () => {
    expect(humanizeStatus('AWAITING_BOOKING_CONFIRMATION')).toBe('Awaiting Booking Confirmation');
  });
});

describe('routing', () => {
  it('parses and serializes hash routes', () => {
    expect(parseHashRoute('#/conversations/abc')).toEqual({
      name: 'conversation',
      conversationId: 'abc',
    });
    expect(routeToHash({ name: 'handoffs' })).toBe('#/handoffs');
  });
});
