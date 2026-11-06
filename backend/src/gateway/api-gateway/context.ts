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
  /**
   * 当前调用方（编排交接边口径）。**只由「当前执行所在的 agent 边界」决定**——见
   * {@link runInAgentScope}。不要用它承载「本次运行从哪来」（那属于 sourceEntry /
   * experimentId / runId / rootCallerAgent）。
   */
  callerAgent?: string;
  /**
   * #185：当前执行所在的 **agent 边界**（进入某 agent 的编排作用域时由
   * {@link runInAgentScope} 写入，skill 执行时若其上没有边界则以该 skill 的归属 agent 兜底）。
   * skill span 的 `callerAgent` 取此值，因此跨阶段被调用的 skill（如教学链调用
   * profile 阶段的 learning-predictor）会归到**真实调用方**，而不是它的静态归属。
   */
  agentScope?: string;
  /**
   * #185：整条调用链最外层的**运行来源**（autopilot/blackbox 的 'simulation-agent'、
   * batch-experiment 任务名、客户端 X-Caller-Agent）。仅供追溯，不参与边归属；随嵌套调用一路继承。
   */
  rootCallerAgent?: string;
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
    /** A/B 实验：钉住某个 prompt 变体（评测/试跑用；未设置则按 selectionKey 分桶） */
    variantOverride?: string;
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

/**
 * #185：进入某个 agent 的编排作用域。
 *
 * 语义是「**重置**」而不是「继承」：agent 边界以内的 skill 调用都以该 agent 为调用方，
 * 上层（autopilot / blackbox / 客户端）写入的运行来源移到 `rootCallerAgent` 保留追溯，
 * 不再冒充交接边的 caller。典型：虚拟课堂的自动驾驶以 `callerAgent: 'simulation-agent'`
 * 起跑，但教学链本身是 teaching-agent 的边界——不重置就会把 `simulation-agent → skill:session-wrapup`
 * 之类的**幽灵边**写进 agent_call_logs，污染按 agent 的成功率/成本/限流归属。
 */
export function runInAgentScope<T>(agentScope: string, fn: () => Promise<T>): Promise<T> {
  const parent = getRequestContext();
  return runWithContext(
    {
      ...parent,
      agentScope,
      callerAgent: agentScope,
      rootCallerAgent: parent.rootCallerAgent || parent.callerAgent || agentScope,
    },
    fn
  );
}
