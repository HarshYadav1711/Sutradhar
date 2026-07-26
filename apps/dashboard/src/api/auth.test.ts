import { afterEach, describe, expect, it } from 'vitest';

import {
  clearOperatorToken,
  hasOperatorToken,
  readOperatorToken,
  writeOperatorToken,
} from '../api/auth';

describe('operator auth storage', () => {
  afterEach(() => {
    clearOperatorToken();
  });

  it('stores tokens in sessionStorage only', () => {
    writeOperatorToken('session-token');
    expect(hasOperatorToken()).toBe(true);
    expect(readOperatorToken()).toBe('session-token');
    expect(sessionStorage.getItem('sutradhar.operator.token')).toBe('session-token');
    expect(localStorage.getItem('sutradhar.operator.token')).toBeNull();
    clearOperatorToken();
    expect(hasOperatorToken()).toBe(false);
  });
});
