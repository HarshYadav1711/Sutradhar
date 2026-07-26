import { describe, expect, it } from 'vitest';

import { AGENT_SYSTEM_INSTRUCTION } from '../src/agent/index.js';

describe('AGENT_SYSTEM_INSTRUCTION', () => {
  it('does not request chain-of-thought or hidden reasoning', () => {
    const lowered = AGENT_SYSTEM_INSTRUCTION.toLowerCase();

    expect(lowered).not.toContain('chain-of-thought');
    expect(lowered).not.toContain('chain of thought');
    expect(lowered).not.toContain('think step by step');
    expect(lowered).not.toContain('hidden reasoning');
    expect(lowered).not.toContain('show your reasoning');
    expect(lowered).not.toContain('scratchpad');
  });

  it('requires tools for operational facts and forbids inventing prices or availability', () => {
    expect(AGENT_SYSTEM_INSTRUCTION).toContain('Use tools for operational facts');
    expect(AGENT_SYSTEM_INSTRUCTION).toContain('Do not invent prices, availability');
    expect(AGENT_SYSTEM_INSTRUCTION).toContain('Do not promise refunds');
    expect(AGENT_SYSTEM_INSTRUCTION).toContain('create_handoff');
  });
});
