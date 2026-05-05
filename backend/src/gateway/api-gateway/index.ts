import { APIRouter } from './router';
import { APIExecutor } from './executor';
import { GatewayCache } from './cache';
import { CallerInfo, ChatRequest, ChatResponse, ExecutionContext, ResolvedRoute } from './types';
import { getRequestContext } from './context';
import { logger } from '../../utils/logger';

export class APIGateway {
  private router: APIRouter;
  private executor: APIExecutor;
  private cache: GatewayCache;

  constructor() {
    this.router = new APIRouter();
    this.executor = new APIExecutor();
    this.cache = new GatewayCache();
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
      sessionId: context?.sessionId,
      sourceEntry: context?.sourceEntry || requestContext.sourceEntry,
      callerAgent: context?.callerAgent || caller.agentId || requestContext.callerAgent,
      userRole: context?.userRole || requestContext.userRole,
      ...context
    };
    
    const normalizedCaller: CallerInfo = {
      ...caller,
      agentId: caller.agentId || requestContext.agentId,
      skillId: caller.skillId || requestContext.skillId,
      userId: executionContext.userId
    };

    let route = this.cache.getRoute(normalizedCaller, executionContext.userId);
    
    if (!route) {
      route = await this.router.resolve(normalizedCaller, executionContext.userId);
      this.cache.setRoute(normalizedCaller, executionContext.userId, route);
      logger.debug('[api-gateway] route resolved', {
        traceId: executionContext.traceId,
        userId: executionContext.userId,
        agentId: normalizedCaller.agentId,
        source: route.source,
        providerId: route.providerId,
        model: route.model
      });
    }

    return this.executor.execute(route, request, executionContext);
  }

  async resolveRoute(caller: CallerInfo, userId?: string): Promise<ResolvedRoute> {
    const cachedRoute = this.cache.getRoute(caller, userId);
    if (cachedRoute) {
      return cachedRoute;
    }

    const route = await this.router.resolve(caller, userId);
    this.cache.setRoute(caller, userId, route);
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

export { CallerInfo, ResolvedRoute, ChatRequest, ChatResponse, ExecutionContext, ExecuteOptions, ChatMessage } from './types';
export { APIRouter } from './router';
export { APIExecutor } from './executor';
export { GatewayCache } from './cache';
