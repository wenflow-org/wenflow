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
  /** 来源入口（platform / system-canary / simulation / admin / user）；连通性测试 = system-canary */
  sourceEntry?: string
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
/** 各顶层 Agent 的身份色；key = Agent id。历史重复定义（Skill 详情页/SkillDrawer 内嵌）已收敛至此 */
export const AGENT_TONES: Record<string, { hue: string; soft: string }> = {
  'goal-agent': { hue: '#4f46e5', soft: 'rgba(79, 70, 229, 0.1)' },
  'path-agent': { hue: '#0d9488', soft: 'rgba(13, 148, 136, 0.1)' },
  'teaching-agent': { hue: '#2f6ae0', soft: 'rgba(47, 106, 224, 0.1)' },
  'profile-agent': { hue: '#d97706', soft: 'rgba(217, 119, 6, 0.1)' },
  'simulation-agent': { hue: '#7c3aed', soft: 'rgba(124, 58, 237, 0.1)' }
}

export interface SkillStat {
  calls: number
  errors: number
  avgMs: number
  /** 相对时间（列表展示用：刚刚 / 2 天前 / 从未） */
  lastAt: string
  /** 原始调用时间（排序用：相对时间串不可比较大小） */
  lastCalledAt?: string
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
  /** 业务会话 ID（跳瀑布时优先进入会话分组视图） */
  sessionId: string
  /** 页面级快捷动作（intent 直达并触发页面动作，如新建用户/公告） */
  quickAction: string
  /** 失败归因/异常流跳转：执行日志错误类别筛选（'' = 不过滤） */
  errorCategory: string
  /** 执行日志时间范围快捷筛选（'' = 页面默认） */
  timeRange: string
  /** 跳转执行日志后聚焦 Trace tab（openTrace/openSession 深链标志） */
  traceFocus: boolean
  /** 合并宿主页 tab 深链（people/sessions/messages/execution-logs 等页面内 tab），页面消费后清空 */
  tab: string
}

export const intent = reactive<InvestigationIntent>({
  scene: 'overview',
  agentFilter: '',
  statusFilter: '',
  traceId: '',
  sessionId: '',
  quickAction: '',
  errorCategory: '',
  timeRange: '',
  traceFocus: false,
  tab: ''
})

/** 总览事故卡 → 执行日志（已过滤该节点 + 失败 + 近 7 天）。
    时间窗必须显式给：执行日志默认窗是「今天」，而事故卡的口径是「近 7 天 · 200 条采样」，
    只带 agent+status 落过去会得到一页空态（2026-10-13 走查 F4 实测）。 */
export function investigateAgent(agentId: string) {
  intent.agentFilter = agentId
  intent.statusFilter = 'err'
  intent.traceId = ''
  intent.sessionId = ''
  intent.traceFocus = false
  intent.errorCategory = ''
  intent.timeRange = 'week'
  intent.tab = ''
  intent.scene = 'execution-logs'
}

/** 总览状态条结论（今日失败 / 今日成功率）→ 执行日志（级别=失败 + 今天）。
    结论讲的是「今日」，动作就按今日落；与 investigateAgent（近 7 天事故卡）各对齐自己的口径。 */
export function investigateTodayFailures() {
  intent.agentFilter = ''
  intent.statusFilter = 'err'
  intent.traceId = ''
  intent.sessionId = ''
  intent.traceFocus = false
  intent.errorCategory = ''
  intent.timeRange = 'today'
  intent.tab = ''
  intent.scene = 'execution-logs'
}

/** 总览状态条结论行的动作归属（纯函数，便于单测）：
    结论讲调用（「需要关注」/旧文案里的今日失败、今日成功率）→ 去执行日志排查；
    其余（运行平稳 / 空闲 / 未就绪）→ 健康中心入口。 */
export function statusActionOf(headline: string): 'investigate-today' | 'health' {
  return /需要关注|今日失败|今日成功率/.test(headline || '') ? 'investigate-today' : 'health'
}

/**
 * 总览状态条结论文案合成（纯函数，便于单测；M-1，2026-10-29 夜审）。
 * base = live 头部结论（运行平稳 / 系统空闲 / 需要关注…），reasons = 健康检查与仿真
 * 子项事实（「1 项异常」「2 项需关注」「仿真需关注」）。此前直接拼 `${base}（${reasons}）`，
 * 会产出「运行平稳（1 项异常）」——取色跟 error 级事实走（红点），措辞却还是「平稳」，
 * 同屏再摆几条红色待办就是三个互相打架的结论。
 * 规则：hasErrorFact（健康检查 error / 仿真 bad / error 级待办任一在场）时，平稳/空闲类
 * 措辞一律改口「需要关注」；仅 warn 档事实保留 base 只括注数量（2026-10-24 行为不变）；
 * base 已是「需要关注」时不重复括注。
 */
export function mergeStatusHeadline(input: { base: string; reasons: string[]; hasErrorFact: boolean }): string {
  const { base, reasons, hasErrorFact } = input
  if (!base || base.includes('需要关注')) return base
  if (!reasons.length) return hasErrorFact ? '需要关注' : base
  const calm = /平稳|空闲|暂无/.test(base)
  const head = hasErrorFact && calm ? '需要关注' : base
  return `${head}（${reasons.join(' · ')}）`
}

/** 任意位置点 Trace → 执行日志页的 Trace tab（预填该链路） */
export function openTrace(traceId: string) {
  intent.traceId = traceId
  intent.sessionId = ''
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceFocus = true
  intent.scene = 'execution-logs'
}

/** 任意位置点会话 → 执行日志页的 Trace tab（优先会话分组视图） */
export function openSession(sessionId: string) {
  intent.traceId = ''
  intent.sessionId = sessionId
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceFocus = true
  intent.scene = 'execution-logs'
}

/** 打开 Skill 详情（原型 open-skill → go("skill") 跳页；保留旧名作兼容入口，
 *  执行日志/链路水印/插件/健康中心四个消费方零改动获得二级页交互） */
export function openSkillDrawer(skillId: string) {
  openSubPage('skill', skillId)
}

export function clearInvestigation() {
  intent.agentFilter = ''
  intent.statusFilter = ''
  intent.traceId = ''
  intent.sessionId = ''
  intent.errorCategory = ''
  intent.timeRange = ''
}

/**
 * 排查动线的 URL 筛选参数（P0 动线修复）：AdminConsole 按 intent.scene 跳转时合并进
 * query，执行日志的「已过滤故障视图」从此可刷新/分享/前进后退还原。
 * ExecLogs 侧做 URL↔筛选双向同步（全量快照语义：query 缺省参数 = 该项默认值）。
 */
export function intentQueryParams(scene: string): Record<string, string> {
  if (scene !== 'execution-logs') return {}
  const q: Record<string, string> = {}
  if (intent.agentFilter) q.agent = intent.agentFilter
  if (intent.statusFilter) q.status = intent.statusFilter
  if (intent.errorCategory) q.cat = intent.errorCategory
  if (intent.timeRange) q.range = intent.timeRange
  return q
}

/* ---------- 二级页面（drill-in） ---------- */
export type SubPageView = 'learner' | 'virtual' | 'user' | 'session' | 'session-real' | 'path' | 'skill' | 'card' | 'card-import'

/** 会话座舱的落点页签（2026-10-12 走查拍板：路径不再有独立详情页，统一在座舱的阶段页签打开；
 *  从学习路径列表进来 = 打开座舱并落在 Path 页签）。只对 session/session-real 有意义；
 *  path 视图是深链适配层，解析出对话后原样带走。 */
export type SubPageStage = 'goal' | 'path' | 'learning' | 'wrapup'
const SUBPAGE_STAGES: ReadonlySet<string> = new Set(['goal', 'path', 'learning', 'wrapup'])
/** 旧深链/后端枚举别名：teaching 是后端阶段名，summary 是终局总结旧名 */
const SUBPAGE_STAGE_ALIAS: Record<string, SubPageStage> = {
  teaching: 'learning',
  teach: 'learning',
  learn: 'learning',
  summary: 'wrapup',
}
export function asSubPageStage(v: unknown): SubPageStage | undefined {
  if (typeof v !== 'string') return undefined
  if (SUBPAGE_STAGES.has(v)) return v as SubPageStage
  return SUBPAGE_STAGE_ALIAS[v]
}

/** 详情内部页签落点：只对 learner 详情有意义（页签 id 见 LearnerDetail 的 LD_TAB_IDS）。
 *  二级页页面内的 ?tab= 归详情组件自己读写（P0-2 页签路由化），这里只带一个「落哪」的提示，
 *  AdminConsole 打开二级页时并进 URL，刷新/深链保持落点。 */
export type SubPageTab = string

/** 列表行 → 学习者详情的落点页签（2026-10-18 用户走查：「学习状态」条目落「概览」不匹配列表主题）：
 *  · 学习状态列表（LearnerCenter）的读数列——趋势 / 疲劳 / 置信 / 风险摘要——与详情「证据」
 *    页签同源同口径（趋势与建议 / 学习压力记录 / 预测校准 / 概念证据密度）；
 *  · 记忆与复习列表（MemoryReviewOverview）与详情「记忆与复习」页签同名同口径（同为 FSRS 普查）。
 *  落点只此一处定义——改映射改这里一行；传空的调用方（画像 / 会话列表下钻）仍落概览。 */
export const LEARNER_DETAIL_LANDING = { learnerState: 'evidence', memoryReview: 'memory' } as const

/** 来源记忆：从二级（画像）进三级（会话）后，返回时回到来源页而非直接回一级列表。
 *  2026-10-18：来源页的落点（stage/tab）也要记住——从座舱 Path 页签点「查看学习者」，
 *  返回时若丢掉 stage 会落回会话默认页签，读的上下文没了。 */
export interface SubPageFrom {
  view: SubPageView
  id: string
  label?: string
  stage?: SubPageStage
  tab?: SubPageTab
  /** 来源链（2026-10-24）：二级 → 三级 → 四级逐层记住上一跳。
   *  此前只存一层，从画像进座舱再进真实课堂会话时，返回与面包屑都会丢掉画像/列表。 */
  parent?: SubPageFrom
}

export const subPage = ref<{ view: SubPageView; id: string; label?: string; includeTest?: boolean; stage?: SubPageStage; tab?: SubPageTab; from?: SubPageFrom } | null>(null)

export function openSubPage(view: SubPageView, id: string, opts?: { includeTest?: boolean; stage?: SubPageStage; tab?: SubPageTab; from?: SubPageFrom; label?: string }) {
  const base: { view: SubPageView; id: string; label?: string; includeTest?: boolean; stage?: SubPageStage; tab?: SubPageTab } =
    opts?.includeTest ? { view, id, includeTest: true } : { view, id }
  /* 语义 id（如 card-import 的 'new'）不该直出面包屑：入口可用 label 覆盖显示名
     （2026-10-31 二轮评审 P2：学习者卡库 / new → 导入卡）。 */
  if (opts?.label) base.label = opts.label
  if (opts?.stage) base.stage = opts.stage
  if (opts?.tab) base.tab = opts.tab
  /* 来源记忆：二级页 → 三级页都可记来源，返回时回原页（不限 session）。
     原先只对 session/session-real 生效，于是「学习者详情 → 路径详情」返回时 from 被
     静默丢弃，直接落回一级列表，原详情与页签上下文全丢（2026-10-08 走查确认）。 */
  if (opts?.from) {
    /* 叠链：仅当 from 描述的就是「当前页」时，才把当前页的来源挂成 parent。
       例：列表 → 画像（from=列表）→ 学习详情（from=画像, parent=列表）→ 座舱（三级链）。
       传的是祖先页（如 PathDetail 把 learner 的 from 原样带下去）时不叠——否则同一条来源
       会被复制成 parent，返回键会多退一层。 */
    const cur = subPage.value
    const fromIsCurrent = !!cur && opts.from.view === cur.view && opts.from.id === cur.id
    const prev = fromIsCurrent ? cur?.from : null
    subPage.value = { ...base, from: prev ? { ...opts.from, parent: prev } : opts.from }
  } else {
    subPage.value = base
  }
}

/** 二级页加载出名称后回写（面包屑显示中文名/短标识；未设置时回退 ID 截断） */
export function setSubPageLabel(label: string) {
  if (subPage.value && label) subPage.value = { ...subPage.value, label }
}

export function closeSubPage() {
  // 有来源记忆（从二级进三级）→ 返回来源页；来源本身还有 parent 时继续保留链路（逐层回退）
  if (subPage.value?.from) {
    const { view, id, label, stage, tab, parent } = subPage.value.from
    subPage.value = {
      view, id,
      ...(label ? { label } : {}),
      ...(stage ? { stage } : {}),
      ...(tab ? { tab } : {}),
      ...(parent ? { from: parent } : {})
    }
  } else {
    subPage.value = null
  }
}

/* ---------- 总览推导 ---------- */
export const overviewHealth = computed(() => {
  // 只信真实数据：live 总览未就绪（首载中 / 后端拉取失败保留旧值）时如实显示空态，
  // 不再编造分数与结论（原「92 运行平稳 / 61 429 限流」是写死的演示残留）
  if (liveOverview.value) return liveOverview.value
  return {
    tone: 'muted' as const,
    score: null,
    headline: '统计尚未就绪',
    subline: '总览统计加载中。健康结论以健康中心的检查清单为准。',
  }
})

/* ================= 成本页筛选（跨组件同源） =================
   金额条（ExecLogs 成本 tab）与成本聚合卡（TokenCost）共用同一份筛选，
   修复「金额条硬编码 7 天、下方可切 30/90 天」的口径漂移；缓存 key 携带
   筛选参数，修复「切换时间窗 60s 内仍显示旧窗口数据」。 */
export const tokenCostFilters = reactive({ days: 7 })

export function tokenCostCacheKey(): string {
  return `token-cost:${tokenCostFilters.days}`
}
