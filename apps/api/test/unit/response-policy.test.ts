import { describe, expect, it } from 'vitest';

import {
  looksLikeLeakedToolCall,
  sanitizeCustomerResponse,
} from '../../src/agent/response-policy.js';

describe('sanitizeCustomerResponse', () => {
  it('rejects leaked tool-call JSON blobs', () => {
    const leaked =
      '{"name":"prepare_booking","parameters":{"serviceId":"svc_1","availabilitySlotId":"slot_1","quantity":1,"address":"Sector 62"}}';

    expect(looksLikeLeakedToolCall(leaked)).toBe(true);
    expect(sanitizeCustomerResponse(leaked)).toBe('');
  });

  it('still redacts tool names in normal prose', () => {
    expect(sanitizeCustomerResponse('I will use prepare_booking next.')).toBe(
      'I will use that step next.',
    );
  });

  it('normalises broken Hinglish apology tokens', () => {
    expect(sanitizeCustomerResponse('Mafik Hai, shaam 4 baje theek hai.')).toBe(
      'Maaf kijiyega, shaam 4 baje theek hai.',
    );
    expect(sanitizeCustomerResponse('Maaf, mujhe lagta hai galat kaha.')).toBe(
      'Maaf kijiyega, mujhe lagta hai galat kaha.',
    );
    expect(sanitizeCustomerResponse('Maaf kijiyega, thoda wait karein.')).toBe(
      'Maaf kijiyega, thoda wait karein.',
    );
  });
});
