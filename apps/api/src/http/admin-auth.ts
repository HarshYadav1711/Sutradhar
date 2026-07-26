import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Constant-time comparison for admin bearer tokens.
 */
export function tokensEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  if (left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

export function assertAdminAuthorized(input: {
  authorizationHeader: string | undefined;
  adminToken: string;
}): void {
  if (!input.adminToken || input.adminToken.trim() === '') {
    const error = new Error('Admin API token is not configured');
    (error as Error & { statusCode: number; code: string }).statusCode = 503;
    (error as Error & { statusCode: number; code: string }).code = 'ADMIN_TOKEN_UNCONFIGURED';
    throw error;
  }

  const provided = extractBearerToken(input.authorizationHeader);
  if (!provided || !tokensEqual(provided, input.adminToken)) {
    const error = new Error('Unauthorized');
    (error as Error & { statusCode: number; code: string }).statusCode = 401;
    (error as Error & { statusCode: number; code: string }).code = 'UNAUTHORIZED';
    throw error;
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  adminToken: string,
): Promise<boolean> {
  try {
    assertAdminAuthorized({
      authorizationHeader: request.headers.authorization,
      adminToken,
    });
    return true;
  } catch (error) {
    const statusCode =
      error instanceof Error && 'statusCode' in error
        ? Number((error as { statusCode: number }).statusCode)
        : 401;
    const code =
      error instanceof Error && 'code' in error
        ? String((error as { code: string }).code)
        : 'UNAUTHORIZED';
    const message = error instanceof Error ? error.message : 'Unauthorized';

    await reply.code(statusCode).send({
      error: {
        code,
        message,
        ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
      },
    });
    return false;
  }
}
