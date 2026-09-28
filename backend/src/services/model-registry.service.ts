/**
 * 模型配置总览（只读聚合，见 doc/MODEL_GATEWAY_DESIGN.md §4.1 / §4.2 / §4.5）。
 *
 * 定位：**读模型统一**——把散落在「代码能力注册表 + platform_api_configs 别名覆盖 +
 * 部署冷却」的生效状态汇聚成一个只读视图，供管理端"看清"（P2⑤ 方案 B）。
 *
 * 不做写操作：模型能力的唯一写源仍是 `config/models.config.ts`（代码注册表）；
 * 别名成员可由 `platform_api_configs.chatModels/reasoningModels/lightModels` 覆盖。
 */
import systemPrisma from '../config/system-database';
import {
  AVAILABLE_MODELS, MODEL_ALIASES, MODEL_MAP, getModelAliasMembers,
  getProviderCatalog, getLlmRegistryStatus, getModelDefaults, reloadLlmProvidersIfChanged
} from '../config/models.config';
import { selectModelForAlias } from '../gateway/api-gateway/model-alias';
import { MAX_MODEL_CANDIDATES } from '../gateway/api-gateway/executor';
import { listCoolingDowns, type CooldownSnapshot } from '../gateway/api-gateway/deployment-health';

export interface ModelRegistryOverview {
  generatedAt: string;
  providers: Array<{
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    recommended: boolean;
    endpointSource: 'inherit' | 'own';
    baseUrl: string | null;
    apiKeyEnv: string | null;
    keyConfigured: boolean | null;
    modelIds: string[];
  }>;
  registry: {
    /** File-as-Truth 目录文件状态（路径/来源/mtime/最近热重载错误） */
    path: string;
    source: 'file' | 'embedded-fallback';
    mtimeMs: number | null;
    lastError: string | null;
    /** 文件内 defaults（运行时实际默认仍以 platform_api_configs DB 行为准，见 defaults 段） */
    fileDefaults: { chat: string; reasoning: string };
  };
  models: Array<{
    id: string;
    label: string;
    tier: string;
    provider: string;
    providerId: string;
    providerName?: string;
    hasOwnEndpoint: boolean;
    keyConfigured: boolean | null;
    capabilities: {
      supportsThinking: boolean;
      supportsReasoningEffort: boolean;
    };
    limits: {
      maxOutputTokens: number | null;
      defaultMaxTokens: number | null;
      reasoningReserveTokens: number;
      maxParallelRequests: number | null;
    };
    fallbacks: string[];
    pricingConfigured: boolean;
    description?: string;
  }>;
  aliases: Array<{
    alias: string;
    source: 'code' | 'db-override';
    members: string[];
    /** DB 覆盖声明（含未注册项，便于发现配置漂移）；无覆盖为 null */
    dbMembers: string[] | null;
    selected: string | null;
    selectedWhenRequiringThinking: string | null;
    degradedWhenRequiringThinking: boolean;
  }>;
  defaults: {
    defaultModelConfigured: string | null;
    defaultModelResolved: string | null;
    defaultModelSource: 'alias' | 'concrete' | 'unset';
    defaultReasoningModelConfigured: string | null;
    defaultReasoningModelResolved: string | null;
    defaultReasoningModelSource: 'alias' | 'concrete' | 'unset';
    /** 评估默认路由（platform_api_configs.defaultEvaluationModel，经 api-config 页配置） */
    defaultEvaluationModelConfigured: string | null;
    defaultEvaluationModelResolved: string | null;
    defaultEvaluationModelSource: 'alias' | 'concrete' | 'unset';
  };
  fallbackChains: Array<{
    model: string;
    fallbacks: string[];
    effectiveFallbacks: string[];
    truncated: boolean;
  }>;
  runtime: { maxModelCandidates: number; fallbackSwapsModelOnly: boolean };
  cooldowns: CooldownSnapshot[];
  /** 配置漂移 / 待清理项 */
  warnings: string[];
  /** ACTIVE prompt 上仍残留的、已废弃的 model 副本数量（见 §4.9） */
  deprecatedPromptModelCount: number;
}

function parseModelList(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export async function getModelRegistryOverview(): Promise<ModelRegistryOverview> {
  // 诊断页读最新目录：热重载检查后，热重载失败信息会如实进入 registry.lastError/warnings
  reloadLlmProvidersIfChanged();
  const platform = await systemPrisma.platform_api_configs
    .findFirst({ where: { id: 'platform' } })
    .catch(() => null);

  const dbLists: Record<string, string[]> = {
    chat: parseModelList(platform?.chatModels),
    reasoning: parseModelList(platform?.reasoningModels),
    light: parseModelList(platform?.lightModels)
  };

  const providers = getProviderCatalog().map((p) => ({
    id: p.id,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    enabled: p.enabled,
    recommended: p.recommended,
    endpointSource: p.endpointSource,
    baseUrl: p.baseUrl ?? null,
    apiKeyEnv: p.apiKeyEnv ?? null,
    keyConfigured: p.apiKeyEnv ? Boolean((process.env[p.apiKeyEnv] || '').trim()) : null,
    modelIds: p.models.map((m) => m.id)
  }));
  const registryStatus = getLlmRegistryStatus();

  const warnings: string[] = [];
  if (registryStatus.source === 'embedded-fallback') {
    warnings.push(`模型目录来自内置兜底（未读到 ${registryStatus.path}）。请检查配置文件是否在位。`);
  }
  if (registryStatus.lastError) {
    warnings.push(`llm-providers.json 热重载失败，沿用上一次好目录：${registryStatus.lastError}`);
  }
  for (const p of providers) {
    if (p.enabled && p.endpointSource === 'own' && p.keyConfigured === false) {
      warnings.push(`供应商「${p.id}」的密钥环境变量 ${p.apiKeyEnv} 未配置，其模型（${p.modelIds.join('、')}）在运行时会直接报错。`);
    }
  }

  // 多通道重名歧义：裸 id 解析取声明在前的启用通道，跨通道引用必须用 provider/model 限定式
  const providerOwners = new Map<string, string[]>();
  for (const p of getProviderCatalog()) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      const owners = providerOwners.get(m.id) ?? [];
      owners.push(p.id);
      providerOwners.set(m.id, owners);
    }
  }
  for (const [modelId, owners] of providerOwners) {
    if (owners.length > 1) {
      warnings.push(`模型「${modelId}」由多个启用供应商声明（${owners.join('、')}）：裸 id 解析取声明在前的「${owners[0]}」，指定其他通道请用 ${owners[1]}/${modelId} 限定式引用。`);
    }
  }

  // 别名：DB 覆盖优先，代码注册表兜底
  const aliases = Object.keys(MODEL_ALIASES).map((alias) => {
    const dbMembers = dbLists[alias] ?? [];
    const unknown = dbMembers.filter((id) => !MODEL_MAP.has(id));
    if (unknown.length) {
      warnings.push(`别名「${alias}」的 DB 覆盖含未注册模型（已忽略）：${unknown.join('、')}`);
    }
    const members = getModelAliasMembers(alias, dbLists);
    const plain = selectModelForAlias(alias, { overrides: dbLists });
    const thinking = selectModelForAlias(alias, { overrides: dbLists, requireThinking: true });
    if (members.length === 0) {
      warnings.push(`别名「${alias}」解析后没有可用成员，会退化为按字面量使用。`);
    }
    return {
      alias,
      source: (dbMembers.length ? 'db-override' : 'code') as 'code' | 'db-override',
      members,
      dbMembers: dbMembers.length ? dbMembers : null,
      selected: plain?.model ?? null,
      selectedWhenRequiringThinking: thinking?.model ?? null,
      degradedWhenRequiringThinking: thinking?.degraded ?? false
    };
  });

  const defaultModel = platform?.defaultModel ?? null;
  const reasoningModel = platform?.defaultReasoningModel ?? null;
  // 评估默认是真实存在的第三档路由（api-config 页可配置，schema defaultEvaluationModel）；
  // 运行时经 apiConfig.service 读取，未配置时兜底 env AI_MODEL_REASONING。
  // 总览与其余两档同口径：只展示 platform 行上的已配置值，不做 env 兜底/伪造。
  const evaluationModel = platform?.defaultEvaluationModel ?? null;
  const chatSelection = defaultModel ? selectModelForAlias(defaultModel, { overrides: dbLists }) : null;
  const reasoningSelection = reasoningModel
    ? selectModelForAlias(reasoningModel, { overrides: dbLists, requireThinking: true })
    : null;
  const evaluationSelection = evaluationModel ? selectModelForAlias(evaluationModel, { overrides: dbLists }) : null;

  const models = AVAILABLE_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    tier: model.tier,
    provider: model.provider,
    providerId: model.providerId,
    ...(model.providerName ? { providerName: model.providerName } : {}),
    hasOwnEndpoint: Boolean(model.providerEndpoint),
    keyConfigured: model.providerEndpoint
      ? Boolean((process.env[model.providerEndpoint.apiKeyEnv] || '').trim())
      : null,
    capabilities: {
      supportsThinking: model.supportsThinking === true,
      supportsReasoningEffort: model.supportsReasoningEffort === true
    },
    limits: {
      maxOutputTokens: model.maxOutputTokens ?? null,
      defaultMaxTokens: model.defaultMaxTokens ?? null,
      reasoningReserveTokens: model.reasoningReserveTokens ?? 0,
      maxParallelRequests: model.maxParallelRequests ?? null
    },
    fallbacks: model.fallbacks ?? [],
    pricingConfigured: Boolean(model.pricing && Object.values(model.pricing).some((value) => typeof value === 'number')),
    description: model.description
  }));

  // 运行时有效链:executor 只允许主模型 + 1 跳 fallback(MAX_MODEL_CANDIDATES),
  // 声明链更长也只生效前 N 个候选——展示层必须与运行时一致,避免「看着 3 层保险实际 1 层」
  const runtimeMaxCandidates = MAX_MODEL_CANDIDATES;
  const fallbackChains = models
    .filter((model) => model.fallbacks.length > 0)
    .map((model) => ({
      model: model.id,
      fallbacks: model.fallbacks,
      effectiveFallbacks: model.fallbacks.slice(0, Math.max(0, runtimeMaxCandidates - 1)),
      truncated: model.fallbacks.length > runtimeMaxCandidates - 1
    }));
  // 降级语义:仅切换模型名,网关与密钥沿用主调用(单网关拓扑下正确;多网关需候选自带部署)
  const runtime = { maxModelCandidates: runtimeMaxCandidates, fallbackSwapsModelOnly: true as const };

  // 跨供应商降级链提示:降级不换网关/密钥,跨供应商链只在单网关拓扑下可用。
  // 两层口径：旧 provider 展示字段（deepseek/agnes 渠道差异）+ providerId（自带端点的独立供应商）。
  for (const model of AVAILABLE_MODELS) {
    for (const target of model.fallbacks ?? []) {
      const targetModel = AVAILABLE_MODELS.find((item) => item.id === target);
      if (!targetModel) continue;
      if (targetModel.provider !== model.provider) {
        warnings.push(`模型「${model.id}」的降级目标「${target}」属于不同 provider（${model.provider} → ${targetModel.provider}）。降级仅切换模型名、网关与密钥沿用主调用：单网关拓扑下可用，多网关部署时该链不可用。`);
      } else if (model.providerId !== targetModel.providerId) {
        warnings.push(`模型「${model.id}」的降级目标「${target}」属于不同供应商（${model.providerId} → ${targetModel.providerId}）。降级不切换端点，跨供应商候选不可达。`);
      }
    }
  }

  // 未被任何别名引用的模型（提示：可能已下线或漏配别名）
  const referenced = new Set(aliases.flatMap((item) => item.members));
  for (const model of AVAILABLE_MODELS) {
    if (!referenced.has(model.id)) {
      warnings.push(`模型「${model.id}」未被任何别名引用（只能通过具体 id 使用）。`);
    }
  }

  // 隐藏真源可见性:agent 级覆盖优先于平台默认路由,遗留行会让平台级模型切换对部分 agent 失效
  try {
    const agentOverrideCount = await systemPrisma.agent_model_configs.count({ where: { enabled: true } });
    if (agentOverrideCount > 0) {
      warnings.push(`${agentOverrideCount} 个 agent 存在模型级覆盖（agent_model_configs，优先级高于平台默认路由）。若平台默认模型切换未生效，请先检查这些覆盖。`);
    }
  } catch { /* 总览是诊断页:统计失败不阻塞其余信息 */ }

  let deprecatedPromptModelCount = 0;
  try {
    deprecatedPromptModelCount = await systemPrisma.agent_prompts.count({
      where: { status: 'ACTIVE', NOT: { model: null } }
    });
  } catch {
    deprecatedPromptModelCount = 0;
  }
  if (deprecatedPromptModelCount > 0) {
    warnings.push(
      `有 ${deprecatedPromptModelCount} 条 ACTIVE prompt 仍带 model 副本（已废弃，运行时仅作最后兜底，模型绑定以路由层为准）。`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    providers,
    registry: {
      path: registryStatus.path,
      source: registryStatus.source,
      mtimeMs: registryStatus.mtimeMs,
      lastError: registryStatus.lastError,
      fileDefaults: getModelDefaults()
    },
    models,
    aliases,
    defaults: {
      defaultModelConfigured: defaultModel,
      defaultModelResolved: chatSelection?.model ?? defaultModel,
      defaultModelSource: defaultModel ? (chatSelection ? 'alias' : 'concrete') : 'unset',
      defaultReasoningModelConfigured: reasoningModel,
      defaultReasoningModelResolved: reasoningSelection?.model ?? reasoningModel,
      defaultReasoningModelSource: reasoningModel ? (reasoningSelection ? 'alias' : 'concrete') : 'unset',
      defaultEvaluationModelConfigured: evaluationModel,
      defaultEvaluationModelResolved: evaluationSelection?.model ?? evaluationModel,
      defaultEvaluationModelSource: evaluationModel ? (evaluationSelection ? 'alias' : 'concrete') : 'unset'
    },
    fallbackChains,
    runtime,
    cooldowns: listCoolingDowns(),
    warnings,
    deprecatedPromptModelCount
  };
}
