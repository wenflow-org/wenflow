/**
 * 难度分配的“分层公平审计（简版）”（Q13 · 只读、纯函数）
 *
 * 背景：`difficulty-fairness-audit.ts` 只能做**行为分层**——真实用户没有人口学/队列标签，
 * 无法做人口学公平审计。为观察“难度调整是否在不同人群间系统性偏移”，本模块在既有单学习者
 * 画像之上加一层**队列聚合**。队列标签通常来自虚拟学习者（`virtual_learner_profiles` 的
 * persona / tags / story 等），因此这里的分层是**虚拟学习者分层**，不等价于真实用户公平性。
 *
 * 纪律：
 * - 纯函数、无 I/O、无 LLM；输出只由输入决定（排序与并列取值均确定性）；
 * - **只做观测，不做因果结论**：队列间差异可能来自样本量、任务分布、标签覆盖等混杂因素，
 *   disparity 只描述“观察到多少差异”，不解释“为什么”。任何结论都需人工复核与更多实验设计。
 *
 * 与既有模块的关系：复用 `auditDifficultyFairness` 计算每个队列的降档画像与标记，
 * 本模块只负责“分组 + 聚合 + 组间差异（disparity）”，不改动既有口径。
 */
import {
  auditDifficultyFairness,
  type DifficultyAdjustmentEvent,
  type DifficultyFairnessThresholds,
} from './difficulty-fairness-audit';

/** 无法解析出队列标签时的统一回退桶。 */
export const UNKNOWN_COHORT_KEY = 'unknown';

/**
 * 队列键解析策略：
 * - `personaTag`（默认）：`personaTag`，回退 `presetKey`；
 * - `frictionBudget`：`frictionBudget` / `friction_budget`；
 * - `storyId`：`storyId` / `story_id`；
 * - `sourceType`：`sourceType`。
 */
export const DIFFICULTY_COHORT_STRATEGIES = ['personaTag', 'frictionBudget', 'storyId', 'sourceType'] as const;

export type DifficultyCohortStrategy = (typeof DIFFICULTY_COHORT_STRATEGIES)[number];

export const DEFAULT_DIFFICULTY_COHORT_STRATEGY: DifficultyCohortStrategy = 'personaTag';

/** 虚拟学习者/画像上可用于分层的原始标签（字段缺省或空白 → 回退桶）。 */
export interface DifficultyCohortLabels {
  personaTag?: unknown;
  presetKey?: unknown;
  frictionBudget?: unknown;
  friction_budget?: unknown;
  storyId?: unknown;
  story_id?: unknown;
  sourceType?: unknown;
}

const COHORT_LABEL_KEYS: Record<DifficultyCohortStrategy, string[]> = {
  personaTag: ['personaTag', 'presetKey'],
  frictionBudget: ['frictionBudget', 'friction_budget'],
  storyId: ['storyId', 'story_id'],
  sourceType: ['sourceType'],
};

export function isDifficultyCohortStrategy(value: unknown): value is DifficultyCohortStrategy {
  return typeof value === 'string' && (DIFFICULTY_COHORT_STRATEGIES as readonly string[]).includes(value);
}

function normalizeCohortLabelValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * 从虚拟学习者的标签里解析出**确定性**队列键。
 *
 * 候选字段缺失/空白 → 返回统一回退桶 `unknown`（不抛错，调用方可据此统计标签覆盖率）。
 * 同一输入恒得同一输出，不含时间/随机。
 */
export function resolveCohortKey(
  labels: DifficultyCohortLabels | null | undefined,
  strategy: DifficultyCohortStrategy = DEFAULT_DIFFICULTY_COHORT_STRATEGY,
): string {
  if (!labels || typeof labels !== 'object') return UNKNOWN_COHORT_KEY;
  const keys = COHORT_LABEL_KEYS[strategy] ?? [];
  for (const key of keys) {
    const value = normalizeCohortLabelValue((labels as Record<string, unknown>)[key]);
    if (value) return value;
  }
  return UNKNOWN_COHORT_KEY;
}

/** 单个队列的聚合画像（share 的分母：任务级用 tasks，学习者级用 learners）。 */
export interface DifficultyCohortAggregate {
  cohortKey: string;
  learners: number;
  tasks: number;
  decreaseTasks: number;
  increaseTasks: number;
  keepTasks: number;
  /** 降档任务 / 任务数 */
  decreaseShare: number;
  /** 升档任务 / 任务数 */
  increaseShare: number;
  /** 任务加权的平均 delta（adjusted - baseline），负=整体被压低 */
  meanDelta: number;
  /** adjusted <= pinnedLowLevel 的任务数 */
  pinnedLowTasks: number;
  pinnedLowShare: number;
  /** 被 D_floor 抬回的任务数（旧数据无该字段 → 0） */
  floorAppliedTasks: number;
  floorAppliedShare: number;
  /** 被 auditDifficultyFairness 标记、待人工复核的学习者数（**不是结论**） */
  flaggedLearners: number;
  flaggedShare: number;
}

/** 组间差异（max - min）。仅描述观测到的跨度，不做因果推断。 */
export interface DifficultyCohortDisparityMetric {
  metric: string;
  min: number;
  minCohortKey: string | null;
  max: number;
  maxCohortKey: string | null;
  /** max - min（>=0）；空输入时为 0。 */
  span: number;
}

export interface DifficultyCohortDisparity {
  increaseShare: DifficultyCohortDisparityMetric;
  meanDelta: DifficultyCohortDisparityMetric;
}

export interface DifficultyCohortAuditOptions {
  /** 透传给 `auditDifficultyFairness` 的阈值（口径与 Q13 既有模块一致） */
  thresholds?: DifficultyFairnessThresholds;
  /** 未出现在 cohortsByUserId 里的用户落到该桶（默认 `unknown`） */
  unknownCohortKey?: string;
}

export interface DifficultyCohortAuditReport {
  /** 按 cohortKey 升序，确定性输出 */
  cohorts: DifficultyCohortAggregate[];
  disparity: DifficultyCohortDisparity;
}

function safeShare(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** 队列键的确定性比较（不依赖 locale，避免跨环境排序漂移）。 */
function compareCohortKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 并列时取 key 更小者（cohorts 已按 key 升序），保证确定性。 */
function disparityMetric(
  metric: string,
  cohorts: DifficultyCohortAggregate[],
  pick: (cohort: DifficultyCohortAggregate) => number,
): DifficultyCohortDisparityMetric {
  if (cohorts.length === 0) {
    return { metric, min: 0, minCohortKey: null, max: 0, maxCohortKey: null, span: 0 };
  }
  let minCohort = cohorts[0];
  let maxCohort = cohorts[0];
  for (const cohort of cohorts) {
    if (pick(cohort) < pick(minCohort)) minCohort = cohort;
    if (pick(cohort) > pick(maxCohort)) maxCohort = cohort;
  }
  return {
    metric,
    min: pick(minCohort),
    minCohortKey: minCohort.cohortKey,
    max: pick(maxCohort),
    maxCohortKey: maxCohort.cohortKey,
    span: pick(maxCohort) - pick(minCohort),
  };
}

/**
 * 按队列聚合难度调整事件，并给出组间差异摘要。
 *
 * - `cohortsByUserId`：userId → 队列键；缺省/空白值落到 `unknownCohortKey`；
 * - 复用 `auditDifficultyFairness` 计算每队列的学习者画像与标记；
 * - 组间差异当前给出 `increaseShare` 与 `meanDelta` 的 max-min（含取得该值的队列 id）。
 *
 * 纯函数：不写库、不读环境、不依赖系统时间。
 */
export function auditDifficultyByCohort(
  events: DifficultyAdjustmentEvent[],
  cohortsByUserId: Record<string, string | null | undefined>,
  options: DifficultyCohortAuditOptions = {},
): DifficultyCohortAuditReport {
  const unknownCohortKey = options.unknownCohortKey?.trim() || UNKNOWN_COHORT_KEY;
  const membership = cohortsByUserId ?? {};
  const grouped = new Map<string, DifficultyAdjustmentEvent[]>();

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.userId !== 'string' || !event.userId) continue;
    const mapped = membership[event.userId];
    const cohortKey = typeof mapped === 'string' && mapped.trim() ? mapped.trim() : unknownCohortKey;
    const bucket = grouped.get(cohortKey);
    if (bucket) bucket.push(event);
    else grouped.set(cohortKey, [event]);
  }

  const cohorts: DifficultyCohortAggregate[] = [];
  for (const [cohortKey, bucket] of grouped) {
    const report = auditDifficultyFairness(bucket, options.thresholds ?? {});
    const tasks = report.totals.tasks;
    const learners = report.totals.learners;
    const pinnedLowTasks = report.learners.reduce((sum, learner) => sum + learner.pinnedLowTasks, 0);
    const flaggedLearners = report.flagged.length;

    cohorts.push({
      cohortKey,
      learners,
      tasks,
      decreaseTasks: report.totals.decreaseTasks,
      increaseTasks: report.totals.increaseTasks,
      keepTasks: report.totals.keepTasks,
      decreaseShare: safeShare(report.totals.decreaseTasks, tasks),
      increaseShare: safeShare(report.totals.increaseTasks, tasks),
      meanDelta: report.totals.meanDelta,
      pinnedLowTasks,
      pinnedLowShare: safeShare(pinnedLowTasks, tasks),
      floorAppliedTasks: report.totals.floorAppliedTasks,
      floorAppliedShare: safeShare(report.totals.floorAppliedTasks, tasks),
      flaggedLearners,
      flaggedShare: safeShare(flaggedLearners, learners),
    });
  }

  cohorts.sort((a, b) => compareCohortKeys(a.cohortKey, b.cohortKey));

  return {
    cohorts,
    disparity: {
      increaseShare: disparityMetric('increaseShare', cohorts, (cohort) => cohort.increaseShare),
      meanDelta: disparityMetric('meanDelta', cohorts, (cohort) => cohort.meanDelta),
    },
  };
}
