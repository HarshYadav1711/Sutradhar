import { HealthResponseSchema, type HealthResponse } from '@sutradhar/contracts';

/**
 * Parses an unknown health payload using the shared contract schema.
 * Keeps the dashboard dependent on @sutradhar/contracts instead of a local type.
 */
export function parseHealthResponse(data: unknown): HealthResponse {
  return HealthResponseSchema.parse(data);
}
