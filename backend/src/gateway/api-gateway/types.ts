export interface CallerInfo {
  agentId?: string;
  skillId?: string;
  action?: string;
  userId?: string;
}

export type ProviderType = 'openai-compatible';

export type RouteSource =
  | 'user-agent-override'
  | 'user-provider'
  | 'agent-config'
  | 'platform'
  | 'env-fallback';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ResolvedRoute {
  providerType: ProviderType;
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  /** 推理模型（用户双模型配置：reasoningModel / 平台 defaultReasoningModel），供两段式调用使用 */
  reasoningModel?: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
  timeoutSource?: 'skill-override' | 'agent-override' | 'route-override' | 'environment-default';
  privateNetworkPolicy: 'runtime' | 'public-only';
  source: RouteSource;
}

export interface RouteExecutionOverride {
  expectedProviderId?: string;
  expectedCredentialFingerprint?: string;
  endpoint?: string;
  model?: string;
  thinkingMode?: ResolvedRoute['thinkingMode'];
  reasoningEffort?: ResolvedRoute['reasoningEffort'];
  timeoutMs?: number;
  privateNetworkPolicy?: ResolvedRoute['privateNetworkPolicy'];
}

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  /** 请求上游以 SSE 流式返回（需同时提供 ExecutionContext.onStreamChunk 才生效） */
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  [key: string]: any;
}

export interface ChatResponse {
  id: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  _gatewayMetadata?: {
    llmRequestId: string;
    providerId: string;
    routeSource: RouteSource;
    requestedModel?: string;
    resolvedModel: string;
    responseModel?: string;
    attemptCount: number;
    /** 本次执行是否走了流式（上游 SSE）路径 */
    streamed: boolean;
  };
  [key: string]: any;
}

export interface ExecutionContext {
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  pathId?: string;
  taskId?: string;
  locale?: {
    language?: string;
    timeZone?: string;
  };
  traceId?: string;
  executionLogId?: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
  promptCallId?: string;
  promptAttemptNo?: number;
  retryBudget?: import('./retry-budget').RetryBudget;
  logicalRetryLimit?: number;
  sourceEntry?: 'user' | 'test' | 'admin' | 'platform' | 'arena' | 'lab' | 'simulation' | 'system-canary';
  callerAgent?: string;
  userRole?: 'admin' | 'user' | 'tester' | 'viewer';
  experimentId?: string;
  runId?: string;
  requestPath?: string;
  abortSignal?: AbortSignal;
  /** 流式模式下逐段透传内容增量；与 request.stream 配合启用流式执行路径 */
  onStreamChunk?: (delta: string) => void;
  [key: string]: any;
}

export interface GatewayExecutionMetrics {
  durationMs: number;
  attempts: number;
  statusCode?: number;
  success: boolean;
  errorMessage?: string;
}

export interface RouteCacheEntry {
  route: ResolvedRoute;
  expiresAt: number;
}

export type ExecuteOptions = ExecutionContext;
