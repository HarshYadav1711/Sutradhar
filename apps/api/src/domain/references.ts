import { randomInt } from 'node:crypto';

function formatDateStamp(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Unable to format reference date stamp');
  }

  return `${year}${month}${day}`;
}

export function createBookingReference(now = new Date(), timeZone = 'Asia/Kolkata'): string {
  return `BK-${formatDateStamp(now, timeZone)}-${randomInt(1000, 9999)}`;
}

export function createHandoffReference(now = new Date(), timeZone = 'Asia/Kolkata'): string {
  return `HO-${formatDateStamp(now, timeZone)}-${randomInt(1000, 9999)}`;
}

export function formatInrFromMinor(minorUnits: number): string {
  const rupees = minorUnits / 100;
  return `INR ${rupees.toFixed(2)}`;
}
