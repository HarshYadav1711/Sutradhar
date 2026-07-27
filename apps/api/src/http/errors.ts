import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
};

export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: string,
  message: string,
) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
    },
  };
  return reply.code(statusCode).send(body);
}

export function zodErrorMessage(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ') || 'Validation failed';
}

export function parseOrThrow<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false; error: ZodError };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const error = new Error(zodErrorMessage(parsed.error));
    (error as Error & { statusCode: number; code: string; zodError: ZodError }).statusCode = 400;
    (error as Error & { statusCode: number; code: string; zodError: ZodError }).code =
      'VALIDATION_ERROR';
    (error as Error & { statusCode: number; code: string; zodError: ZodError }).zodError =
      parsed.error;
    throw error;
  }
  return parsed.data;
}

/**
 * Builds a client-safe error envelope. Never includes stack traces or secret values.
 */
export function toPublicErrorBody(input: {
  requestId?: string;
  statusCode: number;
  code?: string;
  message?: string;
  nodeEnv: string;
  secrets?: Array<string | undefined | null>;
}): ApiErrorBody {
  const isServerError = input.statusCode >= 500;
  let message =
    isServerError && input.nodeEnv === 'production'
      ? 'Internal server error'
      : (input.message ?? 'Request failed');

  for (const secret of input.secrets ?? []) {
    if (!secret || secret.trim().length < 4) {
      continue;
    }
    message = message.split(secret).join('[REDACTED]');
  }

  return {
    error: {
      code: input.code ?? (isServerError ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    },
  };
}
