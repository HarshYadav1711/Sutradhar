import { seedDatabase } from '../../src/db/seed.js';
import type { PrismaClient } from '../../src/db/client.js';
import { createAgentToolRegistry } from '../../src/tools/index.js';
import type { ToolExecutionContext } from '../../src/tools/types.js';

export async function seedConversationFixture(prisma: PrismaClient, now = new Date()) {
  await seedDatabase(prisma, { now });

  const customer = await prisma.customer.findFirstOrThrow();
  const service = await prisma.service.findFirstOrThrow({
    where: { slug: 'standard-ac-servicing' },
  });
  const availableSlot = await prisma.availabilitySlot.findFirstOrThrow({
    where: {
      serviceId: service.id,
      status: 'AVAILABLE',
      startsAt: { gt: now },
    },
    orderBy: { startsAt: 'asc' },
  });
  const alternativeSlot = await prisma.availabilitySlot.findFirstOrThrow({
    where: {
      serviceId: service.id,
      status: 'AVAILABLE',
      startsAt: { gt: availableSlot.startsAt },
    },
    orderBy: { startsAt: 'asc' },
  });
  const unavailableSlot = await prisma.availabilitySlot.findFirstOrThrow({
    where: {
      serviceId: service.id,
      status: 'UNAVAILABLE',
    },
    orderBy: { startsAt: 'asc' },
  });

  const conversation = await prisma.conversation.create({
    data: {
      customerId: customer.id,
      status: 'IDLE',
      structuredState: {},
    },
  });

  const registry = createAgentToolRegistry();
  const context: ToolExecutionContext = {
    db: prisma,
    conversationId: conversation.id,
    customerId: customer.id,
    now,
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
  };

  return {
    prisma,
    registry,
    context,
    customer,
    service,
    availableSlot,
    alternativeSlot,
    unavailableSlot,
    conversation,
  };
}

export function dateKeyInTimeZone(date: Date, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
