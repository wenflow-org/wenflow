/**
 * Admin 零数据呈现规范
 *
 * 背景：新平台 / 低流量时段大量指标分母为 0。
 * 0 次调用时的「成功率 100%」「异常率 100%（共 1 次调用）」
 * 既不是好消息也不是坏消息——是「无数据」。
 *
 * 规范：
 * 1. 分母为 0 的比率一律显示 —，不着语义色（不红不绿）
 * 2. 样本量 < MIN_RATE_SAMPLE 的比率降权显示（弱化，不做警报依据）
 * 3. 均值/耗时类指标在无样本时同样显示 —
 */

export const NO_DATA_TEXT = '—'

/** 比率可作为判断依据的最小样本量 */
export const MIN_RATE_SAMPLE = 5

/** 是否有有效样本 */
export const hasSample = (count?: number | null): boolean => Number(count || 0) > 0

/**
 * 比率文本：无样本或数值缺失时返回 —
 * @param sampleCount 分母（如调用次数）
 * @param percent 已换算为 0-100 的比率值
 */
export function rateText(sampleCount: number | null | undefined, percent: number | null | undefined): string {
  if (!hasSample(sampleCount) || percent == null || !Number.isFinite(Number(percent))) return NO_DATA_TEXT
  return `${Number(percent)}%`
}

/** 比率是否有统计意义（样本量达标） */
export function rateReliable(sampleCount: number | null | undefined): boolean {
  return Number(sampleCount || 0) >= MIN_RATE_SAMPLE
}

/**
 * 比率着色的 class 名：
 * 无样本 → 'rate--na'（灰）；样本不足 → 原 class + ' rate--muted'（降权）
 */
export function rateClass(sampleCount: number | null | undefined, semanticClass: string): string {
  if (!hasSample(sampleCount)) return 'rate--na'
  return rateReliable(sampleCount) ? semanticClass : `${semanticClass} rate--muted`
}

/** 均值/耗时文本：无样本时返回 — */
export function avgText(sampleCount: number | null | undefined, formatted: string): string {
  return hasSample(sampleCount) ? formatted : NO_DATA_TEXT
}
