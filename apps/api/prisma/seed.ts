import 'dotenv/config';

import { createPrismaClient } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  try {
    const result = await seedDatabase(prisma);
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
