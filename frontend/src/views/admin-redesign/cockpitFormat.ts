/**
 * 会话座舱纯格式化函数组（SessionCockpit.vue 拆分）：
 * 无响应式依赖的值归一 / 文本提取 / 时间与标签格式化，供 SFC 与同域子模块共用
 */
import { BarChart3, BookOpen, Brain, ClipboardList, Lightbulb } from 'lucide-vue-next'

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

export function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function boolValue(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

export function conversationMessages(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ role: string; content: string }>
  return value.map(asRecord).map((message) => ({
    role: normalized(message.role) === 'assistant' || normalized(message.role) === 'teacher' ? 'assistant' : 'user',
    content: firstText(message.content, message.text, message.message)
  })).filter((message) => message.content)
}

export function formatTime(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 路径截止日展示视图（M-7，2026-10-29 夜审；纯函数便于单测）。
 * 同一结构化 deadline 的 deadlineText 原文在库里并存互相矛盾的版本（「约三个月」vs
 * 「约 15 个月」，LLM 生成时落库的原样透传），座舱按原文渲染会让同一日期配出相差 5 倍的
 * 相对时长。展示改为优先结构化 deadline 的格式化日期（本地时区 YYYY-MM-DD），原文降级
 * 进 title 悬停；结构化缺失（无值/不可解析）时回退原文展示。
 * 结构化 deadline 两种落库形态都收：epoch 毫秒数 / 数值串，以及 ISO 日期串。
 */
export function pathDeadlineView(rawDeadline: unknown, deadlineText: unknown): { dateText: string; text: string } {
  const text = firstText(deadlineText)
  const ms = typeof rawDeadline === 'number'
    ? rawDeadline
    : typeof rawDeadline === 'string'
      ? (/^\d+$/.test(rawDeadline.trim()) ? Number(rawDeadline.trim()) : Date.parse(rawDeadline))
      : NaN
  const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : null
  const dateText = date && !Number.isNaN(date.getTime())
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : ''
  return { dateText, text }
}

export function stageLabel(st: string) {
  return {
    goal: '目标',
    path: '路径',
    learning: '学习',
    wrapup: '总结'
  }[st] || st
}

/**
 * Wrapup 卡片图标映射（2026-10-14 撤 emoji：主题摘要 / 知识总结 / 练习建议 / 学习评估
 * 四张卡原先各挂一个 emoji 图标）。
 *
 * 替代物按 AchIcon 的**终态**做法走：色块 + lucide 线性图标。AchIcon 的注释记着两段判例——
 * 2026-09-14 先去 emoji 改「色块 + 首字标」，2026-10-08 又收到「logo 图没了，怎么成字体了」
 * 的反馈，于是把字标换回真图标。所以这里直接给组件，不再绕「首字标」那一版。
 */
export function wrapupCardIcon(label: string): unknown {
  const map: Record<string, unknown> = {
    '主题摘要': BookOpen,
    '知识总结': Brain,
    '练习建议': Lightbulb,
    '学习评估': BarChart3,
  }
  return map[label] || ClipboardList
}
