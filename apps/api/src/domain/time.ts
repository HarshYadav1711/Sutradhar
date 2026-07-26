export type TimePeriod = 'morning' | 'afternoon' | 'evening';

export function parseDateOnly(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid date format: ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return { year, month, day };
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
