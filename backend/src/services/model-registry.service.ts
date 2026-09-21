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
import { AVAILABLE_MODELS, MODEL_ALIASES, MODEL_MAP, getModelAliasMembers } from '../config/models.config';
import { selectModelForAlias } from '../gateway/api-gateway/model-alias';
import { MAX_MODEL_CANDIDATES } from '../gateway/api-gateway/executor';
import { listCoolingDowns, type CooldownSnapshot } from '../gateway/api-gateway/deployment-health';

export interface ModelRegistryOverview {
  generatedAt: string;
  models: Array<{
    id: string;
    label: string;
    tier: string;
    provider: string;
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
  const platform = await systemPrisma.platform_api_configs
    .findFirst({ where: { id: 'platform' } })
    .catch(() => null);

  const dbLists: Record<string, string[]> = {
    chat: parseModelList(platform?.chatModels),
    reasoning: parseModelList(platform?.reasoningModels),
    light: parseModelList(platform?.lightModels)
  };

  const warnings: string[] = [];

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
  const chatSelection = defaultModel ? selectModelForAlias(defaultModel, { overrides: dbLists }) : null;
  const reasoningSelection = reasoningModel
    ? selectModelForAlias(reasoningModel, { overrides: dbLists, requireThinking: true })
    : null;

  const models = AVAILABLE_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    tier: model.tier,
    provider: model.provider,
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

  // 跨 provider 降级链提示:降级不换网关/密钥,跨 provider 链只在单网关拓扑下可用
  for (const model of AVAILABLE_MODELS) {
    for (const target of model.fallbacks ?? []) {
      const targetModel = AVAILABLE_MODELS.find((item) => item.id === target);
      if (targetModel && targetModel.provider !== model.provider) {
        warnings.push(`模型「${model.id}」的降级目标「${target}」属于不同 provider（${model.provider} → ${targetModel.provider}）。降级仅切换模型名、网关与密钥沿用主调用：单网关拓扑下可用，多网关部署时该链不可用。`);
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
    models,
    aliases,
    defaults: {
      defaultModelConfigured: defaultModel,
      defaultModelResolved: chatSelection?.model ?? defaultModel,
      defaultModelSource: defaultModel ? (chatSelection ? 'alias' : 'concrete') : 'unset',
      defaultReasoningModelConfigured: reasoningModel,
      defaultReasoningModelResolved: reasoningSelection?.model ?? reasoningModel,
      defaultReasoningModelSource: reasoningModel ? (reasoningSelection ? 'alias' : 'concrete') : 'unset'
    },
    fallbackChains,
    runtime,
    cooldowns: listCoolingDowns(),
    warnings,
    deprecatedPromptModelCount
  };
}
