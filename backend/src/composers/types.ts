export interface PromptDriftInfo {
  driftDetected: boolean;
  codeHash: string;
  dbHash: string;
}

export interface PromptCallContext {
  userId?: string;
  sessionId?: string;
  pathId?: string;
  conversationId?: string;
  taskId?: string;
  locale?: {
    language?: string;
    timeZone?: string;
  };
  /** 显式覆盖 ALS 中的 Context Envelope；默认只供投影函数和 telemetry 使用。 */
  contextEnvelope?: import('../skills/context-envelope').ContextEnvelopeV1;
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
  violations?: string[];
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
import type { RuntimeContract } from '../services/prompt-lab/runtime-contract';
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
    violations?: string[];
  }) => string | null;
}

export interface PromptValidationResult {
  valid: boolean;
  failureReason?: string;
  violations?: string[];
}

export interface PromptRawParseResult {
  parsed: any | null;
  extractedJson: string | null;
  failureReason?: string;
  violations?: string[];
}

export interface PromptCallSpec<TInput, TOutput> {
  agentId: string;
  defaultSystemPrompt: string;
  requireActivePrompt?: boolean;
  caller: {
    agentId?: string;
    skillId?: string;
  };
  buildUserPayload: (
    input: TInput,
    runtime: {
      contextEnvelope: import('../skills/context-envelope').ContextEnvelopeV1;
      runtimeContract: RuntimeContract;
    }
  ) => string | object;
  normalizeOutput: (parsed: any, input: TInput) => TOutput;
  validateParsedOutput?: (parsed: any, input: TInput) => PromptValidationResult;
  /** 覆盖默认 extractJsonObject；用于 goal 等专用结构化解析 */
  parseRawOutput?: (rawOutput: string, input: TInput) => PromptRawParseResult;
  /** ACTIVE/default system 解析后、发请求前再加工（如 field routing supplement） */
  prepareSystemPrompt?: (
    systemPrompt: string,
    input: TInput,
    context: PromptCallContext
  ) => string | Promise<string>;
  /**
   * 将业务输出映射为统一 RuntimeEnvelope。
   * 未提供时 callPrompt 使用 contract 默认 phase 做通用包装。
   */
  mapEnvelope?: (output: TOutput, input: TInput, runtimeContract: RuntimeContract) => RuntimeEnvelope;
  modelDefaults?: {
    maxTokens?: number;
    minMaxTokens?: number;
    temperature?: number;
    model?: string;
  };
  retryStrategy?: PromptRetryStrategy<TInput>;
}
