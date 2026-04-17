import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { CallerInfo, ResolvedRoute } from './types';

interface Config {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export class APIRouter {
  async resolve(caller: CallerInfo, userId?: string): Promise<ResolvedRoute> {
    if (userId && caller.agentId) {
      const userOverride = await this.getUserOverride(userId, caller.agentId);
      if (userOverride) {
        return {
          ...userOverride,
          providerType: 'openai-compatible',
          source: 'user-agent-override'
        };
      }
    }

    if (userId) {
      const userProvider = await this.getUserProvider(userId);
      if (userProvider) {
        return {
          ...userProvider,
          providerType: 'openai-compatible',
          source: 'user-provider'
        };
      }
    }

    if (caller.agentId) {
      const agentConfig = await this.getAgentConfig(caller.agentId);
      if (agentConfig) {
        return {
          ...agentConfig,
          providerType: 'openai-compatible',
          source: 'agent-config'
        };
      }
    }

    const platformDefault = await this.getPlatformDefault();
    return platformDefault;
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

      return {
        providerId: `user-agent:${userId}:${agentId}`,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 2000
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
        model: config.chatModel || 'deepseek-chat',
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

      return {
        providerId: `agent:${agentId}`,
        endpoint: config.endpoint,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens ?? 2000
      };
    } catch (error) {
      logger.error('[api-gateway] fetch agent config failed', {
        agentId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
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
        endpoint: config.apiUrl || process.env.AI_API_ENDPOINT || 'https://api.openai.com/v1',
        apiKey: config.apiKey || process.env.AI_API_KEY || '',
        model: config.defaultModel || process.env.AI_MODEL || 'gpt-3.5-turbo',
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
      endpoint: process.env.AI_API_ENDPOINT || 'https://api.openai.com/v1',
      apiKey: process.env.AI_API_KEY || '',
      model: process.env.AI_MODEL || 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2000,
      providerType: 'openai-compatible',
      source: 'env-fallback'
    };
  }
}
