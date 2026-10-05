import prisma from '../../config/database';
import systemPrisma from '../../config/system-database';
import { logger } from '../../utils/logger';
import { CallerInfo, ResolvedRoute } from './types';
import { getAgentRequestTimeoutInfo } from '../../services/agentRequestTimeout.service';
import { decryptSecret, SecretCryptoError } from '../../utils/secret-crypto';
import { endpointsMatch } from '../../utils/endpoint-identity';
import { selectModelForAlias } from './model-alias';
import { reloadLlmProvidersIfChanged, resolveModelRef } from '../../config/models.config';

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
  reasoningEffort?: 'default' | 'low' | 'high' | 'max';
  temperature: number;
  maxTokens: number;
  /** 通道级结构化输出默认（user-provider 继承 platform 通道设置；skill paramOverrides 仍可覆盖） */
  responseFormat?: 'none' | 'json_object';
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

/**
 * 学习对话链技能（2026-10-02 模型分组 A/B 拍板）：用户自有 provider 上仅这些技能用
 * 用户自己的模型（agnes 组的 A/B 靶面 = 对话学生本尊：goal 阶段对话 + learn 阶段对话）；
 * 路径/评估/收尾链技能按 skill_model_configs 绑定走 ds（好 key、质量锚定——path 生成
 * 质量锚定整条学习路径）。
 */
const LEARN_DIALOGUE_SKILLS = new Set([
  'teaching-turn',
  'virtual-learner-learn-turn-simulator',
  'virtual-learner-epistemic-grounding',
  'peer-reinforcement',
  'adaptive-guidance-copy',
  'learning-predictor',
  'virtual-learner-goal-dialogue-simulator',
  // 2026-10-05：跑批把 ds 空出来（外部测试零影响）——这两条一并纳入用户模型优先集。
  // 只有「调用链从用户自有 provider 起步」（有 user-agent 绑定的上下文，跑批 admin 即此）
  // 才走用户模型；外部测试者无绑定 → 技能行 ds 照常生效。
  'goal-conversation',
  'teaching-opening-generator',
]);

/** 解析 skill_model_configs.paramOverrides（JSON）。非对象/坏 JSON 一律视为未覆盖。 */
function parseSkillParamOverrides(raw: unknown): ResolvedRoute['skillParamOverrides'] {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const b = parsed as Record<string, unknown>;
  const num = (v: unknown): number | null | undefined => (v === null ? null : (typeof v === 'number' && Number.isFinite(v) ? v : undefined));
  const temperature = num(b.temperature);
  const topP = num(b.topP);
  const maxTokens = num(b.maxTokens);
  // 'json_object' = 强制 JSON；'none' = 显式关掉通道默认（null 语义不适用，字符串枚举）
  const responseFormat = typeof b.responseFormat === 'string' && ['json_object', 'none'].includes(b.responseFormat.trim().toLowerCase())
    ? b.responseFormat.trim().toLowerCase()
    : undefined;
  if (temperature === undefined && topP === undefined && maxTokens === undefined && responseFormat === undefined) return null;
  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(responseFormat !== undefined ? { responseFormat } : {}),
  };
}

/** 解析 skill_model_configs.fallbackChain（JSON string[]）。坏值视为未声明（null=用 registry 默认链）。 */
function parseSkillFallbackChain(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out = parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(s => s.trim());
    return out.length ? out : [];
  } catch { return null; }
}

export class APIRouter {
  /** 热重载错误只在该报错文本变化时记一次，避免每次 resolve 刷日志 */
  private lastLoggedReloadError: string | null = null;

  private resolveBaseEndpoint(): string {
    return (process.env.AI_API_URL || '').trim() || 'https://api.openai.com/v1';
  }

  /**
   * 供应商自带端点覆盖（llm-providers.json File-as-Truth）：
   * 解析后的模型所属供应商声明了 baseUrl ⇒ endpoint/apiKey 整体切到该供应商
   * （key 从 apiKeyEnv 环境变量读取，缺失 = 明确报错，不带病调用）。
   * 用户自带 provider（source user-*）不受覆盖——用户模型身份属于用户自己的供应商空间。
   */
  private applyProviderEndpoint(route: ResolvedRoute): ResolvedRoute {
    if (route.source === 'user-provider' || route.source === 'user-agent-override') return route;
    const ref = resolveModelRef(route.model || '');
    if (!ref) return route;
    // 限定式引用统一还原为上游字面 id：配置空间可用 provider/model，请求空间只认裸 id
    if (!ref.definition.providerEndpoint) {
      return ref.definition.id === route.model ? route : { ...route, model: ref.definition.id };
    }
    const apiKey = (process.env[ref.definition.providerEndpoint.apiKeyEnv] || '').trim();
    if (!apiKey) {
      throw new Error(
        `模型「${ref.definition.id}」所属供应商「${ref.providerId}」要求环境变量 ${ref.definition.providerEndpoint.apiKeyEnv}，但未配置（来源 llm-providers.json）。请在部署环境设置后重试。`
      );
    }
    return {
      ...route,
      model: ref.definition.id,
      endpoint: ref.definition.providerEndpoint.baseUrl,
      apiKey,
      privateNetworkPolicy: 'runtime',
      source: 'provider-endpoint'
    };
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

  private resolveModel(configModel?: string | null, aliasOverrides?: Record<string, string[]> | null): string {
    const model = (configModel || process.env.AI_MODEL || '').trim();
    if (!model) {
      throw new Error('AI model is not configured. Set admin defaultModel or AI_MODEL.');
    }
    // 逻辑别名（chat / light …）展开为具体部署；具体模型 id 原样返回
    return selectModelForAlias(model, { overrides: aliasOverrides })?.model ?? model;
  }

  private resolveReasoningModel(configModel?: string | null, aliasOverrides?: Record<string, string[]> | null): string {
    const model = (configModel || process.env.AI_MODEL_REASONING || process.env.AI_MODEL || '').trim();
    if (!model) {
      throw new Error('AI reasoning model is not configured. Set admin defaultReasoningModel or AI_MODEL_REASONING.');
    }
    // reasoning 别名按能力过滤：优先 supportsThinking 的成员（require_parameters 思路）
    return selectModelForAlias(model, { overrides: aliasOverrides, requireThinking: true })?.model ?? model;
  }

  /** platform_api_configs 的别名覆盖（此前为只回显的死字段，现作为别名映射的动态来源）。 */
  private platformAliasOverrides(config: {
    chatModels?: string | null;
    reasoningModels?: string | null;
    lightModels?: string | null;
  }): Record<string, string[]> {
    const parse = (raw?: string | null): string[] => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
      } catch {
        return [];
      }
    };
    return {
      chat: parse(config.chatModels),
      reasoning: parse(config.reasoningModels),
      light: parse(config.lightModels)
    };
  }

  async resolve(caller: CallerInfo, userId?: string): Promise<ResolvedRoute> {
    // File-as-Truth 目录热重载：mtime 变了就地换注册表；坏文件保留上一次好目录，只记日志
    const reload = reloadLlmProvidersIfChanged();
    if (reload.error && reload.error !== this.lastLoggedReloadError) {
      this.lastLoggedReloadError = reload.error;
      logger.warn('[api-gateway] llm-providers.json 热重载失败，沿用上一次目录', { errorMessage: reload.error });
    } else if (!reload.error && this.lastLoggedReloadError) {
      this.lastLoggedReloadError = null;
      logger.info('[api-gateway] llm-providers.json 已恢复并热重载成功');
    }

    if (caller.skillId) {
      const inheritedRoute = await this.resolveBaseRoute(caller, userId);
      const skillRoute = await this.getSkillConfig(caller.skillId, inheritedRoute);
      let route = skillRoute || inheritedRoute;
      // 守门 judge 必须关闭思考模式，避免审查调用因推理延长而拖慢发布链路。
      if (caller.skillId === 'semantic-freeze-judge') {
        route = { ...route, thinkingMode: 'disabled', reasoningEffort: 'default' };
      }
      return this.withRequestTimeout(this.applyProviderEndpoint(route), caller.agentId);
    }

    return this.withRequestTimeout(this.applyProviderEndpoint(await this.resolveBaseRoute(caller, userId)), caller.agentId);
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

      // 平台别名覆盖是全局的模型身份重映射:skill 显式模型同样生效(此前仅平台默认路由生效)
      // 用户自有 provider（user-provider/public-only）分层归属（2026-10-02 A/B 拍板）：
      //   学习对话链技能 → 用户自己的模型（agnes A/B 靶面）；
      //   其余技能（goal/path/评估/收尾链）→ skill 绑定照常生效（ds 好 key，质量锚定）。
      const platformRecord = await this.getPlatformConfigRecord();
      const overrides = platformRecord ? this.platformAliasOverrides(platformRecord) : null;
      const userModelWins = inheritedUserEndpoint && LEARN_DIALOGUE_SKILLS.has(skillId);
      const model = userModelWins
        ? inheritedRoute.model
        : config.model
          ? (isReasoning
            ? this.resolveReasoningModel(config.model, overrides)
            : this.resolveModel(config.model, overrides))
          : inheritedRoute.model;

      return {
        ...inheritedRoute,
        providerId: `skill:${skillId}`,
        endpoint,
        apiKey,
        model,
        // 标记 skill 级是否显式指定了模型（供 resolve-llm-call-params 决定优先级）；
        // 用户自有端点上学习对话链的模型由用户的 chatModel 决定，skill 绑定未生效 → 不标 explicit
        modelExplicit: Boolean(config.model) && !userModelWins,
        thinkingMode: this.normalizeThinkingMode(config.thinkingMode || inheritedRoute.thinkingMode),
        reasoningEffort: this.normalizeReasoningEffort(config.reasoningEffort || inheritedRoute.reasoningEffort),
        // 2026-09-28 配置体系优化：skill 级参数覆盖（paramOverrides JSON）与兜底链
        // （fallbackChain JSON）经路由透传；temperature/maxTokens 列本身仍是 deprecated 占位。
        // 上层字段级优先级见 services/resolve-llm-call-params.ts 头注释。
        skillParamOverrides: parseSkillParamOverrides(config.paramOverrides),
        skillFallbackChain: parseSkillFallbackChain(config.fallbackChain),
        // 路由仅继承上层 temperature/maxTokens，供未声明 prompt/覆盖的调用回退
        temperature: inheritedRoute.temperature,
        maxTokens: inheritedRoute.maxTokens,
        timeoutMs: config.requestTimeoutMs == null
          ? inheritedRoute.timeoutMs
          : Math.min(600_000, Math.max(10_000, config.requestTimeoutMs)),
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
        model: this.resolveModel(
          config.model || platformConfig?.defaultModel,
          platformConfig ? this.platformAliasOverrides(platformConfig) : null
        ),
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

      // user-provider 与平台同渠道时继承其思考模式/强度/结构化输出默认
      // （此前硬编码 'default' → 上游预思考开启，path-gen 类长任务被烧慢超时）
      let responseFormat: 'none' | 'json_object' = 'none';
      let thinkingMode: 'default' | 'enabled' | 'disabled' = 'default';
      let reasoningEffort: 'default' | 'low' | 'high' | 'max' = 'default';
      try {
        const plat = await systemPrisma.platform_api_configs.findUnique({
          where: { id: 'platform' },
          select: { defaultResponseFormat: true, defaultThinkingMode: true, defaultReasoningEffort: true }
        });
        responseFormat = this.normalizeResponseFormat(plat?.defaultResponseFormat);
        thinkingMode = this.normalizeThinkingMode(plat?.defaultThinkingMode || 'default');
        reasoningEffort = this.normalizeReasoningEffort(plat?.defaultReasoningEffort || 'default');
      } catch { /* 读不到按默认 */ }

      return {
        providerId: `user-provider:${userId}`,
        endpoint: config.endpoint,
        apiKey: decryptSecret(config.apiKey, USER_KEY_CONTEXT) || '',
        // 用户自有 provider:模型身份是用户自己的供应商空间,不套平台别名覆盖(有意豁免)
        model: this.resolveModel(config.chatModel),
        reasoningModel: config.reasoningModel ? this.resolveModel(config.reasoningModel) : undefined,
        thinkingMode,
        reasoningEffort,
        temperature: 0.7,
        maxTokens: 2000,
        responseFormat,
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
        chatModels: true,
        reasoningModels: true,
        lightModels: true,
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

    const overrides = platformConfig ? this.platformAliasOverrides(platformConfig) : null;
    const model = isReasoning
      ? this.resolveReasoningModel(config.model || platformConfig?.defaultReasoningModel, overrides)
      : this.resolveModel(config.model || platformConfig?.defaultModel, overrides);

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

  private normalizeReasoningEffort(value?: string | null): 'default' | 'low' | 'high' | 'max' {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized === 'low' || normalized === 'high' || normalized === 'max') {
      return normalized;
    }
    // medium/xhigh 等由上游映射处理，不在此归一；平台只显式表达 default/low/high/max
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
        model: this.resolveModel(config.defaultModel, this.platformAliasOverrides(config)),
        thinkingMode: this.normalizeThinkingMode(config.defaultThinkingMode || 'default'),
        reasoningEffort: this.normalizeReasoningEffort(config.defaultReasoningEffort || 'default'),
        responseFormat: this.normalizeResponseFormat(config.defaultResponseFormat),
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
      responseFormat: 'none',
      temperature: 0.7,
      maxTokens: 2000,
      privateNetworkPolicy: 'runtime',
      providerType: 'openai-compatible',
      source: 'env-fallback'
    };
  }

  private normalizeResponseFormat(value?: string | null): 'none' | 'json_object' {
    return (value || '').trim().toLowerCase() === 'json_object' ? 'json_object' : 'none';
  }
}
