import type { FastifyInstance } from 'fastify';
import {
  ConversationStatusSchema,
  OperatorBookingDetailSchema,
  OperatorBookingListResponseSchema,
  OperatorConversationDetailSchema,
  OperatorConversationListResponseSchema,
  OperatorConversationTraceSchema,
  OperatorHandoffDetailSchema,
  OperatorHandoffListResponseSchema,
  OperatorHandoffUpdateRequestSchema,
  OperatorOverviewSchema,
  PaginationQuerySchema,
  HandoffStatusSchema,
} from '@sutradhar/contracts';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import { requireAdmin } from '../http/admin-auth.js';
import { parseOrThrow, sendError } from '../http/errors.js';
import type { OperatorQueryService } from '../services/operator-query-service.js';

const BookingStatusFilterSchema = z.enum([
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'RESCHEDULED',
  'CANCELLED',
  'COMPLETED',
]);

export async function registerOperatorRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    operator: OperatorQueryService;
  },
): Promise<void> {
  const authorize = async (request: Parameters<typeof requireAdmin>[0], reply: Parameters<typeof requireAdmin>[1]) =>
    requireAdmin(request, reply, deps.config.ADMIN_API_TOKEN);

  app.get('/api/operator/overview', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }
    const overview = await deps.operator.getOverview();
    return OperatorOverviewSchema.parse(overview);
  });

  app.get('/api/operator/conversations', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    let query;
    try {
      const pagination = parseOrThrow(PaginationQuerySchema, request.query);
      const statusRaw = (request.query as { status?: string }).status;
      const status = statusRaw
        ? parseOrThrow(ConversationStatusSchema, statusRaw)
        : undefined;
      query = { ...pagination, ...(status ? { status } : {}) };
    } catch (error) {
      return sendError(
        reply,
        request,
        400,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Validation failed',
      );
    }

    const result = await deps.operator.listConversations(query);
    return OperatorConversationListResponseSchema.parse(result);
  });

  app.get('/api/operator/conversations/:conversationId', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    const { conversationId } = request.params as { conversationId: string };
    const detail = await deps.operator.getConversation(conversationId);
    if (!detail) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'Conversation not found');
    }
    return OperatorConversationDetailSchema.parse(detail);
  });

  app.get('/api/operator/conversations/:conversationId/trace', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    const { conversationId } = request.params as { conversationId: string };
    const trace = await deps.operator.getConversationTrace(conversationId);
    if (!trace) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'Conversation not found');
    }

    const payload = OperatorConversationTraceSchema.parse(trace);
    // Privacy: never include system prompts, secrets, or model reasoning fields.
    return payload;
  });

  app.get('/api/operator/bookings', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    let query;
    try {
      const pagination = parseOrThrow(PaginationQuerySchema, request.query);
      const statusRaw = (request.query as { status?: string }).status;
      const status = statusRaw ? parseOrThrow(BookingStatusFilterSchema, statusRaw) : undefined;
      query = { ...pagination, ...(status ? { status } : {}) };
    } catch (error) {
      return sendError(
        reply,
        request,
        400,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Validation failed',
      );
    }

    const result = await deps.operator.listBookings(query);
    return OperatorBookingListResponseSchema.parse(result);
  });

  app.get('/api/operator/bookings/:bookingId', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    const { bookingId } = request.params as { bookingId: string };
    const detail = await deps.operator.getBooking(bookingId);
    if (!detail) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'Booking not found');
    }
    return OperatorBookingDetailSchema.parse(detail);
  });

  app.get('/api/operator/handoffs', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    let query;
    try {
      const pagination = parseOrThrow(PaginationQuerySchema, request.query);
      const statusRaw = (request.query as { status?: string }).status;
      const status = statusRaw ? parseOrThrow(HandoffStatusSchema, statusRaw) : undefined;
      query = { ...pagination, ...(status ? { status } : {}) };
    } catch (error) {
      return sendError(
        reply,
        request,
        400,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Validation failed',
      );
    }

    const result = await deps.operator.listHandoffs(query);
    return OperatorHandoffListResponseSchema.parse(result);
  });

  app.get('/api/operator/handoffs/:handoffId', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    const { handoffId } = request.params as { handoffId: string };
    const detail = await deps.operator.getHandoff(handoffId);
    if (!detail) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'Handoff not found');
    }
    return OperatorHandoffDetailSchema.parse(detail);
  });

  app.patch('/api/operator/handoffs/:handoffId', async (request, reply) => {
    if (!(await authorize(request, reply))) {
      return;
    }

    let body;
    try {
      body = parseOrThrow(OperatorHandoffUpdateRequestSchema, request.body);
    } catch (error) {
      return sendError(
        reply,
        request,
        400,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Validation failed',
      );
    }

    const { handoffId } = request.params as { handoffId: string };
    const updated = await deps.operator.updateHandoff(handoffId, body);
    if (!updated) {
      return sendError(reply, request, 404, 'NOT_FOUND', 'Handoff not found');
    }
    return OperatorHandoffDetailSchema.parse(updated);
  });
}
