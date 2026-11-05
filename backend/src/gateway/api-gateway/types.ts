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
  | 'env-fallback'
  /** 模型所属供应商自带端点（llm-providers.json 的 baseUrl+apiKeyEnv），endpoint/apiKey 已被供应商覆盖 */
  | 'provider-endpoint';

/**
 * OpenAI 兼容的多模态内容块（2026-10-18 #123）。
 * 文本与图片可混排；纯文本调用仍用 string，避免全链大改。
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

export type ChatMessageContent = string | ChatContentPart[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatMessageContent;
}

/** 消息内容里是否含图片块（网关视觉能力把关用）。 */
export function messageHasImage(content: ChatMessageContent | undefined | null): boolean {
  return Array.isArray(content) && content.some((part) => part?.type === 'image_url');
}

/** 消息列表里是否存在任一图片块。 */
export function messagesHaveImages(messages: Array<{ content?: ChatMessageContent }> | undefined | null): boolean {
  return Array.isArray(messages) && messages.some((message) => messageHasImage(message?.content));
}

export interface ResolvedRoute {
  providerType: ProviderType;
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  /** 该模型是否声明支持图片输入（llm-providers.json `vision: true`）；带图请求的放行依据 */
  vision?: boolean;
  /** 推理模型：只剩学习端 BYOK 会填（user_api_configs.reasoningModel）；平台默认推理模型 2026-11-04 已撤，运行时不再读这一档 */
  reasoningModel?: string;
  /** 模型是否由 skill 级配置显式指定（true=skill_model_configs.model 非空；false=继承上层默认） */
  modelExplicit?: boolean;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  /** 推理强度：取值是上游定义的（low / high / max / 各家自有词），路由只表达
   *  「调用方要什么」，哪一档真能发由模型注册表 `reasoningEfforts` 决定——
   *  裁剪在 thinking-policy，这里不按平台词表改写。 */
  reasoningEffort?: string;
  /** 平台通道级「结构化输出」默认（platform_api_configs.defaultResponseFormat）：
   *  json_object = 对 json 媒介技能的请求附 response_format（解码层强制 JSON）。
   *  技能级 paramOverrides.responseFormat 可覆盖；'none' = 行为不变。 */
  responseFormat?: 'none' | 'json_object';
  temperature: number;
  maxTokens: number;
  /** skill 级参数覆盖（skill_model_configs.paramOverrides 解析值；null=未覆盖）。
   *  resolve-llm-call-params 的 skill-override 层数据源；key 出现才覆盖。 */
  skillParamOverrides?: {
    temperature?: number | null;
    topP?: number | null;
    maxTokens?: number | null;
    /** 单次 prompt 调用的最大尝试次数（含首次）；1..5，受平台逻辑重试预算再夹一次 */
    maxAttempts?: number | null;
    /** 'json_object'=强制 JSON；'none'=显式关闭通道默认（解析时白名单校验） */
    responseFormat?: string;
  } | null;
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
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: ChatMessageContent }>;
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
  /**
   * 测试/探针专用：在请求真正发出前拿到**最终请求体**（含折叠后的 messages、
   * thinking/max_tokens/top_p 等生效值）。仅内存回调，不落库、不暴露 HTTP。
   * 用途：断言 wire format 与参数，不必依赖上游行为间接推断。
   */
  onWireRequest?: (body: ChatRequest) => void;
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
