import { describe, expect, it } from 'vitest';

import {
  ConversationStateError,
  assertKnownConversationStatus,
  canTransitionConversationStatus,
  transitionConversationStatus,
} from '../../src/agent/conversation-state.js';

describe('conversation state machine', () => {
  it('allows the primary booking path', () => {
    expect(transitionConversationStatus('IDLE', 'BOOKING_INTENT')).toBe(
      'COLLECTING_BOOKING_DETAILS',
    );
    expect(
      transitionConversationStatus('COLLECTING_BOOKING_DETAILS', 'BOOKING_PROPOSAL_READY'),
    ).toBe('AWAITING_BOOKING_CONFIRMATION');
    expect(
      transitionConversationStatus('AWAITING_BOOKING_CONFIRMATION', 'BOOKING_CONFIRMED'),
    ).toBe('BOOKED');
  });

  it('allows reschedule and handoff transitions', () => {
    expect(transitionConversationStatus('BOOKED', 'RESCHEDULE_PROPOSAL_READY')).toBe(
      'AWAITING_RESCHEDULE_CONFIRMATION',
    );
    expect(
      transitionConversationStatus('AWAITING_RESCHEDULE_CONFIRMATION', 'RESCHEDULE_CONFIRMED'),
    ).toBe('BOOKED');
    expect(transitionConversationStatus('BOOKED', 'HANDOFF_CREATED')).toBe('HANDED_OFF');
  });

  it('rejects illegal transitions', () => {
    expect(canTransitionConversationStatus('IDLE', 'BOOKING_CONFIRMED')).toBe(false);
    expect(() => transitionConversationStatus('IDLE', 'BOOKING_CONFIRMED')).toThrow(
      ConversationStateError,
    );
  });

  it('rejects arbitrary LLM status strings', () => {
    expect(() => assertKnownConversationStatus('THINKING_HARD')).toThrow(/Unknown conversation status/);
    expect(assertKnownConversationStatus('BOOKED')).toBe('BOOKED');
  });
});
