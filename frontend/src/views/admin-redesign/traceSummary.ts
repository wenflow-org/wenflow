/**
 * 裁判旁路诊断轨迹键值摘要（ADMIN_DEEP_SESSION_AUDIT C3）：
 * 800 字符截断 JSON → 阶段/状态/关键指标行（label:value），原文 JSON 保留在行内 details
 */

export interface TraceKeyValue {
  label: string
  value: string
}

/** 优先抽取键（后端诊断对象常见字段） */
const KEY_LABELS: Array<[string, string]> = [
  ['phase', '阶段'],
  ['stage', '阶段'],
  ['status', '状态'],
  ['decision', '决策'],
  ['verdict', '结论'],
  ['score', '得分'],
  ['round', '轮次'],
  ['attempt', '尝试'],
  ['step', '步骤'],
  ['action', '动作'],
  ['reason', '原因'],
  ['error', '错误'],
  ['message', '信息'],
  ['model', '模型'],
  ['provider', '提供方'],
  ['budgetExhausted', '预算耗尽'],
  ['retries', '重试次数'],
  ['durationMs', '耗时'],
  ['traceId', 'traceId'],
  ['requestId', 'requestId']
]

function scalarText(value: unknown, max = 80): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim().slice(0, max)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const t = JSON.stringify(value)
    return t.length > max ? `${t.slice(0, max)}…` : t
  } catch {
    return ''
  }
}

/**
 * 诊断对象 → 键值行：优先命中 KEY_LABELS（中文标签），再补足未命中的顶层标量键（最多共 6 行）
 */
export function traceSummaryRows(diagnostic: Record<string, unknown> | null | undefined): TraceKeyValue[] {
  if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return []
  const rows: TraceKeyValue[] = []
  const seen = new Set<string>()
  const usedLabels = new Set<string>()
  for (const [key, label] of KEY_LABELS) {
    if (seen.has(key) || usedLabels.has(label) || !(key in diagnostic)) continue
    const text = scalarText(diagnostic[key])
    if (!text) continue
    seen.add(key)
    usedLabels.add(label)
    rows.push({ label, value: text })
  }
  if (rows.length < 6) {
    for (const [key, value] of Object.entries(diagnostic)) {
      if (seen.has(key) || rows.length >= 6) continue
      const text = scalarText(value)
      if (!text) continue
      seen.add(key)
      rows.push({ label: key, value: text })
    }
  }
  return rows
}

/** 原文 JSON（无截断，details 入口） */
export function traceRawJson(diagnostic: Record<string, unknown> | null | undefined): string {
  if (!diagnostic) return ''
  try {
    return JSON.stringify(diagnostic, null, 2)
  } catch {
    return ''
  }
}
