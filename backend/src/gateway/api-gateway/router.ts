import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { CallerInfo, ResolvedRoute } from './types';
import { getAgentRequestTimeoutInfo } from '../../services/agentRequestTimeout.service';
import { decryptSecret, SecretCryptoError } from '../../utils/secret-crypto';
import { endpointsMatch } from '../../utils/endpoint-identity';

const PLATFORM_KEY_CONTEXT = 'system.platform_api_configs.apiKey';
const AGENT_KEY_CONTEXT = 'system.agent_model_configs.apiKey';
const SKILL_KEY_CONTEXT = 'system.skill_model_configs.apiKey';
const USER_KEY_CONTEXT = 'main.user_api_configs.apiKey';
const USER_AGENT_KEY_CONTEXT = 'main.user_agent_model_configs.apiKey';

interface Config {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningModel?: string;
  thinkingMode?: 'default' | 'enabled' | 'disabled';
  reasoningEffort?: 'default' | 'high' | 'max';
  temperature: number;
  maxTokens: number;
  privateNetworkPolicy: ResolvedRoute['privateNetworkPolicy'];
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

export class APIRouter {
  private resolveBaseEndpoint(): string {
    return (process.env.AI_API_URL || '').trim() || 'https://api.openai.com/v1';
  }

  private withRequestTimeout(route: ResolvedRoute, agentId?: string): ResolvedRoute {
    const timeoutInfo = getAgentRequestTimeoutInfo(agentId);
    return {
      ...route,
      timeoutMs: route.timeoutMs ?? timeoutInfo.requestTimeoutMs,
      timeoutSource: route.timeoutSource
        ?? (timeoutInfo.requestTimeoutSource === 'agent-override' ? 'agent-override' : 'environment-default'),
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
      const route = skillRoute || inheritedRoute;
      // 守门 judge 必须关闭思考模式，避免审查调用因推理延长而拖慢发布链路。
      if (caller.skillId === 'semantic-freeze-judge') {
        return this.withRequestTimeout({ ...route, thinkingMode: 'disabled', reasoningEffort: 'default' }, caller.agentId);
      }
      return this.withRequestTimeout(route, caller.agentId);
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
      const configuredEndpoint = (config.endpoint || '').trim();
      const configuredApiKey = configuredEndpoint
        ? decryptSecret(config.apiKey, SKILL_KEY_CONTEXT) || ''
        : '';
      const endpointChanged = Boolean(configuredEndpoint)
        && !endpointsMatch(configuredEndpoint, inheritedRoute.endpoint);
      const endpoint = configuredEndpoint || inheritedRoute.endpoint;
      const inheritedUserEndpoint = inheritedRoute.privateNetworkPolicy === 'public-only';
      const apiKey = endpointChanged
        ? configuredApiKey
        : inheritedUserEndpoint
          ? inheritedRoute.apiKey
          : configuredApiKey || inheritedRoute.apiKey;
      const privateNetworkPolicy = endpointChanged ? 'runtime' : inheritedRoute.privateNetworkPolicy;
      const source = endpointChanged || (!inheritedUserEndpoint && Boolean(configuredApiKey))
        ? 'platform'
        : inheritedRoute.source;

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
        // Phase 2：生成参数 T/maxTokens 不由 skill_model_configs 覆盖（File-as-Truth / resolveLlmGenerationParams）
        // 路由仅继承上层 temperature/maxTokens，供未声明 prompt 的调用回退
        temperature: inheritedRoute.temperature,
        maxTokens: inheritedRoute.maxTokens,
        timeoutMs: config.requestTimeoutMs == null
          ? inheritedRoute.timeoutMs
          : Math.min(300_000, Math.max(10_000, config.requestTimeoutMs)),
        timeoutSource: config.requestTimeoutMs != null ? 'skill-override' : inheritedRoute.timeoutSource,
        privateNetworkPolicy,
        source,
      };
    } catch (error) {
      logger.error('[api-gateway] fetch skill config failed', {
        skillId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof SecretCryptoError) throw error;
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

      const customEndpoint = (config.endpoint || '').trim();
      const customApiKey = customEndpoint
        ? decryptSecret(config.apiKey, USER_AGENT_KEY_CONTEXT) || ''
        : '';

      return {
        providerId: `user-agent:${userId}:${agentId}`,
        endpoint: customEndpoint || platformConfig?.apiUrl || this.resolveBaseEndpoint(),
        apiKey: customEndpoint
          ? customApiKey
          : this.resolvePlatformApiKey(platformConfig, platformConfig?.apiUrl || this.resolveBaseEndpoint()),
        model: this.resolveModel(config.model || platformConfig?.defaultModel),
        thinkingMode: 'default',
        reasoningEffort: 'default',
        temperature: config.temperature ?? platformConfig?.defaultTemperature ?? 0.7,
        maxTokens: config.maxTokens ?? platformConfig?.defaultMaxTokens ?? 2000,
        privateNetworkPolicy: customEndpoint ? 'public-only' : 'runtime'
      };
    } catch (error) {
      logger.error('[api-gateway] fetch user agent override failed', {
        userId,
        agentId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof SecretCryptoError) throw error;
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
          reasoningModel: true,
          enabled: true
        }
      });

      if (!config || !config.enabled || !config.endpoint || !config.apiKey) {
        return null;
      }

      return {
        providerId: `user-provider:${userId}`,
        endpoint: config.endpoint,
        apiKey: decryptSecret(config.apiKey, USER_KEY_CONTEXT) || '',
        model: this.resolveModel(config.chatModel),
        reasoningModel: config.reasoningModel ? this.resolveModel(config.reasoningModel) : undefined,
        thinkingMode: 'default',
        reasoningEffort: 'default',
        temperature: 0.7,
        maxTokens: 2000,
        privateNetworkPolicy: 'public-only'
      };
    } catch (error) {
      logger.error('[api-gateway] fetch user provider failed', {
        userId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof SecretCryptoError) throw error;
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
      if (error instanceof SecretCryptoError) throw error;
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
        lightEndpoint: true,
      }
    });
  }

  private resolvePlatformApiKey(
    config: {
      apiUrl?: string | null;
      apiKey?: string | null;
      reasoningEndpoint?: string | null;
      lightEndpoint?: string | null;
    } | null,
    targetEndpoint?: string | null
  ): string {
    const configuredApiKey = decryptSecret(config?.apiKey, PLATFORM_KEY_CONTEXT) || '';
    const configuredEndpoint = (config?.apiUrl || '').trim();
    const target = (targetEndpoint || configuredEndpoint || this.resolveBaseEndpoint()).trim();
    const configuredTargets = [
      configuredEndpoint,
      config?.reasoningEndpoint,
      config?.lightEndpoint
    ].filter((endpoint): endpoint is string => Boolean(endpoint));
    if (configuredApiKey
      && configuredEndpoint
      && configuredTargets.some(endpoint => endpointsMatch(endpoint, target))) {
      return configuredApiKey;
    }
    return endpointsMatch(target, this.resolveBaseEndpoint()) ? process.env.AI_API_KEY || '' : '';
  }

  private async buildAgentConfig(agentId: string, config: AgentConfigRecord): Promise<Config> {
    const platformConfig = await this.getPlatformConfigRecord();
    const tier = (config.tier || '').toLowerCase();
    const isReasoning = tier === 'reasoning';
    const configuredEndpoint = (config.endpoint || '').trim();
    const inheritedEndpoint = (isReasoning ? platformConfig?.reasoningEndpoint : undefined)
      || platformConfig?.apiUrl
      || this.resolveBaseEndpoint();
    const endpoint = configuredEndpoint || inheritedEndpoint;
    const configuredApiKey = configuredEndpoint
      ? decryptSecret(config.apiKey, AGENT_KEY_CONTEXT) || ''
      : '';
    const apiKey = configuredEndpoint
      ? configuredApiKey
        || (endpointsMatch(configuredEndpoint, inheritedEndpoint)
          ? this.resolvePlatformApiKey(platformConfig, inheritedEndpoint)
          : '')
      : this.resolvePlatformApiKey(platformConfig, inheritedEndpoint);

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
      maxTokens: config.maxTokens ?? platformConfig?.defaultMaxTokens ?? 2000,
      privateNetworkPolicy: 'runtime'
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
        apiKey: this.resolvePlatformApiKey(config, config.apiUrl || this.resolveBaseEndpoint()),
        model: this.resolveModel(config.defaultModel),
        thinkingMode: 'default',
        reasoningEffort: 'default',
        temperature: config.defaultTemperature ?? 0.7,
        maxTokens: config.defaultMaxTokens ?? 2000,
        privateNetworkPolicy: 'runtime',
        providerType: 'openai-compatible',
        source: 'platform'
      };
    } catch (error) {
      logger.error('[api-gateway] fetch platform config failed', {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof SecretCryptoError) throw error;
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
      privateNetworkPolicy: 'runtime',
      providerType: 'openai-compatible',
      source: 'env-fallback'
    };
  }
}
