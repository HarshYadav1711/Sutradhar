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
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: ZodError } },
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
