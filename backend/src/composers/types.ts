export interface PromptDriftInfo {
  driftDetected: boolean;
  codeHash: string;
  dbHash: string;
}

export interface PromptCallContext {
  userId?: string;
  pathId?: string;
  conversationId?: string;
  pipelineRunId?: string;
  pipelineStepIndex?: number;
  traceId?: string;
  parentExecutionId?: string;
  systemPromptOverride?: string;
}

export interface PromptAttemptTrace {
  attempt: number;
  rawOutput: string;
  failureReason?: string;
  status?: 'success' | 'validation_failed' | 'transport_failed';
  durationMs?: number;
  llmRequestId?: string;
  transportAttemptCount?: number;
}

export interface PromptDebugTrace<TOutput = any> {
  agentId: string;
  systemPrompt: string;
  systemPromptVersion: number | null;
  userPayload: string;
  rawModelOutput: string;
  extractedJson: string | null;
  normalizedOutput: TOutput | null;
  promptDrift: PromptDriftInfo | null;
  attempts: PromptAttemptTrace[];
  durationMs: number;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  } | null;
}

export interface PromptCallError {
  code: string;
  message: string;
}

export interface PromptCallResult<TOutput> {
  success: boolean;
  output?: TOutput;
  error?: PromptCallError;
  debug: PromptDebugTrace<TOutput>;
}

export interface PromptRetryStrategy<TInput> {
  maxAttempts: number;
  onValidationFail?: (params: {
    input: TInput;
    attempt: number;
    rawOutput: string;
    extractedJson: string | null;
    failureReason: string;
  }) => string | null;
}

export interface PromptCallSpec<TInput, TOutput> {
  agentId: string;
  defaultSystemPrompt: string;
  requireActivePrompt?: boolean;
  caller: {
    agentId?: string;
    skillId?: string;
  };
  buildUserPayload: (input: TInput) => string | object;
  normalizeOutput: (parsed: any, input: TInput) => TOutput;
  validateParsedOutput?: (parsed: any, input: TInput) => { valid: boolean; failureReason?: string };
  modelDefaults?: {
    maxTokens?: number;
    minMaxTokens?: number;
    temperature?: number;
  };
  retryStrategy?: PromptRetryStrategy<TInput>;
}
