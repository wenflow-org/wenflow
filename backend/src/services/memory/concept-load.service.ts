/**
 * ConceptLoadService（单概念认知负担 · 档位缓存）
 *
 * 背景：`estimateConceptLoad` 原本用正则 + 系数猜"这条名字是不是技能簇/过程型"——
 * 但它判不准语义（`A、B` 可能是并列，也可能是修饰；"流程"字样不等于真要多步检索）。
 * 按 LEARNER_STATE_REVIEW_DESIGN §2.2 的分工，把**档位判断**交给 LLM、**数值权重**仍由代码
 * 公式给（LLM 不自报分数），因此这里是「范式 A：LLM 出观测 + 代码算数值」的第二个落地。
 *
 * 两种来源并存，调用方无需关心：
 * - `source: 'llm'`：`concept-load-estimator` 判定的 granularity / knowledgeType / difficultyBand
 * - 缺档位（LLM 不可用、超时、新概念还没判）→ 回落到 `estimateConceptLoad` 的正则版
 *
 * 缓存：按用户落 `learner_projections(scope=concept-load)`。**按用户而不是全局**是有意的——
 * 同一个名字对新手是技能簇、对熟手只是一个词，负担本来就依赖学习者；顺带避免每节课重复烧 token。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { runBackgroundTask } from '../background-task-tracker.service';
import { executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';
import { normalizeConceptKey } from './memory-trace.service';

/** 单次 LLM 判定的概念数上限（控成本与输出长度） */
export const MAX_JUDGE_BATCH = 30;
/** 档位缓存有效期（天）：概念语义不常变，长 TTL；过期只是重新判一次 */
export const PROFILE_TTL_DAYS = 90;
/**
 * 关键路径上的判定超时（毫秒）。实测一次判定 20–40s，直接 await 会把开课拖到一分钟，
 * 因此关键路径超时即降级到规则版；真正的判定由课后 `warmInBackground` 预热（下节课命中缓存）。
 */
export const JUDGE_TIMEOUT_MS = 8000;
/** 课后预热的超时（毫秒）：off critical path，允许跑满，别把正要拿的结果掐掉 */
export const WARM_TIMEOUT_MS = 120_000;
export const CONCEPT_LOAD_PROJECTION_SCOPE = 'concept-load';
export const CONCEPT_LOAD_KEY_PREFIX = 'concept-load-profiles-v1';

export type ConceptGranularity = 'atomic' | 'cluster';
export type ConceptKnowledgeType = 'factual' | 'conceptual' | 'procedural' | 'metacognitive';
export type ConceptDifficultyBand = 'low' | 'medium' | 'high' | 'unknown';

export interface ConceptLoadProfile {
  /** 归一化后的概念键（与 memory_traces 的 conceptKey 归一化口径一致） */
  conceptKey: string;
  /** 原始展示名（LLM 看到的原文） */
  label: string;
  granularity: ConceptGranularity;
  knowledgeType: ConceptKnowledgeType;
  difficultyBand: ConceptDifficultyBand;
  rationale: string;
  source: 'llm';
  judgedAt: string;
}

export interface ConceptLoadCache {
  schemaVersion: 'concept-load-profiles-v1';
  generatedAt: string;
  profiles: Record<string, ConceptLoadProfile>;
}

/** 档位 → 负担因子（**只有惩罚、没有奖励**：不因模型乐观而扩张温故额度） */
export const GRANULARITY_FACTOR = 1.5;
export const PROCEDURAL_FACTOR = 1.5;
export const HARD_FACTOR = 1.3;

export interface LoadDeps {
  findTraceKeys: (userId: string) => Promise<string[]>;
  readCache: (projectionKey: string) => Promise<{ payload: string } | null>;
  writeCache: (args: Record<string, unknown>) => Promise<unknown>;
  callSkill: (input: Record<string, unknown>) => Promise<{ success: boolean; output?: any; error?: any }>;
}

const defaultDeps: LoadDeps = {
  findTraceKeys: async (userId) => {
    const rows = await prisma.memory_traces.findMany({
      where: { userId, extractionCount: { gt: 0 } },
      orderBy: [{ lastSeenAt: 'desc' }],
      take: 200,
      select: { conceptKey: true },
    });
    return rows.map((row) => row.conceptKey).filter(Boolean);
  },
  readCache: (projectionKey) => prisma.learner_projections.findUnique({
    where: { projectionKey },
    select: { payload: true },
  }) as any,
  writeCache: (args) => prisma.learner_projections.upsert(args as any) as any,
  callSkill: (input) => executeSkillWithResult(auxSkillDefinitionMap['concept-load-estimator'], input as any) as any,
};

export function conceptLoadCacheKey(userId: string): string {
  return `${CONCEPT_LOAD_KEY_PREFIX}:${userId}`;
}

/**
 * 带超时的 skill 调用：超时/失败都当作"没有档位"（调用方回落规则版），
 * 不让一个慢网关把开课卡住（护栏：失败降级到规则，不阻塞主流程）。
 */
async function callSkillWithTimeout(
  call: () => Promise<{ success: boolean; output?: any; error?: any }>,
  timeoutMs: number,
): Promise<{ success: boolean; output?: any; error?: any }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`CONCEPT_LOAD_TIMEOUT:${timeoutMs}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 档位 → 负担因子文字（供 UI/测试核对来源，`llm:` 前缀区分规则版） */
export function profileFactors(profile: ConceptLoadProfile | null | undefined): string[] {
  if (!profile) return [];
  const factors: string[] = [];
  if (profile.granularity === 'cluster') factors.push('llm:cluster');
  if (profile.knowledgeType === 'procedural') factors.push('llm:procedural');
  if (profile.difficultyBand === 'high') factors.push('llm:hard');
  return factors;
}

/**
 * 档位 → 负担权重（**代码出数值**）。
 * 有档位时以 LLM 判断为准（它判的是语义，正则的那些误判正是要被替掉的），
 * 无档位才回落到规则版；两者都只有惩罚项，不因模型乐观而放宽温故额度。
 */
export function mapProfileToLoad(input: {
  profile?: ConceptLoadProfile | null;
  ruleLoad: number;
  ruleFactors: string[];
}): { load: number; factors: string[]; source: 'llm' | 'rule' } {
  const profile = input.profile;
  if (!profile) return { load: input.ruleLoad, factors: input.ruleFactors, source: 'rule' };
  let load = 1;
  if (profile.granularity === 'cluster') load *= GRANULARITY_FACTOR;
  if (profile.knowledgeType === 'procedural') load *= PROCEDURAL_FACTOR;
  if (profile.difficultyBand === 'high') load *= HARD_FACTOR;
  return {
    load: Math.max(1, Math.round(load * 100) / 100),
    factors: profileFactors(profile),
    source: 'llm',
  };
}

/** 校验并整形 LLM 输出（越界键丢弃、枚举兜底） */
export function normalizeJudgedProfiles(
  raw: any,
  labels: Map<string, string>,
  now: Date,
): Record<string, ConceptLoadProfile> {
  const granularityEnum = new Set(['atomic', 'cluster']);
  const knowledgeTypeEnum = new Set(['factual', 'conceptual', 'procedural', 'metacognitive']);
  const difficultyEnum = new Set(['low', 'medium', 'high', 'unknown']);
  const profiles: Record<string, ConceptLoadProfile> = {};
  for (const item of Array.isArray(raw?.concepts) ? raw.concepts : []) {
    const key = normalizeConceptKey(String(item?.conceptKey || ''));
    if (!key || !labels.has(key) || profiles[key]) continue;
    const granularity = String(item?.granularity || '');
    const knowledgeType = String(item?.knowledgeType || '');
    const difficultyBand = String(item?.difficultyBand || '');
    profiles[key] = {
      conceptKey: key,
      label: labels.get(key) as string,
      granularity: (granularityEnum.has(granularity) ? granularity : 'atomic') as ConceptGranularity,
      knowledgeType: (knowledgeTypeEnum.has(knowledgeType) ? knowledgeType : 'conceptual') as ConceptKnowledgeType,
      difficultyBand: (difficultyEnum.has(difficultyBand) ? difficultyBand : 'unknown') as ConceptDifficultyBand,
      rationale: String(item?.rationale || '').slice(0, 80),
      source: 'llm',
      judgedAt: now.toISOString(),
    };
  }
  return profiles;
}

class ConceptLoadService {
  /** 预热在途（同一用户不重复开跑） */
  private readonly warming = new Map<string, Promise<void>>();

  constructor(private readonly deps: LoadDeps = defaultDeps) {}

  async getCache(userId: string): Promise<ConceptLoadCache | null> {
    const row = await this.deps.readCache(conceptLoadCacheKey(userId));
    if (!row?.payload) return null;
    try {
      const parsed = JSON.parse(row.payload) as ConceptLoadCache;
      return parsed?.profiles ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * 取一批概念的负担档位（按 `normalizeConceptKey` 归一化键索引）。
   * - 只对**缺档位或过期**的键调 LLM；其余直接命中缓存；
   * - LLM 失败/超时 → 返回已有缓存，调用方回落到规则版（不阻塞开课）。
   */
  async resolveProfiles(
    userId: string,
    conceptKeys: string[],
    options: { now?: Date; deps?: LoadDeps; timeoutMs?: number } = {},
  ): Promise<{ profiles: Map<string, ConceptLoadProfile>; judged: number; source: 'cache' | 'llm' | 'degraded' }> {
    const deps = options.deps ?? this.deps;
    const now = options.now ?? new Date();
    const labels = new Map<string, string>();
    for (const raw of conceptKeys) {
      const key = normalizeConceptKey(raw);
      if (key && !labels.has(key)) labels.set(key, String(raw).trim() || key);
    }
    const profiles = new Map<string, ConceptLoadProfile>();
    if (labels.size === 0) return { profiles, judged: 0, source: 'cache' };

    const cache = await this.getCache(userId).catch(() => null);
    const ttlMs = PROFILE_TTL_DAYS * 86400_000;
    const missing: string[] = [];
    for (const [key, label] of labels) {
      const cached = cache?.profiles?.[key];
      const fresh = cached && now.getTime() - new Date(cached.judgedAt).getTime() < ttlMs;
      if (fresh) profiles.set(key, { ...cached, label });
      else missing.push(label);
    }
    if (missing.length === 0) return { profiles, judged: 0, source: 'cache' };

    let judged: Record<string, ConceptLoadProfile> = {};
    try {
      // 只问「缺档位」的那批；也只认这批的键（模型多报的键丢弃，避免缓存被塞进没问过的概念）
      const batch = missing.slice(0, MAX_JUDGE_BATCH);
      const requested = new Map(batch.map((label) => [normalizeConceptKey(label), label]));
      const result = await callSkillWithTimeout(
        () => deps.callSkill({ concepts: batch.map((label) => ({ conceptKey: label })) }),
        options.timeoutMs ?? JUDGE_TIMEOUT_MS,
      );
      if (!result?.success) throw new Error(String(result?.error?.message || 'concept-load-estimator failed'));
      judged = normalizeJudgedProfiles(result.output, requested, now);
    } catch (error) {
      logger.warn('[concept-load] 档位判定失败，回落规则版负担估计', {
        userId,
        missing: missing.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return { profiles, judged: 0, source: profiles.size > 0 ? 'cache' : 'degraded' };
    }

    for (const [key, profile] of Object.entries(judged)) profiles.set(key, profile);

    const merged: ConceptLoadCache = {
      schemaVersion: 'concept-load-profiles-v1',
      generatedAt: now.toISOString(),
      profiles: { ...(cache?.profiles ?? {}), ...judged },
    };
    try {
      await deps.writeCache({
        where: { projectionKey: conceptLoadCacheKey(userId) },
        create: {
          id: `clp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          projectionKey: conceptLoadCacheKey(userId),
          userId,
          scope: CONCEPT_LOAD_PROJECTION_SCOPE,
          version: 1,
          payload: JSON.stringify(merged),
          generatedAt: now,
        },
        update: { version: { increment: 1 }, payload: JSON.stringify(merged), generatedAt: now },
      });
    } catch (error) {
      logger.warn('[concept-load] 档位缓存写入失败（不影响本次判定）', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('[concept-load] 档位判定完成', {
      userId,
      requested: labels.size,
      judged: Object.keys(judged).length,
      cached: profiles.size - Object.keys(judged).length,
    });
    return { profiles, judged: Object.keys(judged).length, source: 'llm' };
  }

  /** 关键路径专用：**只读缓存**，绝不调 LLM（实测单批判定 ~40s，不能出现在开课路径上） */
  async resolveCachedProfiles(userId: string, conceptKeys: string[]): Promise<Map<string, ConceptLoadProfile>> {
    try {
      const cache = await this.getCache(userId);
      if (!cache?.profiles) return new Map();
      const ttlMs = PROFILE_TTL_DAYS * 86400_000;
      const now = Date.now();
      const result = new Map<string, ConceptLoadProfile>();
      for (const raw of conceptKeys) {
        const key = normalizeConceptKey(raw);
        const cached = key ? cache.profiles[key] : undefined;
        if (!cached) continue;
        if (now - new Date(cached.judgedAt).getTime() >= ttlMs) continue;
        result.set(key, cached);
      }
      return result;
    } catch {
      return new Map();
    }
  }

  /** 便捷入口：判定并返回 Map（会调 LLM；仅预热/评估用，不要在关键路径上调用） */
  async resolveProfileMap(
    userId: string,
    conceptKeys: string[],
    options: { timeoutMs?: number } = {},
  ): Promise<Map<string, ConceptLoadProfile>> {
    try {
      const result = await this.resolveProfiles(userId, conceptKeys, options);
      return result.profiles;
    } catch {
      return new Map();
    }
  }

  /**
   * 课后预热：把该用户活跃概念的档位判好写进缓存，供**下节课**直接命中，
   * 从而把 LLM 判定挪出开课关键路径（实测单批 ~40s，不适合 inline await）。
   */
  warmInBackground(userId: string): void {
    if (this.warming.has(userId)) return;
    const task = (async () => {
      const keys = await this.deps.findTraceKeys(userId);
      if (keys.length === 0) return;
      const result = await this.resolveProfiles(userId, keys, { timeoutMs: WARM_TIMEOUT_MS });
      logger.info('[concept-load] 课后预热完成', {
        userId,
        candidates: keys.length,
        judged: result.judged,
        source: result.source,
      });
    })()
      .catch((error: any) => {
        logger.warn('[concept-load] 课后预热失败（下节课回落规则版）', {
          userId,
          error: error?.message || String(error),
        });
      })
      .finally(() => {
        if (this.warming.get(userId) === task) this.warming.delete(userId);
      });
    this.warming.set(userId, task);
    runBackgroundTask('concept-load.warm', () => task, { userId });
  }
}

export const conceptLoadService = new ConceptLoadService();
export { ConceptLoadService };
export default conceptLoadService;
