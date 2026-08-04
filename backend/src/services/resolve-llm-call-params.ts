/**
 * 单一 LLM 生成参数读路径（Phase 1 源头统一）
 *
 * 合并顺序（字段级，undefined = 未声明，跳过）：
 *   runtimeOverride → ACTIVE agent_prompts → codeDefaults → routeFallback
 *
 * 路由层（endpoint/key/timeout/skill_model_configs T）仍由 resolveRoute 负责；
 * 本模块只决定最终发给模型的 model / temperature / max_tokens。
 *
 * File-as-Truth：ACTIVE prompt 的 T/maxTokens 优先于 skill_model_configs（route）。
 */

export type LlmParamSource =
  | 'runtime-override'
  | 'active-prompt'
  | 'code-defaults'
  | 'route-fallback'
  | 'none';

export interface LlmGenerationParams {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCallParamsResolution extends LlmGenerationParams {
  sources: {
    model: LlmParamSource;
    temperature: LlmParamSource;
    maxTokens: LlmParamSource;
  };
  /** 与 ChatRequest 对齐的字段名 */
  request: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
  };
}

export interface ResolveLlmGenerationParamsInput {
  runtimeOverride?: {
    model?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
  };
  /** ACTIVE agent_prompts 行（或等价结构） */
  promptConfig?: {
    model?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
  } | null;
  codeDefaults?: {
    model?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
    /** 截断保护下限；与 maxTokens 取 max */
    minMaxTokens?: number | null;
  };
  /** resolveRoute 结果中的生成参数（仅作 prompt/code 都缺失时的回退） */
  routeFallback?: {
    model?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
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
  const prompt = input.promptConfig || null;
  const code = input.codeDefaults || {};
  const route = input.routeFallback || null;

  const model = pickString([
    { value: override.model, source: 'runtime-override' },
    { value: prompt?.model, source: 'active-prompt' },
    { value: code.model, source: 'code-defaults' },
    { value: route?.model, source: 'route-fallback' },
  ]);

  const temperature = pickNumber([
    { value: override.temperature, source: 'runtime-override' },
    { value: prompt?.temperature, source: 'active-prompt' },
    { value: code.temperature, source: 'code-defaults' },
    { value: route?.temperature, source: 'route-fallback' },
  ]);

  let maxTokens = pickNumber([
    { value: override.maxTokens, source: 'runtime-override' },
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

  return {
    model: model.value,
    temperature: temperature.value,
    maxTokens: maxTokens.value,
    sources: {
      model: model.source,
      temperature: temperature.source,
      maxTokens: maxTokens.source,
    },
    request: {
      model: model.value,
      temperature: temperature.value,
      max_tokens: maxTokens.value,
    },
  };
}

export interface ResolveLlmCallParamsInput {
  skillId?: string | null;
  agentId?: string | null;
  /** 已加载的 ACTIVE prompt；不传则按 skillId/agentId 自动加载 */
  promptConfig?: ResolveLlmGenerationParamsInput['promptConfig'];
  runtimeOverride?: ResolveLlmGenerationParamsInput['runtimeOverride'];
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
      };
    } catch {
      routeFallback = null;
    }
  }

  const resolved = resolveLlmGenerationParams({
    runtimeOverride: input.runtimeOverride,
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
    max_tokens?: number;
    [key: string]: any;
  },
  context?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    max_tokens?: number;
    [key: string]: any;
  } | null
): {
  model?: string;
  temperature?: number;
  max_tokens?: number;
} {
  const ctx = context || {};
  return {
    model: nonEmptyString(request.model) ?? nonEmptyString(ctx.model),
    temperature:
      finiteNumber(request.temperature) ?? finiteNumber(ctx.temperature),
    max_tokens:
      finiteNumber(request.max_tokens)
      ?? finiteNumber(ctx.max_tokens)
      ?? finiteNumber(ctx.maxTokens),
  };
}
