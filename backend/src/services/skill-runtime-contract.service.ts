import prisma from '../config/database';
import systemPrisma from '../config/system-database';
import { getAPIGateway } from '../gateway/api-gateway';
import {
  getAgentManifest,
  getAgentOfSkill,
  getCanonicalAgentId,
} from './agent-manifest.service';
import {
  getPlatformReliabilitySettings,
  type PlatformReliabilitySettings,
} from './reliability-settings.service';
import skillModelConfigService from './skillModelConfig.service';

export type SkillStatsRange = '24h' | '7d' | '30d' | 'all';

export interface UnifiedSkillStats {
  skillId: string;
  canonicalId: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgDurationMs: number;
  lastCalledAt: Date | null;
  source: 'prompt_call_logs' | 'agent_call_logs' | 'none';
  range: SkillStatsRange;
}

export interface EffectiveSkillRuntimeConfig {
  skillId: string;
  canonicalId: string;
  route: {
    model: string | null;
    temperature: number | null;
    maxTokens: number | null;
    timeoutMs: number | null;
    thinkingMode: string | null;
    reasoningEffort: string | null;
    source: 'skill-override' | 'agent-or-platform' | 'platform-default' | 'unresolved';
    hasSkillOverride: boolean;
  };
  /** 实际 LLM 请求参数（callPrompt 路径）：ACTIVE prompt 优先于 route */
  llmRequest: {
    model: string | null;
    temperature: number | null;
    maxTokens: number | null;
    source: 'active-prompt' | 'route' | 'none';
    activePrompt: {
      id: string;
      version: number;
      model: string | null;
      temperature: number | null;
      maxTokens: number | null;
    } | null;
  };
  override: {
    enabled: boolean;
    model: string | null;
    temperature: number | null;
    maxTokens: number | null;
    maxLogicalRetries: number | null;
    requestTimeoutMs: number | null;
  } | null;
  reliability: {
    maxUpstreamAttempts: number;
    maxTransportRetries: number;
    maxLogicalRetries: number;
    logicalRetrySource: 'platform-default' | 'skill-override';
    platformMaxLogicalRetries: number;
  };
}

function toShortSkillId(skillId: string): string {
  return String(skillId || '').replace(/^skill:/, '').trim();
}

function toCanonicalSkillId(skillId: string): string {
  const raw = String(skillId || '').trim();
  if (!raw) return raw;
  // 避免 bare "goal-conversation" 被别名解析成 goal-agent
  const preferred = raw.startsWith('skill:') ? raw : `skill:${raw}`;
  const canonical = getCanonicalAgentId(preferred);
  if (canonical.startsWith('skill:')) return canonical;
  const short = toShortSkillId(raw);
  return short ? `skill:${short}` : raw;
}

function rangeToSince(range: SkillStatsRange): Date | null {
  if (range === 'all') return null;
  const ms =
    range === '24h' ? 24 * 3600_000
      : range === '30d' ? 30 * 24 * 3600_000
        : 7 * 24 * 3600_000;
  return new Date(Date.now() - ms);
}

function emptyStats(skillId: string, range: SkillStatsRange): UnifiedSkillStats {
  const short = toShortSkillId(skillId);
  return {
    skillId: short,
    canonicalId: toCanonicalSkillId(skillId),
    callCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: null,
    avgDurationMs: 0,
    lastCalledAt: null,
    source: 'none',
    range,
  };
}

function finalizeStats(
  skillId: string,
  range: SkillStatsRange,
  total: number,
  success: number,
  avgDurationMs: number,
  lastCalledAt: Date | null,
  source: UnifiedSkillStats['source']
): UnifiedSkillStats {
  const short = toShortSkillId(skillId);
  return {
    skillId: short,
    canonicalId: toCanonicalSkillId(skillId),
    callCount: total,
    successCount: success,
    failureCount: Math.max(0, total - success),
    successRate: total > 0 ? Number(((success / total) * 100).toFixed(1)) : null,
    avgDurationMs: Math.round(avgDurationMs || 0),
    lastCalledAt,
    source,
    range,
  };
}

/**
 * 统一 Skill 运行统计：
 * 1) 有 prompt_call_logs → 以 prompt 调用为准（LLM skill）
 * 2) 否则 skill 层 agent_call_logs（排除 api-gateway）
 * 3) 同一 range 口径
 */
export async function getUnifiedSkillStats(
  skillIds: string[],
  range: SkillStatsRange = 'all'
): Promise<Map<string, UnifiedSkillStats>> {
  const result = new Map<string, UnifiedSkillStats>();
  const shortIds = Array.from(
    new Set(skillIds.map(toShortSkillId).filter(Boolean))
  );
  if (!shortIds.length) return result;

  for (const id of shortIds) {
    result.set(id, emptyStats(id, range));
  }

  const since = rangeToSince(range);
  const promptAgentIds = shortIds.map((id) => `skill:${id}`);
  const promptWhere: any = { agentId: { in: promptAgentIds } };
  if (since) promptWhere.createdAt = { gte: since };

  const agentWhere: any = {
    AND: [
      {
        OR: [
          { executionLayer: null },
          { executionLayer: { not: 'api-gateway' } },
        ],
      },
      {
        OR: shortIds.flatMap((name) => [
          { agentId: `skill:${name}` },
          { metadata: { contains: `"skillId":"${name}"` } },
          { metadata: { contains: `"skillId":"skill:${name}"` } },
        ]),
      },
    ],
  };
  if (since) agentWhere.AND.push({ calledAt: { gte: since } });

  const [promptGroups, promptSuccessGroups, agentLogs] = await Promise.all([
    prisma.prompt_call_logs.groupBy({
      by: ['agentId'],
      where: promptWhere,
      _count: { _all: true },
      _avg: { durationMs: true },
      _max: { createdAt: true },
    }),
    prisma.prompt_call_logs.groupBy({
      by: ['agentId', 'success'],
      where: promptWhere,
      _count: { _all: true },
    }),
    prisma.agent_call_logs.findMany({
      where: agentWhere,
      select: {
        agentId: true,
        metadata: true,
        success: true,
        durationMs: true,
        calledAt: true,
      },
    }),
  ]);

  const promptSuccessMap = new Map<string, number>();
  for (const group of promptSuccessGroups) {
    if (group.success) {
      promptSuccessMap.set(group.agentId, group._count._all);
    }
  }

  const promptBacked = new Set<string>();
  for (const group of promptGroups) {
    const short = group.agentId.replace(/^skill:/, '');
    if (!shortIds.includes(short)) continue;
    promptBacked.add(short);
    result.set(
      short,
      finalizeStats(
        short,
        range,
        group._count._all,
        promptSuccessMap.get(group.agentId) || 0,
        group._avg.durationMs || 0,
        group._max.createdAt || null,
        'prompt_call_logs'
      )
    );
  }

  const agentAgg = new Map<
    string,
    { total: number; success: number; durationTotal: number; lastCalledAt: Date | null }
  >();
  for (const log of agentLogs) {
    let short = '';
    if (typeof log.agentId === 'string' && log.agentId.startsWith('skill:')) {
      short = log.agentId.replace(/^skill:/, '');
    } else {
      try {
        const metadata = log.metadata ? JSON.parse(log.metadata) : null;
        const raw = typeof metadata?.skillId === 'string' ? metadata.skillId : '';
        short = raw.replace(/^skill:/, '');
      } catch {
        short = '';
      }
    }
    if (!shortIds.includes(short)) continue;
    if (promptBacked.has(short)) continue;

    const current = agentAgg.get(short) || {
      total: 0,
      success: 0,
      durationTotal: 0,
      lastCalledAt: null,
    };
    current.total += 1;
    current.success += log.success ? 1 : 0;
    current.durationTotal += log.durationMs || 0;
    if (!current.lastCalledAt || log.calledAt > current.lastCalledAt) {
      current.lastCalledAt = log.calledAt;
    }
    agentAgg.set(short, current);
  }

  for (const [short, stats] of agentAgg.entries()) {
    result.set(
      short,
      finalizeStats(
        short,
        range,
        stats.total,
        stats.success,
        stats.total > 0 ? stats.durationTotal / stats.total : 0,
        stats.lastCalledAt,
        'agent_call_logs'
      )
    );
  }

  return result;
}

export async function getUnifiedSkillStat(
  skillId: string,
  range: SkillStatsRange = 'all'
): Promise<UnifiedSkillStats> {
  const short = toShortSkillId(skillId);
  const map = await getUnifiedSkillStats([short], range);
  return map.get(short) || emptyStats(short, range);
}

/**
 * 统一生效配置：
 * - route：平台 → agent → skill_model_configs（与 resolveRoute 一致）
 * - llmRequest：ACTIVE agent_prompts 覆盖 model/temp/maxTokens（与 callPrompt 一致）
 */
export async function resolveEffectiveSkillRuntimeConfig(
  skillId: string
): Promise<EffectiveSkillRuntimeConfig> {
  const short = toShortSkillId(skillId);
  const canonicalId = toCanonicalSkillId(skillId);
  const parentAgent = getAgentOfSkill(canonicalId);
  const manifest = getAgentManifest(canonicalId);

  const [override, activePrompt, reliability, resolvedRoute] = await Promise.all([
    skillModelConfigService.get(short).catch(() => null),
    systemPrisma.agent_prompts.findFirst({
      where: {
        agentId: { in: Array.from(new Set([canonicalId, short, `skill:${short}`])) },
        status: { in: ['ACTIVE', 'published'] },
      },
      orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
      select: {
        id: true,
        version: true,
        model: true,
        temperature: true,
        maxTokens: true,
      },
    }),
    getPlatformReliabilitySettings(),
    getAPIGateway()
      .resolveRoute({
        agentId: parentAgent?.id,
        skillId: short,
      })
      .catch(() => null),
  ]);

  const hasSkillOverride = !!(override?.enabled);
  const routeSource: EffectiveSkillRuntimeConfig['route']['source'] = hasSkillOverride
    ? 'skill-override'
    : resolvedRoute
      ? parentAgent
        ? 'agent-or-platform'
        : 'platform-default'
      : 'unresolved';

  const routeModel = resolvedRoute?.model || override?.model || null;
  // Phase 3：route 投影不再读 skill_model_configs 陈旧 T/maxTokens（运行时本就不覆盖）
  const routeTemperature =
    resolvedRoute?.temperature
    ?? manifest?.defaultModelConfig?.temperature
    ?? null;
  const routeMaxTokens =
    resolvedRoute?.maxTokens
    ?? manifest?.defaultModelConfig?.maxTokens
    ?? null;
  const routeTimeoutMs =
    resolvedRoute?.timeoutMs ??
    override?.requestTimeoutMs ??
    null;

  // 与运行时 resolveLlmGenerationParams 同源
  const { resolveLlmGenerationParams } = await import('./resolve-llm-call-params');
  const llmResolved = resolveLlmGenerationParams({
    promptConfig: activePrompt,
    routeFallback: {
      model: routeModel,
      temperature: routeTemperature,
      maxTokens: routeMaxTokens,
    },
  });
  const llmModel = llmResolved.model ?? null;
  const llmTemperature = llmResolved.temperature ?? null;
  const llmMaxTokens = llmResolved.maxTokens ?? null;
  const mapSource = (
    s: string
  ): EffectiveSkillRuntimeConfig['llmRequest']['source'] => {
    if (s === 'active-prompt') return 'active-prompt';
    if (s === 'route-fallback' || s === 'code-defaults') return 'route';
    if (s === 'runtime-override') return 'active-prompt';
    return 'none';
  };
  const llmSource = mapSource(llmResolved.sources.maxTokens !== 'none'
    ? llmResolved.sources.maxTokens
    : llmResolved.sources.temperature !== 'none'
      ? llmResolved.sources.temperature
      : llmResolved.sources.model);

  const platformMaxLogical = reliability.maxLogicalRetries;
  const logicalRetry =
    override?.maxLogicalRetries == null
      ? platformMaxLogical
      : Math.min(override.maxLogicalRetries, platformMaxLogical);

  return {
    skillId: short,
    canonicalId,
    route: {
      model: routeModel,
      temperature: routeTemperature,
      maxTokens: routeMaxTokens,
      timeoutMs: routeTimeoutMs,
      thinkingMode: resolvedRoute?.thinkingMode || override?.thinkingMode || 'default',
      reasoningEffort: resolvedRoute?.reasoningEffort || override?.reasoningEffort || 'default',
      source: routeSource,
      hasSkillOverride,
    },
    llmRequest: {
      model: llmModel,
      temperature: llmTemperature,
      maxTokens: llmMaxTokens,
      source: llmSource,
      activePrompt: activePrompt
        ? {
            id: activePrompt.id,
            version: activePrompt.version,
            model: typeof activePrompt.model === 'string' && activePrompt.model.trim()
              ? activePrompt.model.trim()
              : null,
            temperature: typeof activePrompt.temperature === 'number'
              ? activePrompt.temperature
              : null,
            maxTokens: typeof activePrompt.maxTokens === 'number'
              ? activePrompt.maxTokens
              : null,
          }
        : null,
    },
    override: override
      ? {
          enabled: !!override.enabled,
          model: override.model || null,
          temperature: override.temperature ?? null,
          maxTokens: override.maxTokens ?? null,
          maxLogicalRetries: override.maxLogicalRetries ?? null,
          requestTimeoutMs: override.requestTimeoutMs ?? null,
        }
      : null,
    reliability: {
      maxUpstreamAttempts: reliability.maxUpstreamAttempts,
      maxTransportRetries: reliability.maxTransportRetries,
      maxLogicalRetries: logicalRetry,
      logicalRetrySource:
        override?.maxLogicalRetries == null ? 'platform-default' : 'skill-override',
      platformMaxLogicalRetries: platformMaxLogical,
    },
  };
}

export function toLegacySkillRuntimeStats(stats: UnifiedSkillStats): {
  callCount: number;
  successRate: number;
  avgLatency: number;
  lastCalledAt: Date | null;
} {
  return {
    callCount: stats.callCount,
    successRate: stats.callCount > 0 ? (stats.successCount / stats.callCount) : 1,
    avgLatency: stats.avgDurationMs,
    lastCalledAt: stats.lastCalledAt,
  };
}

export type { PlatformReliabilitySettings };
