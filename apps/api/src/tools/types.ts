import type { z } from 'zod';

import type { PrismaClient } from '../db/client.js';
import type { JsonValue } from '../repositories/types.js';

export type ToolExecutionContext = {
  db: PrismaClient;
  conversationId: string;
  customerId: string;
  now?: Date;
  timeZone?: string;
  currency?: string;
};

export type ToolResult<TOutput> =
  | {
      ok: true;
      toolName: string;
      data: TOutput;
      durationMs: number;
      toolExecutionId: string;
    }
  | {
      ok: false;
      toolName: string;
      errorCode: string;
      errorMessage: string;
      durationMs: number;
      toolExecutionId: string;
      validationIssues?: JsonValue;
    };

export type AgentTool<TSchema extends z.ZodType, TOutput> = {
  name: string;
  description: string;
  inputSchema: TSchema;
  execute: (
    input: z.infer<TSchema>,
    context: ToolExecutionContext,
  ) => Promise<TOutput>;
};

export type AnyAgentTool = AgentTool<z.ZodType, unknown>;
