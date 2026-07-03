import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { CallerInfo, ResolvedRoute } from './types';
import { getAgentRequestTimeoutInfo } from '../../services/agentRequestTimeout.service';

interface Config {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  temperature: number;
  maxTokens: number;
}

interface AgentConfigRecord {
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  tier: string | null;
  thinkingMode?: string | null;
  reasoningEffort?: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

interface SkillConfigRecord {
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  tier: string | null;
  thinkingMode?: string | null;
  reasoningEffort?: string | null;
  temperature: number | null;
  maxTokens: number | null;
  requestTimeoutMs?: number | null;
}

export class APIRouter {
  private resolveBaseEndpoint(): string {
    return (process.env.AI_API_URL || '').trim() || 'https://api.openai.com/v1';
  }

  private withRequestTimeout(route: ResolvedRoute, agentId?: string): ResolvedRoute {
    const timeoutInfo = getAgentRequestTimeoutInfo(agentId);
    return {
      ...route,
      timeoutMs: timeoutInfo.requestTimeoutMs,
    };
  }

  private resolveModel(configModel?: string | null): string {
    const model = (configModel || process.env.AI_MODEL || '').trim();
    if (!model) {
      throw new Error('AI model is not configured. Set admin defaultModel or AI_MODEL.');
    }
    return model;
  }

  private resolveReasoningModel(configModel?: string | null): string {
    const model = (configModel || process.env.AI_MODEL_REASONING || process.env.AI_MODEL || '').trim();
    if (!model) {
      throw new Error('AI reasoning model is not configured. Set admin defaultReasoningModel or AI_MODEL_REASONING.');
    }
    return model;
  }

  async resolve(caller: CallerInfo, userId?: string): Promise<ResolvedRoute> {
    if (caller.skillId) {
      const inheritedRoute = await this.resolveBaseRoute(caller, userId);
      const skillRoute = await this.getSkillConfig(caller.skillId, inheritedRoute);
      if (skillRoute) {
        return this.withRequestTimeout(skillRoute, caller.agentId);
      }
      return inheritedRoute;
    }

    return this.resolveBaseRoute(caller, userId);
  }

  private async resolveBaseRoute(caller: CallerInfo, userId?: string): Promise<ResolvedRoute> {
    if (userId && caller.agentId) {
      const userOverride = await this.getUserOverride(userId, caller.agentId);
      if (userOverride) {
        return this.withRequestTimeout({
          ...userOverride,
          providerType: 'openai-compatible',
          source: 'user-agent-override'
        }, caller.agentId);
      }
    }

    if (userId) {
      const userProvider = await this.getUserProvider(userId);
      if (userProvider) {
        return this.withRequestTimeout({
          ...userProvider,
          providerType: 'openai-compatible',
          source: 'user-provider'
        }, caller.agentId);
      }
    }

    if (caller.agentId) {
      const agentConfig = await this.getAgentConfig(caller.agentId);
      if (agentConfig) {
        return this.withRequestTimeout({
          ...agentConfig,
          providerType: 'openai-compatible',
          source: 'agent-config'
        }, caller.agentId);
      }
    }

    const platformDefault = await this.getPlatformDefault();
    return this.withRequestTimeout(platformDefault, caller.agentId);
  }

  private async getSkillConfig(skillId: string, inheritedRoute: ResolvedRoute): Promise<ResolvedRoute | null> {
    try {
      const config = await systemPrisma.skill_model_configs.findFirst({
        where: {
          skillId,
          enabled: true,
        },
      });

      if (!config) {
        return null;
      }

      const tier = (config.tier || '').toLowerCase();
      const isReasoning = tier === 'reasoning';
      const platformConfig = await this.getPlatformConfigRecord();

      const endpoint = config.endpoint
        || inheritedRoute.endpoint
        || (isReasoning ? platformConfig?.reasoningEndpoint : undefined)
        || platformConfig?.apiUrl
        || this.resolveBaseEndpoint();

      const apiKey = config.apiKey
        || inheritedRoute.apiKey
        || platformConfig?.apiKey
        || process.env.AI_API_KEY
        || '';

      const model = config.model
        ? (isReasoning ? this.resolveReasoningModel(config.model) : this.resolveModel(config.model))
        : inheritedRoute.model;

      return {
        ...inheritedRoute,
        providerId: `skill:${skillId}`,
        endpoint,
        apiKey,
        model,
        thinkingMode: this.normalizeThinkingMode(config.thinkingMode || inheritedRoute.thinkingMode),
        reasoningEffort: this.normalizeReasoningEffort(config.reasoningEffort || inheritedRoute.reasoningEffort),
        temperature: config.temperature ?? inheritedRoute.temperature,
        maxTokens: config.maxTokens ?? inheritedRoute.maxTokens,
        timeoutMs: config.requestTimeoutMs ?? inheritedRoute.timeoutMs,
        source: 'platform',
      };
    } catch (error) {
      logger.error('[api-gateway] fetch skill config failed', {
        skillId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async getUserOverride(userId: string, agentId: string): Promise<Config | null> {
    try {
      const config = await prisma.user_agent_model_configs.findFirst({
        where: {
          userId,
          agentId,
          enabled: true
        }
      });

      if (!config) {
        return null;
      }

      const platformConfig = await this.getPlatformConfigRecord();

      return {
        providerId: `user-agent:${userId}:${agentId}`,
        endpoint: config.endpoint || platformConfig?.apiUrl || this.resolveBaseEndpoint(),
        apiKey: config.apiKey || platformConfig?.apiKey || process.env.AI_API_KEY || '',
        model: this.resolveModel(config.model || platformConfig?.defaultModel),
        thinkingMode: 'default',
        reasoningEffort: 'default',
        temperature: config.temperature ?? platformConfig?.defaultTemperature ?? 0.7,
        maxTokens: config.maxTokens ?? platformConfig?.defaultMaxTokens ?? 2000
      };
    } catch (error) {
      logger.error('[api-gateway] fetch user agent override failed', {
        userId,
        agentId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async getUserProvider(userId: string): Promise<Config | null> {
    try {
      const config = await prisma.user_api_configs.findUnique({
        where: { userId },
        select: {
          endpoint: true,
          apiKey: true,
          chatModel: true,
          enabled: true
        }
      });

      if (!config || !config.enabled || !config.endpoint || !config.apiKey) {
        return null;
      }

      return {
        providerId: `user-provider:${userId}`,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: this.resolveModel(config.chatModel),
        thinkingMode: 'default',
        reasoningEffort: 'default',
        temperature: 0.7,
        maxTokens: 2000
      };
    } catch (error) {
      logger.error('[api-gateway] fetch user provider failed', {
        userId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async getAgentConfig(agentId: string): Promise<Config | null> {
    try {
      const config = await systemPrisma.agent_model_configs.findFirst({
        where: {
          agentId,
          enabled: true
        }
      });

      if (!config) {
        return null;
      }

      return this.buildAgentConfig(agentId, config);
    } catch (error) {
      logger.error('[api-gateway] fetch agent config failed', {
        agentId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async getPlatformConfigRecord() {
    return systemPrisma.platform_api_configs.findFirst({
      where: { id: 'platform' },
      select: {
        apiUrl: true,
        apiKey: true,
        defaultModel: true,
        defaultReasoningModel: true,
        defaultTemperature: true,
        defaultMaxTokens: true,
        reasoningEndpoint: true,
      }
    });
  }

  private async buildAgentConfig(agentId: string, config: AgentConfigRecord): Promise<Config> {
    const platformConfig = await this.getPlatformConfigRecord();
    const tier = (config.tier || '').toLowerCase();
    const isReasoning = tier === 'reasoning';

    const endpoint = (isReasoning ? config.endpoint || platformConfig?.reasoningEndpoint : config.endpoint)
      || platformConfig?.apiUrl
      || this.resolveBaseEndpoint();

    const apiKey = config.apiKey
      || platformConfig?.apiKey
      || process.env.AI_API_KEY
      || '';

    const model = isReasoning
      ? this.resolveReasoningModel(config.model || platformConfig?.defaultReasoningModel)
      : this.resolveModel(config.model || platformConfig?.defaultModel);

    return {
      providerId: `agent:${agentId}`,
      endpoint,
      apiKey,
      model,
      thinkingMode: this.normalizeThinkingMode(config.thinkingMode),
      reasoningEffort: this.normalizeReasoningEffort(config.reasoningEffort),
      temperature: config.temperature ?? platformConfig?.defaultTemperature ?? 0.7,
      maxTokens: config.maxTokens ?? platformConfig?.defaultMaxTokens ?? 2000
    };
  }

  private normalizeThinkingMode(value?: string | null): 'default' | 'enabled' | 'disabled' {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'enabled' || normalized === 'disabled') {
      return normalized;
    }
    if (normalized === 'on') {
      return 'enabled';
    }
    if (normalized === 'off') {
      return 'disabled';
    }
    return 'default';
  }

  private normalizeReasoningEffort(value?: string | null): 'default' | 'high' | 'max' {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'high' || normalized === 'max') {
      return normalized;
    }
    return 'default';
  }

  private async getPlatformDefault(): Promise<ResolvedRoute> {
    try {
      const config = await systemPrisma.platform_api_configs.findFirst({
        where: {
          id: 'platform'
        }
      });

      if (!config) {
        return this.getFallbackConfig();
      }

      return {
        providerId: 'platform',
        endpoint: config.apiUrl || this.resolveBaseEndpoint(),
        apiKey: config.apiKey || process.env.AI_API_KEY || '',
        model: this.resolveModel(config.defaultModel),
        thinkingMode: 'default',
        reasoningEffort: 'default',
        temperature: config.defaultTemperature ?? 0.7,
        maxTokens: config.defaultMaxTokens ?? 2000,
        providerType: 'openai-compatible',
        source: 'platform'
      };
    } catch (error) {
      logger.error('[api-gateway] fetch platform config failed', {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return this.getFallbackConfig();
    }
  }

  private getFallbackConfig(): ResolvedRoute {
    return {
      providerId: 'env-default',
      endpoint: this.resolveBaseEndpoint(),
      apiKey: process.env.AI_API_KEY || '',
      model: this.resolveModel(),
      thinkingMode: 'default',
      reasoningEffort: 'default',
      temperature: 0.7,
      maxTokens: 2000,
      providerType: 'openai-compatible',
      source: 'env-fallback'
    };
  }
}
