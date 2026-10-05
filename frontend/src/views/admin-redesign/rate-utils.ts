/**
 * 成功率口径单点（评审「跨页七律 3」阈值私有 / P1#26 精度抹失败）：
 * Skills / SkillDetail / PromptEval（TcRankTable 的 failRate 可复用）共用同一套
 * 「阈值 + 精度 + 兜底」——此前四页四套阈值（Skills <70红/<90琥珀、SkillDetail <95 即 warn、
 * PromptEval 90/60 两档、passTone「全过=ok 否则 warn」两档）互相对不上，
 * 且 toFixed(0) 把 99.9% 四舍五入成 100%，失败被显示抹掉。
 *
 * 收敛后的唯一口径（2026-10 拍板，四页 title 披露同一句话）：
 * - 阈值：< RATE_BAD_BELOW% 红（bad）/ < RATE_WARN_BELOW% 琥珀（warn）/ 其余正常（ok）
 * - 精度：固定 1 位小数（99.9% 显示 99.9%，不再被抹成 100%）
 * - 兜底：无分母（calls=0 / passRate 缺失）→ null，调用方渲染「—」并给「暂无数据」类 title，
 *   绝不显示「0% 通过」把「没数据」伪装成「全部失败」
 * 纯函数、无 Vue 依赖，可被任意页面/表格直接复用。
 */

/** 红档阈值：成功率低于该值着红 */
export const RATE_BAD_BELOW = 90
/** 琥珀档阈值：成功率低于该值（但 ≥ 红档）着琥珀 */
export const RATE_WARN_BELOW = 97
/** 显示精度：固定 1 位小数（P1#26：toFixed(0) 会把 99.9% 抹成 100%） */
export const RATE_DECIMALS = 1

/** 阈值披露文案（各着色处 title 拼接用：着色必须带条件阈值且 title 披露） */
export const RATE_THRESHOLD_NOTE = `成功率着色阈值：<${RATE_BAD_BELOW}% 红 / <${RATE_WARN_BELOW}% 琥珀 / 其余正常；保留 ${RATE_DECIMALS} 位小数`

export type RateTone = 'ok' | 'warn' | 'bad' | 'muted'

/** 已知比率（0-100）→ tone；null/undefined/非有限数 = 无数据 → muted */
export function rateToneOf(rate: number | null | undefined): RateTone {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 'muted'
  if (rate < RATE_BAD_BELOW) return 'bad'
  if (rate < RATE_WARN_BELOW) return 'warn'
  return 'ok'
}

/** calls/errors → 0-100 比率（原始精度，显示精度交 formatRate）；无分母 → null */
export function successRateOf(calls: number, errors: number): number | null {
  if (!calls || calls <= 0) return null
  const rate = ((calls - errors) / calls) * 100
  return Math.max(0, Math.min(100, rate))
}

/** 0-100 比率 → 显示文案：固定 1 位小数，整值省略「.0」（92 → 92%、99.9 → 99.9%）；无数据 → null */
export function formatRate(rate: number | null | undefined): string | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null
  const fixed = rate.toFixed(RATE_DECIMALS)
  return fixed.endsWith('.0') ? `${fixed.slice(0, -2)}%` : `${fixed}%`
}

/** calls/errors → 显示文案（1 位小数 + %）；无分母 → null（调用方显「—」，不得显 0%） */
export function successRateText(calls: number, errors: number): string | null {
  const rate = successRateOf(calls, errors)
  return rate == null ? null : formatRate(rate)
}

/** calls/errors → tone（无分母 → muted） */
export function successRateTone(calls: number, errors: number): RateTone {
  return rateToneOf(successRateOf(calls, errors))
}

/**
 * tone → 页面本地 CSS 类。各页类名前缀不同（sk-rate--bad / pe-result--bad /
 * mk-status__meta--bad / is-bad…），本 util 只产 tone、类名映射留在页面；
 * ok / muted 返回 ''（正常与无数据不着色，避免满屏彩灯稀释真异常）。
 */
export function rateToneClass(tone: RateTone, prefix: string): string {
  return tone === 'ok' || tone === 'muted' ? '' : `${prefix}--${tone}`
}
