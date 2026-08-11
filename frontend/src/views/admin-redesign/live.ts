/**
 * 真实数据接入层：把 mock admin 接到后端真实 API
 * 覆盖：执行日志、Skill 注册表、总览统计、用户、学习者模型、虚拟学习者、
 *       API 配置、动态、Prompt Lab、拓扑
 * 原则：每个域独立容错——单个端点失败只影响对应页面，不拖垮整个 live 模式
 */
import { computed, ref } from 'vue'
import {
  adminDashboardApi,
  adminSkillsApi,
  adminUsersApi,
  adminLearnerModelsApi,
  adminVirtualLearnersApi,
  adminApiConfigApi,
  adminAgentsApi,
  adminPromptOpsApi,
  adminAgentTopologyApi,
  adminPlatformSettingsApi,
  adminAnnouncementsApi,
  adminGoalConversationsApi,
  adminRuntimeDefinitionsApi
} from '@/api/adminApi'
import {
  dataSource,
  liveSpans,
  liveSkillStatsMap,
  liveOverview,
  type TraceSpan,
  type SkillStat
} from './store'
import { EXTRA_COMPONENT_VISIBLE_SKILLS } from '@/views/admin/capabilityCatalog'

/** 与生产 Skill 目录同口径：外挂能力 Skill 不在主目录展示（归外挂组件页） */
const isExtraSkill = (id: string) => EXTRA_COMPONENT_VISIBLE_SKILLS.has(id.replace(/^skill:/, ''))

export const liveLoading = ref(false)
export const liveError = ref('')
/** 各域拉取失败记录（页面据此局部降级） */
export const liveFailures = ref<Record<string, string>>({})

/* ================= 工具 ================= */

/** ISO 时间 → 相对时间 */
export function timeAgo(iso?: string | null): string {
  if (!iso) return '从未'
  const t = new Date(iso).getTime()
  if (!t || Number.isNaN(t)) return '从未'
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d === 1) return '昨天'
  if (d < 30) return `${d} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

export function errMsg(e: unknown): string {
  const err = e as { response?: { data?: { error?: { message?: unknown } | string }; status?: number }; message?: string }
  const raw = err?.response?.data?.error
  if (typeof raw === 'string') return raw
  if (raw && typeof raw.message === 'string') return raw.message
  if (err?.response?.status === 401) return '需要 admin 登录'
  return err?.message || '网络错误'
}

/** 长 ID（UUID / traceId）在动态、列表等紧凑场景的截断显示 */
export function shortId(s: string, head = 12, tail = 6): string {
  const id = String(s || '')
  return id.length > head + tail + 3 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id
}

/* ================= 执行日志 → TraceSpan ================= */
interface RawLog {
  id?: string | number
  agentName?: string
  agentId?: string
  status?: string
  durationMs?: number
  createdAt?: string
  traceId?: string
  sessionId?: string
  sourceEntry?: string
  errorMessage?: string
  error?: string
  input?: unknown
  output?: unknown
  executionLayer?: string
  model?: string
  statusCode?: number | string
  attempts?: number
  maxAttempts?: number
  recoveredByRetry?: boolean
  errorCategory?: string
  errorCode?: string
}

function mapStatus(s?: string): TraceSpan['status'] {
  if (s === 'error') return 'err'
  if (s === 'timeout') return 'warn'
  return 'ok'
}

/** 网关行与 skill 行配对的最大时间差（同一次调用的两条记录） */
const GATEWAY_PAIR_WINDOW_MS = 1500

function mapLogsToSpans(items: RawLog[]): TraceSpan[] {
  const byTrace = new Map<string, number>()
  for (const log of items) {
    const t = log.traceId || `log:${log.id}`
    const ts = log.createdAt ? new Date(log.createdAt).getTime() : 0
    const cur = byTrace.get(t)
    if (cur === undefined || ts < cur) byTrace.set(t, ts)
  }

  const tsOf = (l: RawLog) => (l.createdAt ? new Date(l.createdAt).getTime() : 0)

  /* 方案 A：同一次调用 = 网关行 + skill 行两条记录（时间几乎相同）。
     按 trace + 时间差配对，合并为一行（skill 为主），消除列表/瀑布的重复感。 */
  const gatewayRows = items.map((l, i) => ({ l, i })).filter(({ l }) => l.executionLayer === 'api-gateway')
  const skillRows = items.map((l, i) => ({ l, i })).filter(({ l }) => l.executionLayer === 'skill')
  const otherRows = items
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.executionLayer !== 'api-gateway' && l.executionLayer !== 'skill')

  const usedGateway = new Set<number>()
  const paired = new Map<number, number>() // skillIndex → gatewayIndex

  for (const { l: skill, i: si } of skillRows) {
    const t = tsOf(skill)
    let bestGi = -1
    let bestDiff = GATEWAY_PAIR_WINDOW_MS
    for (const { l: g, i: gi } of gatewayRows) {
      if (usedGateway.has(gi) || g.traceId !== skill.traceId) continue
      const d = Math.abs(tsOf(g) - t)
      if (d < bestDiff) {
        bestDiff = d
        bestGi = gi
      }
    }
    if (bestGi >= 0) {
      usedGateway.add(bestGi)
      paired.set(si, bestGi)
    }
  }

  const spanOf = (log: RawLog, i: number, gatewayLog?: RawLog): TraceSpan => {
    const traceId = log.traceId || `log:${log.id}`
    const ts = tsOf(log)
    const errText = log.errorMessage || log.error || ''
    // 统一去掉 skill: 前缀：与注册表 id 对齐（统计/抽屉/最近调用匹配），并缩短列显示
    const agent = (log.agentId || log.agentName || 'unknown').replace(/^skill:/, '')
    return {
      id: String(log.id ?? i),
      traceId,
      // 取舍：live 执行日志只落库单次调用（LLM 往返），无「流程」聚合行——
      // kind 恒为 'call'；'flow' 行仅存在于 demo 数据（store.ts）。
      // 会话级聚合由 TraceWaterfall 会话视图（sessionId 归组）承担，不做后端派生。
      kind: 'call' as const,
      agent,
      stage: (log.agentName || log.agentId || '未知节点').replace(/^skill:/, ''),
      ts: ts || undefined,
      title: errText ? errText.slice(0, 40) : '执行完成',
      startMs: Math.max(0, ts - (byTrace.get(traceId) || ts)),
      durationMs: Number(log.durationMs || 0),
      status: mapStatus(log.status),
      detail: timeAgo(log.createdAt),
      payload: errText || undefined,
      execLayer: log.executionLayer,
      model: log.model,
      statusCode: log.statusCode != null ? Number(log.statusCode) : undefined,
      attempts: log.attempts != null ? Number(log.attempts) : undefined,
      maxAttempts: log.maxAttempts != null ? Number(log.maxAttempts) : undefined,
      recoveredByRetry: Boolean(log.recoveredByRetry),
      errorCategory: log.errorCategory,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      gatewayDurMs: gatewayLog ? Number(gatewayLog.durationMs || 0) : undefined,
      sessionId: log.sessionId || undefined
    }
  }

  const out: TraceSpan[] = []
  for (const { l: log, i } of skillRows) {
    const gi = paired.get(i)
    const gatewayLog = gi !== undefined ? gatewayRows.find(({ i: x }) => x === gi)?.l : undefined
    out.push(spanOf(log, i, gatewayLog))
  }
  for (const { l: log, i } of gatewayRows) {
    if (!usedGateway.has(i)) out.push(spanOf(log, i))
  }
  for (const { l: log, i } of otherRows) {
    out.push(spanOf(log, i))
  }
  return out.sort((a, b) => (a.ts || 0) - (b.ts || 0))
}

/** 日志全量统计（后端 /agents/logs stats：全量口径，非前端样本） */
export interface LiveLogStats {
  total: number
  success: number
  timeout: number
  error: number
  bySource?: Record<string, number>
}
export const liveLogStats = ref<LiveLogStats | null>(null)

/* ---------- Prompt 契约维度（prompt_call_logs）----------
 * 与执行日志同 traceId 关联：同一次调用的传输层（agent_call_logs）与契约层（版本/漂移/tokens/JSON） */
export interface PromptMetaRow {
  agentId: string
  traceId: string
  version: number
  drift: boolean
  tokens: string
  errorCode: string
  errorMessage: string
  userPayload: string
  rawModelOutput: string
  extractedJson: string
  normalizedOutput: string
}
export const livePromptIndex = ref<Record<string, PromptMetaRow[]>>({})

const capText = (v: unknown, n = 6000): string => {
  if (v == null || v === '') return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s.length > n ? `${s.slice(0, n)}\n…（截断）` : s
}

export async function loadPromptIndex(): Promise<void> {
  try {
    const res = await adminRuntimeDefinitionsApi.getPromptCallLogs({ limit: 200 })
    const body = res.data?.data ?? res.data ?? []
    const items: Record<string, unknown>[] = Array.isArray(body) ? body : (body.items || [])
    const index: Record<string, PromptMetaRow[]> = {}
    for (const r of items) {
      const traceId = String(r.traceId || '')
      if (!traceId) continue
      const usage = (r.tokenUsage as Record<string, unknown>) || null
      const tokens = usage
        ? `P ${usage.prompt_tokens ?? usage.prompt ?? 0} / C ${usage.completion_tokens ?? usage.completion ?? 0}`
        : ''
      const row: PromptMetaRow = {
        agentId: String(r.agentId || ''),
        traceId,
        version: Number(r.systemPromptVersion || 0),
        drift: Boolean(r.promptDrift),
        tokens,
        errorCode: String(r.errorCode || ''),
        errorMessage: String(r.errorMessage || ''),
        userPayload: capText(r.userPayload),
        rawModelOutput: capText(r.rawModelOutput),
        extractedJson: capText(r.extractedJson),
        normalizedOutput: capText(r.normalizedOutput)
      }
      ;(index[traceId] ||= []).push(row)
    }
    livePromptIndex.value = index
  } catch {
    // prompt 维度不可用不影响执行日志
  }
}

async function fetchLiveSpans(): Promise<TraceSpan[]> {
  // 放宽样本到 200 条：待办失败统计基于该样本，60 条截断会让"近 7 天 N 次失败"严重低估
  const res = await adminAgentsApi.getLogs({ timeRange: 'week', limit: 200 })
  const body = res.data?.data ?? res.data ?? {}
  const items: RawLog[] = Array.isArray(body) ? body : body.items || body.logs || []
  const stats = body.stats as LiveLogStats | undefined
  if (stats) liveLogStats.value = stats
  return mapLogsToSpans(items)
}

/** 带筛选的服务端重查（执行日志页：时间范围 / 关键词 / 节点 / 状态） */
export interface SpanQuery {
  timeRange?: 'today' | 'yesterday' | 'week' | 'month' | 'all'
  keyword?: string
  agentName?: string
  status?: 'success' | 'error' | 'timeout'
  limit?: number
}

/**
 * 执行日志页带筛选的重查结果：与全局 liveSpans（总览全量口径）隔离，
 * 避免筛选结果污染其他页面的统计与列表
 */
export const liveLogsFiltered = ref<TraceSpan[]>([])

/** 执行日志服务端查询 loading（首屏骨架屏用；与全局 liveLoading 区分，后者覆盖全量 boot） */
export const liveLogsLoading = ref(false)
/** 后端 pagination.total（筛选口径全量条数，供「加载更多」展示） */
export const liveLogsTotal = ref(0)
/** 服务端分页当前页；筛选/查询变化时回到第 1 页 */
export const liveLogsPage = ref(1)
/** 后端是否还有更多页：最近一次响应条数达到分页上限视为有（空页会自动翻转为 false） */
export const liveLogsHasMore = ref(false)

/** 执行日志服务端分页条数（后端默认 20，前端固定 100） */
const LOGS_PAGE_SIZE = 100

/* 服务端查询串行化：同一时刻只发一个请求，期间的更新以最新参数重拉（last-wins），
   保证「加载更多（追加第 N 页）」与「筛选重查（回第 1 页）」并发时状态一致 */
let logsQuerying = false
let logsQueryPending = false
let logsQuerySeq = 0
let logsQueryLatest: { query: SpanQuery; page: number } | null = null

export async function reloadLiveSpans(query: SpanQuery, page = 1): Promise<void> {
  if (logsQuerying) {
    logsQueryLatest = { query, page }
    logsQueryPending = true
    return
  }
  logsQuerying = true
  const seq = ++logsQuerySeq
  liveLogsLoading.value = true
  try {
    const res = await adminAgentsApi.getLogs({ limit: LOGS_PAGE_SIZE, page, ...query })
    const body = res.data?.data ?? res.data ?? {}
    const items: RawLog[] = Array.isArray(body) ? body : body.items || body.logs || []
    const stats = body.stats as LiveLogStats | undefined
    if (stats) liveLogStats.value = stats
    const rawTotal = body.pagination?.total ?? stats?.total ?? items.length
    const total = Number(rawTotal)
    if (Number.isFinite(total)) liveLogsTotal.value = total
    liveLogsHasMore.value = items.length >= LOGS_PAGE_SIZE
    const mapped = mapLogsToSpans(items)
    liveLogsPage.value = page
    if (page <= 1) {
      liveLogsFiltered.value = mapped
    } else {
      // 追加下一页并去重（同一筛选口径下 span id 与原始日志行 id 一致）
      const seen = new Set(liveLogsFiltered.value.map((s) => s.id))
      liveLogsFiltered.value = [...liveLogsFiltered.value, ...mapped.filter((s) => !seen.has(s.id))]
    }
  } finally {
    logsQuerying = false
    liveLogsLoading.value = false
  }
  // 本次响应期间收到更新：旧响应可能已污染状态，以最新参数重拉保证一致
  if (seq !== logsQuerySeq || (logsQueryPending && logsQueryLatest)) {
    const latest = logsQueryLatest
    logsQueryPending = false
    logsQueryLatest = null
    if (latest) void reloadLiveSpans(latest.query, latest.page)
  }
}

/** 执行日志「加载更多」：追加下一页（筛选/重查由 reloadLiveSpans 自动回到第 1 页） */
export async function loadMoreLiveSpans(query: SpanQuery): Promise<void> {
  await reloadLiveSpans(query, liveLogsPage.value + 1)
}

/** 日志详情（展开行时拉真实 input/output + 重试尝试时间线；超长截断） */
export interface LogAttempt {
  promptAttemptNo: number
  transportAttemptNo: number
  maxAttempts: number
  provider: string
  routeSource: string
  model: string
  endpointHost: string
  success: boolean
  willRetry: boolean
  backoffMs: number | null
  statusCode: number | null
  errorCategory: string
  errorCode: string
  errorMessage: string
  durationMs: number
  timeoutMs: number
  promptTokens: number | null
  completionTokens: number | null
  finishReason: string
  ttftMs?: number | null
  promptCacheHitTokens?: number | null
  promptCacheMissTokens?: number | null
}

export interface LogDetail {
  input?: string
  output?: string
  error?: string
  attempts: LogAttempt[]
  attemptCount: number
  maxAttempts: number
}

function mapAttempt(a: Record<string, unknown>): LogAttempt {
  return {
    promptAttemptNo: Number(a.promptAttemptNo || 1),
    transportAttemptNo: Number(a.transportAttemptNo || 1),
    maxAttempts: Number(a.maxAttempts || 1),
    provider: String(a.providerId || a.providerType || ''),
    routeSource: String(a.routeSource || ''),
    model: String(a.resolvedModel || a.responseModel || ''),
    endpointHost: String(a.endpointHost || ''),
    success: !!a.success,
    willRetry: !!a.willRetry,
    backoffMs: a.backoffMs != null ? Number(a.backoffMs) : null,
    statusCode: a.statusCode != null ? Number(a.statusCode) : null,
    errorCategory: String(a.errorCategory || ''),
    errorCode: String(a.errorCode || ''),
    errorMessage: String(a.errorMessage || ''),
    durationMs: Number(a.durationMs || 0),
    timeoutMs: Number(a.effectiveTimeoutMs || a.configuredTimeoutMs || 0),
    promptTokens: a.promptTokens != null ? Number(a.promptTokens) : null,
    completionTokens: a.completionTokens != null ? Number(a.completionTokens) : null,
    finishReason: String(a.finishReason || ''),
    ttftMs: a.ttftMs != null ? Number(a.ttftMs) : null,
    promptCacheHitTokens: a.promptCacheHitTokens != null ? Number(a.promptCacheHitTokens) : null,
    promptCacheMissTokens: a.promptCacheMissTokens != null ? Number(a.promptCacheMissTokens) : null
  }
}

export async function fetchLogDetail(id: string): Promise<LogDetail> {
  const res = await adminAgentsApi.getLogDetail(id)
  const body = res.data?.data ?? res.data ?? {}
  // 新结构：{ log, attempts }；兼容旧平铺
  const d = (body.log || body) as Record<string, unknown>
  const rawAttempts: Record<string, unknown>[] = Array.isArray(body.attempts) ? body.attempts : body.attempts ? [body.attempts] : []
  const cap = (v: unknown): string | undefined => {
    if (v == null) return undefined
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    return s.length > 4000 ? `${s.slice(0, 4000)}\n…（已截断，共 ${s.length} 字符）` : s
  }
  return {
    input: cap(d.input),
    output: cap(d.output),
    error: cap(d.errorMessage || d.error || undefined),
    attempts: rawAttempts.map((a) => mapAttempt(a as Record<string, unknown>)),
    attemptCount: Number(d.attemptCount || rawAttempts.length || 1),
    maxAttempts: Number(d.maxAttempts || rawAttempts[0]?.maxAttempts || 1)
  }
}

/* ================= Skill 注册表 ================= */
interface RawSkill {
  skillId?: string
  id?: string
  name?: string
  displayName?: string
  category?: string
  tier?: string
  description?: string
  agentId?: string | null
  agentName?: string | null
  stats?: { callCount?: number; successRate?: number; avgLatency?: number; lastCalledAt?: string }
  runtime?: { stats?: { callCount?: number; successRate?: number; avgLatency?: number; lastCalledAt?: string } }
}

export interface LiveSkillProfile {
  id: string
  name: string
  category: string
  agentId: string
  agentName?: string
}

export const liveSkillProfiles = ref<LiveSkillProfile[]>([])
/** 外挂能力 Skill 档案（主目录排除，但抽屉/外挂页需要名称等基本信息） */
export const liveExtraProfiles = ref<LiveSkillProfile[]>([])
/** Skill 目录统计时间窗口（默认 7d，历史失败不永久红点） */
export const liveSkillStatsRange = ref<'all' | '24h' | '7d' | '30d'>('7d')

async function fetchLiveSkills(): Promise<Record<string, SkillStat>> {
  const res = await adminSkillsApi.getSkills({ range: liveSkillStatsRange.value })
  const body = res.data?.data ?? res.data ?? {}
  const items: RawSkill[] = Array.isArray(body) ? body : body.skills || body.items || []

  const statsMap: Record<string, SkillStat> = {}
  const profiles: LiveSkillProfile[] = []
  const extras: LiveSkillProfile[] = []

  for (const s of items) {
    const id = s.skillId || s.id || s.name || ''
    if (!id) continue
    const st = s.stats || s.runtime?.stats || {}
    const calls = Number(st.callCount || 0)
    const rate = Number(st.successRate ?? 1)
    statsMap[id] = {
      calls,
      errors: calls > 0 ? Math.round(calls * (1 - rate)) : 0,
      avgMs: Number(st.avgLatency || 0),
      lastAt: st.lastCalledAt ? timeAgo(st.lastCalledAt) : '从未'
    }
    // 主目录档案：排除外挂能力 Skill（与生产 AgentRegistry 同口径）；外挂档案单独保留
    if (isExtraSkill(id)) {
      extras.push({
        id,
        name: s.displayName || s.description || id,
        category: s.category || s.tier || 'skill',
        agentId: s.agentId || '',
        agentName: s.agentName || ''
      })
      continue
    }
    profiles.push({
      id,
      name: s.displayName || s.description || id,
      category: s.category || s.tier || 'skill',
      agentId: s.agentId || '',
      agentName: s.agentName || ''
    })
  }

  liveExtraProfiles.value = extras

  liveSkillProfiles.value = profiles
  return statsMap
}

/* ================= 总览 ================= */
export interface LiveOverviewFull {
  tone: 'ok' | 'warn' | 'muted'
  score: number
  headline: string
  subline: string
  kpis: { label: string; value: string; hint: string }[]
  wrapup: {
    sampleSize: number
    summaryModel: number
    summaryFallback: number
    evaluationModel: number
    evaluationAiFallback: number
    evaluationFailed: number
  }
  funnel: { label: string; value: string; idle: boolean }[]
  rates: string[]
  pulse: { label?: string; calls: number; issue: number }[]
  totalCalls: number
  totalIssues: number
  peak: string
  usage: {
    calls7d: number
    failed7d: number
    totalTokens7d: number
    models7d: { model: string; calls: number; tokens: number }[]
    failures7d: { category: string; count: number }[]
  }
  trend: { date: string; total: number; completed: number }[]
  feed: { text: string; time: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; ts?: number }[]
  actions: { text: string; link: string; tone: 'bad' | 'warn'; agentId: string }[]
}

export const liveOverviewFull = ref<LiveOverviewFull | null>(null)

/** 总览动态是否隐藏虚拟/测试账号（前端开关，直接传给后端 activity 端点） */
export const overviewHideTest = ref(true)

async function fetchLiveOverview(): Promise<{ tone: 'ok' | 'warn' | 'muted'; score: number; headline: string; subline: string }> {
  const [statsRes, activityRes, trendRes] = await Promise.all([
    adminDashboardApi.getStats(),
    adminDashboardApi.getActivity(30, overviewHideTest.value).catch(() => null),
    adminGoalConversationsApi.getStats().catch(() => null)
  ])
  const stats = statsRes.data?.data ?? statsRes.data ?? {}
  const agents = stats.agents || {}
  const users = stats.users || {}
  const learning = stats.learning || {}
  const conv = stats.conversations || {}

  // 指标一律带时间窗口：头部结论只用今日数据（累计值仅作副文案）
  const todayCalls = Number(agents.todayCalls || 0)
  // 后端可能返回字符串或非法值（0/0 场景），统一收敛为有限数
  const todaySuccessRate = Number.isFinite(Number(agents.todaySuccessRate ?? 100)) ? Number(agents.todaySuccessRate ?? 100) : 100
  const todayFailed = Math.max(0, Math.round(todayCalls * (1 - todaySuccessRate / 100)))
  const activeUsers = Number(users.activeToday || 0)

  /* 头部结论：基于今日窗口 + 样本量门槛（今日调用 <20 时只看失败绝对数），
     避免历史失败永久粘住"需要关注"，也避免低流量单次失败误报 */
  let head: { tone: 'ok' | 'warn' | 'muted'; score: number; headline: string; subline: string }
  const warnByRate = todayCalls >= 20 && todaySuccessRate < 90
  const warnByFailures = todayFailed > 0 && todayFailed >= 3
  if (todayCalls === 0 && activeUsers === 0) {
    head = { tone: 'muted', score: 100, headline: '系统空闲', subline: '今日尚无调用，等待学习者开始。' }
  } else if (warnByRate || warnByFailures) {
    head = {
      tone: 'warn',
      score: Math.max(50, Math.round(todaySuccessRate)),
      headline: `需要关注：今日成功率 ${todaySuccessRate}%`,
      subline: `今日 ${todayCalls} 次调用 · ${todayFailed} 次失败。`
    }
  } else {
    head = { tone: 'ok', score: Math.round(todaySuccessRate), headline: '运行平稳', subline: `今日 ${todayCalls} 次调用 · ${activeUsers} 人活跃。` }
  }

  /* 漏斗：目标=完成澄清的对话数（非记录数）；路径保留总量、失败数单列用于断点归因 */
  const completedConversations = Number(conv.completed || 0)
  const totalPaths = Number(learning.totalPaths || 0)
  const funnelRaw = [
    { label: '用户', value: Number(users.total || 0) },
    { label: '目标对话', value: completedConversations },
    { label: '路径', value: totalPaths },
    { label: '任务', value: Number(learning.totalTasks || 0) },
    { label: '完成', value: Number(learning.completedTasks || 0) }
  ]
  const funnel = funnelRaw.map((f) => ({ label: f.label, value: String(f.value), idle: f.value === 0 }))
  const rates = funnelRaw.slice(1).map((f, i) => {
    const prev = funnelRaw[i].value
    if (!prev || !f.value) return '—'
    // 下游可大于上游（一人多目标/一目标多任务），超过 100% 用倍数展示，避免 517% 这种误导
    if (f.label === '任务' || f.value > prev) return `×${(f.value / prev).toFixed(1)}`
    return `${Math.round((f.value / prev) * 100)}%`
  })
  /* 24h 脉搏（后端已按小时聚合的滚动窗口：index 0 = 23h 前，每桶带 label 'HH:00'）；
     空数据不回退全量累计，避免时间口径错位；demo 模式另走壁钟数组，与本块无关 */
  const last24h: { label?: string; total?: number; error?: number; timeout?: number }[] = agents.last24h || []
  const pulse = last24h.length
    ? last24h.map((b) => ({ label: b.label, calls: Number(b.total || 0), issue: Number(b.error || 0) + Number(b.timeout || 0) }))
    : Array.from({ length: 24 }, () => ({ label: undefined, calls: 0, issue: 0 }))
  const totalIssues = pulse.reduce((a, b) => a + b.issue, 0)
  const peakIdx = pulse.reduce((mi, b, i) => (b.calls > (pulse[mi]?.calls || 0) ? i : mi), 0)
  // 高峰小时直接用后端 label（滚动窗口下标 ≠ 壁钟小时）；兜底下标仅用于无 label 的桶
  const peak = pulse[peakIdx]?.calls
    ? pulse[peakIdx].label || `${String(peakIdx).padStart(2, '0')}:00`
    : '—'
  const pulseCalls24h = pulse.reduce((a, b) => a + b.calls, 0)

  /* 动态（excludeTest 已由后端过滤虚拟/测试账号；三类事件按时间戳统一归并排序） */
  const act = activityRes?.data?.data ?? {}
  const feed: LiveOverviewFull['feed'] = []
  for (const u of act.recentUsers || []) {
    feed.push({ text: `新用户注册：${u.email || u.name}`, time: timeAgo(u.createdAt), ts: new Date(u.createdAt).getTime(), tone: 'muted' })
  }
  for (const s of act.recentSessions || []) {
    const title = String(s.subject || s.topic || '')
    const label = title || shortId(String(s.id || ''))
    feed.push({ text: `教学会话：${label}`, time: timeAgo(s.createdAt || s.updatedAt), ts: new Date(s.createdAt || s.updatedAt).getTime(), tone: 'ok' })
  }
  for (const t of act.completedTasks || []) {
    feed.push({ text: `任务完成：${t.title || t.id}`, time: timeAgo(t.completedAt || t.updatedAt), ts: new Date(t.completedAt || t.updatedAt).getTime(), tone: 'ok' })
  }
  feed.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))

  /* 待办：失败最多的节点（近 7 天日志，放宽样本到 200 条减少截断偏差） */
  const byAgent = new Map<string, number>()
  for (const s of liveSpans.value || []) {
    if (s.status === 'err') byAgent.set(s.agent, (byAgent.get(s.agent) || 0) + 1)
  }
  const actions = [...byAgent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([agentId, count]) => ({
      text: `${agentId} 近 7 天 ${count} 次失败`,
      link: '排查执行日志',
      tone: 'bad' as const,
      agentId
    }))

  /* KPI 行：今日窗口 + 活跃量；真实 0 显示 0，非数值才显示 —（避免「无数据」与「零」混淆） */
  const fmt = (n: number, suffix = '') => (Number.isFinite(n) ? `${n}${suffix}` : '—')
  const kpis = [
    { label: '今日调用', value: fmt(todayCalls), hint: todayCalls > 0 ? `超时 ${Number(agents.todayTimeouts || 0)}` : '等待学习者开始' },
    { label: '今日成功率', value: todayCalls > 0 ? `${todaySuccessRate}%` : '—', hint: todayFailed > 0 ? `${todayFailed} 次失败` : '无失败' },
    { label: '今日新增', value: fmt(Number(users.newToday || 0)), hint: '新用户' },
    { label: '今日活跃', value: fmt(activeUsers), hint: `总用户 ${users.total ?? 0}` },
    { label: '进行中对话', value: fmt(Number(conv.active || 0)), hint: '目标澄清阶段' },
    { label: '活跃 Skill', value: fmt(Number(agents.activeAgents24h || 0)), hint: '近 24h 有调用' },
  ]

  /* 总结产出质量：wrapup 生成链路健康度（model / fallback / failed） */
  const wrap = (stats.agents?.wrapup || {}) as Record<string, number>
  const wrapup = {
    sampleSize: Number(wrap.sampleSize || 0),
    summaryModel: Number(wrap.summaryModel || 0),
    summaryFallback: Number(wrap.summaryFallback || 0),
    evaluationModel: Number(wrap.evaluationModel || 0),
    evaluationAiFallback: Number(wrap.evaluationAiFallback || 0),
    evaluationFailed: Number(wrap.evaluationFailed || 0),
  }

  /* 近 7 天 LLM 用量与失败归因 */
  const usageRaw = (stats.usage || {}) as {
    calls7d?: number
    failed7d?: number
    totalTokens7d?: number
    models7d?: { model: string; calls: number; tokens: number }[]
    failures7d?: { category: string; count: number }[]
  }
  const usage = {
    calls7d: Number(usageRaw.calls7d || 0),
    failed7d: Number(usageRaw.failed7d || 0),
    totalTokens7d: Number(usageRaw.totalTokens7d || 0),
    models7d: (usageRaw.models7d || []).slice(0, 5),
    failures7d: (usageRaw.failures7d || []).slice(0, 5),
  }

  /* 近 7 天目标对话趋势（目标澄清量，含完成数） */
  const trendRaw = ((trendRes?.data?.data ?? {}) as { dailyStats?: { date: string; total: number; completed: number }[] }).dailyStats || []
  const trend = trendRaw
    .map((d) => ({ date: d.date, total: Number(d.total || 0), completed: Number(d.completed || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)

  liveOverviewFull.value = {
    ...head,
    kpis,
    wrapup,
    funnel,
    rates,
    pulse,
    // 脉搏卡展示 24h 汇总；与健康分（今日窗口）分离，避免时间口径混用
    totalCalls: pulseCalls24h,
    totalIssues,
    peak,
    usage,
    trend,
    feed: feed.slice(0, 6),
    actions
  }
  return head
}

/* ================= 用户 ================= */
export interface LiveUser {
  id: string
  name: string
  email: string
  isAdmin: boolean
  xp: number
  currentLevel: string
  lastLoginAt: string | null
  createdAt: string
  paths: number
  sessions: number
}

export const liveUsers = ref<LiveUser[]>([])

/** 后端用户总数（分页 total；前端只拉前 100 行，用于截断提示） */
export const liveUsersTotal = ref(0)

async function fetchLiveUsers(): Promise<void> {
  const res = await adminUsersApi.getUsers({ limit: 100 })
  const body = res.data?.data ?? res.data ?? {}
  const items = body.users || body.items || []
  liveUsersTotal.value = Number(body.pagination?.total || items.length)
  liveUsers.value = items.map((u: Record<string, unknown>) => ({
    id: String(u.id),
    name: String(u.name || u.email || u.id),
    email: String(u.email || ''),
    isAdmin: !!u.isAdmin,
    xp: Number(u.xp || 0),
    currentLevel: String(u.currentLevel || ''),
    lastLoginAt: (u.lastLoginAt as string) || null,
    createdAt: String(u.createdAt || ''),
    paths: Number((u._count as Record<string, number>)?.learning_paths || 0),
    sessions: Number((u._count as Record<string, number>)?.teaching_sessions || 0)
  }))
}

export async function liveCreateUser(data: { name: string; email: string; password: string; admin: boolean }): Promise<void> {
  await adminUsersApi.createUser({
    name: data.name,
    email: data.email,
    password: data.password,
    isAdmin: data.admin,
    role: data.admin ? 'admin' : 'user'
  })
  await fetchLiveUsers()
}

export async function liveDeleteUser(id: string): Promise<void> {
  await adminUsersApi.deleteUser(id)
  liveUsers.value = liveUsers.value.filter((u) => u.id !== id)
}

export async function liveSetUserRole(id: string, admin: boolean): Promise<void> {
  await adminUsersApi.updateUserRole(id, admin ? 'admin' : 'user')
  const u = liveUsers.value.find((x) => x.id === id)
  if (u) u.isAdmin = admin
}

export async function liveGetUserDetail(id: string): Promise<Record<string, unknown>> {
  const res = await adminUsersApi.getUser(id)
  return res.data?.data ?? res.data ?? {}
}

/* ================= 学习者模型 ================= */
export interface LiveLearner {
  userId: string
  name: string
  email: string
  pathId?: string
  pathTitle: string | null
  currentTask: string | null
  currentMilestone: string | null
  trend: 'up' | 'down' | 'flat'
  fatigue: string
  confidence: number
  generatedAt: string
  struggling: string[]
  fragile: string[]
}

export const liveLearners = ref<LiveLearner[]>([])

function mapTrend(t?: string): 'up' | 'down' | 'flat' {
  if (t === 'improving' || t === 'up') return 'up'
  if (t === 'declining' || t === 'down') return 'down'
  return 'flat'
}

function mapFatigue(f?: string): string {
  return f === 'high' ? '高' : f === 'medium' ? '中' : '低'
}

async function fetchLiveLearners(): Promise<void> {
  const res = await adminLearnerModelsApi.list({ limit: 100 })
  const body = res.data?.data ?? res.data ?? {}
  const items = body.items || []
  liveLearners.value = items.map((m: Record<string, unknown>) => ({
    userId: String(m.userId),
    name: String(m.userName || m.userId),
    email: String(m.email || ''),
    pathId: (m.pathId as string) || undefined,
    pathTitle: (m.pathTitle as string) || null,
    currentTask: (m.currentTask as string) || null,
    currentMilestone: (m.currentMilestone as string) || null,
    trend: mapTrend(m.recentTrend as string),
    fatigue: mapFatigue(m.fatigueRisk as string),
    confidence: Number(m.confidence || 0),
    generatedAt: String(m.generatedAt || ''),
    struggling: (m.strugglingConcepts as string[]) || [],
    fragile: (m.fragileConcepts as string[]) || []
  }))
}

export async function liveRecomputeLearner(userId: string, pathId?: string): Promise<void> {
  await adminLearnerModelsApi.recompute(userId, pathId ? { pathId } : undefined)
  await fetchLiveLearners()
}

export async function liveGetLearnerDetail(userId: string, pathId?: string): Promise<Record<string, unknown>> {
  const res = await adminLearnerModelsApi.getDetail(userId, pathId ? { pathId } : undefined)
  return res.data?.data ?? res.data ?? {}
}

export async function liveGetLearnerEvidence(userId: string, pathId?: string): Promise<Record<string, unknown>[]> {
  const res = await adminLearnerModelsApi.getEvidence(userId, { limit: 20, ...(pathId ? { pathId } : {}) })
  const body = res.data?.data ?? res.data ?? {}
  return Array.isArray(body) ? body : (body?.items || body?.evidence || [])
}

/* ================= 虚拟学习者 ================= */
export interface LiveVirtual {
  id: string
  name: string
  goal: string
  level: string
  story: string
  sessions: number
  /** 故事池条数（会话故事，不是人物背景字数） */
  storyCount: number
  createdAt: string
  raw: Record<string, unknown>
}

export const liveVirtuals = ref<LiveVirtual[]>([])

async function fetchLiveVirtuals(): Promise<void> {
  const res = await adminVirtualLearnersApi.getVirtualLearners({ limit: 100 })
  const body = res.data?.data ?? res.data ?? {}
  const items = body.profiles || body.items || []
  liveVirtuals.value = items.map((p: Record<string, unknown>) => {
    const profile = (p.profile as Record<string, unknown>) || {}
    const pool = Array.isArray(profile.storyPool) ? profile.storyPool : []
    const storyCount = Number(p.storyCount ?? pool.length ?? 0)
    return {
      id: String(p.id),
      name: String(profile.name || profile.nameHint || p.userName || p.id),
      goal: String(p.learningGoal || '未设置目标'),
      level: String(p.knowledgeLevel || ''),
      story: String(profile.background || profile.corePersonality || p.notes || ''),
      sessions: Number(p.sessionCount || (p._count as Record<string, number>)?.sessions || 0),
      storyCount,
      createdAt: String(p.createdAt || ''),
      raw: p
    }
  })
}

export async function liveCreateVirtual(data: {
  name: string
  /** 可选长期倾向；真正的当次学习需求来自故事 goalSeed */
  goal?: string
  story: string
  personaSeed?: Record<string, unknown>
}): Promise<void> {
  // personaSeed 存在时展开为完整画像（含 learningStyle 等故事生成必需字段）
  const profile: Record<string, unknown> = data.personaSeed
    ? { ...data.personaSeed, background: data.story || data.personaSeed.background }
    : { background: data.story }
  await adminVirtualLearnersApi.createVirtualLearner({
    name: data.name,
    learningGoal: (data.goal || '').trim(),
    notes: data.story,
    profile
  })
  await fetchLiveVirtuals()
}

export async function liveDeleteVirtual(id: string): Promise<void> {
  await adminVirtualLearnersApi.deleteVirtualLearner(id)
  liveVirtuals.value = liveVirtuals.value.filter((v) => v.id !== id)
}

export async function liveGetVirtualDetail(id: string): Promise<Record<string, unknown>> {
  const res = await adminVirtualLearnersApi.getVirtualLearner(id)
  return res.data?.data ?? res.data ?? {}
}

/* ================= API 配置 ================= */
export interface LiveApiConfig {
  apiUrl: string
  apiKeyConfigured: boolean
  availableModels: string[]
  defaultModel: string
  defaultReasoningModel: string
  defaultEvaluationModel: string
  connectionStatus: string
  lastCheckedAt: string
  networkPolicy: {
    adminAccessMode: 'loopback' | 'private' | 'any'
    adminAllowedIps: string[]
    allowPrivateNetwork: boolean
    privateNetworkHosts: string[]
  }
}

export const liveApiConfig = ref<LiveApiConfig | null>(null)

async function fetchLiveApiConfig(): Promise<void> {
  const res = await adminApiConfigApi.getConfig()
  const d = res.data?.data ?? res.data ?? {}
  liveApiConfig.value = {
    apiUrl: String(d.apiUrl || ''),
    apiKeyConfigured: !!d.apiKeyConfigured,
    availableModels: d.availableModels || [],
    defaultModel: d.defaultModel || '',
    defaultReasoningModel: d.defaultReasoningModel || '',
    defaultEvaluationModel: d.defaultEvaluationModel || '',
    connectionStatus: d.connectionStatus || 'unknown',
    lastCheckedAt: d.lastCheckedAt || '',
    networkPolicy: {
      adminAccessMode: d.networkPolicy?.adminAccessMode || 'private',
      adminAllowedIps: d.networkPolicy?.adminAllowedIps || [],
      allowPrivateNetwork: d.networkPolicy?.allowPrivateNetwork !== false,
      privateNetworkHosts: d.networkPolicy?.privateNetworkHosts || []
    }
  }
}

export async function liveFetchModels(apiUrl: string, apiKey: string): Promise<string[]> {
  const res = await adminApiConfigApi.testConnection({ apiUrl, apiKey })
  const d = res.data?.data ?? res.data ?? {}
  const models = d.models || d.availableModels || []
  return Array.isArray(models) ? models.map(String) : []
}

export async function liveSaveApiConfig(data: {
  apiUrl: string
  apiKey: string
  availableModels: string[]
  defaultModel: string
  defaultReasoningModel: string
  defaultEvaluationModel: string
}): Promise<void> {
  await adminApiConfigApi.updateConfig(data)
  await fetchLiveApiConfig()
}

export async function liveRunModelTest(data: {
  apiUrl?: string
  apiKey?: string
  model: string
  prompt: string
}): Promise<{ text: string; latencyMs?: number; usage?: string }> {
  const res = await adminApiConfigApi.testModel({
    ...data,
    temperature: 0.2,
    maxTokens: 64
  })
  const d = res.data?.data ?? res.data ?? {}
  const usage = d.usage
    ? `P ${d.usage.prompt_tokens ?? 0} / C ${d.usage.completion_tokens ?? 0} / T ${d.usage.total_tokens ?? 0}`
    : undefined
  return {
    text: String(d.text || d.output || d.content || '（无文本输出）'),
    latencyMs: d.latencyMs ?? d.durationMs,
    usage
  }
}

export async function liveSaveNetworkPolicy(p: LiveApiConfig['networkPolicy']): Promise<void> {
  await adminApiConfigApi.updateNetworkPolicy(p)
  await fetchLiveApiConfig()
}

/* ================= Prompt Lab（v2 已退役，改由 Prompt 工作台 core-* 端点承接） ================= */

/* ================= 协议视图 / 规则总览（懒加载缓存） ================= */
export interface LiveProtocol {
  id: string
  title: string
  statusLabel: string
  summary: string
  callSites: string
}

export interface LiveRule {
  ruleId: string
  prefix: string
  text: string
  agentId: string
  agentDisplayName: string
  source: string
}

export interface LiveRulesOverview {
  totalRules: number
  totalPrefixes: number
  conflictPrefixCount: number
  conflictPrefixes: { prefix: string; agentIds: string[] }[]
  rules: LiveRule[]
}

let protocolCache: LiveProtocol[] | null = null
let rulesCache: LiveRulesOverview | null = null

export async function fetchProtocolView(): Promise<LiveProtocol[]> {
  if (protocolCache) return protocolCache
  const res = await adminPromptOpsApi.getProtocolView()
  const body = res.data?.data ?? res.data ?? {}
  const items = body.protocols || []
  const mapped: LiveProtocol[] = items.map((p: Record<string, unknown>) => ({
    id: String(p.id || ''),
    title: String(p.title || p.id || ''),
    statusLabel: String(p.statusLabel || p.status || ''),
    summary: String(p.summary || ''),
    callSites: String(p.callSites || '')
  }))
  protocolCache = mapped
  return mapped
}

export async function fetchRulesOverview(): Promise<LiveRulesOverview> {
  if (rulesCache) return rulesCache
  const res = await adminPromptOpsApi.getSkillRulesOverview()
  const body = res.data?.data ?? res.data ?? {}
  const summary = body.summary || {}
  const byPrefix = (body.byPrefix || {}) as Record<string, Record<string, unknown>[]>
  const rules: LiveRule[] = []
  for (const list of Object.values(byPrefix)) {
    for (const r of list || []) {
      rules.push({
        ruleId: String(r.ruleId || ''),
        prefix: String(r.prefix || ''),
        text: String(r.text || ''),
        agentId: String(r.agentId || ''),
        agentDisplayName: String(r.agentDisplayName || ''),
        source: String(r.source || '')
      })
    }
  }
  rulesCache = {
    totalRules: Number(summary.totalRules || rules.length),
    totalPrefixes: Number(summary.totalPrefixes || 0),
    conflictPrefixCount: Number(summary.conflictPrefixCount || 0),
    conflictPrefixes: ((body.conflictPrefixes || []) as Record<string, unknown>[]).map((c) => ({
      prefix: String(c.prefix || c.prefixId || c.id || ''),
      agentIds: Array.isArray(c.agentIds) ? c.agentIds.map(String) : []
    })),
    rules
  }
  return rulesCache
}

/* ================= 编排：Skill 字段目录（真实变量流） ================= */
export interface LiveCatalogSkill {
  skillId: string
  skillName: string
  inputFields: string[]
  outputFields: string[]
}

export interface LiveCatalogAgent {
  agentId: string
  agentName: string
  skills: LiveCatalogSkill[]
}

export const liveSkillCatalog = ref<LiveCatalogAgent[]>([])

function fieldName(f: unknown): string {
  if (f == null) return ''
  if (typeof f === 'string') return f
  const o = f as Record<string, unknown>
  return String(o.path || o.name || o.fieldId || o.id || o.field || '')
}

async function fetchLiveSkillCatalog(): Promise<void> {
  const res = await adminPromptOpsApi.getSkillCatalog()
  const body = res.data?.data ?? res.data ?? {}
  const agents = body.agents || []
  liveSkillCatalog.value = agents.map((a: Record<string, unknown>) => ({
    agentId: String(a.agentId || ''),
    agentName: String(a.agentName || a.agentId || ''),
    skills: ((a.skills as Record<string, unknown>[]) || []).map((s) => ({
      skillId: String(s.skillId || '').replace(/^skill:/, ''),
      skillName: String(s.skillName || s.skillId || ''),
      inputFields: ((s.inputFields as unknown[]) || []).map(fieldName).filter(Boolean),
      outputFields: ((s.outputFields as unknown[]) || []).map(fieldName).filter(Boolean)
    }))
  }))
}

/* ================= 拓扑 ================= */export interface LiveTopoNode {
  id: string
  type: string
  label: string
  parentAgentId?: string
  memberCount?: number
  stats: { totalCalls: number; failed: number; avgDuration: number }
  ioContractVersion?: string
  modelConfig?: { model?: string; temperature?: number; maxTokens?: number; source?: string }
}

export const liveTopoNodes = ref<LiveTopoNode[]>([])

/** 拓扑统计时间范围（页面可切换，触发服务端重查） */
export const liveTopoRange = ref<'24h' | '7d' | '30d' | 'all'>('all')

async function fetchLiveTopology(): Promise<void> {
  const res = await adminAgentTopologyApi.getTopology(liveTopoRange.value)
  const body = res.data?.data ?? res.data ?? {}
  const nodes = body.nodes || []
  liveTopoNodes.value = nodes.map((n: Record<string, unknown>) => {
    const stats = (n.stats as Record<string, unknown>) || {}
    return {
      id: String(n.id),
      type: String(n.type || ''),
      label: String(n.label || n.id),
      parentAgentId: n.parentAgentId ? String(n.parentAgentId) : undefined,
      memberCount: n.memberCount != null ? Number(n.memberCount) : undefined,
      stats: {
        totalCalls: Number(stats.totalCalls || 0),
        failed: Number(stats.failed || 0),
        avgDuration: Number(stats.avgDuration || 0)
      },
      ioContractVersion: n.ioContractVersion ? String(n.ioContractVersion) : undefined,
      modelConfig: n.modelConfig as LiveTopoNode['modelConfig']
    }
  })
}

/** 切换拓扑时间范围并重查 */
export async function reloadLiveTopology(range: '24h' | '7d' | '30d' | 'all'): Promise<void> {
  liveTopoRange.value = range
  await fetchLiveTopology()
}

/* ================= 平台注册开关 ================= */
export const registrationEnabled = ref<boolean | null>(null)

export async function fetchRegistrationSetting(): Promise<void> {
  const res = await adminPlatformSettingsApi.getRegistrationSetting()
  const d = res.data?.data ?? res.data ?? {}
  registrationEnabled.value = d.registrationEnabled !== false
}

export async function updateRegistrationSetting(enabled: boolean): Promise<void> {
  await adminPlatformSettingsApi.updateRegistrationSetting(enabled)
  registrationEnabled.value = enabled
}

/* ================= 平台公告 ================= */
export interface LiveAnnouncement {
  id: string
  title: string
  body: string
  severity: 'info' | 'warning' | 'critical'
  status: 'draft' | 'published' | 'archived'
  publishedAt: string | null
  expiresAt: string | null
  createdBy: string | null
  createdAt: string
}

export const liveAnnouncements = ref<LiveAnnouncement[]>([])

/** 侧栏导航徽章：live 真实计数（无数据时不显示） */
export const liveNavBadges = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  const virtuals = liveVirtuals.value.length
  if (virtuals > 0) out['virtual-learners'] = String(virtuals)
  const skills = liveSkillProfiles.value.length
  if (skills > 0) out.skills = String(skills)
  const addons = liveExtraProfiles.value.length || EXTRA_COMPONENT_VISIBLE_SKILLS.size
  if (addons > 0) out.addons = String(addons)
  const published = liveAnnouncements.value.filter((a) => a.status === 'published').length
  if (published > 0) out.announcements = String(published)
  // 事故信号：近 7 天失败数（>0 时侧栏亮红）
  const failed = (liveSpans.value || []).filter((s) => s.status === 'err').length
  if (failed > 0) out['execution-logs'] = String(failed)
  return out
})

/** 红色告警徽章场景（事故信号，区别于普通计数徽章） */
export const alarmNavBadges = new Set(['execution-logs'])

async function fetchLiveAnnouncements(): Promise<void> {
  const res = await adminAnnouncementsApi.list()
  const body = res.data?.data ?? res.data ?? {}
  const items = body.items || []
  liveAnnouncements.value = items.map((a: Record<string, unknown>) => ({
    id: String(a.id),
    title: String(a.title || ''),
    body: String(a.body || ''),
    severity: (a.severity as LiveAnnouncement['severity']) || 'info',
    status: (a.status as LiveAnnouncement['status']) || 'draft',
    publishedAt: (a.publishedAt as string) || null,
    expiresAt: (a.expiresAt as string) || null,
    createdBy: (a.createdBy as string) || null,
    createdAt: String(a.createdAt || '')
  }))
}

export async function liveCreateAnnouncement(data: {
  title: string
  body: string
  severity: string
  expiresAt?: string | null
  publishNow: boolean
}): Promise<void> {
  await adminAnnouncementsApi.create(data as unknown as Record<string, unknown>)
  await fetchLiveAnnouncements()
}

export async function liveUpdateAnnouncement(
  id: string,
  data: { title: string; body: string; severity: string; expiresAt?: string | null }
): Promise<void> {
  await adminAnnouncementsApi.update(id, data as unknown as Record<string, unknown>)
  await fetchLiveAnnouncements()
}

export async function livePublishAnnouncement(id: string): Promise<void> {
  await adminAnnouncementsApi.publish(id)
  await fetchLiveAnnouncements()
}

export async function liveArchiveAnnouncement(id: string): Promise<void> {
  await adminAnnouncementsApi.archive(id)
  await fetchLiveAnnouncements()
}

export async function liveDeleteAnnouncement(id: string): Promise<void> {
  await adminAnnouncementsApi.remove(id)
  liveAnnouncements.value = liveAnnouncements.value.filter((a) => a.id !== id)
}

export async function refreshLiveOverview() {
  if (liveLoading.value) return
  liveOverview.value = await fetchLiveOverview()
}

export async function refreshLiveSkills() {
  if (liveLoading.value) return
  liveSkillStatsMap.value = await fetchLiveSkills()
}

/* ================= 总入口 ================= */
/**
 * 渐进式加载：首屏只等 spans + overview（落地页所需），
 * 其余 10 个域后台并行，页面响应式填充；liveLoading 到全部结束才复位。
 */
export async function loadLiveData() {
  if (liveLoading.value) return
  liveLoading.value = true
  liveError.value = ''
  liveFailures.value = {}

  const jobs: Record<string, () => Promise<unknown>> = {
    spans: async () => { liveSpans.value = await fetchLiveSpans() },
    skills: async () => { liveSkillStatsMap.value = await fetchLiveSkills() },
    overview: async () => { liveOverview.value = await fetchLiveOverview() },
    users: fetchLiveUsers,
    learners: fetchLiveLearners,
    virtuals: fetchLiveVirtuals,
    apiConfig: fetchLiveApiConfig,
    topology: fetchLiveTopology,
    catalog: fetchLiveSkillCatalog,
    registration: fetchRegistrationSetting,
    announcements: fetchLiveAnnouncements
  }

  // spans 先于 overview（overview 的待办从 spans 推导）
  try {
    await jobs.spans()
  } catch (e) {
    liveFailures.value.spans = errMsg(e)
  }
  const { spans: _s, overview, ...rest } = jobs
  try {
    await overview()
  } catch (e) {
    liveFailures.value.overview = errMsg(e)
  }

  // 核心域（日志）失败才算整体失败；其余局部降级
  if (liveFailures.value.spans && !liveSpans.value?.length) {
    liveError.value = `真实数据拉取失败：${liveFailures.value.spans}`
    dataSource.value = 'demo'
    liveLoading.value = false
    return
  }

  // 关键域就绪即放行首屏；其余域后台继续
  dataSource.value = 'live'
  const entries = Object.entries(rest)
  void Promise.all(
    entries.map(async ([key, fn]) => {
      try {
        await fn()
      } catch (e) {
        liveFailures.value[key] = errMsg(e)
      }
    })
  ).then(() => {
    const failedKeys = Object.keys(liveFailures.value)
    liveError.value = failedKeys.length ? `部分数据不可用：${failedKeys.join('、')}` : ''
    liveLoading.value = false
  })
}

export function backToDemo() {
  dataSource.value = 'demo'
  liveError.value = ''
}

/** live 模式是否可用（页面用于分支） */
export const isLive = computed(() => dataSource.value === 'live')
