const MARKDOWN_TABLE_PATTERN = /^\s*\|.+\|/m;
const TOOL_NAME_PATTERN =
  /\b(search_services|check_availability|get_customer_profile|save_customer_details|prepare_booking|prepare_reschedule|create_handoff|commit_pending_action|cancel_pending_action)\b/gi;

/**
 * WhatsApp-friendly customer text: no markdown tables, no internal tool names,
 * no fake success phrasing, concise line breaks.
 */
export function sanitizeCustomerResponse(raw: string | null | undefined): string {
  if (!raw) {
    return '';
  }

  let text = raw.replace(/\r\n/g, '\n').trim();

  if (MARKDOWN_TABLE_PATTERN.test(text)) {
    text = text
      .split('\n')
      .filter((line) => !/^\s*\|/.test(line) && !/^\s*-+:?/.test(line))
      .join('\n')
      .trim();
  }

  text = text.replace(TOOL_NAME_PATTERN, 'that step');
  text = text.replace(/```[\s\S]*?```/g, '').trim();
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');

  // Collapse excessive blank lines for WhatsApp.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

export function looksHinglish(message: string): boolean {
  return /\b(haan|han|nahi|kal|shaam|subah|dopahar|chahiye|ho sakta|kar do|mat karo|theek|thik|bhai|ji|kya|hai)\b/i.test(
    message,
  );
}

export function detectLanguageStyle(message: string): 'en' | 'hinglish' {
  return looksHinglish(message) ? 'hinglish' : 'en';
}

export function controlledFailureMessage(
  reason:
    | 'provider_failure'
    | 'max_steps'
    | 'repeated_tool_failure'
    | 'malformed_tool'
    | 'no_availability'
    | 'unsupported_service',
  languageStyle: 'en' | 'hinglish' = 'en',
): string {
  if (languageStyle === 'hinglish') {
    switch (reason) {
      case 'provider_failure':
        return 'Abhi system reply generate nahi kar paaya. Thodi der baad phir try karein.';
      case 'max_steps':
        return 'Is request ko complete karne mein issue aa raha hai. Please details dobara short mein bhejein, ya team help karegi.';
      case 'repeated_tool_failure':
        return 'Operational check fail ho gaya. Main abhi booking confirm nahi kar sakta. Thodi der baad try karein.';
      case 'malformed_tool':
        return 'Internal step invalid tha, isliye main aage nahi badha. Please apni request clearly dubara bhejein.';
      case 'no_availability':
        return 'Us time pe slot available nahi mila. Main real alternatives share kar sakta hoon.';
      case 'unsupported_service':
        return 'Yeh service abhi support nahi karti. Main isko team ko escalate kar sakta hoon.';
    }
  }

  switch (reason) {
    case 'provider_failure':
      return 'I could not generate a reply right now. Please try again in a moment.';
    case 'max_steps':
      return 'I could not finish this request in one pass. Please resend the key details briefly, or ask for a human teammate.';
    case 'repeated_tool_failure':
      return 'An operational check failed repeatedly, so I cannot complete that step right now. Please try again shortly.';
    case 'malformed_tool':
      return 'An internal step was invalid, so I stopped. Please resend your request clearly.';
    case 'no_availability':
      return 'No matching slot was available. I can share real alternatives from the schedule.';
    case 'unsupported_service':
      return 'That service is not supported. I can escalate this to a teammate if you want.';
  }
}

export function bookingCommittedMessage(input: {
  reference: string;
  languageStyle?: 'en' | 'hinglish';
}): string {
  if (input.languageStyle === 'hinglish') {
    return `Booking confirm ho gayi. Reference: ${input.reference}`;
  }
  return `Your booking is confirmed. Reference: ${input.reference}`;
}

export function rescheduleCommittedMessage(input: {
  reference: string;
  languageStyle?: 'en' | 'hinglish';
}): string {
  if (input.languageStyle === 'hinglish') {
    return `Reschedule confirm ho gaya. Booking reference: ${input.reference}`;
  }
  return `Your reschedule is confirmed. Booking reference: ${input.reference}`;
}
