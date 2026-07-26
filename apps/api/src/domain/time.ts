export type TimePeriod = 'morning' | 'afternoon' | 'evening';

/** Maximum booking horizon relative to today in the business timezone. */
export const MAX_BOOKING_DAYS_AHEAD = 90;

export function parseDateOnly(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid date format: ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid date format: ${date}`);
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid calendar date: ${date}`);
  }

  // Reject non-existent calendar days (e.g. 2026-02-31).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${date}`);
  }

  return { year, month, day };
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Returns true when the YYYY-MM-DD calendar date is today or later in the given timezone.
 */
export function isDateOnOrAfterToday(date: string, now: Date, timeZone: string): boolean {
  const requested = parseDateOnly(date);
  const todayKey = formatDateInTimeZone(now, timeZone);
  const today = parseDateOnly(todayKey);

  const requestedUtc = Date.UTC(requested.year, requested.month - 1, requested.day);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  return requestedUtc >= todayUtc;
}

/**
 * Validates a model-supplied normalised date for availability checks.
 * Does not invent or select a slot.
 */
export function assertReasonableBookingDate(
  date: string,
  now: Date,
  timeZone: string,
  maxDaysAhead = MAX_BOOKING_DAYS_AHEAD,
): void {
  const requested = parseDateOnly(date);
  if (!isDateOnOrAfterToday(date, now, timeZone)) {
    throw new Error('Requested date is in the past');
  }

  const today = parseDateOnly(formatDateInTimeZone(now, timeZone));
  const requestedUtc = Date.UTC(requested.year, requested.month - 1, requested.day);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  const daysAhead = Math.floor((requestedUtc - todayUtc) / (24 * 60 * 60 * 1000));

  if (daysAhead > maxDaysAhead) {
    throw new Error(`Requested date is more than ${maxDaysAhead} days ahead`);
  }
}

export function zonedDayBounds(
  date: string,
  timeZoneOffset = '+05:30',
): { start: Date; end: Date } {
  const { year, month, day } = parseDateOnly(date);
  const start = new Date(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00${timeZoneOffset}`,
  );
  const end = new Date(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59.999${timeZoneOffset}`,
  );
  return { start, end };
}

export function hourInTimeZone(date: Date, timeZone: string): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date),
  );

  return hour;
}

export function periodForHour(hour: number): TimePeriod {
  if (hour < 12) {
    return 'morning';
  }
  if (hour < 17) {
    return 'afternoon';
  }
  return 'evening';
}

export function formatSlotLabel(startsAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(startsAt);
}
