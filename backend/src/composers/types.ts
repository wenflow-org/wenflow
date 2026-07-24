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

// 与 prompt-lab envelope-adapter 对齐（避免 status 等枚举漂移）
export type { RuntimeEnvelope as PromptRuntimeEnvelope } from '../services/prompt-lab/envelope-adapter';
import type { RuntimeEnvelope } from '../services/prompt-lab/envelope-adapter';

export interface PromptCallResult<TOutput> {
  success: boolean;
  output?: TOutput;
  /** 统一运行契约 envelope（由 callPrompt 按 runtimeContract 自动映射） */
  runtimeEnvelope?: RuntimeEnvelope;
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
  /**
   * 将业务输出映射为统一 RuntimeEnvelope。
   * 未提供时 callPrompt 使用 contract 默认 phase 做通用包装。
   */
  mapEnvelope?: (output: TOutput, input: TInput) => RuntimeEnvelope;
  modelDefaults?: {
    maxTokens?: number;
    minMaxTokens?: number;
    temperature?: number;
    model?: string;
  };
  retryStrategy?: PromptRetryStrategy<TInput>;
}
