import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { CallerInfo, ResolvedRoute } from './types';
import { getAgentRequestTimeoutInfo } from '../../services/agentRequestTimeout.service';

interface Config {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface AgentConfigRecord {
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  tier: string | null;
  temperature: number | null;
  maxTokens: number | null;
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
      const config = await prisma.agent_model_configs.findFirst({
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
    return prisma.platform_api_configs.findFirst({
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
      temperature: config.temperature ?? platformConfig?.defaultTemperature ?? 0.7,
      maxTokens: config.maxTokens ?? platformConfig?.defaultMaxTokens ?? 2000
    };
  }

  private async getPlatformDefault(): Promise<ResolvedRoute> {
    try {
      const config = await prisma.platform_api_configs.findFirst({
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
      temperature: 0.7,
      maxTokens: 2000,
      providerType: 'openai-compatible',
      source: 'env-fallback'
    };
  }
}
