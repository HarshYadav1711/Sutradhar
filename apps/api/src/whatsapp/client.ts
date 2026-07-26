export type WhatsAppSendTextInput = {
  to: string;
  body: string;
};

export type WhatsAppSendTextResult = {
  messageId: string | null;
  raw: unknown;
};

export type WhatsAppClientOptions = {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    error: (obj: Record<string, unknown>, msg?: string) => void;
    warn?: (obj: Record<string, unknown>, msg?: string) => void;
  };
  maxRetries?: number;
};

export class WhatsAppClientError extends Error {
  readonly code: string;
  readonly statusCode: number | null;
  readonly retryable: boolean;
  readonly metaError?: unknown;

  constructor(input: {
    message: string;
    code: string;
    statusCode?: number | null;
    retryable: boolean;
    metaError?: unknown;
  }) {
    super(input.message);
    this.name = 'WhatsAppClientError';
    this.code = input.code;
    this.statusCode = input.statusCode ?? null;
    this.retryable = input.retryable;
    this.metaError = input.metaError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseMetaError(payload: unknown): { message: string; code: string; details: unknown } {
  if (!payload || typeof payload !== 'object') {
    return { message: 'WhatsApp API request failed', code: 'WHATSAPP_HTTP_ERROR', details: null };
  }

  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') {
    return { message: 'WhatsApp API request failed', code: 'WHATSAPP_HTTP_ERROR', details: payload };
  }

  const record = error as Record<string, unknown>;
  const message =
    typeof record.message === 'string' && record.message.trim() !== ''
      ? record.message
      : 'WhatsApp API request failed';
  const code =
    typeof record.code === 'number'
      ? `META_${record.code}`
      : typeof record.type === 'string'
        ? record.type
        : 'WHATSAPP_HTTP_ERROR';

  return {
    message,
    code,
    details: {
      type: record.type ?? null,
      code: record.code ?? null,
      error_subcode: record.error_subcode ?? null,
      fbtrace_id: record.fbtrace_id ?? null,
    },
  };
}

/**
 * Official WhatsApp Cloud API client using native fetch.
 */
export class WhatsAppClient {
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(private readonly options: WhatsAppClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 2;
  }

  buildMessagesUrl(): string {
    const version = this.options.graphVersion.replace(/^\/+|\/+$/g, '');
    const phoneNumberId = this.options.phoneNumberId;
    return `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  }

  async sendText(input: WhatsAppSendTextInput): Promise<WhatsAppSendTextResult> {
    const url = this.buildMessagesUrl();
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'text',
      text: {
        preview_url: false,
        body: input.body,
      },
    };

    let attempt = 0;
    const totalAttempts = this.maxRetries + 1;

    while (attempt < totalAttempts) {
      attempt += 1;
      try {
        const result = await this.postJson(url, payload);
        const messageId = extractOutboundMessageId(result);
        this.options.logger?.info(
          {
            to: input.to,
            outboundMessageId: messageId,
          },
          'WhatsApp outbound message sent',
        );
        return { messageId, raw: result };
      } catch (error) {
        const clientError =
          error instanceof WhatsAppClientError
            ? error
            : new WhatsAppClientError({
                message: error instanceof Error ? error.message : 'WhatsApp send failed',
                code: 'WHATSAPP_SEND_FAILED',
                retryable: true,
              });

        const retriesLeft = attempt < totalAttempts && clientError.retryable;
        if (!retriesLeft) {
          this.options.logger?.error(
            {
              code: clientError.code,
              statusCode: clientError.statusCode,
            },
            'WhatsApp outbound message failed',
          );
          throw clientError;
        }

        const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
        this.options.logger?.warn?.(
          { attempt, backoffMs, code: clientError.code },
          'Retrying WhatsApp outbound message',
        );
        await sleep(backoffMs);
      }
    }

    throw new WhatsAppClientError({
      message: 'WhatsApp send failed after retries',
      code: 'WHATSAPP_SEND_FAILED',
      retryable: true,
    });
  }

  private async postJson(url: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim() !== '') {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          parsed = { raw: text.slice(0, 500) };
        }
      }

      if (!response.ok) {
        const meta = parseMetaError(parsed);
        throw new WhatsAppClientError({
          message: meta.message,
          code: meta.code,
          statusCode: response.status,
          retryable: isRetryableStatus(response.status),
          metaError: meta.details,
        });
      }

      return parsed;
    } catch (error) {
      if (error instanceof WhatsAppClientError) {
        throw error;
      }

      const aborted =
        (error instanceof Error && error.name === 'AbortError') ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name?: string }).name === 'AbortError');

      throw new WhatsAppClientError({
        message: aborted
          ? 'WhatsApp request timed out'
          : error instanceof Error
            ? error.message
            : 'WhatsApp transport failure',
        code: aborted ? 'WHATSAPP_TIMEOUT' : 'WHATSAPP_TRANSPORT_ERROR',
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractOutboundMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const first = messages[0];
  if (!first || typeof first !== 'object') {
    return null;
  }
  const id = (first as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}
