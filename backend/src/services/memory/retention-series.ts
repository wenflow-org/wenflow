/**
 * 保留率序列 / 遗忘曲线（Q2 记忆看板 + Q8 观测激活）
 *
 * 纯函数：给定一条 memory_trace（含 FSRS 状态列，或仅 legacy mastery/extraction 字段），
 * 按固定采样日 [0,1,3,7,14,30] 计算「距上次复习第 N 天的期望保留率」。
 *
 * 口径与 `memory-trace.service.fsrsRetentionOfTrace` / `getRetentionSnapshot` **完全一致**：
 * - 有 `fsrsStability` 用 FSRS-6 DSR 状态；
 * - 否则用 `fsrsStateFromLegacy` 从 legacy 字段推导（迁移兼容）。
 * 因此同一条 trace 的当前保留率与到期判定不会出现两个口径（Q2 前置：统一展示口径）。
 *
 * 本模块不落库、无 IO，可单测（见 __tests__/retention-series.test.ts）。
 */
import {
  fsrsRetrievability,
  fsrsStateFromLegacy,
  type FsrsMemoryState,
} from './fsrs';

/** 遗忘曲线采样日（天，距上次复习）：与前端 x 轴一致 */
export const RETENTION_CURVE_DAYS = [0, 1, 3, 7, 14, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 构造曲线所需的 trace 字段（fsrs* 为可空列，legacy 字段兜底） */
export interface RetentionCurveSource {
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLapses: number | null;
  /** FSRS reps 真列（可缺省；缺省回退 extractionCount，与写入侧一致） */
  fsrsReps?: number | null;
  masteryScore: number;
  extractionCount: number;
  lastSeenAt: Date | null;
}

export interface RetentionCurvePoint {
  /** 距上次复习的天数 */
  day: number;
  /** 该时点的期望保留率（0-1，保留 4 位小数） */
  retention: number;
}

/** 单条概念的保留率序列 */
export interface RetentionSeries {
  /** 采样日（与 retention 对齐，便于直接喂 ECharts） */
  days: number[];
  /** 各采样日保留率（0-1） */
  retention: number[];
  /** 距上次复习已过天数（asOf 口径，保留 1 位小数） */
  elapsedDays: number;
  /** 当前保留率（0-1，保留 4 位小数） */
  currentRetention: number;
  points: RetentionCurvePoint[];
}

/**
 * trace → FSRS 状态（与 memory-trace.service.fsrsRetentionOfTrace 同口径）。
 * 导出供 route 直接读取数值 stability（天），避免与曲线内部口径分裂。
 */
export function fsrsStateOfTrace(source: RetentionCurveSource): FsrsMemoryState {
  if (source.fsrsStability !== null && source.fsrsStability !== undefined) {
    return {
      stability: source.fsrsStability,
      difficulty: source.fsrsDifficulty ?? 5,
      reps: source.fsrsReps ?? source.extractionCount,
      lapses: source.fsrsLapses ?? 0,
      lastReviewAt: source.lastSeenAt,
    };
  }
  return fsrsStateFromLegacy(source.masteryScore, source.extractionCount, source.lastSeenAt);
}

function round(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

/**
 * 构建单条概念的遗忘曲线。
 * - 曲线锚点 = 上次复习时间（lastSeenAt）：第 0 天恒为 1（刚复习完）；
 * - 无 lastSeenAt（仅 KT EMA 的痕迹）返回全 0，由调用方决定是否展示。
 */
export function buildRetentionSeries(
  source: RetentionCurveSource,
  options: { asOf?: Date; days?: readonly number[] } = {},
): RetentionSeries {
  const asOf = options.asOf ?? new Date();
  const days = [...(options.days ?? RETENTION_CURVE_DAYS)];
  const state = fsrsStateOfTrace(source);
  const anchor = state.lastReviewAt;
  const retention = days.map((day) =>
    anchor ? round(fsrsRetrievability(state, new Date(anchor.getTime() + day * DAY_MS)), 4) : 0,
  );
  const elapsedDays = anchor
    ? round(Math.max(0, (asOf.getTime() - anchor.getTime()) / DAY_MS), 1)
    : 0;
  const currentRetention = anchor ? round(fsrsRetrievability(state, asOf), 4) : 0;
  return {
    days,
    retention,
    elapsedDays,
    currentRetention,
    points: days.map((day, index) => ({ day, retention: retention[index] })),
  };
}

/** 概念在记忆看板中的分组：到期复习优先（老师先回捞）→ 已掌握 → 其它 */
export type RetentionConceptBucket = 'due' | 'mastered' | 'other';

export interface RetentionConceptInput extends RetentionCurveSource {
  conceptKey: string;
  label: string | null;
  bucket: RetentionConceptBucket;
  /** memory_traces 的 legacy 内化强度字符串标签（unknown/fragile/developing/stable） */
  stabilityLabel?: string | null;
}

export interface RetentionConceptSeries extends RetentionConceptInput {
  /** 数值稳定性（天，FSRS 口径；legacy 行由 fsrsStateFromLegacy 推导） */
  stability: number;
  /** 当前保留率（与 retention/curve.currentRetention 同值，便于单独消费） */
  retention: number;
  curve: RetentionSeries;
}

/**
 * 批量构建概念保留率序列：过滤无 lastSeenAt 的痕迹，按「到期 → 已掌握 → 其它、
 * 同组内当前保留率升序（越危险越靠前）」确定性排序，并截断到 max（默认 8，防曲线糊成一片）。
 */
export function buildRetentionSeriesForConcepts(
  concepts: RetentionConceptInput[],
  options: { asOf?: Date; days?: readonly number[]; max?: number } = {},
): RetentionConceptSeries[] {
  const asOf = options.asOf ?? new Date();
  const max = Number.isInteger(options.max) && (options.max as number) > 0 ? (options.max as number) : 8;
  const bucketRank: Record<RetentionConceptBucket, number> = { due: 0, mastered: 1, other: 2 };
  return concepts
    .filter((concept) => !!concept.lastSeenAt)
    .map((concept) => {
      const curve = buildRetentionSeries(concept, { asOf, days: options.days });
      return {
        ...concept,
        stability: round(fsrsStateOfTrace(concept).stability, 2),
        retention: curve.currentRetention,
        curve,
      };
    })
    .sort((a, b) =>
      bucketRank[a.bucket] - bucketRank[b.bucket]
      || a.retention - b.retention
      || a.conceptKey.localeCompare(b.conceptKey),
    )
    .slice(0, max);
}
