import {
  ErrorEnvelopeSchema,
  OperatorBookingListResponseSchema,
  OperatorConversationDetailSchema,
  OperatorConversationListResponseSchema,
  OperatorConversationTraceSchema,
  OperatorHandoffDetailSchema,
  OperatorHandoffListResponseSchema,
  OperatorHandoffUpdateRequestSchema,
  OperatorOverviewSchema,
  type OperatorBookingListResponse,
  type OperatorConversationDetail,
  type OperatorConversationListResponse,
  type OperatorConversationTrace,
  type OperatorHandoffDetail,
  type OperatorHandoffListResponse,
  type OperatorHandoffUpdateRequest,
  type OperatorOverview,
} from '@sutradhar/contracts';

import { clearOperatorToken, readOperatorToken } from './auth';

export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type OperatorApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => string | null;
  onUnauthorized?: () => void;
};

function resolveBaseUrl(explicit?: string): string {
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.replace(/\/$/, '');
  }
  return 'http://127.0.0.1:4000';
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') {
      continue;
    }
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export class OperatorApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized: (() => void) | undefined;

  constructor(options: OperatorApiClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    // Wrap global fetch — extracting `window.fetch` and calling it unbound throws
    // "Illegal invocation" in browsers.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.getToken = options.getToken ?? readOperatorToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  async getOverview(): Promise<OperatorOverview> {
    return this.request('/api/operator/overview', OperatorOverviewSchema);
  }

  async listConversations(input: {
    page?: number;
    pageSize?: number;
    status?: string;
  } = {}): Promise<OperatorConversationListResponse> {
    const query = buildQuery({
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 20,
      status: input.status,
    });
    return this.request(`/api/operator/conversations${query}`, OperatorConversationListResponseSchema);
  }

  async getConversation(conversationId: string): Promise<OperatorConversationDetail> {
    return this.request(
      `/api/operator/conversations/${encodeURIComponent(conversationId)}`,
      OperatorConversationDetailSchema,
    );
  }

  async getConversationTrace(conversationId: string): Promise<OperatorConversationTrace> {
    return this.request(
      `/api/operator/conversations/${encodeURIComponent(conversationId)}/trace`,
      OperatorConversationTraceSchema,
    );
  }

  async listBookings(input: {
    page?: number;
    pageSize?: number;
    status?: string;
  } = {}): Promise<OperatorBookingListResponse> {
    const query = buildQuery({
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 20,
      status: input.status,
    });
    return this.request(`/api/operator/bookings${query}`, OperatorBookingListResponseSchema);
  }

  async listHandoffs(input: {
    page?: number;
    pageSize?: number;
    status?: string;
  } = {}): Promise<OperatorHandoffListResponse> {
    const query = buildQuery({
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 20,
      status: input.status,
    });
    return this.request(`/api/operator/handoffs${query}`, OperatorHandoffListResponseSchema);
  }

  async updateHandoff(
    handoffId: string,
    patch: OperatorHandoffUpdateRequest,
  ): Promise<OperatorHandoffDetail> {
    const body = OperatorHandoffUpdateRequestSchema.parse(patch);
    return this.request(
      `/api/operator/handoffs/${encodeURIComponent(handoffId)}`,
      OperatorHandoffDetailSchema,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    );
  }

  private async request<T>(
    path: string,
    schema: { parse: (value: unknown) => T },
    init: RequestInit = {},
  ): Promise<T> {
    const token = this.getToken();
    if (!token) {
      throw new ApiClientError('Operator token is required', 401, 'UNAUTHORIZED');
    }

    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    const text = await response.text();
    let json: unknown = null;
    if (text.trim() !== '') {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        throw new ApiClientError('Invalid JSON response from API', response.status, 'INVALID_JSON');
      }
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 503) {
        this.onUnauthorized?.();
        if (response.status === 401) {
          clearOperatorToken();
        }
      }

      const envelope = ErrorEnvelopeSchema.safeParse(json);
      const code = envelope.success ? envelope.data.error.code : 'HTTP_ERROR';
      const message = envelope.success
        ? envelope.data.error.message
        : `Request failed with status ${response.status}`;
      throw new ApiClientError(message, response.status, code);
    }

    return schema.parse(json);
  }
}

export function createOperatorApiClient(options?: OperatorApiClientOptions): OperatorApiClient {
  return new OperatorApiClient(options);
}
