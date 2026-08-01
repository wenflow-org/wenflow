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
  /** 已完成的对话历史；仅 conversational/turn 类 Skill 应使用。 */
  assistantMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pipelineRunId?: string;
  pipelineStepIndex?: number;
  traceId?: string;
  parentExecutionId?: string;
  /** 调用来源，仅用于 Gateway telemetry 与排障。 */
  requestPath?: string;
  /** 显式复用上游预算，避免兼容调用重置重试额度。 */
  retryBudget?: import('../gateway/api-gateway/retry-budget').RetryBudget;
  systemPromptOverride?: string;
  /**
   * 调用点级生成参数覆盖（调用方显式传入的 model/temperature/maxTokens）。
   * 优先级高于 ACTIVE prompt（core params）与路由配置，与调试用 promptRuntimeOverride 同级、按调用合并。
   */
  generationOverride?: {
    model?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
  };
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
  promptCallId: string;
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
  finalLlmRequestId?: string | null;
  providerId?: string | null;
  model?: string | null;
}

export interface PromptCallError {
  code: string;
  message: string;
}

// 与 prompt-lab envelope-adapter 对齐（避免 status 等枚举漂移）
export type { RuntimeEnvelope as PromptRuntimeEnvelope } from '../services/prompt-lab/envelope-adapter';
import type { RuntimeContract } from '../services/prompt-lab/runtime-contract';
import type { RuntimeEnvelope } from '../services/prompt-lab/envelope-adapter';
import type { SkillPromptContract } from '../services/skill-prompt-contract';

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
    action?: string;
  };
  buildUserPayload: (
    input: TInput,
    runtime: {
      contextEnvelope: import('../skills/context-envelope').ContextEnvelopeV1;
      runtimeContract: RuntimeContract;
      promptContract: SkillPromptContract;
    }
  ) => string | object;
  /**
   * 仅用于兼容遗留多消息调用。正式 Skill 保持 system + user 的确定性投影，
   * 不应默认使用此扩展点。
   */
  buildMessages?: (params: {
    input: TInput;
    systemPrompt: string;
    userPayload: string;
    retryMessage: string | null;
    runtime: {
      contextEnvelope: import('../skills/context-envelope').ContextEnvelopeV1;
      runtimeContract: RuntimeContract;
      promptContract: SkillPromptContract;
    };
  }) => Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
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
  retryStrategy?: PromptRetryStrategy<TInput>;
}
