/**
 * 终局评估分数可视化（ADMIN_DEEP_SESSION_AUDIT C2/C3）：
 * 0-1 小数原样直出 → 百分比 + 档位色阶（≥0.8 ok / ≥0.6 warn / 其余 bad），维度 chip 配迷你条
 */

export type ScoreTone = 'ok' | 'warn' | 'bad' | 'muted'

/** 兼容 0-1 小数与 0-100 整数两种后端口径 */
function normalized(v: number): number {
  return v > 1 ? v / 100 : v
}

/** 0.85 → "85%"；空值/非法 → "—" */
export function scoreToPct(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${Math.round(normalized(v) * 100)}%`
}

/** 条宽百分比（0-100 钳制）；空值 → 0 */
export function scoreFillPct(v: number | null | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(normalized(v) * 100)))
}

/** 档位：≥80 ok / ≥60 warn / 其余 bad；空值 muted */
export function scoreTone(v: number | null | undefined): ScoreTone {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'muted'
  const n = normalized(v)
  if (n >= 0.8) return 'ok'
  if (n >= 0.6) return 'warn'
  return 'bad'
}

/** mk-badge 档位类 */
export function scoreBadgeCls(v: number | null | undefined): string {
  return {
    ok: 'mk-badge--ok',
    warn: 'mk-badge--warn',
    bad: 'mk-badge--bad',
    muted: 'mk-badge--muted'
  }[scoreTone(v)]
}
