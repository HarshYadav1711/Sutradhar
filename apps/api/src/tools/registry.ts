import { ZodError, type z } from 'zod';

import { isDomainError, toSafeErrorCode, toSafeErrorMessage } from '../domain/errors.js';
import type { JsonValue } from '../repositories/types.js';
import type { AgentTool, AnyAgentTool, ToolExecutionContext, ToolResult } from './types.js';

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AnyAgentTool>();

  register<TSchema extends z.ZodType, TOutput>(tool: AgentTool<TSchema, TOutput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as AnyAgentTool);
  }

  get(name: string): AnyAgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AnyAgentTool[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    name: string,
    rawInput: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult<unknown>> {
    const tool = this.tools.get(name);
    const started = Date.now();

    if (!tool) {
      const durationMs = Date.now() - started;
      const execution = await context.db.toolExecution.create({
        data: {
          conversationId: context.conversationId,
          toolName: name,
          validatedInput: {},
          status: 'ERROR',
          durationMs,
          errorCode: 'TOOL_NOT_FOUND',
          errorMessage: `Unknown tool: ${name}`,
        },
      });

      return {
        ok: false,
        toolName: name,
        errorCode: 'TOOL_NOT_FOUND',
        errorMessage: `Unknown tool: ${name}`,
        durationMs,
        toolExecutionId: execution.id,
      };
    }

    let validatedInput: unknown;
    try {
      validatedInput = tool.inputSchema.parse(rawInput);
    } catch (error) {
      const durationMs = Date.now() - started;
      const issues =
        error instanceof ZodError ? toJsonValue(error.issues) : toJsonValue({ message: 'Invalid input' });

      const execution = await context.db.toolExecution.create({
        data: {
          conversationId: context.conversationId,
          toolName: tool.name,
          validatedInput: toJsonValue(rawInput ?? {}),
          status: 'VALIDATION_ERROR',
          durationMs,
          errorCode: 'VALIDATION_ERROR',
          errorMessage: 'Tool input failed validation',
          output: issues,
        },
      });

      return {
        ok: false,
        toolName: tool.name,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Tool input failed validation',
        durationMs,
        toolExecutionId: execution.id,
        validationIssues: issues,
      };
    }

    try {
      const data = await tool.execute(validatedInput, context);
      const durationMs = Date.now() - started;
      const serialised = toJsonValue(data);

      const execution = await context.db.toolExecution.create({
        data: {
          conversationId: context.conversationId,
          toolName: tool.name,
          validatedInput: toJsonValue(validatedInput),
          status: 'SUCCESS',
          durationMs,
          output: serialised,
        },
      });

      return {
        ok: true,
        toolName: tool.name,
        data,
        durationMs,
        toolExecutionId: execution.id,
      };
    } catch (error) {
      const durationMs = Date.now() - started;
      const errorCode = isDomainError(error) ? error.code : toSafeErrorCode(error);
      const errorMessage = toSafeErrorMessage(error);

      const execution = await context.db.toolExecution.create({
        data: {
          conversationId: context.conversationId,
          toolName: tool.name,
          validatedInput: toJsonValue(validatedInput),
          status: 'ERROR',
          durationMs,
          errorCode,
          errorMessage,
        },
      });

      return {
        ok: false,
        toolName: tool.name,
        errorCode,
        errorMessage,
        durationMs,
        toolExecutionId: execution.id,
      };
    }
  }
}
