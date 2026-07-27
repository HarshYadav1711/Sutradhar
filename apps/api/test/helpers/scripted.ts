import type { ScriptedModelResponse } from '../../src/agent/model/scripted-provider.js';

export function toolCall(
  name: string,
  args: Record<string, unknown>,
  id = `call_${name}`,
): ScriptedModelResponse {
  return {
    text: null,
    toolCalls: [{ id, name, arguments: args }],
    finishReason: 'tool_calls',
    model: 'scripted',
  };
}

export function textReply(text: string): ScriptedModelResponse {
  return {
    text,
    toolCalls: [],
    finishReason: 'stop',
    model: 'scripted',
  };
}
