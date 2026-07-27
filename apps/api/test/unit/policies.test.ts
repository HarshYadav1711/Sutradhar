import { describe, expect, it } from 'vitest';

import { ConfirmationPolicy } from '../../src/domain/confirmation-policy.js';
import { evaluatePendingActionGate } from '../../src/domain/pending-action-gate.js';
import {
  getMissingBookingFields,
  firstMissingBookingPrompt,
} from '../../src/domain/booking-policy.js';
import { assertReasonableBookingDate, isDateOnOrAfterToday } from '../../src/domain/time.js';

describe('pending action gate', () => {
  const policy = new ConfirmationPolicy();

  it('commits and cancels from confirmation policy', () => {
    expect(
      evaluatePendingActionGate({
        confirmationDecision: policy.evaluate('yes'),
        message: 'yes',
        expired: false,
      }),
    ).toBe('COMMIT');

    expect(
      evaluatePendingActionGate({
        confirmationDecision: policy.evaluate('nahi'),
        message: 'nahi',
        expired: false,
      }),
    ).toBe('CANCEL');
  });

  it('asks for confirmation on related ambiguous replies', () => {
    expect(
      evaluatePendingActionGate({
        confirmationDecision: policy.evaluate('maybe'),
        message: 'maybe',
        expired: false,
      }),
    ).toBe('ASK_EXPLICIT_CONFIRMATION');
  });

  it('supersedes on unrelated new requests', () => {
    expect(
      evaluatePendingActionGate({
        confirmationDecision: policy.evaluate(
          'Actually I need washing machine repair tomorrow evening instead',
        ),
        message: 'Actually I need washing machine repair tomorrow evening instead',
        expired: false,
      }),
    ).toBe('SUPERSEDE');
  });

  it('marks expired pending actions', () => {
    expect(
      evaluatePendingActionGate({
        confirmationDecision: 'AMBIGUOUS',
        message: 'yes',
        expired: true,
      }),
    ).toBe('EXPIRED');
  });
});

describe('booking collection policy', () => {
  it('detects missing service, date, time, and address', () => {
    expect(
      getMissingBookingFields({
        serviceId: null,
        requestedDate: null,
        timePreference: null,
        address: null,
        quantity: null,
      }),
    ).toEqual(['service', 'date', 'timePreference', 'address', 'quantity']);

    expect(
      firstMissingBookingPrompt({
        serviceId: 'svc',
        requestedDate: '2026-07-28',
        timePreference: 'evening',
        address: null,
        quantity: 1,
      }),
    ).toMatch(/address/i);
  });
});

describe('booking date validation', () => {
  const now = new Date('2026-07-27T04:00:00.000Z');
  const timeZone = 'Asia/Kolkata';

  it('accepts today and near-future dates', () => {
    expect(isDateOnOrAfterToday('2026-07-27', now, timeZone)).toBe(true);
    expect(() => assertReasonableBookingDate('2026-07-28', now, timeZone)).not.toThrow();
  });

  it('rejects past and far-future dates without inventing slots', () => {
    expect(isDateOnOrAfterToday('2026-07-26', now, timeZone)).toBe(false);
    expect(() => assertReasonableBookingDate('2026-07-26', now, timeZone)).toThrow(/past/i);
    expect(() => assertReasonableBookingDate('2027-01-01', now, timeZone)).toThrow(/days ahead/i);
  });
});
