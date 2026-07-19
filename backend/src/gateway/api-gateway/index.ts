import { APIRouter } from './router';
import { APIExecutor } from './executor';
import { GatewayCache } from './cache';
import { CallerInfo, ChatRequest, ChatResponse, ExecutionContext, ResolvedRoute, RouteExecutionOverride } from './types';
import { getRequestContext } from './context';
import { logger } from '../../utils/logger';
import { createHash } from 'crypto';
import { getAgentOfSkill } from '../../services/agent-manifest.service';

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
    const executionContext: ExecutionContext = {
      userId: context?.userId || caller.userId || requestContext.userId,
      traceId: context?.traceId || requestContext.traceId,
      executionLogId: context?.executionLogId || requestContext.executionLogId,
      sessionId: context?.sessionId,
      sourceEntry: context?.sourceEntry || requestContext.sourceEntry,
      callerAgent: context?.callerAgent || caller.agentId || requestContext.callerAgent,
      userRole: context?.userRole || requestContext.userRole,
      experimentId: context?.experimentId || requestContext.experimentId,
      runId: context?.runId || requestContext.runId,
      abortSignal: context?.abortSignal || requestContext.abortSignal,
      ...context
    };
    if (!executionContext.abortSignal) {
      executionContext.abortSignal = requestContext.abortSignal;
    }
    
    const normalizedCaller = this.normalizeCaller(caller, executionContext.userId);
    executionContext.callerAgent = context?.callerAgent || normalizedCaller.agentId || requestContext.callerAgent;

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

    return this.executor.execute(route, request, executionContext);
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
