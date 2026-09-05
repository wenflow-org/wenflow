/**
 * FSRS-6 记忆调度引擎（M2 升级：替代 ACT-R Cepeda 15% 规则 + SM-2 ×2 倍增）
 *
 * 设计依据（教育理论研究报告 2026-09-02 §五）：
 * - FSRS-6（Free Spaced Repetition Scheduler v6）在 7 亿条真实复习记录上训练，
 *   同保留率下比 SM-2 减少 20-30% 复习量，99.6% 用户集合优于 SM-2。
 * - DSR 三变量模型：Difficulty（1-10，均值回归避免 Ease Hell）/ Stability（天，
 *   回忆率降到 90% 所需时间）/ Retrievability（幂律遗忘曲线）。
 *
 * 本模块是对官方 ts-fsrs（MIT，open-spaced-repetition）的薄封装：
 * - 屏蔽 ts-fsrs 的 learning-steps 短期记忆机制（Wenflow 是跨天复习，非闪卡）
 * - 提供与现有 MemoryTraceService 对齐的纯函数接口（可单测、零 IO）
 * - 下次到期时间 = lastReview + stability 天（desired retention 缺省 0.9）
 *
 * 注意：本文件不落库；持久化与读写由 MemoryTraceService 承担。
 */
import { fsrs as createFsrsScheduler, createEmptyCard, Rating, State } from 'ts-fsrs';
import type { Card } from 'ts-fsrs';

/** FSRS 成绩码（与 ts-fsrs Rating 对齐：1=Again 2=Hard 3=Good 4=Easy） */
export type FsrsGradeCode = 1 | 2 | 3 | 4;

/** 可持久化的 FSRS 记忆状态（存 memory_traces 的数值列，JSON 安全） */
export interface FsrsMemoryState {
  /** FSRS 稳定性（天）：回忆率从 100% 降到 desiredRetention 所需时间 */
  stability: number;
  /** FSRS 难度（1-10），均值回归 */
  difficulty: number;
  /** 累计复习次数 */
  reps: number;
  /** 累计失误次数（Again 次数） */
  lapses: number;
  /** 最近一次复习时间（null = 从未复习） */
  lastReviewAt: Date | null;
}

/** 默认目标保留率（回忆率阈值；FSRS 的间隔据此反算） */
export const FSRS_DEFAULT_RETENTION = 0.9;
/** 首个学习周期的最小间隔（天）：保护睡眠巩固窗口（Rasch & Born 2013） */
export const FSRS_MIN_FIRST_INTERVAL_DAYS = 1;

/**
 * 知识看板状态 → FSRS 成绩码（确定性映射，零 LLM；与 mapKnowledgeStatusToMastery 语义对齐）
 * - mastered + progress≥100 → Easy：完全掌握且达标
 * - mastered → Good：已掌握
 * - review → Hard：到期复习点（尚不稳固，按困难处理）
 * - learning / pending → Again：尚未掌握
 */
export function fsrsGradeFromStatus(
  status: 'pending' | 'learning' | 'mastered' | 'review',
  progress: number,
): FsrsGradeCode {
  const p = Number.isFinite(progress) ? progress : 0;
  switch (status) {
    case 'mastered':
      return p >= 100 ? Rating.Easy : Rating.Good;
    case 'review':
      return Rating.Hard;
    case 'learning':
    case 'pending':
    default:
      return Rating.Again;
  }
}

/** 空状态（新概念，从未复习） */
export function fsrsEmptyState(): FsrsMemoryState {
  return { stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReviewAt: null };
}

/**
 * 从现有 memory_traces 字段初始化 FSRS 状态（迁移兼容，让旧数据给 FSRS 一个合理起点）。
 * 近似映射（消费策略：一面稳定演进，不必精确）：
 * - stability ≈ masteryScore × 10 天（0.2→2 天，0.9→9 天）
 * - difficulty 中性 5
 */
export function fsrsStateFromLegacy(
  masteryScore: number,
  extractionCount: number,
  lastSeenAt: Date | string | null,
): FsrsMemoryState {
  const m = Number.isFinite(masteryScore) ? Math.max(0.05, Math.min(1, masteryScore)) : 0.5;
  return {
    stability: Math.max(1, Math.round(m * 10)),
    difficulty: 5,
    reps: Number.isInteger(extractionCount) && extractionCount > 0 ? extractionCount : 0,
    lapses: 0,
    lastReviewAt: lastSeenAt ? new Date(lastSeenAt) : null,
  };
}

/** ts-fsrs 卡片状态码：0=new 1=learning 2=review 3=relearning */
function cardStateOf(state: FsrsMemoryState): State {
  if (state.stability <= 0) return State.New; // 首次
  return state.lapses > 0 ? State.Relearning : State.Review;
}

/** 把 FsrsMemoryState 还原为 ts-fsrs 卡片（供 scheduler.next 消费） */
function cardOf(state: FsrsMemoryState, now: Date): Card {
  const empty = createEmptyCard();
  return {
    due: empty.due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: state.reps,
    lapses: state.lapses,
    state: cardStateOf(state),
    last_review: state.lastReviewAt ?? now,
  };
}

export interface FsrsScheduleResult {
  state: FsrsMemoryState;
  /** 下次复习间隔（天，向下取整到整数天，至少 FSRS_MIN_FIRST_INTERVAL_DAYS） */
  intervalDays: number;
}

/**
 * FSRS 调度核心：应用一次复习成绩，返回新记忆状态与下次间隔。
 * @param prev 上一次记忆状态（null = 新概念）
 * @param grade 本次复习成绩（Again/Hard/Good/Easy）
 * @param now 复习发生时间
 * @param desiredRetention 目标保留率（0-1，缺省 0.9；考试目标可上调至 0.95）
 */
export function fsrsSchedule(
  prev: FsrsMemoryState | null,
  grade: FsrsGradeCode,
  now: Date,
  desiredRetention: number = FSRS_DEFAULT_RETENTION,
): FsrsScheduleResult {
  const retention = Number.isFinite(desiredRetention) ? Math.max(0.5, Math.min(1, desiredRetention)) : FSRS_DEFAULT_RETENTION;
  const scheduler = createFsrsScheduler({ request_retention: retention, enable_short_term: false });
  const card = prev ? cardOf(prev, now) : createEmptyCard();
  const result = scheduler.next(card, now, grade);

  const stability = Number.isFinite(result.card.stability) && result.card.stability > 0
    ? result.card.stability
    : 1;
  // 下次复习 = lastReview + stability 天（desired retention 下 stability 即"降到阈值的天数"）
  const intervalDays = Math.max(FSRS_MIN_FIRST_INTERVAL_DAYS, Math.round(stability));

  return {
    state: {
      stability: result.card.stability,
      difficulty: result.card.difficulty,
      reps: result.card.reps,
      lapses: result.card.lapses,
      lastReviewAt: new Date(result.card.last_review ?? now),
    },
    intervalDays,
  };
}

/**
 * 当前可提取率（幂律遗忘曲线），对应 ACT-R calculateRetention 的等效输出。
 * 接口保持与 actr.calculateRetention 相似（供 due 判定与展示复用）。
 */
export function fsrsRetrievability(state: FsrsMemoryState, now: Date): number {
  if (!state || state.stability <= 0 || !state.lastReviewAt) return 0;
  const elapsed = Math.max(0, (now.getTime() - state.lastReviewAt.getTime()) / (24 * 60 * 60 * 1000));
  // FSRS-6 幂律遗忘曲线：R(t,S) = (1 + FACTOR·t/S)^DECAY，FACTOR=19/81，DECAY=-0.5
  // （等价于 ts-fsrs 内部 forgetting curve；内联公式以保持纯函数无 IO）
  const FACTOR = 19 / 81;
  const DECAY = -0.5;
  const power = Math.pow(1 + (FACTOR * elapsed) / state.stability, DECAY);
  const r = Number.isFinite(power) ? power : 0;
  return Math.max(0, Math.min(1, r));
}