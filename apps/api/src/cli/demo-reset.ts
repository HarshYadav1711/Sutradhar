import '../load-env.js';

import { loadConfig } from '../config.js';
import { createPrismaClient } from '../db/client.js';
import { seedDatabase } from '../db/seed.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPrismaClient(config.DATABASE_URL);

  try {
    const result = await seedDatabase(db, {
      now: new Date(),
      timezone: config.BUSINESS_TIMEZONE,
    });

    process.stdout.write(
      [
        'Demo reset complete.',
        `timezone=${result.timezone}`,
        `services=${result.serviceCount}`,
        `slots=${result.slotCount}`,
        `available=${result.availableSlotCount}`,
        `demoCustomerId=${result.demoCustomerId}`,
        'Schema migrations were not modified.',
      ].join('\n') + '\n',
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `Demo reset failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
