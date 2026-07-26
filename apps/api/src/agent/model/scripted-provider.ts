import type {
  ModelCompleteOptions,
  ModelHealthStatus,
  ModelProvider,
  ModelRequest,
  ModelResult,
  ModelSuccessResult,
} from './types.js';

export type ScriptedModelResponse = Omit<ModelSuccessResult, 'ok' | 'provider'> & {
  provider?: string;
};

export type ScriptedModelProviderOptions = {
  /**
   * Explicit test-environment override.
   * Production remains blocked even when this is true.
   */
  allowInNonTestEnv?: boolean;
  env?: NodeJS.ProcessEnv;
};

function assertScriptedProviderAllowed(options: ScriptedModelProviderOptions): void {
  const env = options.env ?? process.env;
  const nodeEnv = env.NODE_ENV ?? 'development';

  if (nodeEnv === 'production') {
    throw new Error('ScriptedModelProvider cannot be activated in production mode');
  }

  const allowed =
    nodeEnv === 'test' ||
    env.SUTRADHAR_ALLOW_SCRIPTED_MODEL === 'true' ||
    options.allowInNonTestEnv === true;

  if (!allowed) {
    throw new Error(
      'ScriptedModelProvider is test-only. Set NODE_ENV=test or SUTRADHAR_ALLOW_SCRIPTED_MODEL=true.',
    );
  }
}

/**
 * Deterministic queued model responses for automated tests only.
 * This is not the real AI implementation.
 */
export class ScriptedModelProvider implements ModelProvider {
  readonly name = 'scripted-test-only';

  private readonly queue: ScriptedModelResponse[];
  private readonly modelName: string;

  constructor(
    responses: ScriptedModelResponse[],
    options: ScriptedModelProviderOptions & { model?: string } = {},
  ) {
    assertScriptedProviderAllowed(options);
    this.queue = [...responses];
    this.modelName = options.model ?? 'scripted';
  }

  remaining(): number {
    return this.queue.length;
  }

  async health(): Promise<ModelHealthStatus> {
    return {
      healthy: this.queue.length > 0,
      provider: this.name,
      model: this.modelName,
      detail:
        this.queue.length > 0
          ? 'Scripted test provider has queued responses'
          : 'Scripted test provider queue is empty',
      checkedAt: new Date().toISOString(),
    };
  }

  async complete(_request: ModelRequest, options: ModelCompleteOptions = {}): Promise<ModelResult> {
    if (options.signal?.aborted) {
      return {
        ok: false,
        errorCode: 'SCRIPTED_ABORTED',
        errorMessage: 'Scripted provider call was aborted',
        finishReason: 'cancelled',
        provider: this.name,
        model: this.modelName,
      };
    }

    const next = this.queue.shift();
    if (!next) {
      return {
        ok: false,
        errorCode: 'SCRIPTED_QUEUE_EMPTY',
        errorMessage: 'Scripted provider has no remaining responses',
        finishReason: 'error',
        provider: this.name,
        model: this.modelName,
      };
    }

    return {
      ok: true,
      text: next.text,
      toolCalls: next.toolCalls,
      finishReason: next.finishReason,
      provider: this.name,
      model: next.model ?? this.modelName,
      ...(next.usage ? { usage: next.usage } : {}),
    };
  }
}
