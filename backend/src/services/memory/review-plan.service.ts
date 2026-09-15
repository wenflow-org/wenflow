/**
 * 复习计划服务（记忆层 M2 出口 · 课内温故）
 *
 * 背景：到期复习点此前只有两个出口——首页「今日复习」卡（上限 20）与借壳复习课。
 * 结果是「显式复习」需要用户额外决定，依从性差、积压只增不减（Anki 的 backlog
 * death spiral）。产品原始设计是把复习**藏在日常课里**：每节新课开场先用 1–2 分钟
 * 接一下快到遗忘点的旧知（`2e3ca16` 曾实现，因为「到期点串进本节知识点看板」的
 * 显示 bug 被整体删掉；本服务只负责**选点与配额**，注入走独立通道）。
 *
 * 两条纪律：
 * 1. 配额按**认知负担预算**而非条数。CLT 的内在/外在负荷要先占用预算，生成负荷
 *    （检索努力）才留在「有益困难」区间。一个把 3 个子概念塞进一句名字的复合点，
 *    负担是原子点的 1.5–2 倍，遇到它就只带 1 个。
 * 2. 预算**动态**：用真实的课内检索成功率回校准（Bjork 有益困难，目标 ~85%）。
 *    成功率长期偏低 → 降预算（点太难或预算定高了）；长期偏高 → 升预算。
 *
 * 出口不写库：纯读取 + 纯函数，便于单测与复用（首页计数、课内注入共用同一份计划）。
 */
import prisma from '../../config/database';
import { memoryTraceService, normalizeConceptKey } from './memory-trace.service';
import { mapReviewStatusToRating, type ReviewRating } from '../learner/ReviewCompletedConsumer';

/** 基准负担预算（负担单位）：约等于「两个原子点」或「一个复合点 + 一个原子点」 */
export const BASE_LOAD_BUDGET = 2.0;
/** 成功率偏低（点太难/预算偏高）时的收缩预算 */
export const LOW_LOAD_BUDGET = 1.0;
/** 成功率偏高（间隔偏短/预算偏保守）时的扩张预算 */
export const HIGH_LOAD_BUDGET = 3.0;
/** 单节课温故的硬上限（即使预算充裕也不超过） */
export const MAX_WARMUP_ITEMS = 3;
/** 连续失败多少次判定「没学会」→ 退出复习队列，转回路径重学（Anki leech 语义） */
export const LEECH_CONSECUTIVE_AGAIN = 3;
/** 连续成功多少次判定「毕业」→ 不再按计划间隔回捞（仅在保留率跌破阈值时才回捞） */
export const GRADUATE_CONSECUTIVE_SUCCESS = 5;
/** 动态预算回看的最近检索次数 */
const OUTCOME_WINDOW = 40;
/** 单元点负担上限（防止多因子连乘放大到一个点吃掉整个预算） */
const MAX_SINGLE_LOAD = 3.0;

const COMPOUND_RE = /[、和与及/／→=＝；;,，]/;
const PROCESS_RE = /(流程|步骤|顺序|先.{0,6}再|之后|然后|第[一二三四]步)/;
const WARMUP_EVIDENCE_TYPES = ['review:warmup', 'review:completed'];

export interface ConceptLoadEstimate {
  /** 负担权重（≥1，用于消耗预算） */
  load: number;
  /** 命中的因子（供 UI/测试核对，不用编造） */
  factors: string[];
}

/**
 * 单个知识点的认知负担估计。
 * 因子口径：粒度（复合/超长 → 其实是一个技能簇）、类型（过程型检索需多步）、
 * 生疏度（掌握弱 / 保留率低 → 需要更多轮次）。
 */
export function estimateConceptLoad(
  name: string,
  opts: { masteryScore?: number | null; retention?: number | null } = {},
): ConceptLoadEstimate {
  const text = String(name || '').trim();
  if (!text) return { load: 1, factors: [] };
  const factors: string[] = [];
  let load = 1;

  const length = [...text].length;
  const compound = COMPOUND_RE.test(text) || length > 24;
  if (compound) {
    load *= 1.5;
    factors.push(length > 24 ? 'granularity:long' : 'granularity:compound');
  }
  if (PROCESS_RE.test(text)) {
    load *= 1.5;
    factors.push('type:process');
  }
  const mastery = Number(opts.masteryScore);
  if (Number.isFinite(mastery) && mastery < 0.5) {
    load *= 1.3;
    factors.push('unfamiliar:mastery');
  }

  return { load: Math.min(MAX_SINGLE_LOAD, Math.round(load * 100) / 100), factors };
}

/** 成功率 → 负担预算（动态：偏低收缩、偏高扩张、无样本取基准） */
export function computeLoadBudget(successRate: number | null | undefined): number {
  if (successRate === null || successRate === undefined || !Number.isFinite(successRate)) {
    return BASE_LOAD_BUDGET;
  }
  if (successRate < 0.7) return LOW_LOAD_BUDGET;
  if (successRate > 0.9) return HIGH_LOAD_BUDGET;
  return BASE_LOAD_BUDGET;
}

export interface WarmupOutcome {
  conceptKey: string;
  rating: ReviewRating;
  status: string;
  progress: number;
  occurredAt: Date;
}

export interface ReviewPlanItem {
  conceptKey: string;
  label: string;
  retention: number;
  reason: string;
  masteryScore: number;
  /** 该点消耗的负担预算 */
  load: number;
  loadFactors: string[];
  /** 该概念最早出现的来源路径标题（跨 path 场景下给用户一句解释；未知为 null） */
  originPathTitle: string | null;
  /** 本堂课内温故的实测结果（教学回合报告，收束时回写记忆引擎）；未温故为 undefined */
  outcome?: { status: string; progress: number; reviewedAt: string };
}

export interface RelearnSuggestion {
  conceptKey: string;
  label: string;
  consecutiveAgain: number;
}

export interface ReviewPlan {
  /** 本节温故应接的点（按负担预算裁好） */
  items: ReviewPlanItem[];
  /** 本次可用负担预算（负担单位） */
  budget: number;
  /** 已占用负担 */
  usedLoad: number;
  /** 到期总量（含未入选的），用于诚实计数「另有 N 个排队中」 */
  backlogCount: number;
  /** 近期课内检索成功率（无样本为 null） */
  successRate: number | null;
  /** 判定为「没学会」、已退出复习队列的点（建议回路径重学） */
  relearnSuggestions: RelearnSuggestion[];
}

/** 数据访问口（默认走 prisma；单测注入替身，避免全局 mock） */
export interface ReviewPlanDeps {
  getDueTraces: (userId: string, options: { limit: number; now: Date }) => Promise<Array<{
    conceptKey: string;
    label: string | null;
    masteryScore: number;
    retention: number;
    reason: string;
    extractionCount: number;
  }>>;
  findEvidence: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  findSessions: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  findPaths: (args: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
}

const defaultDeps: ReviewPlanDeps = {
  getDueTraces: (userId, options) => memoryTraceService.getDueTraces(userId, options) as any,
  findEvidence: (args) => prisma.learner_evidence.findMany(args as any) as any,
  findSessions: (args) => prisma.teaching_sessions.findMany(args as any) as any,
  findPaths: (args) => prisma.learning_paths.findMany(args as any) as any,
};

/** 从 learner_evidence 读近期检索结果（review:warmup / review:completed 两类同源） */
export async function loadRecentOutcomes(
  userId: string,
  take = OUTCOME_WINDOW,
  deps: ReviewPlanDeps = defaultDeps,
): Promise<WarmupOutcome[]> {
  try {
    const rows = await deps.findEvidence({
      where: { userId, evidenceType: { in: WARMUP_EVIDENCE_TYPES } },
      orderBy: { occurredAt: 'desc' },
      take,
      select: { payload: true, occurredAt: true },
    });
    const outcomes: WarmupOutcome[] = [];
    for (const row of rows) {
      try {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        const conceptKey = String((payload as any)?.conceptKey || '').trim();
        const rating = String((payload as any)?.rating || '');
        if (!conceptKey || !['again', 'hard', 'good', 'easy'].includes(rating)) continue;
        outcomes.push({
          conceptKey: normalizeConceptKey(conceptKey),
          rating: rating as ReviewRating,
          status: String((payload as any)?.status || ''),
          progress: Number((payload as any)?.progress) || 0,
          occurredAt: new Date(row.occurredAt),
        });
      } catch {
        // 单条 payload 损坏不影响整体统计
      }
    }
    return outcomes;
  } catch {
    return [];
  }
}

/** 成功率：good/easy 视为检索成功（hard/again 计入失败，有益困难区间靠它校准） */
export function computeSuccessRate(outcomes: WarmupOutcome[]): number | null {
  if (outcomes.length === 0) return null;
  const success = outcomes.filter((item) => item.rating === 'good' || item.rating === 'easy').length;
  return Math.round((success / outcomes.length) * 100) / 100;
}

/** 每个概念自最近一次起的连续失败次数（用于 leech 判定） */
export function consecutiveFailures(outcomes: WarmupOutcome[]): Map<string, number> {
  const streak = new Map<string, number>();
  const closed = new Set<string>();
  for (const outcome of outcomes) {
    if (closed.has(outcome.conceptKey)) continue;
    if (outcome.rating === 'again') {
      streak.set(outcome.conceptKey, (streak.get(outcome.conceptKey) ?? 0) + 1);
    } else {
      closed.add(outcome.conceptKey);
    }
  }
  return streak;
}

/** 每个概念自最近一次起的连续成功次数（用于毕业判定） */
export function consecutiveSuccesses(outcomes: WarmupOutcome[]): Map<string, number> {
  const streak = new Map<string, number>();
  const closed = new Set<string>();
  for (const outcome of outcomes) {
    if (closed.has(outcome.conceptKey)) continue;
    if (outcome.rating === 'good' || outcome.rating === 'easy') {
      streak.set(outcome.conceptKey, (streak.get(outcome.conceptKey) ?? 0) + 1);
    } else {
      closed.add(outcome.conceptKey);
    }
  }
  return streak;
}

/** 到期点 → 教学场景里给学生的「这是什么」一句来源（跨 path 时避免困惑） */
async function resolveOriginPathTitles(
  userId: string,
  conceptKeys: string[],
  deps: ReviewPlanDeps,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (conceptKeys.length === 0) return result;
  try {
    const evidence = await deps.findEvidence({
      where: {
        userId,
        sessionId: { not: null },
        evidenceKey: { in: conceptKeys.map((key) => `review:result:${key}`) },
      },
      select: { evidenceKey: true, sessionId: true },
      take: 60,
    });
    const pathIdByKey = new Map<string, string>();
    const sessionIds = Array.from(new Set(evidence.map((row) => row.sessionId).filter(Boolean) as string[]));
    if (sessionIds.length === 0) return result;
    const sessions = await deps.findSessions({
      where: { id: { in: sessionIds } },
      select: { id: true, learningPathId: true },
    });
    const pathIdBySession = new Map(sessions.map((row) => [row.id, row.learningPathId]));
    for (const row of evidence) {
      const key = String(row.evidenceKey || '').replace(/^review:result:/, '');
      const pathId = row.sessionId ? pathIdBySession.get(row.sessionId) : null;
      if (key && pathId && !pathIdByKey.has(key)) pathIdByKey.set(key, pathId);
    }
    const pathIds = Array.from(new Set(pathIdByKey.values()));
    if (pathIds.length === 0) return result;
    const paths = await deps.findPaths({
      where: { id: { in: pathIds } },
      select: { id: true, title: true },
    });
    const titleByPath = new Map(paths.map((row) => [row.id, row.title]));
    for (const [key, pathId] of pathIdByKey) {
      const title = titleByPath.get(pathId);
      if (title) result.set(key, title);
    }
  } catch {
    // 来源解析失败不影响复习计划
  }
  return result;
}

/**
 * 构建一节新课的温故计划。
 * 步骤：取到期点 → 剔除 leech / 从未提取 → 同族去重 → 按急迫度排序 → 按负担预算裁剪。
 */
export async function buildReviewPlan(
  userId: string,
  options: { now?: Date; maxItems?: number; candidateLimit?: number; deps?: ReviewPlanDeps } = {},
): Promise<ReviewPlan> {
  const deps = options.deps ?? defaultDeps;
  const now = options.now ?? new Date();
  const maxItems = Math.max(1, options.maxItems ?? MAX_WARMUP_ITEMS);
  const candidateLimit = Math.max(maxItems, options.candidateLimit ?? 60);

  const outcomes = await loadRecentOutcomes(userId, OUTCOME_WINDOW, deps);
  const successRate = computeSuccessRate(outcomes);
  const budget = computeLoadBudget(successRate);
  const failures = consecutiveFailures(outcomes);
  const successes = consecutiveSuccesses(outcomes);

  const leechKeys = new Set(
    Array.from(failures.entries())
      .filter(([, count]) => count >= LEECH_CONSECUTIVE_AGAIN)
      .map(([key]) => key),
  );

  const due = await deps.getDueTraces(userId, { limit: candidateLimit, now }) as Awaited<ReturnType<typeof memoryTraceService.getDueTraces>>;

  // 同族去重：同一概念的多种说法只保留最急迫的一条（normalizeConceptKey 已归一化，
  // 这里再按族名收敛，避免「换一种说法」重复占用温故预算）
  const byFamily = new Map<string, (typeof due)[number]>();
  const relearn = new Map<string, RelearnSuggestion>();
  let backlogCount = 0;
  for (const trace of due) {
    if (!trace.conceptKey) continue;
    const family = normalizeConceptKey(trace.conceptKey);
    if (!family) continue;
    // 从未被真正提取过的点没有可回捞的记忆（kt-estimate 孤儿等），不进队列
    if (trace.extractionCount === 0) continue;
    backlogCount += 1;
    if (leechKeys.has(family)) {
      if (!relearn.has(family)) {
        relearn.set(family, {
          conceptKey: family,
          label: trace.label || trace.conceptKey,
          consecutiveAgain: failures.get(family) ?? LEECH_CONSECUTIVE_AGAIN,
        });
      }
      continue;
    }
    const existing = byFamily.get(family);
    if (!existing || isMoreUrgent(trace, existing)) byFamily.set(family, trace);
  }

  const candidates = Array.from(byFamily.values())
    .filter((trace) => {
      // 毕业：连续成功达阈值 → 不再按计划间隔回捞，只在保留率真跌了才回捞
      const graduated = (successes.get(normalizeConceptKey(trace.conceptKey)) ?? 0) >= GRADUATE_CONSECUTIVE_SUCCESS;
      return !(graduated && trace.reason !== 'below-threshold');
    })
    .sort((a, b) => urgencyOf(b) - urgencyOf(a));

  const picked: typeof candidates = [];
  let usedLoad = 0;
  for (const trace of candidates) {
    if (picked.length >= maxItems) break;
    const estimate = estimateConceptLoad(trace.label || trace.conceptKey, {
      masteryScore: trace.masteryScore,
      retention: trace.retention,
    });
    if (picked.length > 0 && usedLoad + estimate.load > budget) continue;
    if (picked.length === 0 && estimate.load > budget) {
      // 预算再低也要接一个最急的点：这节课本来就是为它来的
      picked.push(trace);
      usedLoad = estimate.load;
      break;
    }
    picked.push(trace);
    usedLoad = Math.round((usedLoad + estimate.load) * 100) / 100;
  }

  const origins = await resolveOriginPathTitles(userId, picked.map((trace) => normalizeConceptKey(trace.conceptKey)), deps);

  const items: ReviewPlanItem[] = picked.map((trace) => {
    const estimate = estimateConceptLoad(trace.label || trace.conceptKey, {
      masteryScore: trace.masteryScore,
      retention: trace.retention,
    });
    const family = normalizeConceptKey(trace.conceptKey);
    return {
      conceptKey: trace.conceptKey,
      label: trace.label || trace.conceptKey,
      retention: Math.round(trace.retention * 100) / 100,
      reason: trace.reason,
      masteryScore: trace.masteryScore,
      load: estimate.load,
      loadFactors: estimate.factors,
      originPathTitle: origins.get(family) ?? null,
    };
  });

  return {
    items,
    budget,
    usedLoad,
    backlogCount: Math.max(0, backlogCount - items.length),
    successRate,
    relearnSuggestions: Array.from(relearn.values()),
  };
}

/** 急迫度：保留率越低越急；跌破阈值的优先于「按计划间隔到期」 */
function urgencyOf(trace: { retention: number; reason: string }): number {
  const reasonBonus = trace.reason === 'below-threshold' ? 0.4 : 0;
  return Math.round(((1 - trace.retention) + reasonBonus) * 1000) / 1000;
}

function isMoreUrgent(a: { retention: number; reason: string }, b: { retention: number; reason: string }): boolean {
  return urgencyOf(a) > urgencyOf(b);
}

/** 温故结果 → FSRS 成绩（与复习课回写同一口径，避免两套语义） */
export function warmupStatusToGrade(status: string, progress: number) {
  return mapReviewStatusToRating(status, progress);
}

export const reviewPlanService = {
  buildReviewPlan,
  estimateConceptLoad,
  computeLoadBudget,
  computeSuccessRate,
  consecutiveFailures,
  consecutiveSuccesses,
};

export default reviewPlanService;
