/**
 * 绝对日期归一化（P0.1，TIME-TRUST-SCHEME-20261001）。
 *
 * 独立小模块：goal-conversation.service / path.coordinator / path-planning-hints /
 * goal-path-visible-summary 四处共用；不与 visible-summary 同文件的原因是——
 * 大量既有单测对 goal-path-visible-summary 做整模块 mock（只给 buildGoalPathVisibleSummary），
 * 同文件新增导出会把真实现一起 mock 掉。
 */
export function normalizeDeadlineDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  // 合法日历日校验：ISO 严格解析 + 往返一致（拦 2026-02-30 这类不存在的日期）
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  const roundTrip = Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  return roundTrip === `${y}-${m}-${d}` ? roundTrip : null;
}
