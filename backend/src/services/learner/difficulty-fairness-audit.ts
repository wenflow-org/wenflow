/**
 * 难度分配公平审计（Q13 · 只读、纯函数）
 *
 * 背景：审计 §4.2(2) 指出难度控制曾是"纯阻尼 → 稳态最低档"，存在**自我实现预言**风险：
 * 被判"弱/累"的学习者若被系统性降档，会长期得不到 ZPD 挑战，系统反而更确信其弱。
 * D_floor（`TaskDifficultyAdjustmentService`）是第一道结构性护栏；本模块提供**观测面**——
 * 从难度台账（`learner_evidence: task:difficulty:adjustment`）复算每个学习者的降档画像，
 * 找出"被长期钉在低档/持续低于基线"的候选。
 *
 * 纪律：纯函数、无 I/O、无 LLM；**只做观测与标记，不做因果结论**（观察性数据，见阈值说明）。
 *
 * 数据局限（务必随报告输出）：
 * - 台账只在 `reasons.length > 0` 时写入 → 完全"keep 且无理由"的任务不在数据里，覆盖率天然不完整；
 * - 真实用户无敏感属性/分层标签，故这里只做**行为分层**（基线高低、降档画像），不是人口学公平审计；
 * - `floor`/`floorApplied` 仅在新版（含 D_floor）写入后才有值。
 */

export interface DifficultyAdjustmentEvent {
  userId: string;
  occurredAt: string; // ISO
  baseline: number;
  adjusted: number;
  direction?: string;
  reasons?: string[];
  floor?: number | null;
  floorApplied?: boolean;
}

export interface DifficultyFairnessThresholds {
  /** "低档"判定线：调整后 <= 该值算贴着地板（默认 3，与 D_FLOOR_ABSOLUTE 对齐） */
  pinnedLowLevel?: number;
  /** "长期低于基线"告警：最大连续低于基线的任务数 >= 该值（默认 3） */
  consecutiveBelowFlag?: number;
  /** 判定"几乎总在降档"所需的最少任务数（默认 3） */
  minTasksForPattern?: number;
}

export interface PerLearnerDifficultyFairness {
  userId: string;
  tasks: number;
  decreaseTasks: number;
  increaseTasks: number;
  keepTasks: number;
  /** 平均 delta（adjusted - baseline），负=整体被压低 */
  meanDelta: number;
  /** 按时间排序后，连续 adjusted < baseline 的最大长度 */
  maxConsecutiveBelowBaseline: number;
  /** adjusted <= pinnedLowLevel 的任务数 */
  pinnedLowTasks: number;
  /** 被 D_floor 抬回的任务数（旧数据无该字段 → 0） */
  floorAppliedTasks: number;
  reasonHistogram: Record<string, number>;
}

export interface DifficultyFairnessFlag {
  userId: string;
  flags: string[];
}

export interface DifficultyFairnessReport {
  learners: PerLearnerDifficultyFairness[];
  flagged: DifficultyFairnessFlag[];
  totals: {
    learners: number;
    tasks: number;
    decreaseTasks: number;
    increaseTasks: number;
    keepTasks: number;
    meanDelta: number;
    floorAppliedTasks: number;
  };
}

const DEFAULTS: Required<DifficultyFairnessThresholds> = {
  pinnedLowLevel: 3,
  consecutiveBelowFlag: 3,
  minTasksForPattern: 3,
};

function toFinite(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** 复算单个学习者的降档画像（事件按 occurredAt 升序处理）。 */
export function summarizeLearnerDifficulty(
  userId: string,
  events: DifficultyAdjustmentEvent[],
  thresholds: DifficultyFairnessThresholds = {},
): PerLearnerDifficultyFairness {
  const pinnedLowLevel = thresholds.pinnedLowLevel ?? DEFAULTS.pinnedLowLevel;
  const ordered = events
    .filter((event) => event && typeof event.userId === 'string' && event.userId === userId)
    .slice()
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  let decreaseTasks = 0;
  let increaseTasks = 0;
  let keepTasks = 0;
  let deltaSum = 0;
  let pinnedLowTasks = 0;
  let floorAppliedTasks = 0;
  let currentBelowRun = 0;
  let maxConsecutiveBelowBaseline = 0;
  const reasonHistogram: Record<string, number> = {};

  for (const event of ordered) {
    const baseline = toFinite(event.baseline, 0);
    const adjusted = toFinite(event.adjusted, baseline);
    const delta = adjusted - baseline;
    deltaSum += delta;
    if (delta < 0) decreaseTasks += 1;
    else if (delta > 0) increaseTasks += 1;
    else keepTasks += 1;

    if (adjusted <= pinnedLowLevel) pinnedLowTasks += 1;
    if (event.floorApplied === true) floorAppliedTasks += 1;

    if (delta < 0) {
      currentBelowRun += 1;
      if (currentBelowRun > maxConsecutiveBelowBaseline) maxConsecutiveBelowBaseline = currentBelowRun;
    } else {
      currentBelowRun = 0;
    }

    for (const reason of Array.isArray(event.reasons) ? event.reasons : []) {
      const key = String(reason);
      reasonHistogram[key] = (reasonHistogram[key] ?? 0) + 1;
    }
  }

  return {
    userId,
    tasks: ordered.length,
    decreaseTasks,
    increaseTasks,
    keepTasks,
    meanDelta: ordered.length ? deltaSum / ordered.length : 0,
    maxConsecutiveBelowBaseline,
    pinnedLowTasks,
    floorAppliedTasks,
    reasonHistogram,
  };
}

/**
 * 全体审计：按学习者聚合 + 标记可疑画像。
 * 标记只是**待人工复核的候选**，不是结论。
 */
export function auditDifficultyFairness(
  events: DifficultyAdjustmentEvent[],
  thresholds: DifficultyFairnessThresholds = {},
): DifficultyFairnessReport {
  const consecutiveBelowFlag = thresholds.consecutiveBelowFlag ?? DEFAULTS.consecutiveBelowFlag;
  const minTasksForPattern = thresholds.minTasksForPattern ?? DEFAULTS.minTasksForPattern;

  const byUser = new Map<string, DifficultyAdjustmentEvent[]>();
  for (const event of events) {
    if (!event || typeof event.userId !== 'string' || !event.userId) continue;
    const bucket = byUser.get(event.userId);
    if (bucket) bucket.push(event);
    else byUser.set(event.userId, [event]);
  }

  const learners: PerLearnerDifficultyFairness[] = [];
  const flagged: DifficultyFairnessFlag[] = [];

  for (const [userId, bucket] of byUser) {
    const summary = summarizeLearnerDifficulty(userId, bucket, thresholds);
    learners.push(summary);

    const flags: string[] = [];
    if (summary.maxConsecutiveBelowBaseline >= consecutiveBelowFlag) flags.push('consecutive_below_baseline');
    if (summary.tasks >= minTasksForPattern && summary.decreaseTasks === summary.tasks) flags.push('always_decreased');
    if (summary.tasks >= minTasksForPattern && summary.pinnedLowTasks / summary.tasks >= 0.5) flags.push('majority_pinned_low');
    if (summary.tasks >= minTasksForPattern && summary.meanDelta <= -1) flags.push('mean_delta_at_least_one_tier_down');
    if (flags.length) flagged.push({ userId, flags });
  }

  learners.sort((a, b) => a.userId.localeCompare(b.userId));
  flagged.sort((a, b) => a.userId.localeCompare(b.userId));

  const totals = learners.reduce(
    (acc, item) => ({
      learners: acc.learners + 1,
      tasks: acc.tasks + item.tasks,
      decreaseTasks: acc.decreaseTasks + item.decreaseTasks,
      increaseTasks: acc.increaseTasks + item.increaseTasks,
      keepTasks: acc.keepTasks + item.keepTasks,
      meanDelta: 0,
      floorAppliedTasks: acc.floorAppliedTasks + item.floorAppliedTasks,
    }),
    { learners: 0, tasks: 0, decreaseTasks: 0, increaseTasks: 0, keepTasks: 0, meanDelta: 0, floorAppliedTasks: 0 },
  );
  totals.meanDelta = totals.tasks
    ? learners.reduce((sum, item) => sum + item.meanDelta * item.tasks, 0) / totals.tasks
    : 0;

  return { learners, flagged, totals };
}
