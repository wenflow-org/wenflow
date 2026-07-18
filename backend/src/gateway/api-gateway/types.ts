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
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
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
}

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
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
  [key: string]: any;
}

export interface ExecutionContext {
  userId?: string;
  sessionId?: string;
  traceId?: string;
  executionLogId?: string;
  sourceEntry?: 'user' | 'test' | 'admin' | 'platform' | 'arena' | 'lab' | 'simulation';
  callerAgent?: string;
  userRole?: 'admin' | 'user' | 'tester' | 'viewer';
  experimentId?: string;
  runId?: string;
  requestPath?: string;
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
