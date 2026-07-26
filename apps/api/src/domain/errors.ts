export class DomainConflictError extends Error {
  readonly code = 'DOMAIN_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'DomainConflictError';
  }
}

export class DomainNotFoundError extends Error {
  readonly code = 'DOMAIN_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'DomainNotFoundError';
  }
}

export class DomainValidationError extends Error {
  readonly code = 'DOMAIN_VALIDATION';

  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export class DomainExpiredError extends Error {
  readonly code = 'DOMAIN_EXPIRED';

  constructor(message: string) {
    super(message);
    this.name = 'DomainExpiredError';
  }
}

export function isDomainError(
  error: unknown,
): error is
  | DomainConflictError
  | DomainNotFoundError
  | DomainValidationError
  | DomainExpiredError {
  return (
    error instanceof DomainConflictError ||
    error instanceof DomainNotFoundError ||
    error instanceof DomainValidationError ||
    error instanceof DomainExpiredError
  );
}

export function toSafeErrorMessage(error: unknown): string {
  if (isDomainError(error)) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return 'An unexpected domain error occurred';
  }

  return 'An unexpected domain error occurred';
}

export function toSafeErrorCode(error: unknown): string {
  if (isDomainError(error)) {
    return error.code;
  }

  return 'UNEXPECTED_ERROR';
}
