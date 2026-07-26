export type HandoffSignalKind =
  | 'complaint'
  | 'refund'
  | 'damage'
  | 'unsupported_service'
  | 'uncertain';

export type HandoffPriorityHint = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type DetectedHandoffSignal = {
  kind: HandoffSignalKind;
  reason: string;
  priority: HandoffPriorityHint;
};

const REFUND_PATTERN =
  /\b(refund|money back|paisa wapas|paise wapas|charge reverse|compensate|compensation)\b/i;
const DAMAGE_PATTERN = /\b(damaged|damage|broke|broken|kharab kar diya|tod diya)\b/i;
const COMPLAINT_PATTERN =
  /\b(complaint|nobody responded|no one responded|escalate|manager|poor service|bahut bura|shikayat)\b/i;
const UNSUPPORTED_PATTERN =
  /\b(iphone|laptop|plumbing|electrician|car service|painter|spaceship)\b/i;

/**
 * Lightweight escalation detector used for operational events and priority hints.
 * The model still calls create_handoff; this policy never invents outcomes.
 */
export class HandoffPolicy {
  detect(message: string): DetectedHandoffSignal | null {
    const text = message.trim();
    if (text === '') {
      return null;
    }

    if (REFUND_PATTERN.test(text)) {
      return {
        kind: 'refund',
        reason: 'Customer requested a refund',
        priority: 'HIGH',
      };
    }

    if (DAMAGE_PATTERN.test(text)) {
      return {
        kind: 'damage',
        reason: 'Customer reported damage',
        priority: 'HIGH',
      };
    }

    if (COMPLAINT_PATTERN.test(text)) {
      return {
        kind: 'complaint',
        reason: 'Customer raised a complaint',
        priority: 'HIGH',
      };
    }

    if (UNSUPPORTED_PATTERN.test(text)) {
      return {
        kind: 'unsupported_service',
        reason: 'Customer requested an unsupported service',
        priority: 'NORMAL',
      };
    }

    return null;
  }

  /**
   * Handoffs must never approve refunds or compensation.
   */
  assertSafeHandoffResult(result: { refundOrCompensationApproved?: unknown }): void {
    if (result.refundOrCompensationApproved === true) {
      throw new Error('Handoff results must not approve refunds or compensation');
    }
  }

  customerFacingHandoffMessage(input: {
    reference: string;
    kind: HandoffSignalKind | string;
    languageStyle?: 'en' | 'hinglish';
  }): string {
    const style = input.languageStyle ?? 'en';
    if (style === 'hinglish') {
      return `Maine aapka case team ko bhej diya hai. Reference: ${input.reference}. Refund ya compensation abhi approve nahi hua — team contact karegi.`;
    }
    return `I have escalated this to a human teammate. Reference: ${input.reference}. No refund or compensation has been approved — the team will follow up.`;
  }
}

export const handoffPolicy = new HandoffPolicy();
