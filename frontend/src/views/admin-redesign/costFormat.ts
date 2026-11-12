/**
 * 成本金额格式化（2026-11-09 走查统一）：成本页三张表（按 Skill 成本明细 / 用户排行 / 模型排行）
 * 与「调用成本」KPI 卡共用同一精度，避免同一页里 2/4/6 位小数混排、每行重复 `≈ $` 前缀、
 * 小数点对不齐的乱象。
 *
 * 统一口径：非负且有限 → 固定 4 位小数（tabular-nums 下逐位对齐）；
 * 极小的非零金额（< 0.00005）显 `<0.0001` 而非 `0.0000`（不把「真花了钱但极少」读成零）；
 * 非数 / ≤0 → `0.0000`。
 * 货币单位与 `≈` 上提到表头（如「预估成本 (USD)」），单元格只放纯数字。
 */
export function formatUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '0.0000'
  if (v < 0.00005) return '<0.0001'
  return v.toFixed(4)
}

/**
 * Token 计数（2026-11-11 全站口径统一）：B/M/K 固定 1 位小数、K 用大写
 * （此前成本页写 `552.4K`、Trace 页写 `1.5k`，同站两种写法）。
 * 非正数 / 非有限 → `0`；< 1000 取整（Token 是整数计数，不出现 12.5）。
 */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

/**
 * 百分比（2026-11-11 全站口径统一）：默认 1 位小数，整数不带 `.0`
 * （`89.1%` / `95%` / `100%`）；非零但不足 1% 显 `<1%`，不写成 `0%` 冒充零。
 */
export function formatPct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p) || p <= 0) return '0%'
  if (p < 1) return '<1%'
  const rounded = Math.round(p * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`
}
