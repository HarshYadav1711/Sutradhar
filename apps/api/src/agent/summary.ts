const MAX_SUMMARY_CHARS = 800;

/**
 * Appends a compact operational line to the conversation summary.
 * Does not replace structured conversation state.
 */
export function appendCompactSummary(
  existing: string | null | undefined,
  line: string,
  maxChars = MAX_SUMMARY_CHARS,
): string {
  const nextLine = line.replace(/\s+/g, ' ').trim();
  if (!nextLine) {
    return (existing ?? '').trim();
  }

  const base = (existing ?? '').trim();
  const combined = base === '' ? nextLine : `${base}\n${nextLine}`;

  if (combined.length <= maxChars) {
    return combined;
  }

  // Keep the newest lines within the budget.
  const lines = combined.split('\n');
  const kept: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index]!;
    const extra = candidate.length + (kept.length > 0 ? 1 : 0);
    if (size + extra > maxChars) {
      break;
    }
    kept.unshift(candidate);
    size += extra;
  }
  return kept.join('\n');
}

export type StructuredBookingState = {
  serviceId?: string;
  requestedDate?: string;
  timePreference?: 'morning' | 'afternoon' | 'evening' | string;
  quantity?: number;
  address?: string;
  availabilitySlotId?: string;
  pendingActionId?: string;
  bookingId?: string;
  newAvailabilitySlotId?: string;
  lastIntent?: string;
};

export function readStructuredState(value: unknown): StructuredBookingState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as StructuredBookingState;
}

export function mergeStructuredState(
  existing: StructuredBookingState,
  patch: StructuredBookingState,
): StructuredBookingState {
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, entry]) => entry !== undefined && entry !== null),
    ),
  };
}
