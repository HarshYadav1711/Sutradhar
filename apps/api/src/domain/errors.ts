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
