const TOKEN_KEY = 'sutradhar.operator.token';

/**
 * Operator token storage. Uses sessionStorage only — never localStorage.
 * Callers must not log or render the token value.
 */
export function readOperatorToken(): string | null {
  try {
    const value = sessionStorage.getItem(TOKEN_KEY);
    if (!value || value.trim() === '') {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function writeOperatorToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearOperatorToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function hasOperatorToken(): boolean {
  return readOperatorToken() !== null;
}
