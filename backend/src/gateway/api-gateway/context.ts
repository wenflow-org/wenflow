import { AsyncLocalStorage } from 'async_hooks';
import type { RouteExecutionOverride } from './types';
import type { RetryBudget } from './retry-budget';
import type { ContextEnvelopeV1 } from '../../skills/context-envelope';

export type SourceEntry = 'user' | 'test' | 'admin' | 'platform' | 'arena' | 'lab' | 'simulation';

/**
 * 流式调用事件（由 callPrompt 下沉层发出，HTTP 路由翻译为 SSE 事件）。
 * - delta：内容增量（透传上游 token）
 * - restart：逻辑重试重新生成，客户端应清空已显示内容
 * - error：带内失败（HTTP 200 已提交后无法改状态码）
 */
export type PromptStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'restart'; attempt: number }
  | { type: 'error'; code: string; message: string };

/** 请求级流式意向：路由在进入业务链路前通过 setRequestContext 注入 */
export interface StreamRequest {
  enabled: boolean;
  onStream?: (event: PromptStreamEvent) => void;
  /** 已被某个 callPrompt 消费后置位，后续 LLM 调用自动降级为缓冲 */
  consumed?: boolean;
}

export interface RequestContext {
  userId?: string;
  agentId?: string;
  action?: string;
  skillId?: string;
  executionLogId?: string;
  parentExecutionId?: string;
  rootExecutionId?: string;
  promptCallId?: string;
  promptAttemptNo?: number;
  retryBudget?: RetryBudget;
  logicalRetryLimit?: number;
  sessionId?: string;
  conversationId?: string;
  pathId?: string;
  taskId?: string;
  locale?: {
    language?: string;
    timeZone?: string;
  };
  contextEnvelope?: ContextEnvelopeV1;
  sourceEntry?: SourceEntry;
  traceId?: string;
  callerAgent?: string;
  userRole?: 'admin' | 'user' | 'tester' | 'viewer';
  abortSignal?: AbortSignal;
  experimentId?: string;
  runId?: string;
  promptRuntimeOverride?: {
    systemPromptOverride?: string;
    routingUserIdOverride?: string;
    modelOverride?: string;
    temperatureOverride?: number;
    maxTokensOverride?: number;
    routeOverride?: RouteExecutionOverride;
  };
  /** 请求级流式意向（SSE 出口路由注入，callPrompt 读取） */
  streamRequest?: StreamRequest;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function setRequestContext(context: RequestContext): void {
  const store = requestContextStorage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

export function getRequestContext(): RequestContext {
  return requestContextStorage.getStore() || {};
}

export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(context, fn);
}
