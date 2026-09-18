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
import { conceptLoadService, mapProfileToLoad, type ConceptLoadProfile } from './concept-load.service';
import { getDailyState as defaultGetDailyState, type ReviewDailyState } from './review-quota.service';
import { mapReviewStatusToRating, type ReviewRating } from '../learner/ReviewCompletedConsumer';
import { conceptBeliefService } from '../learner/concept-belief.service';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';

/** 基准负担预算（负担单位）：约等于**两个原子点**（1.0+1.0），或一个复合/流程点（1.5） */
export const BASE_LOAD_BUDGET = 2.0;
/** 成功率偏低（点太难/预算偏高）时的收缩预算 */
export const LOW_LOAD_BUDGET = 1.0;
/** 成功率偏高（间隔偏短/预算偏保守）时的扩张预算 */
export const HIGH_LOAD_BUDGET = 3.0;
/** 单节课温故的硬上限（即使预算充裕也不超过） */
export const MAX_WARMUP_ITEMS = 3;
/** 只为最急的这么多个候选取 LLM 负担档位（控 token；预算最多 3.0，入选只会落在最急的几个里） */
export const LOAD_PROFILE_LOOKAHEAD = 12;
/** 连续失败多少次判定「没学会」→ 退出复习队列，转回路径重学（Anki leech 语义） */
export const LEECH_CONSECUTIVE_AGAIN = 3;
/** 连续成功多少次判定「毕业」→ 不再按计划间隔回捞（仅在保留率跌破阈值时才回捞） */
export const GRADUATE_CONSECUTIVE_SUCCESS = 5;
/** 动态预算回看的最近检索次数 */
const OUTCOME_WINDOW = 40;
/**
 * 切换预算档位所需的最小结果样本数（2026-09-17，审计 §3.6 问题③）。
 *
 * 此前只有 `<0.7` / `>0.9` 两个阈值、没有样本下限 ⇒ **单次结果就能把档位顶到极值**
 * （实测：1/1 成功 → successRate=1.0 → 预算直接跳到高档 3.0），档位在样本少时剧烈跳动。
 * 样本不足时保持基准，等样本攒够再分档。
 */
export const MIN_BUDGET_SAMPLE = 5;
/**
 * 单节课最多可占用的"当日剩余额度"比例（2026-09-17，审计 §3.6 问题②）。
 *
 * 当日额度（默认 6.0，≈ 3 节课）是跨会话共享的；此前单节课可一次把剩余额度全吃掉，
 * 于是"当天的第一节课温故完，后面几节课就一点都温故不了"。给单节课加份额上限，
 * 让额度在一天内的多节课之间摊开。
 */
export const SESSION_DAILY_SHARE_CAP = 0.6;
/** 单节课的额度下限（负担单位）：剩余不多时也保留这么多，避免"当天第二节课完全不能温故" */
export const SESSION_DAILY_SHARE_FLOOR = 1.0;
/**
 * 信念背离判定（2026-09-17，审计 §4.2(3)/§7 P1-3：`pKnowL` 此前零下游消费）。
 *
 * 语义：状态/自评说"掌握了"（masteryScore ≥ `BELIEF_DIVERGENCE_MASTERY`）但 BKT 信念仍很低
 * （pKnowL ≤ `BELIEF_DIVERGENCE_PKNOWL`）→ 判为"记住了答案但没形成理解"，
 * 建议**回路径重学**而不是继续按间隔回捞。
 *
 * 边界（刻意不做的事）：**不改间隔、不改难度档位** —— BKT 参数未拟合、观测不满足其假设
 * （LLM 语义判断 ≠ 单技能二值作答），只允许它影响"这条建议"，不允许它改调度真值。
 */
export const BELIEF_DIVERGENCE_MASTERY = 0.7;
export const BELIEF_DIVERGENCE_PKNOWL = 0.2;
/** 单元点负担上限（防止多因子连乘放大到一个点吃掉整个预算） */
export const MAX_SINGLE_LOAD = 3.0;

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
 * 生疏度（掌握弱 → 需要更多轮次）。
 *
 * 粒度与类型优先取 **LLM 档位**（`profile`，见 concept-load.service）：正则判不准语义
 * （`A、B` 可能是并列也可能是修饰），LLM 的误判率更低、且能识别"看着短其实要三步"的点；
 * 没有档位（LLM 不可用/新概念）时回落到正则版。掌握度因子始终来自数据，不交给模型。
 */
export function estimateConceptLoad(
  name: string,
  opts: { masteryScore?: number | null; retention?: number | null; profile?: ConceptLoadProfile | null } = {},
): ConceptLoadEstimate {
  const text = String(name || '').trim();
  if (!text) return { load: 1, factors: [] };

  // 规则版（兜底）：正则 + 长度
  const length = [...text].length;
  const ruleFactors: string[] = [];
  let ruleLoad = 1;
  const compound = COMPOUND_RE.test(text) || length > 24;
  if (compound) {
    ruleLoad *= 1.5;
    ruleFactors.push(length > 24 ? 'granularity:long' : 'granularity:compound');
  }
  if (PROCESS_RE.test(text)) {
    ruleLoad *= 1.5;
    ruleFactors.push('type:process');
  }

  const mapped = mapProfileToLoad({ profile: opts.profile, ruleLoad, ruleFactors });
  // 掌握度**不作为负担乘数**（2026-09-17 修正）：到期项几乎必然掌握弱，×1.3 等于给**每一条**统一加价，
  // 只把预算语义"2.0 ≈ 两个原子点"架空（1.3×2 > 2.0 ⇒ 永远只装得下 1 条，吞吐被腰斩），
  // 却不提供任何区分度（"生疏"本来就是它到期的原因，选点顺序也已按保留率从低到高排）。
  // 真正有区分度的是复合/流程（结构复杂度），保留。
  return { load: Math.min(MAX_SINGLE_LOAD, Math.round(mapped.load * 100) / 100), factors: [...mapped.factors] };
}

/**
 * 成功率 → 负担预算（动态：偏低收缩、偏高扩张、无样本/样本不足取基准）
 *
 * 2026-09-17 加**样本下限**（审计 §3.6 问题③）：此前无下限，单次结果即可跳档
 * （1/1 成功 → 高档 3.0；1/1 失败 → 低档 1.0）。现要求至少 `MIN_BUDGET_SAMPLE` 条结果才分档。
 *
 * @param successRate 近期检索成功率（null/NaN = 无样本）
 * @param sampleSize 该成功率背后的结果条数（缺省 0 = 不足 → 基准）
 */
export function computeLoadBudget(successRate: number | null | undefined, sampleSize = 0): number {
  if (successRate === null || successRate === undefined || !Number.isFinite(successRate)) {
    return BASE_LOAD_BUDGET;
  }
  if (!Number.isFinite(sampleSize) || sampleSize < MIN_BUDGET_SAMPLE) {
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
  /**
   * 模型**真的把该点问出来了**的时刻（首次）。它不等于"有结果"：
   * 结算时「问过了但始终没推进」= 学习者没答出 → 按失败留痕（否则失败永不入库，
   * 成功率与保持曲线都只是上界，leech/自净也永远不会触发）。
   */
  askedAt?: string;
}

export interface RelearnSuggestion {
  conceptKey: string;
  label: string;
  /** 连续答错次数（leech 判定用）；信念背离判定不适用时为 0（见 reason） */
  consecutiveAgain: number;
  /**
   * 触发原因：
   * - `leech`：连续答错 ≥ LEECH_CONSECUTIVE_AGAIN → 退出复习队列，回路径重学；
   * - `belief-divergence`（2026-09-17）：状态/自评显示已掌握，但 BKT 信念仍很低 →
   *   更像"记住了答案没形成理解"，继续按间隔回捞收益低，建议回路径重学。
   */
  reason: 'leech' | 'belief-divergence';
}

export interface ReviewPlan {
  /** 本节温故应接的点（按负担预算裁好；当日额度用完时为空） */
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
  /** 当日额度（跨会话共享）：今天还剩多少负担单位可接 */
  daily: {
    date: string;
    limitLoad: number;
    usedLoad: number;
    remainingLoad: number;
  };
  /** 明天预计到期的点数（首页「明日预告」；不参与选点） */
  tomorrowCount: number;
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
  /** 概念负担档位（**只读缓存**；LLM 判定由课后预热负责，见 concept-load.service） */
  loadProfiles: (userId: string, conceptKeys: string[]) => Promise<Map<string, ConceptLoadProfile>>;
  /** 当日温故额度（跨会话共享；见 review-quota.service） */
  getDailyState: (userId: string) => Promise<ReviewDailyState>;
  /** 明天预计到期的点数（首页"明日预告"，不参与选点） */
  countDueBetween: (userId: string, from: Date, to: Date) => Promise<number>;
  /**
   * 概念信念（BKT `pKnowL`，**只读**）：仅用于"状态说掌握、信念说没掌握"的背离判定
   * （`belief-divergence` → 回路径重学建议）。**不参与间隔/难度/排序**（见常量注释的边界）。
   */
  loadConceptBeliefs?: (userId: string, pathId: string | null) => Promise<Map<string, number>>;
}

const defaultDeps: ReviewPlanDeps = {
  getDueTraces: (userId, options) => memoryTraceService.getDueTraces(userId, options) as any,
  findEvidence: (args) => prisma.learner_evidence.findMany(args as any) as any,
  findSessions: (args) => prisma.teaching_sessions.findMany(args as any) as any,
  findPaths: (args) => prisma.learning_paths.findMany(args as any) as any,
  loadProfiles: (userId, conceptKeys) => conceptLoadService.resolveCachedProfiles(userId, conceptKeys),
  getDailyState: (userId) => defaultGetDailyState(userId),
  countDueBetween: async (userId, from, to) => prisma.memory_traces.count({
    where: { userId, extractionCount: { gt: 0 }, dueAt: { gt: from, lte: to } },
  }),
  // 概念信念（只读）：背离判定用；读不到就当没有信念（不影响其余行为）
  loadConceptBeliefs: async (userId, pathId) => {
    const payload = await conceptBeliefService.getBeliefs(userId, pathId);
    return new Map(
      Object.entries(payload?.beliefs ?? {}).map(([key, value]) => [normalizeConceptKey(key), value.pKnowL]),
    );
  },
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

/**
 * 成功率：good/easy 视为检索成功（hard/again 计入失败，有益困难区间靠它校准）。
 *
 * ⚠️ 口径说明（2026-09-16 审计 §3.9）：这是**摩擦口径**，不是 FSRS 语义。
 * FSRS 里 hard 也是"回忆出来了，只是费力"；而写证据时 `learning`（推进但未掌握）会落到 hard，
 * 于是"有进展的复习"被记成失败、拉低预算（实测：一节有进展的课把 successRate 打到 0）。
 * 分析侧请同时看宽口径（`retention-curve.isRetrievalSuccessLenient`），不要只依赖本函数。
 * 另注：目前**失败（未答出）不产生证据** → 本成功率是**上界**，不是真值。
 */
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
  picked: Array<{ conceptKey: string; pathId?: string | null }>,
  deps: ReviewPlanDeps,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (picked.length === 0) return result;
  try {
    const pathIdByKey = new Map<string, string>();

    // ① 痕迹自带来源路径（新数据）：**不依赖"是否复习过"**，所以首次温故也能说清来源
    for (const trace of picked) {
      const key = normalizeConceptKey(trace.conceptKey);
      if (key && trace.pathId) pathIdByKey.set(key, trace.pathId);
    }

    // ② 老数据没有 pathId：回落到"曾经复习过 → 那次复习所在会话的路径"反查（尽力而为）
    const missing = picked
      .map((trace) => normalizeConceptKey(trace.conceptKey))
      .filter((key) => key && !pathIdByKey.has(key));
    if (missing.length > 0) {
      const evidence = await deps.findEvidence({
        where: {
          userId,
          sessionId: { not: null },
          evidenceKey: { in: missing.map((key) => `review:result:${key}`) },
        },
        select: { evidenceKey: true, sessionId: true },
        take: 60,
      });
      const sessionIds = Array.from(new Set(evidence.map((row) => row.sessionId).filter(Boolean) as string[]));
      if (sessionIds.length > 0) {
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
      }
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
  options: {
    now?: Date;
    maxItems?: number;
    candidateLimit?: number;
    deps?: ReviewPlanDeps;
    /**
     * 本节的路径（范围口径：**只复习当前路径**的旧知）。
     * - 传入且痕迹有来源路径 → 只保留同一路径的；
     * - 痕迹 pathId 为空（迁移前的历史行，无法判断归属）→ **仍可复习**，避免老数据一刀切失效；
     * - 不传（脚本/后台回看）→ 不启用范围过滤（与旧行为一致）。
     */
    pathId?: string | null;
  } = {},
): Promise<ReviewPlan> {
  const deps = options.deps ?? defaultDeps;
  // 读侧也要走模拟时钟：写侧（dueAt/lastSeenAt 由 memory-trace 写入）用的是 simulatedNowOr()，
  // 若读侧用墙钟，日期模拟下"到期"会算错（模拟到未来 → 永远算不出到期；模拟到过去 → 全部算到期）。
  const now = options.now ?? simulatedNowOr();
  const maxItems = Math.max(1, options.maxItems ?? MAX_WARMUP_ITEMS);
  const candidateLimit = Math.max(maxItems, options.candidateLimit ?? 60);

  const outcomes = await loadRecentOutcomes(userId, OUTCOME_WINDOW, deps);
  const successRate = computeSuccessRate(outcomes);
  // 样本量一并传入：样本不足时不分档（防"1/1 成功即跳高档"，审计 §3.6 问题③）
  const budget = computeLoadBudget(successRate, outcomes.length);
  const failures = consecutiveFailures(outcomes);
  const successes = consecutiveSuccesses(outcomes);

  const leechKeys = new Set(
    Array.from(failures.entries())
      .filter(([, count]) => count >= LEECH_CONSECUTIVE_AGAIN)
      .map(([key]) => key),
  );

  const scopePathId = options.pathId ?? null;
  const due = await deps.getDueTraces(userId, { limit: candidateLimit, now }) as Awaited<ReturnType<typeof memoryTraceService.getDueTraces>>;

  // 同族去重：同一概念的多种说法只保留最急迫的一条（normalizeConceptKey 已归一化，
  // 这里再按族名收敛，避免「换一种说法」重复占用温故预算）
  const byFamily = new Map<string, (typeof due)[number]>();
  const relearn = new Map<string, RelearnSuggestion>();
  // 概念信念（BKT pKnowL，只读；缺省/读失败 = 无信念 → 不参与判定）
  const beliefs = deps.loadConceptBeliefs
    ? await deps.loadConceptBeliefs(userId, scopePathId).catch(() => new Map<string, number>())
    : new Map<string, number>();
  for (const trace of due) {
    if (!trace.conceptKey) continue;
    const family = normalizeConceptKey(trace.conceptKey);
    if (!family) continue;
    // 范围过滤（只当前路径）：来源明确且不是本节路径的旧知不进本节队列
    if (scopePathId && trace.pathId && trace.pathId !== scopePathId) continue;
    // 从未被真正提取过的点没有可回捞的记忆（kt-estimate 孤儿等），不进队列
    if (trace.extractionCount === 0) continue;
    if (leechKeys.has(family)) {
      if (!relearn.has(family)) {
        relearn.set(family, {
          conceptKey: family,
          label: trace.label || trace.conceptKey,
          consecutiveAgain: failures.get(family) ?? LEECH_CONSECUTIVE_AGAIN,
          reason: 'leech',
        });
      }
      continue;
    }
    // 信念背离（2026-09-17，审计 §4.2(3)：pKnowL 此前零下游消费）：
    // 状态/自评说"掌握了"但 BKT 信念仍很低 → 判为"记住了答案没形成理解"，
    // 继续按间隔回捞收益低 → 建议回路径重学（只产建议，**不改间隔/档位**）。
    const pKnowL = beliefs.get(family);
    if (pKnowL !== undefined
      && pKnowL <= BELIEF_DIVERGENCE_PKNOWL
      && Number(trace.masteryScore) >= BELIEF_DIVERGENCE_MASTERY) {
      if (!relearn.has(family)) {
        relearn.set(family, {
          conceptKey: family,
          label: trace.label || trace.conceptKey,
          consecutiveAgain: 0,
          reason: 'belief-divergence',
        });
      }
      continue;
    }
    const existing = byFamily.get(family);
    if (!existing || isMoreUrgent(trace, existing)) byFamily.set(family, trace);
  }

  // 当日额度（跨会话共享）：今天已经接过的量会压缩本节可用预算；
  // 额度用完则本节不温故（**顺延到明天**，而不是把剩下的今天全倒出来）。
  const dailyRead = await deps.getDailyState(userId)
    .then((state) => ({ ok: true as const, state }))
    .catch(() => ({
      ok: false as const,
      state: {
        date: now.toISOString().slice(0, 10),
        limitLoad: budget,
        usedLoad: 0,
        usedCount: 0,
        // 读不到额度 → 退回"按会话预算走"（不能让一次读失败把温故整个关掉）
        remainingLoad: budget,
        reservedKeys: [] as string[],
      },
    }));
  const daily = dailyRead.state;
  const reservedToday = new Set(daily.reservedKeys.map((key) => normalizeConceptKey(key)));
  // 单节课份额上限（审计 §3.6 问题②）：不让当天第一节课把剩余额度一次吃光；
  // 下限 SESSION_DAILY_SHARE_FLOOR 保证"剩余很少时"行为与旧版一致（额度本身仍是硬约束）。
  // 额度**读不到**时不启用份额上限（fallback 的语义就是"没有额度信息，按会话预算走"）。
  const sessionShareCap = dailyRead.ok
    ? Math.max(SESSION_DAILY_SHARE_FLOOR, daily.remainingLoad * SESSION_DAILY_SHARE_CAP)
    : Number.POSITIVE_INFINITY;
  const effectiveBudget = Math.round(Math.min(budget, daily.remainingLoad, sessionShareCap) * 100) / 100;

  // 队列（按**概念族**计，同一概念的多种说法只占一个排队位）：
  // leech 已转"回路径重学"、毕业点不再按计划间隔回捞 —— 都不算"排队中"。
  const queue = Array.from(byFamily.values())
    .filter((trace) => {
      const graduated = (successes.get(normalizeConceptKey(trace.conceptKey)) ?? 0) >= GRADUATE_CONSECUTIVE_SUCCESS;
      return !(graduated && trace.reason !== 'below-threshold');
    })
    .sort((a, b) => urgencyOf(b) - urgencyOf(a));
  const queuedCount = queue.length;
  // 今天已经接过 → 顺延到明天（同一天不重复占额度），但仍算在排队里
  const candidates = queue.filter((trace) => !reservedToday.has(normalizeConceptKey(trace.conceptKey)));

  // 认知负担档位：只对最急的前 LOAD_PROFILE_LOOKAHEAD 个候选取（LLM 一次判一批），
  // 其余用规则版兜底 —— 预算最多 3.0，实际入选只会落在最急的几个里，没必要判满 60 个。
  const lookahead = candidates.slice(0, LOAD_PROFILE_LOOKAHEAD);
  const profileMap = await deps.loadProfiles(userId, lookahead.map((trace) => trace.label || trace.conceptKey));
  const loadOf = (trace: (typeof candidates)[number]) => estimateConceptLoad(trace.label || trace.conceptKey, {
    masteryScore: trace.masteryScore,
    retention: trace.retention,
    profile: profileMap.get(normalizeConceptKey(trace.label || trace.conceptKey)) ?? null,
  });

  const picked: typeof candidates = [];
  let usedLoad = 0;
  for (const trace of candidates) {
    if (picked.length >= maxItems) break;
    // 当日额度已用完 → 今天不再接（顺延），本节进入正常教学
    if (effectiveBudget <= 0) break;
    const estimate = loadOf(trace);
    if (picked.length > 0 && usedLoad + estimate.load > effectiveBudget) continue;
    if (picked.length === 0 && estimate.load > effectiveBudget) {
      // 预算再低也要接一个最急的点：这节课本来就是为它来的
      picked.push(trace);
      usedLoad = estimate.load;
      break;
    }
    picked.push(trace);
    usedLoad = Math.round((usedLoad + estimate.load) * 100) / 100;
  }

  // 明日预告：明天（UTC 日）预计到期的点数，用于首页「明天预计 N 个」
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);
  const startOfTomorrow = new Date(endOfToday.getTime() + 1);
  const endOfTomorrow = new Date(startOfTomorrow.getTime() + 86400_000 - 1);
  const tomorrowCount = await deps
    .countDueBetween(userId, endOfToday, endOfTomorrow)
    .catch(() => 0);

  const origins = await resolveOriginPathTitles(userId, picked, deps);

  const items: ReviewPlanItem[] = picked.map((trace) => {
    const estimate = loadOf(trace);
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
    budget: effectiveBudget,
    usedLoad,
    backlogCount: Math.max(0, queuedCount - items.length),
    successRate,
    relearnSuggestions: Array.from(relearn.values()),
    daily: {
      date: daily.date,
      limitLoad: daily.limitLoad,
      usedLoad: daily.usedLoad,
      remainingLoad: daily.remainingLoad,
    },
    tomorrowCount,
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
