export type ConfirmationDecision = 'CONFIRMED' | 'REJECTED' | 'AMBIGUOUS';

const CONFIRM_PHRASES = [
  'yes',
  'y',
  'yeah',
  'yep',
  'confirm',
  'confirmed',
  'confirm it',
  'book it',
  'book',
  'go ahead',
  'yes please',
  'please confirm',
  'haan',
  'han',
  'ha',
  'haji',
  'ji',
  'kar do',
  'confirm kar do',
  'book kar do',
  'haan kar do',
  'han kar do',
  'ok confirm',
  'okay confirm',
] as const;

const REJECT_PHRASES = [
  'no',
  'n',
  'nope',
  'cancel',
  'cancelled',
  'canceled',
  'do not book',
  'dont book',
  "don't book",
  'do not confirm',
  'dont confirm',
  "don't confirm",
  'nahi',
  'nahin',
  'mat karo',
  'mat karna',
  'cancel kar do',
  'reject',
  'stop',
] as const;

function normalizeMessage(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.!?,_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isExactPhrase(normalized: string, phrases: readonly string[]): boolean {
  return phrases.includes(normalized);
}

/**
 * Deterministic customer confirmation classifier.
 * Never calls an LLM and never treats unrelated text as confirmation.
 */
export class ConfirmationPolicy {
  evaluate(rawMessage: string): ConfirmationDecision {
    const normalized = normalizeMessage(rawMessage);

    if (normalized === '') {
      return 'AMBIGUOUS';
    }

    if (isExactPhrase(normalized, CONFIRM_PHRASES)) {
      return 'CONFIRMED';
    }

    if (isExactPhrase(normalized, REJECT_PHRASES)) {
      return 'REJECTED';
    }

    return 'AMBIGUOUS';
  }
}

export const confirmationPolicy = new ConfirmationPolicy();
