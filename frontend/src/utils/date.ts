/**
 * 本地时区日期键工具（YYYY-MM-DD）。
 *
 * 拍板口径（2026-08-21 仪表盘修复 / 2026-09-18 收敛为公共工具）：
 * 凡「按天归组/按天比较」都必须用**本地日期**，不得用 `toISOString().slice(0, 10)`。
 * 后者是 UTC 切日：UTC+8 用户在 00:00–08:00 的学习会被记进「昨天」，
 * 与预算卡/趋势的服务端本地口径互相矛盾（曾导致：学习历史把刚上完的课归到「昨天」、
 * 学习状态当日时长柱与趋势日期对不上）。
 *
 * 新增按天归组逻辑请复用本文件，勿在各页面各写一份。
 */

/** Date → 本地日期键（YYYY-MM-DD） */
export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * ISO 时间戳 → 本地日期键；空值/非法值返回 ''（调用方按需跳过该条）。
 * 注意：不要对已经是「无时区日期串」（如 '2026-09-18'）的值使用本函数做二次转换，
 * 那种值本就没有时区语义，直接使用即可。
 */
export function localDateKeyFromIso(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : localDateKey(d);
}
