import { APIRouter } from './router';
import { APIExecutor } from './executor';
import { GatewayCache } from './cache';
import { CallerInfo, ChatRequest, ChatResponse, ExecutionContext, ResolvedRoute, RouteExecutionOverride } from './types';
import { getRequestContext } from './context';
import { logger } from '../../utils/logger';
import { createHash } from 'crypto';
import { getAgentOfSkill } from '../../services/agent-manifest.service';
import { createRuntimeRetryBudget } from '../../services/reliability-settings.service';
import { platformRpmLimiter, virtualLearnerRpmLimiter, getSimulationModelLimiter } from './rpm-limiter';
import { GatewayExecutionError } from './failure-classification';

export class APIGateway {
  private router: APIRouter;
  private executor: APIExecutor;
  private cache: GatewayCache;

  constructor() {
    this.router = new APIRouter();
    this.executor = new APIExecutor();
    this.cache = new GatewayCache();
  }

  private normalizeCaller(caller: CallerInfo, userId?: string): CallerInfo {
    const requestContext = getRequestContext();
    const legacySkillId = caller.agentId?.startsWith('skill:')
      ? caller.agentId.slice('skill:'.length)
      : undefined;
    const skillId = caller.skillId
      || legacySkillId
      || (!caller.agentId ? requestContext.skillId : undefined);
    const agentId = legacySkillId
      ? requestContext.agentId || getAgentOfSkill(`skill:${legacySkillId}`)?.id
      : caller.agentId || requestContext.agentId || (skillId ? getAgentOfSkill(`skill:${skillId}`)?.id : undefined);
    return {
      ...caller,
      agentId,
      skillId,
      userId: userId || caller.userId
    };
  }

  async execute(
    request: ChatRequest,
    caller: CallerInfo,
    context?: ExecutionContext
  ): Promise<ChatResponse> {
    const requestContext = getRequestContext();
    const inheritedRetryBudget = context?.retryBudget || requestContext.retryBudget;
    const executionContext: ExecutionContext = {
      ...context,
      userId: context?.userId || caller.userId || requestContext.userId,
      traceId: context?.traceId || requestContext.traceId,
      executionLogId: context?.executionLogId || requestContext.executionLogId,
      parentExecutionId: context?.parentExecutionId || requestContext.executionLogId || requestContext.parentExecutionId,
      rootExecutionId: context?.rootExecutionId || requestContext.rootExecutionId,
      promptCallId: context?.promptCallId || requestContext.promptCallId,
      promptAttemptNo: context?.promptAttemptNo || requestContext.promptAttemptNo,
      retryBudget: inheritedRetryBudget,
      sessionId: context?.sessionId || requestContext.sessionId || requestContext.contextEnvelope?.session?.sessionId,
      conversationId: context?.conversationId || requestContext.conversationId || requestContext.contextEnvelope?.session?.conversationId,
      pathId: context?.pathId || requestContext.pathId || requestContext.contextEnvelope?.session?.pathId,
      taskId: context?.taskId || requestContext.taskId || requestContext.contextEnvelope?.session?.taskId,
      locale: context?.locale || requestContext.locale || requestContext.contextEnvelope?.locale,
      sourceEntry: context?.sourceEntry || requestContext.sourceEntry,
      callerAgent: context?.callerAgent || caller.agentId || requestContext.callerAgent,
      userRole: context?.userRole || requestContext.userRole,
      experimentId: context?.experimentId || requestContext.experimentId,
      runId: context?.runId || requestContext.runId,
      abortSignal: context?.abortSignal || requestContext.abortSignal
    };
    
    const normalizedCaller = this.normalizeCaller(caller, executionContext.userId);
    executionContext.callerAgent = context?.callerAgent || normalizedCaller.agentId || requestContext.callerAgent;
    executionContext.agentId = normalizedCaller.agentId;
    executionContext.skillId = normalizedCaller.skillId;
    executionContext.retryBudget = inheritedRetryBudget
      || await createRuntimeRetryBudget();

    let route = this.cache.getRoute(normalizedCaller, executionContext.userId);
    
    if (!route) {
      route = await this.router.resolve(normalizedCaller, executionContext.userId);
      this.cache.setRoute(normalizedCaller, executionContext.userId, route);
      logger.debug('[api-gateway] route resolved', {
        traceId: executionContext.traceId,
        userId: executionContext.userId,
        agentId: normalizedCaller.agentId,
        skillId: normalizedCaller.skillId,
        source: route.source,
        providerId: route.providerId,
        model: route.model
      });
    }

    route = this.applyRouteOverride(route, requestContext.promptRuntimeOverride?.routeOverride);

    // 出站 RPM 限流：虚拟学习者（sourceEntry=simulation）与平台全局两条独立通道。
    // simulation 内再按模型分桶：平台默认模型（route.source=platform）走主桶（统计/driver 口径
    // 不变），其它模型（user-provider 绑定 agnes 等分组）各开独立子桶——ds/agnes 并发与 RPM
    // 互不挤占（2026-10-02 模型分组 A/B）。
    // 超预算时在此等待令牌（不报错），让自动驾驶自然变慢；
    // 排队护栏 RPM_QUEUE_WAIT_MS（默认 0=不设限）超时后按 rate_limit 快速失败，
    // 防止饱和时「调用方重试 → 队列更长」的无界放大。
    let rpmLimiter = platformRpmLimiter;
    if (executionContext.sourceEntry === 'simulation') {
      rpmLimiter = route.source === 'platform'
        ? virtualLearnerRpmLimiter
        : getSimulationModelLimiter(route.model);
    }
    const queueWaitMs = Number(process.env.RPM_QUEUE_WAIT_MS) > 0 ? Number(process.env.RPM_QUEUE_WAIT_MS) : 0;
    const releaseRpm = await rpmLimiter.acquire({ maxWaitMs: queueWaitMs });
    if (releaseRpm === null) {
      logger.warn('[api-gateway] RPM 排队超时，按 rate_limit 快速失败', {
        channel: rpmLimiter.name,
        queueWaitMs,
        queued: rpmLimiter.stats().queued
      });
      throw new GatewayExecutionError(
        `出站限流排队超时（${Math.round(queueWaitMs / 1000)}s），请稍后重试或下调并发`,
        { category: 'rate_limit', code: 'RPM_QUEUE_TIMEOUT', statusCode: 429, retryable: true }
      );
    }
    try {
      return await this.executor.execute(route, request, executionContext);
    } finally {
      releaseRpm();
    }
  }

  private applyRouteOverride(route: ResolvedRoute, override?: RouteExecutionOverride): ResolvedRoute {
    if (!override) return route;
    if (override.expectedProviderId && override.expectedProviderId !== route.providerId) {
      throw new Error(`API route provider changed: expected ${override.expectedProviderId}, received ${route.providerId}`);
    }
    if (override.expectedCredentialFingerprint) {
      const currentFingerprint = createHash('sha256').update(JSON.stringify(route.apiKey || '')).digest('hex');
      if (currentFingerprint !== override.expectedCredentialFingerprint) {
        throw new Error(`API route credentials changed for ${route.providerId}`);
      }
    }
    const endpoint = override.endpoint || route.endpoint;
    const endpointChanged = endpoint !== route.endpoint;
    const overrideNetworkPolicy = override.privateNetworkPolicy
      || (endpointChanged ? 'public-only' : route.privateNetworkPolicy);
    const privateNetworkPolicy = route.privateNetworkPolicy === 'public-only'
      || overrideNetworkPolicy === 'public-only'
      ? 'public-only'
      : 'runtime';
    return {
      ...route,
      endpoint,
      model: override.model || route.model,
      thinkingMode: override.thinkingMode || route.thinkingMode,
      reasoningEffort: override.reasoningEffort || route.reasoningEffort,
      timeoutMs: override.timeoutMs ?? route.timeoutMs,
      timeoutSource: override.timeoutMs != null ? 'route-override' : route.timeoutSource,
      privateNetworkPolicy,
    };
  }

  async resolveRoute(caller: CallerInfo, userId?: string): Promise<ResolvedRoute> {
    const routingUserId = userId || caller.userId;
    const normalizedCaller = this.normalizeCaller(caller, routingUserId);
    const cachedRoute = this.cache.getRoute(normalizedCaller, routingUserId);
    if (cachedRoute) {
      return cachedRoute;
    }

    const route = await this.router.resolve(normalizedCaller, routingUserId);
    this.cache.setRoute(normalizedCaller, routingUserId, route);
    return route;
  }

  invalidateCache(userId?: string, agentId?: string, skillId?: string): void {
    this.cache.invalidate(userId, agentId, skillId);
  }
}

let gatewayInstance: APIGateway | null = null;

export function getAPIGateway(): APIGateway {
  if (!gatewayInstance) {
    gatewayInstance = new APIGateway();
  }
  return gatewayInstance;
}

export { CallerInfo, ResolvedRoute, RouteExecutionOverride, ChatRequest, ChatResponse, ExecutionContext, ExecuteOptions, ChatMessage } from './types';
export { APIRouter } from './router';
export { APIExecutor } from './executor';
export { GatewayCache } from './cache';
