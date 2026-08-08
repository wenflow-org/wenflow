/**
 * ACT-R 幂律衰减记忆模型（记忆引擎 M2）
 *
 * 基于 Anderson & Schooler (1991) 的幂律遗忘：记忆保留率按 1/(1+t)^d 衰减，
 * d 为衰减参数（ACT-R 默认 0.5，预留个性化标定）。
 *
 * 复习调度采用 Cepeda et al. (2008) 间隔效应规则：最优复习间隔约为
 * 目标保留时间的 10%-20%（实现取中值 15%）。
 *
 * 纯函数、无 IO，可单测；持久化与读写由 MemoryTraceService 承担。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 到期判定默认保留率阈值：低于该值视为"即将跌落遗忘悬崖" */
export const DEFAULT_RETENTION_THRESHOLD = 0.7;

/** 默认衰减参数 d（ACT-R 标准值） */
export const DEFAULT_DECAY_FACTOR = 0.5;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** 距上次提取的天数（从未提取返回 null） */
export function daysSince(date: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, (now.getTime() - parsed.getTime()) / DAY_MS);
}

/**
 * 幂律衰减保留率：R(t) = m / (1 + t)^d
 * @param masteryScore 最近评估的内化强度 m（0-1）
 * @param lastSeenAt 最近一次提取/复习时间；从未提取返回 m（无衰减）
 */
export function calculateRetention(
  masteryScore: number,
  lastSeenAt: Date | string | null | undefined,
  now: Date = new Date(),
  decayFactor: number = DEFAULT_DECAY_FACTOR,
): number {
  const m = clamp01(masteryScore);
  const elapsed = daysSince(lastSeenAt, now);
  if (elapsed === null) return m;
  const d = Number.isFinite(decayFactor) && decayFactor > 0 ? decayFactor : DEFAULT_DECAY_FACTOR;
  return clamp01(m / Math.pow(1 + elapsed, d));
}

/**
 * Cepeda 10%-20% 间隔规则：目标保留 T 天 → 复习间隔取中值 15%（下限 1 天）。
 */
export function reviewIntervalDays(retentionTargetDays: number): number {
  if (!Number.isFinite(retentionTargetDays) || retentionTargetDays <= 0) return 1;
  return Math.max(1, Math.round(retentionTargetDays * 0.15));
}

export type ReviewDueReason =
  | 'below-threshold' // 保留率跌破阈值（即使未到计划间隔，如初始强度低）
  | 'interval-elapsed' // 距上次提取超过计划间隔
  | 'never-seen' // 从未提取过（无衰减依据，不视为到期）
  | 'not-due';

export interface ReviewDueResult {
  due: boolean;
  retention: number;
  intervalDays: number;
  daysSinceLastSeen: number | null;
  reason: ReviewDueReason;
}

/**
 * 到期判定：保留率低于阈值，或距上次提取已超过计划间隔。
 * 从未提取过的概念不判到期（等待首次提取后再进入衰减调度）。
 */
export function isReviewDue(options: {
  masteryScore: number;
  lastSeenAt?: Date | string | null;
  retentionTargetDays: number;
  retentionThreshold?: number;
  decayFactor?: number;
  now?: Date;
}): ReviewDueResult {
  const now = options.now ?? new Date();
  const threshold = Number.isFinite(options.retentionThreshold)
    ? clamp01(options.retentionThreshold!)
    : DEFAULT_RETENTION_THRESHOLD;
  const retention = calculateRetention(options.masteryScore, options.lastSeenAt, now, options.decayFactor);
  const elapsed = daysSince(options.lastSeenAt, now);
  const intervalDays = reviewIntervalDays(options.retentionTargetDays);

  if (elapsed === null) {
    return { due: false, retention, intervalDays, daysSinceLastSeen: null, reason: 'never-seen' };
  }

  if (retention < threshold) {
    return { due: true, retention, intervalDays, daysSinceLastSeen: elapsed, reason: 'below-threshold' };
  }
  if (elapsed >= intervalDays) {
    return { due: true, retention, intervalDays, daysSinceLastSeen: elapsed, reason: 'interval-elapsed' };
  }
  return { due: false, retention, intervalDays, daysSinceLastSeen: elapsed, reason: 'not-due' };
}
