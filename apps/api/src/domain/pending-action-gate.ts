import type { ConfirmationDecision } from './confirmation-policy.js';

export type PendingActionGateDecision =
  | 'COMMIT'
  | 'CANCEL'
  | 'ASK_EXPLICIT_CONFIRMATION'
  | 'SUPERSEDE'
  | 'EXPIRED';

const RELATED_AMBIGUOUS_PHRASES = [
  'maybe',
  'perhaps',
  'okay',
  'ok',
  'ok i will check',
  'okay i will check',
  'i will check',
  'let me check',
  'not sure',
  'hmm',
  'hm',
  'what time',
  'what time exactly',
  'tell me more',
  'details',
  'thik hai',
  'theek hai',
  'dekhte hain',
  'sochta hun',
  'sochti hun',
] as const;

const NEW_REQUEST_HINTS =
  /\b(need|book|repair|service|servicing|reschedule|cancel booking|refund|complaint|damaged|damage|washing machine|refrigerator|fridge|ac\b|air conditioner|kal\b|shaam|subah|dopahar|chahiye|ho sakta|refund|paisa wapas)\b/i;

function normalize(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.!?,_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classifies how an inbound message should interact with an existing pending action.
 * ConfirmationPolicy decisions are respected first; ambiguous messages are split into
 * related confirmation noise vs unrelated new requests that may supersede the proposal.
 */
export function evaluatePendingActionGate(input: {
  confirmationDecision: ConfirmationDecision;
  message: string;
  expired: boolean;
}): PendingActionGateDecision {
  if (input.expired) {
    return 'EXPIRED';
  }

  if (input.confirmationDecision === 'CONFIRMED') {
    return 'COMMIT';
  }

  if (input.confirmationDecision === 'REJECTED') {
    return 'CANCEL';
  }

  const normalized = normalize(input.message);

  if (RELATED_AMBIGUOUS_PHRASES.includes(normalized as (typeof RELATED_AMBIGUOUS_PHRASES)[number])) {
    return 'ASK_EXPLICIT_CONFIRMATION';
  }

  // Short confirmation-adjacent hedges without clear new intent.
  if (normalized.length > 0 && normalized.length <= 24 && !NEW_REQUEST_HINTS.test(normalized)) {
    return 'ASK_EXPLICIT_CONFIRMATION';
  }

  if (NEW_REQUEST_HINTS.test(normalized) || normalized.length >= 40) {
    return 'SUPERSEDE';
  }

  return 'ASK_EXPLICIT_CONFIRMATION';
}

export function explicitConfirmationPrompt(languageStyle: 'en' | 'hinglish' = 'en'): string {
  if (languageStyle === 'hinglish') {
    return 'Please clearly reply "haan" to confirm, or "nahi" to cancel this proposal.';
  }
  return 'Please reply "yes" to confirm this proposal, or "no" to cancel it.';
}

export function pendingExpiredPrompt(languageStyle: 'en' | 'hinglish' = 'en'): string {
  if (languageStyle === 'hinglish') {
    return 'Woh proposal expire ho gaya. Naya booking request bhej sakte ho.';
  }
  return 'That proposal has expired. Please send a new request if you still want to book.';
}

export function pendingCancelledPrompt(languageStyle: 'en' | 'hinglish' = 'en'): string {
  if (languageStyle === 'hinglish') {
    return 'Theek hai, maine woh proposal cancel kar diya. Batayein aage kya chahiye.';
  }
  return 'Okay, I cancelled that proposal. Tell me what you need next.';
}
