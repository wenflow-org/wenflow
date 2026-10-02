/**
 * 单一 LLM 生成参数读路径（Phase 1 源头统一）
 *
 * 合并顺序（字段级，undefined = 未声明，跳过）：
 *   runtimeOverride → skill-override(skill_model_configs.paramOverrides) → ACTIVE agent_prompts
 *   → codeDefaults → routeFallback
 *
 * 路由层（endpoint/key/timeout/skill_model_configs T）仍由 resolveRoute 负责；
 * model/温度/topP/预算的最终值由本模块决定。skill-override 层经 ResolvedRoute.skillParamOverrides
 * 透传（router.getSkillConfig 解析 JSON 后挂上）。
 *
 * File-as-Truth：ACTIVE prompt 的 T/maxTokens 优先于 skill_model_configs（route）。
 */

import { getModelDefinition } from '../config/models.config';

/** 调用方未声明输出预算、且模型未配置 defaultMaxTokens 时的全局兜底 */
export const GLOBAL_DEFAULT_MAX_TOKENS = 8192;
/** 输出预算下限：低于该值不再下调（截断保护） */
export const MIN_OUTPUT_TOKENS = 256;

export type LlmParamSource =
  | 'runtime-override'
  | 'skill-override'
  | 'active-prompt'
  | 'code-defaults'
  | 'route-fallback'
  | 'none';

export interface LlmGenerationParams {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** 'json_object' = 请求附 response_format（解码层强制 JSON；仅 json 媒介技能生效，composer 把关） */
  responseFormat?: 'none' | 'json_object';
}

export interface LlmCallParamsResolution extends LlmGenerationParams {
  sources: {
    model: LlmParamSource;
    temperature: LlmParamSource;
    topP: LlmParamSource;
    maxTokens: LlmParamSource;
    responseFormat: LlmParamSource;
  };
  /** 与 ChatRequest 对齐的字段名 */
  request: {
    model?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    response_format?: { type: 'json_object' };
  };
}

export interface ResolveLlmGenerationParamsInput {
  runtimeOverride?: {
    model?: string | null;
    temperature?: number | null;
    topP?: number | null;
    maxTokens?: number | null;
  };
  /** skill 级覆盖（skill_model_configs.paramOverrides，null=未覆盖；字段级跳过） */
  skillOverrides?: {
    temperature?: number | null;
    topP?: number | null;
    maxTokens?: number | null;
    /** 'json_object' = 强制 JSON；'none'/缺省 = 用通道默认 */
    responseFormat?: string | null;
  } | null;
  /** ACTIVE agent_prompts 行（或等价结构；topP 该表暂无列，恒空） */
  promptConfig?: {
    model?: string | null;
    temperature?: number | null;
    topP?: number | null;
    maxTokens?: number | null;
  } | null;
  codeDefaults?: {
    model?: string | null;
    temperature?: number | null;
    topP?: number | null;
    maxTokens?: number | null;
    /** 截断保护下限；与 maxTokens 取 max */
    minMaxTokens?: number | null;
  };
  /** resolveRoute 结果中的生成参数（仅作 prompt/code 都缺失时的回退） */
  routeFallback?: {
    model?: string | null;
    temperature?: number | null;
    topP?: number | null;
    maxTokens?: number | null;
    /** 通道级默认（platform_api_configs.defaultResponseFormat 经路由透传） */
    responseFormat?: string | null;
    /** 经 ResolvedRoute 透传的 skill 级覆盖（不走 pickNumber 链，单独作 skill-override 层） */
    skillParamOverrides?: {
      temperature?: number | null;
      topP?: number | null;
      maxTokens?: number | null;
      responseFormat?: string | null;
    } | null;
  } | null;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function pickString(
  layers: Array<{ value: unknown; source: LlmParamSource }>
): { value?: string; source: LlmParamSource } {
  for (const layer of layers) {
    const v = nonEmptyString(layer.value);
    if (v !== undefined) return { value: v, source: layer.source };
  }
  return { source: 'none' };
}

function pickNumber(
  layers: Array<{ value: unknown; source: LlmParamSource }>
): { value?: number; source: LlmParamSource } {
  for (const layer of layers) {
    // null 视为显式未用，跳过；undefined 也跳过
    if (layer.value === undefined || layer.value === null) continue;
    const v = finiteNumber(layer.value);
    if (v !== undefined) return { value: v, source: layer.source };
  }
  return { source: 'none' };
}

/**
 * 纯函数：给定已加载的 prompt/route/defaults，解析最终生成参数。
 * 不访问 DB，可单测、可被 admin effective 与运行时共用。
 */
export function resolveLlmGenerationParams(
  input: ResolveLlmGenerationParamsInput
): LlmCallParamsResolution {
  const override = input.runtimeOverride || {};
  const skillOverride = input.skillOverrides || null;
  const prompt = input.promptConfig || null;
  const code = input.codeDefaults || {};
  const route = input.routeFallback || null;

  // 模型绑定只来自「模型/路由层」：runtimeOverride > route > codeDefaults。
  // `agent_prompts.model`（active-prompt）是历史遗留的**绑定副本**，已废弃，仅作最后兜底——
  // 否则它会抢走 route 的权威，导致「改平台默认模型对已 seed 的 skill 不生效」
  // （2026-09 实测：30/30 ACTIVE prompt 带 model 副本；见 doc/MODEL_GATEWAY_DESIGN.md §4.9）。
  // skill_model_configs.model 经 router.getSkillConfig 进 ResolvedRoute.model（modelExplicit 标记）。
  const model = pickString([
    { value: override.model, source: 'runtime-override' },
    { value: route?.model, source: 'route-fallback' },
    { value: code.model, source: 'code-defaults' },
    { value: prompt?.model, source: 'active-prompt' },
  ]);

  // 温度/topP/maxTokens 合并序（2026-09-28 起）：runtime-override > skill-override
  // > active-prompt(File-as-Truth) > code-defaults > route-fallback。
  // skill-override = skill_model_configs.paramOverrides（管理端可配，覆盖即优先）。
  const temperature = pickNumber([
    { value: override.temperature, source: 'runtime-override' },
    { value: skillOverride?.temperature, source: 'skill-override' },
    { value: prompt?.temperature, source: 'active-prompt' },
    { value: code.temperature, source: 'code-defaults' },
    { value: route?.temperature, source: 'route-fallback' },
  ]);

  // topP：agent_prompts 暂无列 → active-prompt 层恒空，只有 runtime / skill / code / route 四层
  const topP = pickNumber([
    { value: override.topP, source: 'runtime-override' },
    { value: skillOverride?.topP, source: 'skill-override' },
    { value: prompt?.topP, source: 'active-prompt' },
    { value: code.topP, source: 'code-defaults' },
    { value: route?.topP, source: 'route-fallback' },
  ]);

  let maxTokens = pickNumber([
    { value: override.maxTokens, source: 'runtime-override' },
    { value: skillOverride?.maxTokens, source: 'skill-override' },
    { value: prompt?.maxTokens, source: 'active-prompt' },
    { value: code.maxTokens, source: 'code-defaults' },
    { value: route?.maxTokens, source: 'route-fallback' },
  ]);

  const minMax = finiteNumber(code.minMaxTokens);
  if (minMax !== undefined && minMax > 0) {
    if (maxTokens.value === undefined) {
      maxTokens = { value: minMax, source: 'code-defaults' };
    } else if (maxTokens.value < minMax) {
      maxTokens = { value: minMax, source: maxTokens.source };
    }
  }

  // 输出预算策略（2026-09 修正，见 doc/MODEL_GATEWAY_DESIGN.md §4.3）：
  //   `maxOutputTokens` 是**模型能力上限**，不是请求参数。
  //   - 调用方声明（prompt/code/route）即权威意图，只做上下界 clamp
  //   - 未声明 → 模型 defaultMaxTokens，其次全局兜底
  //   - runtime-override 保持豁免（调试/低耗可显式调小；越界由调用方负责）
  // 旧实现把任何非 runtime-override 的声明值**无条件抬到模型硬上限**（deepseek=131072），
  // 使 prompts/core/*.yaml 的 params.maxTokens（800~32000）全部失效。
  if (maxTokens.source !== 'runtime-override') {
    const modelDef = model.value ? getModelDefinition(model.value) : undefined;
    if (maxTokens.value === undefined) {
      maxTokens = {
        value: modelDef?.defaultMaxTokens ?? GLOBAL_DEFAULT_MAX_TOKENS,
        source: 'code-defaults',
      };
    }
    if (maxTokens.value < MIN_OUTPUT_TOKENS) {
      maxTokens = { value: MIN_OUTPUT_TOKENS, source: maxTokens.source };
    }
    const modelMax = modelDef?.maxOutputTokens;
    if (modelMax !== undefined && maxTokens.value > modelMax) {
      // 显式配置超过模型上限时压回上限（防止上游 400：max_tokens exceeds limit）
      maxTokens = { value: modelMax, source: maxTokens.source };
    }
  }

  // 结构化输出（2026-10-02）：skill-override（paramOverrides.responseFormat）> 通道默认
  // （route = platform_api_configs.defaultResponseFormat）。层内「显式声明即停」：skill 填 'none'
  // 是有意关闭通道默认，不能落空到 route。仅 'json_object' 生效，其余值按关闭处理。
  let responseFormat: { value?: 'json_object'; source: LlmParamSource } = { source: 'none' };
  for (const layer of [
    { value: skillOverride?.responseFormat, source: 'skill-override' as const },
    { value: route?.responseFormat, source: 'route-fallback' as const },
  ]) {
    const normalized = typeof layer.value === 'string' ? layer.value.trim().toLowerCase() : '';
    if (!normalized) continue;
    if (normalized === 'json_object') responseFormat = { value: 'json_object', source: layer.source };
    break;
  }

  return {
    model: model.value,
    temperature: temperature.value,
    topP: topP.value,
    maxTokens: maxTokens.value,
    responseFormat: responseFormat.value ?? 'none',
    sources: {
      model: model.source,
      temperature: temperature.source,
      topP: topP.source,
      maxTokens: maxTokens.source,
      responseFormat: responseFormat.source,
    },
    request: {
      model: model.value,
      temperature: temperature.value,
      top_p: topP.value,
      max_tokens: maxTokens.value,
      ...(responseFormat.value ? { response_format: { type: 'json_object' as const } } : {}),
    },
  };
}

export interface ResolveLlmCallParamsInput {
  skillId?: string | null;
  agentId?: string | null;
  /** 已加载的 ACTIVE prompt；不传则按 skillId/agentId 自动加载 */
  promptConfig?: ResolveLlmGenerationParamsInput['promptConfig'];
  runtimeOverride?: ResolveLlmGenerationParamsInput['runtimeOverride'];
  /** skill 级参数覆盖（不传则从 route 行读取 paramOverrides） */
  skillOverrides?: ResolveLlmGenerationParamsInput['skillOverrides'];
  codeDefaults?: ResolveLlmGenerationParamsInput['codeDefaults'];
  /** 是否解析 route 作为最后回退（默认 true） */
  includeRouteFallback?: boolean;
}

function toPromptAgentIds(skillId?: string | null, agentId?: string | null): string[] {
  const ids: string[] = [];
  const shortSkill = skillId ? String(skillId).replace(/^skill:/, '').trim() : '';
  if (shortSkill) {
    ids.push(`skill:${shortSkill}`, shortSkill);
  }
  if (agentId && String(agentId).trim()) {
    ids.push(String(agentId).trim());
  }
  return Array.from(new Set(ids.filter(Boolean)));
}

/**
 * 异步入口：可自动加载 ACTIVE prompt 与 route fallback。
 * 运行时 callPrompt / aiService / 直接 gateway 调用应优先使用本函数或纯函数 + 已有 prompt。
 */
export async function resolveLlmCallParams(
  input: ResolveLlmCallParamsInput
): Promise<LlmCallParamsResolution & {
  promptAgentId: string | null;
  routeResolved: boolean;
}> {
  let promptConfig = input.promptConfig;
  let promptAgentId: string | null = null;

  if (promptConfig === undefined) {
    const { agentConfigService } = await import('./agentConfig.service');
    for (const id of toPromptAgentIds(input.skillId, input.agentId)) {
      const row = await agentConfigService.getActivePrompt(id);
      if (row) {
        promptConfig = row;
        promptAgentId = id;
        break;
      }
    }
  }

  let routeFallback: ResolveLlmGenerationParamsInput['routeFallback'] = null;
  let routeResolved = false;
  if (input.includeRouteFallback !== false) {
    try {
      const { getAPIGateway } = await import('../gateway/api-gateway');
      const shortSkill = input.skillId
        ? String(input.skillId).replace(/^skill:/, '').trim()
        : undefined;
      const route = await getAPIGateway().resolveRoute({
        agentId: input.agentId || undefined,
        skillId: shortSkill || undefined,
      });
      routeResolved = true;
      routeFallback = {
        model: route.model,
        temperature: route.temperature,
        maxTokens: route.maxTokens,
        // 通道级结构化输出默认（platform_api_configs.defaultResponseFormat）
        responseFormat: (route as any).responseFormat ?? null,
        // skill 级覆盖（paramOverrides JSON）经 ResolvedRoute 透传，供 skill-override 层
        skillParamOverrides: (route as any).skillParamOverrides ?? null,
      };
    } catch {
      routeFallback = null;
    }
  }

  const resolved = resolveLlmGenerationParams({
    runtimeOverride: input.runtimeOverride,
    skillOverrides: input.skillOverrides ?? routeFallback?.skillParamOverrides ?? null,
    promptConfig,
    codeDefaults: input.codeDefaults,
    routeFallback,
  });

  return {
    ...resolved,
    promptAgentId,
    routeResolved,
  };
}

/** 从 ChatRequest 与 ExecutionContext 中提升可能被误放在 context 的生成参数 */
export function hoistLlmParamsFromContext(
  request: {
    model?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    [key: string]: any;
  },
  context?: {
    model?: string;
    temperature?: number;
    topP?: number;
    top_p?: number;
    maxTokens?: number;
    max_tokens?: number;
    [key: string]: any;
  } | null
): {
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
} {
  const ctx = context || {};
  return {
    model: nonEmptyString(request.model) ?? nonEmptyString(ctx.model),
    temperature:
      finiteNumber(request.temperature) ?? finiteNumber(ctx.temperature),
    top_p:
      finiteNumber(request.top_p)
      ?? finiteNumber(ctx.topP)
      ?? finiteNumber(ctx.top_p),
    max_tokens:
      finiteNumber(request.max_tokens)
      ?? finiteNumber(ctx.max_tokens)
      ?? finiteNumber(ctx.maxTokens),
  };
}
