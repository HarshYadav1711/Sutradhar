/**
 * Explicit conversation status transitions.
 * The model never assigns status strings; only deterministic code paths do.
 */

export const CONVERSATION_STATUSES = [
  'IDLE',
  'COLLECTING_BOOKING_DETAILS',
  'AWAITING_BOOKING_CONFIRMATION',
  'BOOKED',
  'AWAITING_RESCHEDULE_CONFIRMATION',
  'HANDED_OFF',
  'CLOSED',
] as const;

export type ConversationStatusName = (typeof CONVERSATION_STATUSES)[number];

export type ConversationTransitionEvent =
  | 'BOOKING_INTENT'
  | 'DETAILS_INCOMPLETE'
  | 'BOOKING_PROPOSAL_READY'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_REJECTED'
  | 'PENDING_SUPERSEDED'
  | 'RESCHEDULE_PROPOSAL_READY'
  | 'RESCHEDULE_CONFIRMED'
  | 'RESCHEDULE_REJECTED'
  | 'HANDOFF_CREATED'
  | 'CONVERSATION_CLOSED'
  | 'RETURN_TO_IDLE';

const ALLOWED_TRANSITIONS: Record<
  ConversationStatusName,
  Partial<Record<ConversationTransitionEvent, ConversationStatusName>>
> = {
  IDLE: {
    BOOKING_INTENT: 'COLLECTING_BOOKING_DETAILS',
    DETAILS_INCOMPLETE: 'COLLECTING_BOOKING_DETAILS',
    BOOKING_PROPOSAL_READY: 'AWAITING_BOOKING_CONFIRMATION',
    RESCHEDULE_PROPOSAL_READY: 'AWAITING_RESCHEDULE_CONFIRMATION',
    HANDOFF_CREATED: 'HANDED_OFF',
    CONVERSATION_CLOSED: 'CLOSED',
  },
  COLLECTING_BOOKING_DETAILS: {
    DETAILS_INCOMPLETE: 'COLLECTING_BOOKING_DETAILS',
    BOOKING_PROPOSAL_READY: 'AWAITING_BOOKING_CONFIRMATION',
    HANDOFF_CREATED: 'HANDED_OFF',
    RETURN_TO_IDLE: 'IDLE',
    CONVERSATION_CLOSED: 'CLOSED',
  },
  AWAITING_BOOKING_CONFIRMATION: {
    BOOKING_CONFIRMED: 'BOOKED',
    BOOKING_REJECTED: 'COLLECTING_BOOKING_DETAILS',
    PENDING_SUPERSEDED: 'COLLECTING_BOOKING_DETAILS',
    BOOKING_PROPOSAL_READY: 'AWAITING_BOOKING_CONFIRMATION',
    HANDOFF_CREATED: 'HANDED_OFF',
    RETURN_TO_IDLE: 'IDLE',
    CONVERSATION_CLOSED: 'CLOSED',
  },
  BOOKED: {
    RESCHEDULE_PROPOSAL_READY: 'AWAITING_RESCHEDULE_CONFIRMATION',
    BOOKING_INTENT: 'COLLECTING_BOOKING_DETAILS',
    HANDOFF_CREATED: 'HANDED_OFF',
    CONVERSATION_CLOSED: 'CLOSED',
    RETURN_TO_IDLE: 'IDLE',
  },
  AWAITING_RESCHEDULE_CONFIRMATION: {
    RESCHEDULE_CONFIRMED: 'BOOKED',
    RESCHEDULE_REJECTED: 'BOOKED',
    PENDING_SUPERSEDED: 'BOOKED',
    RESCHEDULE_PROPOSAL_READY: 'AWAITING_RESCHEDULE_CONFIRMATION',
    HANDOFF_CREATED: 'HANDED_OFF',
    CONVERSATION_CLOSED: 'CLOSED',
  },
  HANDED_OFF: {
    CONVERSATION_CLOSED: 'CLOSED',
    RETURN_TO_IDLE: 'IDLE',
    BOOKING_INTENT: 'COLLECTING_BOOKING_DETAILS',
  },
  CLOSED: {
    RETURN_TO_IDLE: 'IDLE',
    BOOKING_INTENT: 'COLLECTING_BOOKING_DETAILS',
  },
};

export class ConversationStateError extends Error {
  readonly code = 'INVALID_CONVERSATION_TRANSITION';

  constructor(
    readonly from: ConversationStatusName,
    readonly event: ConversationTransitionEvent,
    message?: string,
  ) {
    super(message ?? `Invalid conversation transition: ${from} + ${event}`);
    this.name = 'ConversationStateError';
  }
}

export function isConversationStatus(value: unknown): value is ConversationStatusName {
  return typeof value === 'string' && (CONVERSATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Resolves the next status for a known event. Throws when the transition is not allowed.
 */
export function transitionConversationStatus(
  from: ConversationStatusName,
  event: ConversationTransitionEvent,
): ConversationStatusName {
  const next = ALLOWED_TRANSITIONS[from][event];
  if (!next) {
    throw new ConversationStateError(from, event);
  }
  return next;
}

export function canTransitionConversationStatus(
  from: ConversationStatusName,
  event: ConversationTransitionEvent,
): boolean {
  return ALLOWED_TRANSITIONS[from][event] !== undefined;
}

/**
 * Rejects arbitrary LLM-supplied status strings. Only known enum values are accepted.
 */
export function assertKnownConversationStatus(value: unknown): ConversationStatusName {
  if (!isConversationStatus(value)) {
    throw new Error(`Unknown conversation status: ${String(value)}`);
  }
  return value;
}
