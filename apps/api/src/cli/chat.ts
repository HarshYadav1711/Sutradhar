import 'dotenv/config';

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createPrismaClient } from '../db/client.js';
import {
  DemoResetResponseSchema,
  SimulatorMessageResponseSchema,
} from '@sutradhar/contracts';

const DEFAULT_CUSTOMER_KEY = 'simulator:local-demo';

function printHelp(): void {
  output.write('Commands: /reset  /quit  /help\n');
  output.write('Type a message to talk to Sutradhar through the local simulator.\n\n');
}

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    ENABLE_SIMULATOR: process.env.ENABLE_SIMULATOR ?? 'true',
  });

  if (!config.ENABLE_SIMULATOR) {
    output.write('Simulator is disabled. Set ENABLE_SIMULATOR=true to use chat.\n');
    process.exitCode = 1;
    return;
  }

  const db = createPrismaClient(config.DATABASE_URL);
  const app = await buildApp({
    config,
    db,
    logger: false,
  });

  const customerKey = process.env.SIMULATOR_CUSTOMER_KEY?.trim() || DEFAULT_CUSTOMER_KEY;
  let startFreshNext = true;

  output.write('Sutradhar local chat\n');
  output.write(`Customer: ${customerKey}\n`);
  output.write(`API boundary: in-process simulator (no Meta credentials required)\n\n`);
  printHelp();

  const rl = readline.createInterface({ input, output, terminal: true });

  const shutdown = async () => {
    rl.close();
    await app.close();
    await db.$disconnect();
  };

  try {
    for (;;) {
      const line = (await rl.question('You> ')).trim();
      if (line === '') {
        continue;
      }

      if (line === '/quit' || line === '/exit') {
        output.write('Goodbye.\n');
        break;
      }

      if (line === '/help') {
        printHelp();
        continue;
      }

      if (line === '/reset') {
        const resetResponse = await app.inject({
          method: 'POST',
          url: '/api/simulator/reset',
        });
        if (resetResponse.statusCode !== 200) {
          output.write(`Reset failed (${resetResponse.statusCode}): ${resetResponse.body}\n`);
          continue;
        }
        DemoResetResponseSchema.parse(resetResponse.json());
        startFreshNext = true;
        output.write('Demo data reset. Next message starts a clean conversation.\n');
        continue;
      }

      if (line.startsWith('/')) {
        output.write('Unknown command. Try /help\n');
        continue;
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/simulator/messages',
        payload: {
          customerKey,
          text: line,
          startFresh: startFreshNext,
        },
      });
      startFreshNext = false;

      if (response.statusCode !== 200) {
        output.write(`Agent error (${response.statusCode}): ${response.body}\n`);
        continue;
      }

      const body = SimulatorMessageResponseSchema.parse(response.json());
      const agentText = body.outboundText?.trim() || '(no outbound text)';
      output.write(`Agent> ${agentText}\n`);
      if (body.bookingReference) {
        output.write(`(booking ${body.bookingReference})\n`);
      }
      if (body.handoffReference) {
        output.write(`(handoff ${body.handoffReference})\n`);
      }
    }
  } finally {
    await shutdown();
  }
}

void main().catch(async (error) => {
  output.write(`Chat failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
