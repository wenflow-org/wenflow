/**
 * 任务级难度自动调整（把学习者模型真正接进课堂）
 *
 * 纪律（`doc/LEARNER_STATE_REVIEW_DESIGN.md` §2.1/§2.2）：**档位由代码给，LLM 只出观测**。
 * 因此这里是一个纯函数式的判定器：输入学习者状态 + 任务基线，输出确定的难度档位与依据，
 * 不做任何 LLM 调用（课堂关键路径上不允许 inline await LLM）。
 *
 * 三层状态各归其位（承接"全局=总负担、路径=单课、会话=本节课"）：
 * - **课内（路径级）**：`lessonMetrics` —— 这一课所在路径最近的压力/平衡，决定"这节课要不要降档"；
 * - **学习者级（全局聚合）**：`globalMetrics`/`fatigueRisk`/`recommendedPacing` —— 总负担，
 *   只作为降档理由（累了就别再上强度），不区分是哪条路径把它推高的；
 * - **知识证据**：脆弱/挣扎概念、前置缺口 —— 缺基础就该降档。
 *
 * 升档更保守：要求**没有任何降档理由**，且课内状态明确"有余力"。降档最多 2 档，升档最多 1 档。
 */
import type { LearnerLearningControlState } from '../../agents/learner-model-agent/types';

/** `challengeLevelCap` 在任务级的具体含义：本任务难度不得越过该上限 */
export const CHALLENGE_CAP_LIMITS: Record<'low' | 'medium' | 'high', number> = {
  low: 4,
  medium: 7,
  high: 10,
};

/** 难度取值域（与 LSS/KTL 的 0-10 刻度一致） */
export const DIFFICULTY_RANGE = { min: 1, max: 10 } as const;

export interface TaskDifficultyMetrics {
  lss: number;
  ktl: number;
  lf: number;
  lsb: number;
}

export interface TaskDifficultyInput {
  /** 任务自身基线难度（由任务认知档位换算，见 resolveBaselineLevel） */
  baselineLevel: number;
  /** 学习者级（全局聚合）状态 */
  globalMetrics: TaskDifficultyMetrics;
  /** 课内（路径级）状态；缺省 = 用全局（该路径还没有历史时） */
  lessonMetrics?: TaskDifficultyMetrics | null;
  /** 课内控制状态（来自学习者快照；其 challengeLevelCap/paceMode 决定上限与升档资格） */
  learningControlState?: Pick<LearnerLearningControlState, 'paceMode' | 'conceptLoad' | 'challengeLevelCap'> | null;
  fatigueRisk?: string | null;
  recommendedPacing?: string | null;
  /** 知识证据计数 */
  knowledgeSignals?: {
    fragileCount?: number;
    strugglingCount?: number;
    prerequisiteGapCount?: number;
  } | null;
}

export type TaskDifficultyDirection = 'decrease' | 'keep' | 'increase';

export interface TaskDifficultyAdjustment {
  /** 任务原始难度（1-10） */
  baseline: number;
  /** 调整后难度（1-10，已按 challengeLevelCap 封顶） */
  adjusted: number;
  direction: TaskDifficultyDirection;
  delta: number;
  /** 上限来源（可审计） */
  cap: number;
  capSource: 'low' | 'medium' | 'high';
  /** 判定依据（稳定枚举，只含**学习者状态证据**，便于统计与度量） */
  reasons: string[];
  /** 是否被 challengeLevelCap 截断（上限是"封顶"，不是一条降档证据） */
  capApplied: boolean;
  /** 参与判定的证据快照（可审计/可回归） */
  evidence: {
    lessonLss: number;
    lessonKtl: number;
    lessonLf: number;
    lessonLsb: number;
    globalLf: number;
    globalPacing: string;
    fatigueRisk: string;
    paceMode: string;
    conceptLoad: string;
    challengeLevelCap: string;
    fragileCount: number;
    strugglingCount: number;
    prerequisiteGapCount: number;
    lessonScopeIsPath: boolean;
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * 任务基线难度 ← 任务认知档位。
 * 优先 `cognitiveLoad`（低/中/高 → 3/5/7），否则回落到 `cognitiveLevel`（认知层级 → 3-8），
 * 都没有则取中位 5。这样基线是**确定的**，不随 LLM 表述漂移。
 */
export function resolveBaselineLevel(input: {
  cognitiveLoad?: string | null;
  cognitiveLevel?: string | null;
}): number {
  const load = String(input.cognitiveLoad || '').trim().toLowerCase();
  if (load === 'low') return 3;
  if (load === 'high') return 7;
  if (load === 'medium') return 5;

  const level = String(input.cognitiveLevel || '').trim().toLowerCase();
  const byLevel: Record<string, number> = {
    remember: 3,
    understand: 4,
    apply: 5,
    analyze: 6,
    evaluate: 7,
    create: 8,
  };
  if (byLevel[level]) return byLevel[level];

  return 5;
}

/** 降档理由（每条 -1，合计最多 -2） */
function collectDecreaseReasons(
  input: TaskDifficultyInput,
  lesson: TaskDifficultyMetrics,
  lessonScopeIsPath: boolean
): string[] {
  const reasons: string[] = [];
  const cap = input.learningControlState?.challengeLevelCap;

  // 课内（路径级）：这条路最近本来就吃力 → 这节课降档。
  // 仅在**有本路径历史**时生效：本路径还没上过课时，不能借用别的路径的路径级证据
  // （LSS 是会话级量、balance 是路径自身状态），那是跨路径污染。
  if (lessonScopeIsPath && lesson.lss >= 6) reasons.push('lesson_stress_high');
  if (lessonScopeIsPath && (lesson.lf >= 6 || lesson.lsb < 0)) reasons.push('path_load_unbalanced');
  // 学习者级：总负担重（累）→ 任何路径都别再上强度
  if (input.fatigueRisk === 'high' || input.recommendedPacing === 'slow' || input.globalMetrics.lf >= 6) {
    reasons.push('fatigue_high');
  }
  // 学习者级：总负荷失衡（例如当天课多）→ 同样降档。层级要说清：这是全局信号，不是"本路径失衡"。
  if (!lessonScopeIsPath && input.globalMetrics.lsb < 0) reasons.push('global_imbalance');
  // 知识证据：脆弱/挣扎/前置缺口
  const fragile = input.knowledgeSignals?.fragileCount ?? 0;
  const struggling = input.knowledgeSignals?.strugglingCount ?? 0;
  const gaps = input.knowledgeSignals?.prerequisiteGapCount ?? 0;
  if (fragile > 0) reasons.push('fragile_concepts');
  if (struggling > 0) reasons.push('struggling_concepts');
  if (gaps > 0) reasons.push('prerequisite_gaps');

  return reasons;
}

/** 升档资格：要求课内明确"有余力"，任何降档理由都会取消资格 */
function canIncrease(input: TaskDifficultyInput, lesson: TaskDifficultyMetrics, decreaseReasons: string[]): boolean {
  if (decreaseReasons.length > 0) return false;
  const control = input.learningControlState;
  if (!control || control.challengeLevelCap !== 'high' || control.paceMode !== 'push') return false;
  return lesson.ktl >= 5 && lesson.lf <= 3 && lesson.lss <= 4;
}

export function decideTaskDifficulty(input: TaskDifficultyInput): TaskDifficultyAdjustment {
  const lessonProvided = Boolean(input.lessonMetrics);
  const lesson = input.lessonMetrics ?? input.globalMetrics;
  const capSource = (input.learningControlState?.challengeLevelCap as 'low' | 'medium' | 'high') || 'medium';
  const cap = CHALLENGE_CAP_LIMITS[capSource] ?? CHALLENGE_CAP_LIMITS.medium;

  const decreaseReasons = collectDecreaseReasons(input, lesson, lessonProvided);
  let delta = -Math.min(decreaseReasons.length, 2);
  if (canIncrease(input, lesson, decreaseReasons)) delta = 1;
  if (!Number.isFinite(delta)) delta = 0;

  const baseline = clamp(Math.round(input.baselineLevel), DIFFICULTY_RANGE.min, DIFFICULTY_RANGE.max);
  const ceiling = Math.min(cap, DIFFICULTY_RANGE.max);
  const desired = clamp(baseline + delta, DIFFICULTY_RANGE.min, DIFFICULTY_RANGE.max);
  // 上限是**封顶**，不额外计一档（否则"本路径压力大"会被算两次：一次降档、一次封顶）
  const adjusted = clamp(desired, DIFFICULTY_RANGE.min, ceiling);
  const finalDelta = adjusted - baseline;

  const reasons = [...decreaseReasons];
  if (reasons.length === 0 && finalDelta > 0) reasons.push('ready_to_accelerate');
  const capApplied = adjusted < desired;

  return {
    baseline,
    adjusted,
    direction: finalDelta > 0 ? 'increase' : finalDelta < 0 ? 'decrease' : 'keep',
    delta: finalDelta,
    cap,
    capSource,
    reasons,
    capApplied,
    evidence: {
      lessonLss: lesson.lss,
      lessonKtl: lesson.ktl,
      lessonLf: lesson.lf,
      lessonLsb: lesson.lsb,
      globalLf: input.globalMetrics.lf,
      globalPacing: input.recommendedPacing || 'moderate',
      fatigueRisk: input.fatigueRisk || 'low',
      paceMode: input.learningControlState?.paceMode || 'steady',
      conceptLoad: input.learningControlState?.conceptLoad || 'medium',
      challengeLevelCap: capSource,
      fragileCount: input.knowledgeSignals?.fragileCount ?? 0,
      strugglingCount: input.knowledgeSignals?.strugglingCount ?? 0,
      prerequisiteGapCount: input.knowledgeSignals?.prerequisiteGapCount ?? 0,
      lessonScopeIsPath: lessonProvided,
    },
  };
}

export const taskDifficultyAdjustmentService = { resolveBaselineLevel, decideTaskDifficulty };
