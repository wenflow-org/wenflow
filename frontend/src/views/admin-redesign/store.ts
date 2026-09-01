/**
 * Admin 重设计实验室：共享数据仓库
 *
 * 核心概念：一条事故线贯穿全站。
 * - 所有页面读同一份 span 数据（执行日志 / 事件中心 / Skill / 总览看到的
 *   是同一次 429 爆发的不同切面）
 * - intent 驱动跨页排查动线：总览事故卡 → 已过滤的日志 → Trace 瀑布 → Skill 抽屉
 */
import { computed, reactive, ref } from 'vue'

/* ---------- 数据源：真实（演示模式已移除，恒 live；类型保留历史联合以兼容 live.ts 遗留 backToDemo） ---------- */
export const dataSource = ref<'demo' | 'live'>('live')
/** 数据源是否为真实模式（历史兼容导出，恒为 true） */
export const isLive = computed(() => dataSource.value === 'live')
export const liveSpans = ref<TraceSpan[] | null>(null)
export const liveSkillStatsMap = ref<Record<string, SkillStat> | null>(null)
export const liveOverview = ref<{ tone: 'ok' | 'warn' | 'bad' | 'muted'; score: number | null; headline: string; subline: string } | null>(null)

/* ---------- Trace Span（全站最小事实单元） ---------- */
export interface TraceSpan {
  id: string
  traceId: string
  kind: 'flow' | 'call'
  agent: string
  stage: string
  title: string
  /** 该 trace 内相对起点偏移 ms（自起点 0 计） */
  startMs: number
  durationMs: number
  status: 'ok' | 'warn' | 'err'
  detail: string
  payload?: string
  /** 绝对时间戳（live 日志行） */
  ts?: number
  /** live 扩展字段：执行层/模型/状态码/重试/错误码 */
  execLayer?: string
  model?: string
  statusCode?: number
  attempts?: number
  maxAttempts?: number
  recoveredByRetry?: boolean
  errorCategory?: string
  errorCode?: string
  errorMessage?: string
  /** 合并的网关行耗时（同一次调用的 api-gateway 记录） */
  gatewayDurMs?: number
  /** 业务会话 ID（教学/目标对话等业务链路，用于会话归组） */
  sessionId?: string
  /** agent_call_logs 传输层 token 统计（无数据 = 未统计） */
  promptTokens?: number | null
  completionTokens?: number | null
}

/* demo 链路数据已移除 — 数据源恒为 live，从后端拉取 */
export const spans = computed<TraceSpan[]>(() => {
  // live：严格按 ref 是否已写入判断（空数组也算已就绪）
  return liveSpans.value ?? []
})

/* ---------- 身份色（拓扑 / 编排 / 抽屉 / 设计页共用，单源） ---------- */
/** 各顶层 Agent 的身份色；key = Agent id。历史重复定义（SkillDesignPage/SkillDrawer 内嵌）已收敛至此 */
export const AGENT_TONES: Record<string, { hue: string; soft: string }> = {
  'goal-agent': { hue: '#4f46e5', soft: 'rgba(79, 70, 229, 0.1)' },
  'path-agent': { hue: '#0d9488', soft: 'rgba(13, 148, 136, 0.1)' },
  'teaching-agent': { hue: '#3478f6', soft: 'rgba(52, 120, 246, 0.1)' },
  'profile-agent': { hue: '#d97706', soft: 'rgba(217, 119, 6, 0.1)' },
  'simulation-agent': { hue: '#7c3aed', soft: 'rgba(124, 58, 237, 0.1)' }
}

export interface SkillStat {
  calls: number
  errors: number
  avgMs: number
  lastAt: string
}

export function skillStatOf(skillId: string): SkillStat {
  // 真实数据模式：直接用注册表统计
  if (dataSource.value === 'live' && liveSkillStatsMap.value?.[skillId]) {
    return liveSkillStatsMap.value[skillId]
  }
  const mine = spans.value.filter((s) => s.kind === 'call' && s.agent === skillId)
  const errors = mine.filter((s) => s.status === 'err').length
  const avgMs = mine.length ? Math.round(mine.reduce((a, s) => a + s.durationMs, 0) / mine.length) : 0
  return {
    calls: mine.length,
    errors,
    avgMs,
    lastAt: mine.length ? '刚刚' : '从未'
  }
}

export function recentSpansOf(skillId: string, limit = 5): TraceSpan[] {
  return spans.value.filter((s) => s.agent === skillId).slice(0, limit)
}

/* ---------- 排查意图（跨页动线） ---------- */
export interface InvestigationIntent {
  scene: string
  agentFilter: string
  statusFilter: string
  traceId: string
  skillDrawerId: string
  /** 业务会话 ID（跳瀑布时优先进入会话分组视图） */
  sessionId: string
  /** 页面级快捷动作（命令面板「新建用户」等直达并触发页面动作） */
  quickAction: string
  /** 失败归因/异常流跳转：执行日志错误类别筛选（'' = 不过滤） */
  errorCategory: string
  /** 执行日志时间范围快捷筛选（'' = 页面默认） */
  timeRange: string
}

export const intent = reactive<InvestigationIntent>({
  scene: 'overview',
  agentFilter: '',
  statusFilter: '',
  traceId: '',
  skillDrawerId: '',
  sessionId: '',
  quickAction: '',
  errorCategory: '',
  timeRange: ''
})

/** 命令面板 → 页面快捷动作（如打开新建弹窗），页面消费后需清空 */
export function queueQuickAction(sceneId: string, action: string) {
  intent.quickAction = action
  intent.scene = sceneId
}

/** 总览事故卡 → 执行日志（已过滤该节点 + 失败） */
export function investigateAgent(agentId: string) {
  intent.agentFilter = agentId
  intent.statusFilter = 'err'
  intent.traceId = ''
  intent.errorCategory = ''
  intent.timeRange = ''
  intent.scene = 'execution-logs'
}

/** 任意位置点 Trace → 独立 Trace 瀑布页（预填该链路） */
export function openTrace(traceId: string) {
  intent.traceId = traceId
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.scene = 'trace-waterfall'
}

/** 任意位置点会话 → Trace 瀑布页（优先会话分组视图） */
export function openSession(sessionId: string) {
  intent.traceId = ''
  intent.sessionId = sessionId
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.scene = 'trace-waterfall'
}

/** 打开 Skill 详情抽屉（不切换场景） */
export function openSkillDrawer(skillId: string) {
  intent.skillDrawerId = skillId
}

export function closeSkillDrawer() {
  intent.skillDrawerId = ''
}

export function clearInvestigation() {
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceId = ''
  intent.sessionId = ''
  intent.errorCategory = ''
  intent.timeRange = ''
}

/* ---------- 二级页面（drill-in） ---------- */
export type SubPageView = 'learner' | 'virtual' | 'user' | 'session' | 'session-real'

/** 来源记忆：从二级（画像）进三级（会话）后，返回时回到来源页而非直接回一级列表 */
export interface SubPageFrom {
  view: SubPageView
  id: string
  label?: string
}

export const subPage = ref<{ view: SubPageView; id: string; label?: string; includeTest?: boolean; from?: SubPageFrom } | null>(null)

export function openSubPage(view: SubPageView, id: string, opts?: { includeTest?: boolean; from?: SubPageFrom }) {
  const base = opts?.includeTest ? { view, id, includeTest: true } : { view, id }
  // 从二级（virtual/learner）进三级（session）时记忆来源，返回时回到该页
  if ((view === 'session' || view === 'session-real') && opts?.from) {
    subPage.value = { ...base, from: opts.from }
  } else {
    subPage.value = base
  }
}

/** 二级页加载出名称后回写（面包屑显示中文名/短标识；未设置时回退 ID 截断） */
export function setSubPageLabel(label: string) {
  if (subPage.value && label) subPage.value = { ...subPage.value, label }
}

export function closeSubPage() {
  // 有来源记忆（从二级进三级）→ 返回来源页；否则回一级列表
  if (subPage.value?.from) {
    const { view, id, label } = subPage.value.from
    subPage.value = { view, id, ...(label ? { label } : {}) }
  } else {
    subPage.value = null
  }
}

/* ---------- 总览推导 ---------- */
export const overviewHealth = computed(() => {
  // 真实数据模式：用后端统计推导
  if (liveOverview.value) return liveOverview.value
  const errs = spans.value.filter((s) => s.status === 'err').length
  if (errs > 0) return { tone: 'warn' as const, score: 61, headline: `需要关注：${errs} 次失败`, subline: '教学链路连续 429 限流，伴学已降级介入。' }
  return { tone: 'ok' as const, score: 92, headline: '运行平稳', subline: '学习链路与模型服务都在正常区间。' }
})

/* ================= 页面数据缓存新鲜度（避免切 tab 重复拉取） ================= */
const pageFetchedAt = new Map<string, number>()
/** 页面数据在 ttl 内视为新鲜（无需重拉） */
export function isPageCacheFresh(key: string, ttlMs = 60_000): boolean {
  const at = pageFetchedAt.get(key)
  return typeof at === 'number' && Date.now() - at < ttlMs
}
/** 标记页面数据已拉取 */
export function markPageFetched(key: string) {
  pageFetchedAt.set(key, Date.now())
}
