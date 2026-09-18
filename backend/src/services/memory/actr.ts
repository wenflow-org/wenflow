/**
 * 复习间隔规则与保留率工具（记忆引擎遗留工具集）
 *
 * 历史：M2 曾用 ACT-R 幂律衰减 `R(t)=m/(1+t)^d` 做到期判定；2026-09 起保留率统一由
 * FSRS 承担（见 `fsrs.ts` 的 `fsrsRetrievability`）。本文件只保留仍在使用的三件套：
 * Cepeda 15% 间隔规则、到期阈值常量、`clamp01`。
 *
 * 2026-09-18：删除已无任何生产调用的死代码 `calculateRetention` / `isReviewDue` /
 * `daysSince` / `DEFAULT_DECAY_FACTOR`（此前仅测试引用，易误导"ACT-R 仍在调度"）。
 *
 * 纯函数、无 IO，可单测。
 */

/** 到期判定默认保留率阈值：低于该值视为"即将跌落遗忘悬崖" */
export const DEFAULT_RETENTION_THRESHOLD = 0.7;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Cepeda 10%-20% 间隔规则：目标保留 T 天 → 复习间隔取中值 15%（下限 1 天）。
 * SM-2 式递增：intervalFactor（复习成功倍增）参与缩放，计算侧 clamp 上限 32×。
 */
export const MAX_INTERVAL_FACTOR = 32;

export function reviewIntervalDays(retentionTargetDays: number, intervalFactor = 1): number {
  if (!Number.isFinite(retentionTargetDays) || retentionTargetDays <= 0) return 1;
  const factor = Number.isFinite(intervalFactor) ? Math.min(Math.max(intervalFactor, 1), MAX_INTERVAL_FACTOR) : 1;
  return Math.max(1, Math.round(retentionTargetDays * 0.15 * factor));
}
