import { z } from 'zod';

import type { AnyAgentTool } from '../../tools/types.js';
import type { ModelToolDefinition } from './types.js';

export function zodSchemaToParameters(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}

export function toolToModelDefinition(tool: AnyAgentTool): ModelToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: zodSchemaToParameters(tool.inputSchema),
  };
}
