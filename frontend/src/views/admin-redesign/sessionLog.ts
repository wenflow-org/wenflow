/**
 * 会话日志格式化（ADMIN_DEEP_SESSION_AUDIT C1）：
 * 原始 JSON 直出 → 可读行（阶段徽章 + 摘要文本 + 耗时 + error 显眼标注），原文保留 details
 * 实测样本：{"timestamp":"...","phase":"virtual-reply","durationMs":25659,"details":{...}}
 */

export interface LogEntryView {
  /** 阶段/类型（virtual-reply / error / ...），无则空串 */
  phase: string
  /** 耗时文本（25.7s / 812ms / 2 分 08 秒），无则空串 */
  durationText: string
  /** 摘要文本（message/text/error/details.message 优先），无则空串 */
  text: string
  /** error 行：phase/type 或 level/severity 命中错误档，或 error===true / ok===false */
  isError: boolean
  /** 原文 JSON（无删减，details 折叠入口） */
  rawJson: string
}

const ERROR_PHASES = new Set(['error', 'err', 'failed', 'failure', 'exception'])
const ERROR_LEVELS = new Set(['error', 'critical', 'fatal'])

export function isErrorLog(entry: Record<string, unknown>): boolean {
  const phase = String(entry.phase || entry.type || '').toLowerCase()
  const level = String(entry.level || entry.severity || '').toLowerCase()
  return ERROR_PHASES.has(phase) || ERROR_LEVELS.has(level) || entry.error === true || entry.ok === false
}

/** 25659 → "25.7s"；<1s → "812ms"；≥1 分钟 → "2 分 08 秒"；非法值 → "" */
export function fmtDurationMs(ms: number | string | null | undefined): string {
  const value = typeof ms === 'string' ? Number(ms) : ms
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60000) return `${(value / 1000).toFixed(1)}s`
  const m = Math.floor(value / 60000)
  const s = Math.round((value % 60000) / 1000)
  return s > 0 ? `${m} 分 ${String(s).padStart(2, '0')} 秒` : `${m} 分钟`
}

const SUMMARY_KEYS = ['message', 'text', 'error', 'title', 'action', 'reason'] as const

/** 摘要文本：顶层 message/text/error/title/action 优先，其次 details 内同类键（含 details.output 一层）；
 *  type 已作阶段展示不重复 */
function summaryText(entry: Record<string, unknown>): string {
  for (const key of SUMMARY_KEYS) {
    const v = entry[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const details = entry.details
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const d = details as Record<string, unknown>
    for (const key of SUMMARY_KEYS) {
      const v = d[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    /* 虚拟会话日志把正文放在 details.output（simulation.learn-phase 的 message/reply 都在这一层）：
       不读它整行就只剩英文阶段徽章 + 「原文」JSON，主视觉位等于没有内容（2026-10-18 走查） */
    const out = d.output
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      const o = out as Record<string, unknown>
      for (const key of [...SUMMARY_KEYS, 'reply', 'userVisible', 'aiResponse', 'response'] as const) {
        const v = o[key]
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
    }
  }
  return ''
}

/** 虚拟会话日志阶段 → 中文（后端 SimulationLogEntry.phase 枚举；未命中回落原文，不猜词）。
 *  与真实模式的 timelineKindLabel（goal/path/teaching/evidence）分属两套枚举，不要混用。 */
const VIRTUAL_PHASE_ZH: Record<string, string> = {
  'virtual-reply': '学习者回复',
  'goal-response': '目标对话',
  'stage-transition': '阶段推进',
  'path-review': '路径复盘',
  'path-replan': '路径重排',
  'path-replan-completed': '路径重排完成',
  'path-replan-guard': '路径重排拦截',
  'path-regenerate': '路径重生成',
  'path-enrichment-not-ready': '路径内容未就绪',
  'teaching-reply': '课堂回复',
  'teaching-response': '课堂响应',
  'teaching-start': '课堂开始',
  'teaching-interrupted': '课堂中断',
  error: '错误'
}

export function virtualLogPhaseZh(phase: string): string {
  const raw = String(phase || '').trim()
  return VIRTUAL_PHASE_ZH[raw.toLowerCase()] || raw
}

export function parseLogEntry(entry: Record<string, unknown>): LogEntryView {
  const phase = String(entry.phase || entry.type || '').trim()
  let text = summaryText(entry)
  if (!text) {
    // 全字段兜底：无阶段时给整行 JSON 截断预览；有阶段时只显示阶段徽章
    if (!phase) {
      try {
        text = JSON.stringify(entry).slice(0, 160)
      } catch {
        text = ''
      }
    }
  }
  let rawJson = ''
  try {
    rawJson = JSON.stringify(entry, null, 2)
  } catch {
    rawJson = ''
  }
  return {
    phase,
    durationText: fmtDurationMs(entry.durationMs as number | string | null | undefined),
    text,
    isError: isErrorLog(entry),
    rawJson
  }
}
