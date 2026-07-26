import type { PrismaClient, SlotStatus } from '../generated/prisma/client.js';

export const BUSINESS_TIMEZONE_DEFAULT = 'Asia/Kolkata';

export type SeedServiceDefinition = {
  name: string;
  slug: string;
  description: string;
  basePriceMinor: number;
  estimatedDurationMinutes: number;
};

export const SEED_SERVICES: SeedServiceDefinition[] = [
  {
    name: 'Standard AC servicing',
    slug: 'standard-ac-servicing',
    description: 'Filter clean, gas check, and basic performance inspection for one AC unit.',
    basePriceMinor: 49900,
    estimatedDurationMinutes: 60,
  },
  {
    name: 'AC deep cleaning',
    slug: 'ac-deep-cleaning',
    description: 'Indoor unit deep clean with coil wash and drainage check.',
    basePriceMinor: 99900,
    estimatedDurationMinutes: 90,
  },
  {
    name: 'Washing machine inspection',
    slug: 'washing-machine-inspection',
    description: 'Diagnostic visit for wash quality, noise, and drainage issues.',
    basePriceMinor: 34900,
    estimatedDurationMinutes: 45,
  },
  {
    name: 'Refrigerator inspection',
    slug: 'refrigerator-inspection',
    description: 'Cooling performance check, seal inspection, and basic troubleshooting.',
    basePriceMinor: 39900,
    estimatedDurationMinutes: 45,
  },
  {
    name: 'General appliance visit',
    slug: 'general-appliance-visit',
    description: 'On-site assessment for common household appliance faults.',
    basePriceMinor: 29900,
    estimatedDurationMinutes: 40,
  },
];

type Period = 'morning' | 'afternoon' | 'evening';

const PERIOD_HOURS: Record<Period, { startHour: number; endHour: number }> = {
  morning: { startHour: 10, endHour: 11 },
  afternoon: { startHour: 14, endHour: 15 },
  evening: { startHour: 18, endHour: 19 },
};

export type SeedOptions = {
  timezone?: string;
  now?: Date;
  dayCount?: number;
};

function istCalendarParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE_DEFAULT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  if (!year || !month || !day) {
    throw new Error('Unable to derive IST calendar date for seed');
  }

  return { year, month, day };
}

function addCalendarDays(year: number, month: number, day: number, offset: number) {
  const utc = new Date(Date.UTC(year, month - 1, day + offset));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function createIstDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;
  return new Date(iso);
}

export function buildSeedSlots(input: {
  serviceIds: string[];
  timezone: string;
  now?: Date;
  dayCount?: number;
}) {
  const now = input.now ?? new Date();
  const dayCount = input.dayCount ?? 5;
  const today = istCalendarParts(now);
  const slots: Array<{
    serviceId: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    status: SlotStatus;
    staffDisplayName: string | null;
  }> = [];

  for (let offset = 1; offset <= dayCount; offset += 1) {
    const date = addCalendarDays(today.year, today.month, today.day, offset);

    for (const period of Object.keys(PERIOD_HOURS) as Period[]) {
      const hours = PERIOD_HOURS[period];
      const startsAt = createIstDateTime(date.year, date.month, date.day, hours.startHour);
      const endsAt = createIstDateTime(date.year, date.month, date.day, hours.endHour);

      // Keep one afternoon window unavailable so alternatives can be demonstrated.
      const unavailable = offset === 2 && period === 'afternoon';
      const status: SlotStatus = unavailable ? 'UNAVAILABLE' : 'AVAILABLE';

      for (const serviceId of input.serviceIds) {
        slots.push({
          serviceId,
          startsAt,
          endsAt,
          timezone: input.timezone,
          status,
          staffDisplayName: period === 'evening' ? 'Evening crew' : null,
        });
      }
    }
  }

  return slots;
}

export async function seedDatabase(prisma: PrismaClient, options: SeedOptions = {}) {
  const timezone = options.timezone ?? process.env.BUSINESS_TIMEZONE ?? BUSINESS_TIMEZONE_DEFAULT;
  const now = options.now ?? new Date();

  await prisma.webhookEvent.deleteMany();
  await prisma.operationalEvent.deleteMany();
  await prisma.toolExecution.deleteMany();
  await prisma.pendingAction.deleteMany();
  await prisma.humanHandoff.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.availabilitySlot.deleteMany();
  await prisma.service.deleteMany();
  await prisma.customer.deleteMany();

  await prisma.service.createMany({
    data: SEED_SERVICES.map((service) => ({
      ...service,
      active: true,
    })),
  });

  const services = await prisma.service.findMany({
    orderBy: { slug: 'asc' },
  });

  const slots = buildSeedSlots({
    serviceIds: services.map((service) => service.id),
    timezone,
    now,
  });

  await prisma.availabilitySlot.createMany({
    data: slots,
  });

  const demoCustomer = await prisma.customer.create({
    data: {
      whatsappNumber: '+919811122233',
      name: 'Ananya Sharma',
      preferredLanguage: 'en-IN',
      defaultAddress: 'Sector 62, Noida, Uttar Pradesh',
    },
  });

  return {
    timezone,
    serviceCount: services.length,
    slotCount: slots.length,
    availableSlotCount: slots.filter((slot) => slot.status === 'AVAILABLE').length,
    unavailableSlotCount: slots.filter((slot) => slot.status === 'UNAVAILABLE').length,
    demoCustomerId: demoCustomer.id,
  };
}
