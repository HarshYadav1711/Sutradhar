import { z } from 'zod';

import { DomainNotFoundError, DomainValidationError } from '../../domain/errors.js';
import {
  formatSlotLabel,
  hourInTimeZone,
  periodForHour,
  zonedDayBounds,
  type TimePeriod,
} from '../../domain/time.js';
import type { AgentTool } from '../types.js';

const inputSchema = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timePreference: z.enum(['morning', 'afternoon', 'evening']).optional(),
});

type SlotView = {
  id: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  label: string;
  period: TimePeriod;
};

export const checkAvailabilityTool: AgentTool<typeof inputSchema, unknown> = {
  name: 'check_availability',
  description:
    'Check database-backed availability for a service on a date, with optional morning/afternoon/evening preference.',
  inputSchema,
  async execute(input, context) {
    const timeZone = context.timeZone ?? process.env.BUSINESS_TIMEZONE ?? 'Asia/Kolkata';
    const service = await context.db.service.findFirst({
      where: { id: input.serviceId, active: true },
    });

    if (!service) {
      throw new DomainNotFoundError('Service not found');
    }

    let dayBounds;
    try {
      dayBounds = zonedDayBounds(input.date);
    } catch {
      throw new DomainValidationError('Invalid requested date');
    }

    const daySlots = await context.db.availabilitySlot.findMany({
      where: {
        serviceId: service.id,
        status: 'AVAILABLE',
        startsAt: {
          gte: dayBounds.start,
          lte: dayBounds.end,
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    const toView = (slot: (typeof daySlots)[number]): SlotView => {
      const period = periodForHour(hourInTimeZone(slot.startsAt, timeZone));
      return {
        id: slot.id,
        serviceId: slot.serviceId,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        timezone: slot.timezone,
        status: slot.status,
        label: formatSlotLabel(slot.startsAt, timeZone),
        period,
      };
    };

    const matching = input.timePreference
      ? daySlots.filter(
          (slot) => periodForHour(hourInTimeZone(slot.startsAt, timeZone)) === input.timePreference,
        )
      : daySlots;

    if (matching.length > 0) {
      return {
        serviceId: service.id,
        date: input.date,
        timePreference: input.timePreference ?? null,
        matched: matching.map(toView),
        alternatives: [],
      };
    }

    const sameDayAlternatives = daySlots.map(toView);
    if (sameDayAlternatives.length > 0) {
      return {
        serviceId: service.id,
        date: input.date,
        timePreference: input.timePreference ?? null,
        matched: [],
        alternatives: sameDayAlternatives,
      };
    }

    const nearby = await context.db.availabilitySlot.findMany({
      where: {
        serviceId: service.id,
        status: 'AVAILABLE',
        startsAt: {
          gt: dayBounds.end,
        },
      },
      orderBy: { startsAt: 'asc' },
      take: 6,
    });

    return {
      serviceId: service.id,
      date: input.date,
      timePreference: input.timePreference ?? null,
      matched: [],
      alternatives: nearby.map(toView),
    };
  },
};
