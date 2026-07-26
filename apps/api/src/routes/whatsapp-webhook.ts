import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AppConfig } from '../config.js';
import { sendError } from '../http/errors.js';
import type { WebhookInboxService } from '../whatsapp/inbox.js';
import type { NormalizedWhatsAppEvent } from '../whatsapp/normalize.js';
import { verifyWhatsAppSignature } from '../whatsapp/signature.js';
import { verifyWhatsAppSubscription } from '../whatsapp/verify.js';

export type WhatsAppWebhookRequest = FastifyRequest & {
  rawBody?: Buffer;
};

export async function registerWhatsAppWebhookRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    inbox: WebhookInboxService;
  },
): Promise<void> {
  // Encapsulate the raw-body JSON parser so other routes keep the default parser.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (request, body, done) => {
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
        (request as WhatsAppWebhookRequest).rawBody = raw;
        try {
          const json = JSON.parse(raw.toString('utf8')) as unknown;
          done(null, json);
        } catch {
          const error = new Error('Invalid JSON payload');
          (error as Error & { statusCode: number }).statusCode = 400;
          done(error, undefined);
        }
      },
    );

    scope.get('/webhooks/whatsapp', async (request, reply) => {
      if (!deps.config.WHATSAPP_ENABLED) {
        return sendError(reply, request, 503, 'WHATSAPP_DISABLED', 'WhatsApp integration is disabled');
      }

      const result = verifyWhatsAppSubscription(
        request.query as {
          'hub.mode'?: string;
          'hub.verify_token'?: string;
          'hub.challenge'?: string;
        },
        deps.config.WHATSAPP_VERIFY_TOKEN,
      );

      if (!result.ok) {
        request.log.warn({ code: result.code }, 'WhatsApp webhook verification failed');
        return sendError(reply, request, 403, result.code, result.message);
      }

      reply.header('content-type', 'text/plain; charset=utf-8');
      return reply.code(200).send(result.challenge);
    });

    scope.post('/webhooks/whatsapp', async (request, reply) => {
      if (!deps.config.WHATSAPP_ENABLED) {
        return sendError(reply, request, 503, 'WHATSAPP_DISABLED', 'WhatsApp integration is disabled');
      }

      const rawBody = (request as WhatsAppWebhookRequest).rawBody;
      if (!rawBody) {
        return sendError(reply, request, 400, 'MISSING_RAW_BODY', 'Raw request body is required');
      }

      const signatureHeader = request.headers['x-hub-signature-256'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

      const valid = verifyWhatsAppSignature({
        rawBody,
        signatureHeader: signature,
        appSecret: deps.config.META_APP_SECRET,
      });

      if (!valid) {
        request.log.warn(
          {
            hasSignature: Boolean(signature),
          },
          'WhatsApp webhook signature validation failed',
        );
        return sendError(
          reply,
          request,
          401,
          signature ? 'INVALID_SIGNATURE' : 'MISSING_SIGNATURE',
          signature ? 'Invalid WhatsApp signature' : 'Missing WhatsApp signature',
        );
      }

      const events: NormalizedWhatsAppEvent[] = (() => {
        try {
          return deps.inbox.normalize(request.body);
        } catch {
          return [];
        }
      })();

      const enqueue = await deps.inbox.enqueueNormalizedEvents(events);

      return reply.code(200).send({
        ok: true,
        accepted: enqueue.accepted,
        duplicates: enqueue.duplicates,
      });
    });
  });
}
