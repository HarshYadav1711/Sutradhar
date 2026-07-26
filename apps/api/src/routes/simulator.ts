import type { FastifyInstance } from 'fastify';
import {
  DemoResetResponseSchema,
  SimulatorMessageRequestSchema,
  SimulatorMessageResponseSchema,
} from '@sutradhar/contracts';

import type { AppConfig } from '../config.js';
import { parseOrThrow, sendError } from '../http/errors.js';
import type { SimulatorService } from '../services/simulator-service.js';

export async function registerSimulatorRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    simulator: SimulatorService;
  },
): Promise<void> {
  app.post('/api/simulator/messages', async (request, reply) => {
    if (!deps.config.ENABLE_SIMULATOR) {
      return sendError(reply, request, 404, 'SIMULATOR_DISABLED', 'Simulator is disabled');
    }

    let body;
    try {
      body = parseOrThrow(SimulatorMessageRequestSchema, request.body);
    } catch (error) {
      return sendError(
        reply,
        request,
        400,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Validation failed',
      );
    }

    const result = await deps.simulator.sendMessage({
      ...body,
      ...(typeof request.id === 'string' ? { requestId: request.id } : {}),
    });

    const payload = SimulatorMessageResponseSchema.parse({
      conversationId: result.conversationId,
      customerId: result.customerId,
      inboundMessageId: result.inboundMessageId,
      outboundMessageId: result.outboundMessageId,
      outboundText: result.outboundText,
      conversationStatus: result.conversationStatus,
      outcome: result.outcome,
      bookingId: result.bookingId,
      bookingReference: result.bookingReference,
      handoffId: result.handoffId,
      handoffReference: result.handoffReference,
      pendingActionId: result.pendingActionId,
      duplicated: result.duplicated,
      stepsUsed: result.stepsUsed,
    });

    return reply.code(200).send(payload);
  });

  app.post('/api/simulator/reset', async (request, reply) => {
    if (!deps.config.ENABLE_SIMULATOR) {
      return sendError(reply, request, 404, 'SIMULATOR_DISABLED', 'Simulator is disabled');
    }

    const result = await deps.simulator.resetDemo();
    return reply.code(200).send(DemoResetResponseSchema.parse(result));
  });
}
