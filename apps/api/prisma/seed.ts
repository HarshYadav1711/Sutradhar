import 'dotenv/config';

import { loadConfig } from '../src/config.js';
import { createPrismaClient } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = createPrismaClient(config.DATABASE_URL);

  try {
    const result = await seedDatabase(prisma, {
      timezone: config.BUSINESS_TIMEZONE,
    });
    console.log(
      `Seeded ${result.serviceCount} services, ${result.slotCount} slots (${result.availableSlotCount} available, ${result.unavailableSlotCount} unavailable), timezone=${result.timezone}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
