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
  if (!Array.isArray(value)) return [] as Array<{ role: string; content: string; at: string }>
  return value.map(asRecord).map((message) => ({
    role: normalized(message.role) === 'assistant' || normalized(message.role) === 'teacher' ? 'assistant' : 'user',
    content: firstText(message.content, message.text, message.message),
    /* 每条消息的原始时间戳（2026-11-11 用户「对话里看不到时间，只有内容」）：
       目标对话与课堂转录都要在气泡头显示发生时刻。`time` 是真实教学消息的实际字段
       （session-console 的 teaching.messages 只有 role/content/time），其余形态兜底。 */
    at: firstText(message.time, message.timestamp, message.createdAt)
  })).filter((message) => message.content)
}

/**
 * 课堂转录（带视觉产物）：与 `conversationMessages` 同口径，但保留 figures/diagrams。
 * 为什么单列一个函数：Goal 对话只需要 role/content；课堂转录要能把图渲染出来，
 * 否则运营在座舱里只能看到老师写「见图」，图本身不可见（2026-10-18 虚拟课堂带图验收）。
 */
export interface TranscriptMessage {
  role: string
  content: string
  /** 该消息的原始时间戳（`timestamp` 优先，退回 `createdAt`/`time`）；缺失为空串。
   *  与检查点合并成一条时间轴时用它排序——座舱里两者必须按课堂发生顺序交错，不能把检查点堆到末尾。 */
  at: string
  /* 载荷形状由后端 normalizeFigure/normalizeDiagram 决定；座舱只透传给渲染组件，不在这里重塑。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  figures: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diagrams: any[]
}

export function transcriptMessages(value: unknown): TranscriptMessage[] {
  if (!Array.isArray(value)) return []
  return value.map(asRecord).map((message) => {
    const rawFigures = Array.isArray(message.figures) ? message.figures : []
    const rawDiagrams = Array.isArray(message.diagrams) ? message.diagrams : []
    return {
      role: normalized(message.role) === 'assistant' || normalized(message.role) === 'teacher' ? 'assistant' : 'user',
      content: firstText(message.content, message.text, message.message),
      at: firstText(message.timestamp, message.createdAt, message.time),
      figures: rawFigures.map(asRecord).filter((figure) => firstText(figure.kind)),
      diagrams: rawDiagrams.map(asRecord).filter((diagram) => firstText(diagram.code))
    }
  }).filter((message) => message.content || message.figures.length || message.diagrams.length)
}

/** 时间戳 → 毫秒；解析不出返回 null（排到最后，而不是当第 0 秒插到最前）。 */
export function timeValue(value: unknown): number | null {
  const text = firstText(value)
  if (!text) return null
  const t = new Date(text).getTime()
  return Number.isNaN(t) ? null : t
}

export interface LearnTimelineEntry {
  kind: 'message' | 'checkpoint'
  key: string
  at: number | null
  seq: number
  message?: TranscriptMessage
  checkpoint?: CheckpointRecord
}

/**
 * 检查点记录（题目/判分/理解度）。结构化通道字段，真实模式来自会话控制台的
 * `teaching.checkpoints`，虚拟模式来自 teaching-detail 的 `state.checkpointHistory`。
 */
export interface CheckpointRecord {
  checkpointId?: string | null
  title?: string | null
  type?: string | null
  question?: string | null
  /** 选项文本（答案键不下发）：复核时对照 A/B/C/D 与学员所选 */
  options?: Array<{ id?: string | null; text?: string | null }> | null
  /** 学员选了哪些选项（新行 selectedOptionIds，存量行可能是 submittedOptionIds） */
  selectedOptionIds?: string[] | null
  passed?: boolean | null
  judgedBy?: string | null
  understanding?: number | null
  conceptName?: string | null
  submittedAt?: string | null
}

/**
 * 课堂时间轴：消息与检查点按发生时间交错。
 *
 * 为什么需要合并（2026-10-19 用户走查「这检查点怎么在下方，不符合课堂阅读顺序」）：
 * 检查点走结构化通道，题目**不进**聊天逐字稿（只在 `checkpointHistory`），早期实现把它们
 * 整块挂在转录末尾 —— 读者读到「再走一条」时，题面却在整节课之后，得来回翻。
 *
 * 排序规则（2026-11-11 用户「顺序对吗」修正）：检查点按**作答的那条学员消息**落位，
 * 而不是按 `submittedAt` 硬排。实测落库时间是该回合处理完才写（真实样本：学员 03:42:08
 * 作答、老师 03:42:28 讲评、检查点 03:42:34 才落库），硬按时间排会把「题目/判分」
 * 排到老师讲评之后，读起来像答完又被补了一道题。现在把它插回学员发言之后、讲评之前：
 * 学员答完 → 看到题与判分 → 再看老师怎么讲。没有前置学员发言时仍按自身时间排。
 */
export function mergeLearnTimeline(
  messages: TranscriptMessage[],
  checkpoints: CheckpointRecord[]
): LearnTimelineEntry[] {
  const entries: LearnTimelineEntry[] = []
  messages.forEach((message, index) => {
    entries.push({ kind: 'message', key: `m-${index}`, at: timeValue(message.at), seq: entries.length, message })
  })
  /** 学员发言（有时间的）：检查点归属到 submittedAt 之前最后一条 */
  const learnerTurns = entries.filter(
    (entry): entry is LearnTimelineEntry & { at: number } =>
      entry.kind === 'message' && entry.message?.role === 'user' && entry.at !== null
  )
  checkpoints.forEach((checkpoint, index) => {
    const submittedAt = timeValue(checkpoint.submittedAt)
    let at = submittedAt
    if (submittedAt !== null) {
      let anchor: LearnTimelineEntry & { at: number } | null = null
      for (const turn of learnerTurns) {
        if (turn.at <= submittedAt && (!anchor || turn.at >= anchor.at)) anchor = turn
      }
      if (anchor) at = anchor.at
    }
    entries.push({
      kind: 'checkpoint',
      key: `c-${index}-${firstText(checkpoint.checkpointId)}`,
      at,
      seq: entries.length,
      checkpoint
    })
  })
  const rank = (entry: LearnTimelineEntry) =>
    entry.kind === 'checkpoint' ? 1 : entry.message?.role === 'user' ? 0 : 2
  return entries.sort((a, b) => {
    if (a.at === null && b.at === null) return a.seq - b.seq
    if (a.at === null) return 1
    if (b.at === null) return -1
    if (a.at !== b.at) return a.at - b.at
    // 同一时刻：学员发言 → 检查点（作答与判分）→ 老师讲评
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return a.seq - b.seq
  })
}

/**
 * 全站时间口径：`YYYY-MM-DD HH:mm`（本地时区，24 小时制）。
 *
 * 为什么不用 `toLocaleString('zh-CN')`（2026-11-11 全站审计）：它输出
 * `2026/11/11 18:32:59`，与列表页 / 教学会话页的 `YYYY-MM-DD HH:mm` 同页并存时
 * 一屏两套日期格式；秒对运营读「几点开始」也不是必要信息（日志另有完整时间）。
 * 需要秒的场景在调用方自行补，不在共享格式化里分叉。
 */
export function formatTime(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

/**
 * 会话日志行的时间戳：与同页其它绝对时间同一口径 `YYYY-MM-DD HH:mm`。
 *
 * 历史（2026-11-01 外部评审 P2）：原先固定 `toLocaleTimeString` 只出 HH:MM:SS，
 * 跨天日志从上往下读会出现「23:13:27 之后变成 14:06:19」的时间倒流错觉；随后补成
 * 「今天只时分秒 / 非今天 MM-DD HH:MM:SS」，又与页头 `2026/11/11 18:32:59` 形成
 * 同页两套格式（2026-11-11 用户复核）。现在统一成全日期，今天与非今天不再分叉；
 * 秒不参与主口径，日志的排序仍由完整 ISO 承载（entry.at）。
 */
export function formatLogTime(value?: string | null) {
  return formatTime(value)
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
