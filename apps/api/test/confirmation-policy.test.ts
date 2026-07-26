import { describe, expect, it } from 'vitest';

import { ConfirmationPolicy } from '../src/domain/confirmation-policy.js';

describe('ConfirmationPolicy', () => {
  const policy = new ConfirmationPolicy();

  it.each([
    'yes',
    'YES',
    '  Confirm It ',
    'book it',
    'go ahead',
    'yes please',
    'yes confirm it',
    'Yes, confirm it.',
    'haan',
    'han',
    'kar do',
    'confirm kar do',
  ])('confirms explicit affirmation: %s', (message) => {
    expect(policy.evaluate(message)).toBe('CONFIRMED');
  });

  it.each(['no', 'cancel', 'do not book', "don't book", 'nahi', 'mat karo', 'NOPE'])(
    'rejects explicit rejection: %s',
    (message) => {
      expect(policy.evaluate(message)).toBe('REJECTED');
    },
  );

  it.each([
    'maybe',
    'okay I will check',
    'what time exactly',
    'Sector 62',
    'thanks',
    '',
    '   ',
  ])('marks unclear responses as ambiguous: %s', (message) => {
    expect(policy.evaluate(message)).toBe('AMBIGUOUS');
  });
});
