import { createPrismaClient, type PrismaClient } from './client.js';

export class DatabaseLifecycle {
  private client: PrismaClient | undefined;

  get prisma(): PrismaClient {
    if (!this.client) {
      throw new Error('Database client has not been started');
    }
    return this.client;
  }

  start(databaseUrl?: string): PrismaClient {
    if (this.client) {
      return this.client;
    }

    this.client = createPrismaClient(databaseUrl);
    return this.client;
  }

  async stop(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.$disconnect();
    this.client = undefined;
  }
}

export const databaseLifecycle = new DatabaseLifecycle();
