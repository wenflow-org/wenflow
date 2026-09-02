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
import { humanizeHttpError } from './terms'

/** 与生产 Skill 目录同口径：外挂能力 Skill 不在主目录展示（归外挂组件页） */
const isExtraSkill = (id: string) => EXTRA_COMPONENT_VISIBLE_SKILLS.has(id.replace(/^skill:/, ''))

export const liveLoading = ref(false)
/** 各域拉取失败记录（页面据此局部降级） */
export const liveFailures = ref<Record<string, string>>({})
/** 并发守卫：防止 auto-refresh 在上一次未完成时重复发起请求 */
export const liveRefreshing = ref(false)

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
  const status = err?.response?.status
  const message =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw.message === 'string'
        ? raw.message
        : err?.message || ''
  // 网关黑话/限流人话（terms.ts 单源）：429 →「请求过于频繁」；"API request failed with status N" →「上游服务异常（HTTP N）」
  const human = humanizeHttpError(message, status)
  if (human) return human
  if (status === 401) return '需要 admin 登录'
  return message || '网络错误'
}

/** 长 ID（UUID / traceId）在动态、列表等紧凑场景的截断显示 */
export function shortId(s: string, head = 12, tail = 6): string {
  const id = String(s || '')
  return id.length > head + tail + 3 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id
}

/* ================= 执行日志 → TraceSpan ================= */
export interface RawLog {
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
  promptTokens?: number | null
  completionTokens?: number | null
}

function mapStatus(s?: string): TraceSpan['status'] {
  if (s === 'error') return 'err'
  if (s === 'timeout') return 'warn'
  return 'ok'
}

/** 网关行与 skill 行配对的最小时间差下限（短调用的兜底窗口） */
const GATEWAY_PAIR_WINDOW_MS = 1500

/**
 * 网关行与 skill 行的配对时间差上限。
 * W2 修窗（ADMIN_DEEP_VLAB_TRACE_AUDIT §4.2 W2）：固定 1500ms 窗口对长调用失效——
 * 长调用下网关记录与 skill 记录的写出时间差可远超 1.5s（实测 11.4s 网关行与 25.6s
 * skill 行并列两行）。窗口改为随调用时长缩放：至少 1500ms，且不小于两条记录
 * 各自 durationMs 的较小值——长调用给足窗口，短调用保持原有防误配能力；
 * 仍限同 traceId，且取时间最接近的未用网关行。
 */
export function gatewayPairWindowMs(skillDurMs: number, gatewayDurMs: number): number {
  return Math.max(GATEWAY_PAIR_WINDOW_MS, Math.min(skillDurMs, gatewayDurMs))
}

export function mapLogsToSpans(items: RawLog[]): TraceSpan[] {
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
    let bestDiff = Infinity
    for (const { l: g, i: gi } of gatewayRows) {
      if (usedGateway.has(gi) || g.traceId !== skill.traceId) continue
      const d = Math.abs(tsOf(g) - t)
      if (d >= bestDiff) continue
      if (d >= gatewayPairWindowMs(Number(skill.durationMs || 0), Number(g.durationMs || 0))) continue
      bestDiff = d
      bestGi = gi
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
      /* P1 语义修复：detail 不再塞 timeAgo(createdAt) 相对时间（消息列/瀑布「摘要」显示相对时间属语义错位，
         时间语义收敛到时间列）；改为错误摘要，无错误时留空（展开区/标题已承载其余信息） */
      detail: errText ? errText.slice(0, 60) : '',
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
      /** 来源入口（platform / system-canary / simulation / admin / user）；连通性测试 = system-canary */
      sourceEntry: log.sourceEntry || undefined,
      gatewayDurMs: gatewayLog ? Number(gatewayLog.durationMs || 0) : undefined,
      sessionId: log.sessionId || undefined,
      promptTokens: log.promptTokens != null ? Number(log.promptTokens) : null,
      completionTokens: log.completionTokens != null ? Number(log.completionTokens) : null
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
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0))
}

/**
 * 执行日志专用二次合并：mapLogsToSpans 的配对要求「同 traceId」，但 skill 层记录
 * 常无 traceId（前端回退为 log:<id>），与网关行（gw:<id>）配不上 → 同一次调用
 * 并列成两行。本函数按「同 sessionId + 时间窗口 + agent 匹配」兜底配对：
 * 网关信息并入 skill 行（真实 traceId / 模型 / 输入输出 tokens / HTTP 状态），
 * 网关行不再单独出现。仅执行日志列表使用——瀑布/链路视图保留两行。
 */
export function mergeGatewayPairsForExecLogs(spans: TraceSpan[]): TraceSpan[] {
  const skills = spans.map((s, i) => ({ s, i })).filter(({ s }) => s.execLayer === 'skill')
  const gateways = spans.map((s, i) => ({ s, i })).filter(({ s }) => s.execLayer === 'api-gateway')
  if (!skills.length || !gateways.length) return spans

  const used = new Set<number>()
  const list = [...spans]

  for (const { s: skill, i: si } of skills) {
    const t = skill.ts || 0
    let bestG: { s: TraceSpan; i: number } | null = null
    let bestDiff = Infinity
    for (const { s: g, i: gi } of gateways) {
      if (used.has(gi)) continue
      if (skill.sessionId && g.sessionId && g.sessionId !== skill.sessionId) continue
      const skillAgent = skill.agent || ''
      if (!skillAgent) continue
      // agent 匹配：网关 stage/agent 必须带 skill 名（「API 网关 · path-planning」含 path-planning）
      const gwText = `${g.stage || ''} ${g.agent || ''}`
      if (!gwText.includes(skillAgent)) continue
      const d = Math.abs((g.ts || 0) - t)
      if (d >= bestDiff) continue
      if (d >= gatewayPairWindowMs(skill.durationMs || 0, g.durationMs || 0)) continue
      bestDiff = d
      bestG = { s: g, i: gi } // gi 为原 spans 索引（used 唯一键），勿用 gateways 下标
    }
    if (!bestG) continue
    const gw = bestG.s
    used.add(bestG.i)
    const base = list[si] ?? skill
    // 网关信息并入 skill 行（真实 traceId / 模型 / 传输层 tokens / HTTP 状态）
    list[si] = {
      ...base,
      traceId: gw.traceId || base.traceId, // 取网关真实链路 ID（可跳完整 Trace）
      model: base.model || gw.model, // 补模型名
      promptTokens: base.promptTokens ?? gw.promptTokens, // 补传输层统计
      completionTokens: base.completionTokens ?? gw.completionTokens,
      statusCode: base.statusCode ?? gw.statusCode, // 补 HTTP 状态
      gatewayDurMs: gw.durationMs, // 触发展开区「网关合并」说明
    }
  }

  const usedIds = new Set(gateways.filter(({ i }) => used.has(i)).map(({ s }) => s.id))
  return list.filter((s) => !(s.execLayer === 'api-gateway' && usedIds.has(s.id)))
}

/* ================= 瀑布：服务端分页 / traceId 直达（W1） =================
 * 瀑布不再只依赖 200 条 boot 快照（实测多为 1-span 截断链路）：
 * - 初始样本 = 全局 boot 快照（liveSpans），零额外请求；
 * - 「加载更多样本」= 服务端 page 追加（按 id 去重 + 重算 trace 内 startMs，
 *   保证跨页同一条链路的相对起点一致）；
 * - traceId / sessionId 直达 = 服务端查询整条链路，本地替换该 trace/session 的 span。
 * 独立于 ExecLogs 的 liveLogsFiltered / reloadLiveSpans（不污染执行日志的分页状态）。
 */
export const waterfallSpans = ref<TraceSpan[] | null>(null)
/** 服务端全量口径（pagination.total），状态条展示「样本 N / 全量 M」 */
export const waterfallTotal = ref(0)
/** 已加载的服务端页数（boot 快照视为第 1 页；追加从第 2 页起） */
export const waterfallPage = ref(1)
export const waterfallLoading = ref(false)
export const waterfallError = ref('')

const WATERFALL_PAGE_SIZE = 200

/**
 * 本地样本上限（性能审计：瀑布行列表无虚拟化）：
 * 「加载更多样本」每页追加 200 条，无限追加会让行渲染与预聚合开销无界增长。
 * 达到上限后停止追加（数据层守卫 + UI 隐藏入口并提示），全量口径仍由 waterfallTotal 展示。
 */
export const WATERFALL_MAX_SPANS = 2000

/** 同 trace 内按绝对时间戳重算 startMs（页追加后跨页同 trace 行的相对起点保持一致） */
export function rebaseTraceStartMs(spans: TraceSpan[]): TraceSpan[] {
  const byTrace = new Map<string, number>()
  for (const s of spans) {
    const ts = s.ts ?? 0
    const cur = byTrace.get(s.traceId)
    if (cur === undefined || ts < cur) byTrace.set(s.traceId, ts)
  }
  return spans.map((s) => ({
    ...s,
    startMs: Math.max(0, (s.ts ?? 0) - (byTrace.get(s.traceId) ?? 0))
  }))
}

/** 服务端页追加合并：按 span id 去重（新页覆盖旧行），重算 startMs 保持跨页同 trace 一致 */
export function mergeSpanPages(existing: TraceSpan[], incoming: TraceSpan[]): TraceSpan[] {
  const byId = new Map<string, TraceSpan>()
  for (const s of existing) byId.set(s.id, s)
  for (const s of incoming) byId.set(s.id, s)
  const merged = [...byId.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  return rebaseTraceStartMs(merged)
}

interface WaterfallPageResult {
  items: RawLog[]
  total: number
}

async function fetchWaterfallPage(query: SpanQuery, page: number): Promise<WaterfallPageResult> {
  const res = await adminAgentsApi.getLogs({ limit: WATERFALL_PAGE_SIZE, page, ...query })
  const body = res.data?.data ?? res.data ?? {}
  const items: RawLog[] = Array.isArray(body) ? body : body.items || body.logs || []
  const stats = body.stats as LiveLogStats | undefined
  const total = Number(body.pagination?.total ?? stats?.total ?? items.length)
  return { items, total: Number.isFinite(total) ? total : items.length }
}

/** 初始样本对齐全局 boot 快照（live 模式瀑布挂载时调用；已对齐则跳过） */
export function waterfallSyncFromBoot(): void {
  if (waterfallSpans.value !== null) return
  waterfallSpans.value = liveSpans.value ? [...liveSpans.value] : []
  waterfallPage.value = 1
  if (liveLogStats.value?.total) waterfallTotal.value = liveLogStats.value.total
}

/** 「加载更多样本」：服务端追加下一页（week 窗口与 boot 同口径） */
export async function waterfallLoadMore(): Promise<void> {
  if (waterfallLoading.value) return
  const base = waterfallSpans.value ?? []
  // 本地上限保护：行列表无虚拟化，达到上限不再追加（UI 同步隐藏入口并提示）
  if (base.length >= WATERFALL_MAX_SPANS) return
  waterfallLoading.value = true
  waterfallError.value = ''
  try {
    const nextPage = waterfallPage.value + 1
    const { items, total } = await fetchWaterfallPage({ timeRange: 'week' }, nextPage)
    if (items.length) {
      waterfallSpans.value = mergeSpanPages(base, mapLogsToSpans(items))
      waterfallPage.value = nextPage
    }
    if (total) waterfallTotal.value = total
  } catch (e) {
    waterfallError.value = errMsg(e)
  } finally {
    waterfallLoading.value = false
  }
}

/** 服务端整链路重查：traceId 直达（与执行日志直达同模式），本地替换该 trace 的 span */
export async function waterfallFetchTrace(traceId: string): Promise<boolean> {
  const base = waterfallSpans.value ?? []
  waterfallLoading.value = true
  waterfallError.value = ''
  try {
    const { items, total } = await fetchWaterfallPage({ traceId, timeRange: 'week' }, 1)
    const incoming = mapLogsToSpans(items)
    if (total) waterfallTotal.value = total
    if (!incoming.length) return false
    waterfallSpans.value = mergeSpanPages(
      base.filter((s) => s.traceId !== traceId),
      incoming
    )
    return true
  } catch (e) {
    waterfallError.value = errMsg(e)
    return false
  } finally {
    waterfallLoading.value = false
  }
}

/** 服务端按业务会话重查：会话视图直达（metadata 命中 sessionId），本地替换该会话的 span */
export async function waterfallFetchSession(sessionId: string): Promise<boolean> {
  const base = waterfallSpans.value ?? []
  waterfallLoading.value = true
  waterfallError.value = ''
  try {
    const { items, total } = await fetchWaterfallPage({ sessionId, timeRange: 'week' }, 1)
    const incoming = mapLogsToSpans(items)
    if (total) waterfallTotal.value = total
    if (!incoming.length) return false
    waterfallSpans.value = mergeSpanPages(
      base.filter((s) => s.sessionId !== sessionId),
      incoming
    )
    return true
  } catch (e) {
    waterfallError.value = errMsg(e)
    return false
  } finally {
    waterfallLoading.value = false
  }
}

/** 日志全量统计（后端 /agents/logs stats：全量口径，非前端样本） */
export interface LiveLogStats {
  total: number
  success: number
  timeout: number
  error: number
  bySource?: Record<string, number>
  /** 延迟分位（毫秒）：后端 stats 提供时优先（P50/P99 对标 Langfuse 观测台核心指标） */
  latencyPercentiles?: { p50?: number; p99?: number }
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

/** 带筛选的服务端重查（执行日志页：时间范围 / 关键词 / 节点 / 状态 / trace / 会话） */
export interface SpanQuery {
  timeRange?: 'today' | 'yesterday' | 'week' | 'month' | 'all'
  keyword?: string
  agentName?: string
  /** 节点过滤走 agentId（服务端做 skill:/agent: 前缀规范化，兼容裸名）；agentName 保留给分组名场景 */
  agentId?: string
  status?: 'success' | 'error' | 'timeout'
  traceId?: string
  sessionId?: string
  /** 错误类别筛选（失败归因/异常流跳转；后端按列值 + 空类别启发式归并） */
  errorCategory?: string
  limit?: number
}

/**
 * 执行日志页带筛选的重查结果：与全局 liveSpans（总览全量口径）隔离，
 * 避免筛选结果污染其他页面的统计与列表
 */
export const liveLogsFiltered = ref<TraceSpan[]>([])

/** 执行日志服务端查询 loading（首屏骨架屏用；与全局 liveLoading 区分，后者覆盖全量 boot） */
export const liveLogsLoading = ref(false)
/** P0 修复：执行日志查询失败标记（此前 try/finally 吞错 → 失败伪装成「暂无日志」） */
export const liveLogsError = ref('')
/** 后端 pagination.total（筛选口径全量条数，驱动状态条与页码器） */
export const liveLogsTotal = ref(0)
/** 服务端分页当前页；筛选/搜索/traceId 直达/每页条数变化时回到第 1 页，自动刷新保留当前页 */
export const liveLogsPage = ref(1)
/** 每页条数（传统分页方案 A：15/30/50/100，默认 30 对齐旧 LOGS_PAGE_SIZE；变更回第 1 页） */
export const liveLogsPageSize = ref(30)

/**
 * 分页纯函数：筛选口径总页数（total / pageSize 向上取整，至少 1 页）。
 * 替代旧 hasMorePages 行式追加判定——传统分页下「下一页可用」= page < totalPages。
 * pageSize 非法（0/负）收敛为 1，避免除零。
 */
export function totalPagesOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

/* 服务端查询串行化：同一时刻只发一个请求，期间的更新以最新参数重拉（last-wins），
   保证「翻页（替换当前页）」与「筛选重查（回第 1 页）」并发时状态一致 */
let logsQuerying = false
let logsQueryPending = false
let logsQuerySeq = 0
let logsQueryLatest: { query: SpanQuery; page: number } | null = null

/**
 * 执行日志带筛选重查（传统分页方案 A）：
 * - page 缺省/1 = 回第 1 页（筛选/搜索/traceId/sessionId 直达、每页条数变更的语义）
 * - 翻页 = 请求对应 page 并整体替换列表（不再行式追加；「加载更多」已由页码器替代）
 * - 自动刷新传 liveLogsPage 即保留当前页（10s 刷新不再把页码重置回 1）
 */
export async function reloadLiveSpans(query: SpanQuery, page = 1): Promise<void> {
  if (logsQuerying) {
    logsQueryLatest = { query, page }
    logsQueryPending = true
    return
  }
  logsQuerying = true
  const seq = ++logsQuerySeq
  liveLogsLoading.value = true
  liveLogsError.value = ''
  try {
    const res = await adminAgentsApi.getLogs({ limit: liveLogsPageSize.value, page, ...query })
    const body = res.data?.data ?? res.data ?? {}
    const items: RawLog[] = Array.isArray(body) ? body : body.items || body.logs || []
    const stats = body.stats as LiveLogStats | undefined
    if (stats) liveLogStats.value = stats
    const rawTotal = body.pagination?.total ?? stats?.total ?? items.length
    const total = Number(rawTotal)
    if (Number.isFinite(total)) liveLogsTotal.value = total
    /* 传统分页：整页替换（下一页可达性由页码器按 page < totalPagesOf(total, pageSize) 判定）；
       网关/skill 并列行做执行日志专用合并（瀑布/链路视图不受影响） */
    liveLogsFiltered.value = mergeGatewayPairsForExecLogs(mapLogsToSpans(items))
    liveLogsPage.value = page
  } catch (error) {
    // P0 修复：失败必须可见（此前吞错导致首查失败显示「暂无日志」）
    liveLogsError.value = errMsg(error) || '执行日志加载失败'
    liveLogsFiltered.value = []
    liveLogsTotal.value = 0
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
  tone: 'ok' | 'warn' | 'bad' | 'muted'
  score: number | null
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
  /** 全量副口径：24h 调用总数（含虚拟/测试账号） */
  totalCallsAll?: number
  totalIssues: number
  peak: string
  usage: {
    calls7d: number
    failed7d: number
    totalTokens7d: number
    models7d: { model: string; calls: number; tokens: number }[]
    failures7d: { category: string; count: number }[]
    /** 全量副口径（含虚拟/测试账号，供标注对比） */
    calls7dAll?: number
    totalTokens7dAll?: number
  }
  trend: { date: string; total: number; completed: number }[]
  /** G1：近 7 天每日调用/失败趋势（总览新增卡） */
  trend7d: { date: string; calls: number; failed: number }[]
  /** G4：近 7 天 Top Skill 活跃榜 */
  topSkills: { agentId: string; calls: number; failed: number }[]
  /** G2/G3：近 7 天每日新增注册 / 活跃用户 */
  growth7d: { date: string; newUsers: number; activeUsers: number }[]
  feed: { text: string; time: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; ts?: number; errorCategory?: string; agentId?: string }[]
  actions: { text: string; link: string; tone: 'bad' | 'warn'; agentId: string }[]
}

export const liveOverviewFull = ref<LiveOverviewFull | null>(null)

/** 总览动态是否隐藏虚拟/测试账号（前端开关，直接传给后端 activity 端点） */
export const overviewHideTest = ref(true)

export interface OverviewHead {
  tone: 'ok' | 'warn' | 'bad' | 'muted'
  score: number | null
  headline: string
  subline: string
}

/**
 * 头部结论（P0-2：健康环口径修复）。
 * - score = 今日真实成功率，无下限钳制（5.3% 就显示 5.3%）；
 * - 今日 0 调用 → score null（环显示「—」，与 KPI 卡一致），不再显示 100；
 * - 成功率 <80% 且失败 >=3 次 → tone 'bad'（红色环高亮）。
 * - todayCallsAll：今日全量调用（含虚拟/测试）。真实 0 但全量 >0 时，结论如实说明「0 的原因」，
 *   避免「明明有调用却显示空闲」的误解（R3 修复）。
 */
export function buildOverviewHead(input: {
  todayCalls: number
  todaySuccessRate: number
  todayFailed: number
  activeUsers: number
  todayCallsAll?: number
}): OverviewHead {
  const { todayCalls, todaySuccessRate, todayFailed, activeUsers } = input
  const todayCallsAll = Number(input.todayCallsAll || 0)
  const todayOnlySimulated = todayCalls === 0 && todayCallsAll > 0
  const warnByRate = todayCalls >= 20 && todaySuccessRate < 90
  const warnByFailures = todayFailed > 0 && todayFailed >= 3
  const badByRate = todaySuccessRate < 80 && todayFailed >= 3
  if (todayCalls === 0) {
    if (todayOnlySimulated) {
      return { tone: 'muted', score: null, headline: '真实用户暂无调用', subline: '今日无真实用户调用；虚拟/模拟仿真请见「虚拟学习者」页。' }
    }
    return activeUsers === 0
      ? { tone: 'muted', score: null, headline: '系统空闲', subline: '今日尚无调用，等待学习者开始。' }
      : { tone: 'muted', score: null, headline: '今日暂无调用', subline: `今日 ${activeUsers} 人活跃，尚无 Agent 调用。` }
  }
  if (badByRate) {
    return {
      tone: 'bad',
      score: todaySuccessRate,
      headline: `需要关注：今日成功率 ${todaySuccessRate}%`,
      subline: `今日 ${todayCalls} 次调用 · ${todayFailed} 次失败。`
    }
  }
  if (warnByRate || warnByFailures) {
    return {
      tone: 'warn',
      score: todaySuccessRate,
      headline: `需要关注：今日成功率 ${todaySuccessRate}%`,
      subline: `今日 ${todayCalls} 次调用 · ${todayFailed} 次失败。`
    }
  }
  return { tone: 'ok', score: todaySuccessRate, headline: '运行平稳', subline: `今日 ${todayCalls} 次调用 · ${activeUsers} 人活跃。` }
}

async function fetchLiveOverview(): Promise<OverviewHead> {
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
  const todayCallsAll = Number(agents.todayCallsAll || 0)
  /* 虚拟/测试调用独立口径：后端 overview/stats 已返回（总览不展示，预留供「虚拟学习者」仿真看板使用） */
  // 后端可能返回字符串或非法值（0/0 场景），统一收敛为有限数
  const todaySuccessRate = Number.isFinite(Number(agents.todaySuccessRate ?? 100)) ? Number(agents.todaySuccessRate ?? 100) : 100
  const todayFailed = Math.max(0, Math.round(todayCalls * (1 - todaySuccessRate / 100)))
  const activeUsers = Number(users.activeToday || 0)

  /* 头部结论：基于今日窗口 + 样本量门槛（今日调用 <20 时只看失败绝对数），
     避免历史失败永久粘住"需要关注"，也避免低流量单次失败误报 */
  const head = buildOverviewHead({ todayCalls, todaySuccessRate, todayFailed, activeUsers, todayCallsAll })

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
  const peakFallback = pulse[peakIdx]?.calls
    ? pulse[peakIdx].label || `${String(peakIdx).padStart(2, '0')}:00`
    : '—'
  // P0-1：后端已全量聚合（last24hTotal/last24hPeak 为权威值），前端求和/推断仅作旧缓存兜底
  const pulseCalls24hRaw = Number(agents.last24hTotal)
  const pulseCalls24h = Number.isFinite(pulseCalls24hRaw) ? pulseCalls24hRaw : pulse.reduce((a, b) => a + b.calls, 0)
  const peak = pulseCalls24h > 0 ? String(agents.last24hPeak || '') || peakFallback : '—'

  /* 动态（excludeTest 已由后端过滤虚拟/测试账号；异常事件优先置顶，
     普通事件在后；时间窗 = 后端近 24h） */
  const act = activityRes?.data?.data ?? {}
  const feed: LiveOverviewFull['feed'] = []
  for (const f of act.recentFailures || []) {
    const cat = String(f.errorCategory || f.errorCode || 'error')
    const agent = String(f.agentId || '未知节点').replace(/^skill:/, '')
    feed.push({
      text: `执行失败：${agent}（${cat}）`,
      time: timeAgo(f.calledAt),
      ts: new Date(f.calledAt).getTime(),
      tone: 'bad',
      errorCategory: cat,
      agentId: f.agentId
    })
  }
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
  // 异常（bad/warn）置顶，组内按时间倒序；普通事件随后（前端折叠展示）
  const toneRank = (t: string) => (t === 'bad' ? 0 : t === 'warn' ? 1 : 2)
  feed.sort((a, b) => {
    const r = toneRank(a.tone) - toneRank(b.tone)
    if (r !== 0) return r
    return (b.ts ?? 0) - (a.ts ?? 0)
  })
  // 动态去重：同文案事件（如同一失败调用重复上报的 generic-chat/caller_abort）只保留最新一条，
  // 避免"3 张相同卡"占满动态流（排序已在上面完成，此处按首现即最新）
  const feedDeduped = new Map<string, LiveOverviewFull['feed'][number]>()
  for (const f of feed) {
    if (!feedDeduped.has(f.text)) feedDeduped.set(f.text, f)
  }

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

  /* KPI 行：纯真实用户口径（R4：总览回归「真实用户看板」，虚拟/模拟数据不混入；
     真实 0 显示 0，非数值才显示 —；0 原因给一句导航提示，不展示虚拟数字） */
  const fmt = (n: number, suffix = '') => (Number.isFinite(n) ? `${n}${suffix}` : '—')
  const todayOnlySimulated = todayCalls === 0 && todayCallsAll > 0
  const kpis = [
    { label: '今日调用', value: fmt(todayCalls), hint: todayCalls > 0 ? `超时 ${Number(agents.todayTimeouts || 0)}` : todayOnlySimulated ? '今日无真实调用 · 虚拟仿真见「虚拟学习者」' : '等待学习者开始' },
    { label: '今日成功率', value: todayCalls > 0 ? `${todaySuccessRate}%` : '—', hint: todayFailed > 0 ? `${todayFailed} 次失败` : todayOnlySimulated ? '暂无真实用户调用' : '无失败' },
    { label: '用户活跃', value: `${fmt(Number(users.newToday || 0))} 新增 / ${fmt(activeUsers)} 活跃`, hint: `总用户 ${users.total ?? 0}（真实，不含测试/虚拟）` },
    { label: '系统活跃', value: `${fmt(Number(conv.active || 0))} 对话 / ${fmt(Number(agents.activeAgents24h || 0))} Skill`, hint: '目标澄清 + 近 24h Skill 调用' },
  ]
  if (todayCallsAll > todayCalls && !todayOnlySimulated) {
    kpis[0] = { ...kpis[0], hint: `${kpis[0].hint} · 全量（含虚拟/测试）${todayCallsAll} 次` }
  }

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
    calls7dAll?: number
    totalTokens7dAll?: number
  }
  const usage = {
    calls7d: Number(usageRaw.calls7d || 0),
    failed7d: Number(usageRaw.failed7d || 0),
    totalTokens7d: Number(usageRaw.totalTokens7d || 0),
    models7d: (usageRaw.models7d || []).slice(0, 5),
    failures7d: (usageRaw.failures7d || []).slice(0, 5),
    calls7dAll: Number(usageRaw.calls7dAll || 0),
    totalTokens7dAll: Number(usageRaw.totalTokens7dAll || 0),
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
    trend7d: (stats.agents?.trend7d || []).slice(0, 7),
    topSkills: (stats.agents?.topSkills || []).slice(0, 5),
    growth7d: (stats.users?.growth7d || []).slice(0, 7),
    feed: [...feedDeduped.values()].slice(0, 12),
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
  /** 数据隔离标记（includeTest=true 时供前端灰标） */
  isVirtualLearner: boolean
  isTestAccount: boolean
  xp: number
  currentLevel: string
  lastLoginAt: string | null
  createdAt: string
  paths: number
  sessions: number
}

export const liveUsers = ref<LiveUser[]>([])

/** 后端用户总数（分页 total；前端只拉前 50 行，用于截断提示） */
export const liveUsersTotal = ref(0)

/**
 * 数据隔离（A3）：默认仅真实用户（排除虚拟学习者与测试/审计账号，后端单点 utils/test-account.ts）；
 * includeTest=true 时显式包含全量并带回行标记
 */
async function fetchLiveUsers(includeTest = false): Promise<void> {
  const res = await adminUsersApi.getUsers({ limit: 50, ...(includeTest ? { includeTest: true } : {}) })
  const body = res.data?.data ?? res.data ?? {}
  const items = body.users || body.items || []
  liveUsersTotal.value = Number(body.pagination?.total || items.length)
  liveUsers.value = items.map((u: Record<string, unknown>) => ({
    id: String(u.id),
    name: String(u.name || u.email || u.id),
    email: String(u.email || ''),
    isAdmin: !!u.isAdmin,
    isVirtualLearner: !!u.isVirtualLearner,
    isTestAccount: !!u.isTestAccount,
    xp: Number(u.xp || 0),
    currentLevel: String(u.currentLevel || ''),
    lastLoginAt: (u.lastLoginAt as string) || null,
    createdAt: String(u.createdAt || ''),
    paths: Number((u._count as Record<string, number>)?.learning_paths || 0),
    sessions: Number((u._count as Record<string, number>)?.teaching_sessions || 0)
  }))
}

/** 用户列表数据隔离切换：切换「含虚拟/测试」后重拉列表（默认仅真实由 loadLiveData 兜底） */
export async function liveSetUsersIncludeTest(includeTest: boolean): Promise<void> {
  await fetchLiveUsers(includeTest)
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
  /** 测试/虚拟账号标记（后端命名约定识别；excludeTest=true 时恒为 false） */
  isTestAccount?: boolean
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

async function fetchLiveLearners(includeTest = false): Promise<void> {
  const res = await adminLearnerModelsApi.list({ limit: 50, ...(includeTest ? { includeTest: true } : { excludeTest: true }) })
  const body = res.data?.data ?? res.data ?? {}
  const items = body.items || []
  liveLearners.value = items.map((m: Record<string, unknown>) => ({
    userId: String(m.userId),
    name: String(m.userName || m.userId),
    email: String(m.email || ''),
    isTestAccount: !!m.isTestAccount,
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

export async function liveSetLearnersIncludeTest(includeTest: boolean): Promise<void> {
  await fetchLiveLearners(includeTest)
}

export async function liveRecomputeLearner(userId: string, pathId?: string): Promise<void> {
  await adminLearnerModelsApi.recompute(userId, pathId ? { pathId } : undefined)
  await fetchLiveLearners()
}

export async function liveGetLearnerDetail(userId: string, pathId?: string, includeTest?: boolean): Promise<Record<string, unknown>> {
  const res = await adminLearnerModelsApi.getDetail(userId, {
    ...(pathId ? { pathId } : {}),
    ...(includeTest ? { includeTest: true } : {}),
  })
  return res.data?.data ?? res.data ?? {}
}

/** 压力趋势点：learning_metrics 历史（与用户侧 /state/trends 同源） */
export interface LoadCurvePoint {
  date: string
  lss: number | null
  ktl: number | null
  lf: number | null
  lsb: number | null
}

export async function liveGetLearnerEvidence(userId: string, pathId?: string, includeTest?: boolean): Promise<{
  items: Record<string, unknown>[]
  domain: Record<string, unknown>[]
  loadCurve: LoadCurvePoint[]
}> {
  const res = await adminLearnerModelsApi.getEvidence(userId, {
    limit: 20,
    ...(pathId ? { pathId } : {}),
    ...(includeTest ? { includeTest: true } : {}),
  })
  const body = res.data?.data ?? res.data ?? {}
  if (Array.isArray(body)) return { items: body, domain: [], loadCurve: [] }
  const items = Array.isArray(body.items) ? body.items : (Array.isArray(body.evidence) ? body.evidence : [])
  const domain = Array.isArray(body.domain) ? body.domain : []
  const loadCurve = Array.isArray(body.loadCurve) ? body.loadCurve : []
  return { items, domain, loadCurve }
}

/** 证据原始字段：后端 LearnerRecentEvidence（type/taskId/sessionId/conceptKeys/signal/score/happenedAt）+
 *  domain 证据（learner_evidence 表 goal/path 类型，detail 为 payload 摘要） */
export interface LearnerEvidenceRaw {
  type?: string
  kind?: string
  taskId?: string
  sessionId?: string
  conceptKeys?: unknown
  signal?: string
  score?: number
  happenedAt?: string
  createdAt?: string
  detail?: string
}

/** 学习者预测校准数据（实证命中率 + 最近预测） */
export interface PredictionCalibration {
  stats: {
    total: number
    stallHitRate: number | null
    toneHitRate: number | null
    calibration: Array<{ range: string; min: number; max: number; n: number; hard: number; hardRate: number | null }>
  }
  recent: Array<{
    id: string
    taskId?: string
    stallRisk: number
    predictedTone: string
    suggestedDepth: string
    focusConcepts: string[]
    rationale: string
    outcome?: string | null
    createdAt: string
    outcomeAt?: string | null
  }>
}

export async function liveGetLearnerPredictions(userId: string, includeTest?: boolean): Promise<PredictionCalibration | null> {
  try {
    const res = await adminLearnerModelsApi.getPredictions(userId, includeTest ? { includeTest: true } : undefined)
    const body = res.data?.data ?? res.data ?? {}
    return {
      stats: body.stats,
      recent: Array.isArray(body.recent) ? body.recent : [],
    }
  } catch {
    return null
  }
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
  /** 当前运行中的会话数（后端 runningCount，全量聚合口径，已扣除暂停的自动驾驶） */
  runningCount: number
  /** 已暂停自动驾驶的会话数（autopilot=stopped，进度保留） */
  pausedCount: number
  /** 失败/放弃的会话累计数（全量聚合） */
  failedCount: number
  /** 卡死（running 超 reclaim 阈值无写入）会话数 */
  stalledCount: number
  /** 运行中会话 id（会话样本内；用于「运行中」列直达座舱） */
  runningSessionIds: string[]
  /** 已暂停会话 id（autopilot=stopped） */
  pausedSessionIds?: string[]
  /** 阶段进度（轴 B）：Goal/Path/Learn 三态 + 任务进度 */
  stageProgress?: {
    goalReady: boolean
    pathReady: boolean
    learnStarted: boolean
    taskDone: number
    taskTotal: number
  } | null
  /** 最近一个运行中会话的阶段（无运行中会话时回退最近会话阶段） */
  currentStage: string | null
  createdAt: string
  raw: Record<string, unknown>
}

export const liveVirtuals = ref<LiveVirtual[]>([])

/** 后端全量虚拟人总数（分页 total；前端只拉前 50 行，状态条「已截断」提示用） */
export const liveVirtualsTotal = ref(0)

/** 全量口径会话状态分区（A2 生命周期视图）：创建中/运行中/失败/放弃/完成 */
export const liveVirtualSessionStats = ref({
  created: 0,
  running: 0,
  failed: 0,
  abandoned: 0,
  completed: 0,
  total: 0
})

/** 卡死分区：reclaim 可回收会话数（running/created 超阈值无写入，与 reclaim 端点同阈值） */
export const liveVirtualStaleCount = ref(0)

/** 虚拟实验运行统计（A5）：全量口径完成率/失败率/平均时长/卡死最长分钟（来自 /virtual-learners/stats） */
export interface LiveVirtualRunStats {
  profileCount: number
  totalSessions: number
  created: number
  running: number
  failed: number
  abandoned: number
  completed: number
  completionRate: number
  failureRate: number
  /** failed / total：只含系统/上游失败，不含人为终止（拍板 2026-08-21） */
  systemFailureRate: number
  /** abandoned / total：管理员止停/批量终止/僵尸回收/学习者放弃 */
  humanTerminatedRate: number
  staleCount: number
  maxStaleMins: number
  avgDurationMs: number
  reclaimThresholdMs: number
  /** 今日虚拟/测试账号调用数（agent_call_logs；仿真看板与真实看板互斥口径） */
  todayCalls: number
}

export const liveVirtualRunStats = ref<LiveVirtualRunStats>({
  profileCount: 0,
  totalSessions: 0,
  created: 0,
  running: 0,
  failed: 0,
  abandoned: 0,
  completed: 0,
  completionRate: 0,
  failureRate: 0,
  systemFailureRate: 0,
  humanTerminatedRate: 0,
  staleCount: 0,
  maxStaleMins: 0,
  avgDurationMs: 0,
  reclaimThresholdMs: 0,
  todayCalls: 0
})

/** 自动驾驶全局并发（配额条：used=内存运行中，limit=env 可配上限，默认 10） */
export const liveAutopilotConcurrency = ref({ used: 0, limit: 10 })

async function fetchLiveVirtualStats(): Promise<void> {
  const res = await adminVirtualLearnersApi.getVirtualLearnerStats()
  const body = res.data?.data ?? res.data ?? {}
  liveVirtualRunStats.value = {
    profileCount: Number(body.profileCount ?? 0),
    totalSessions: Number(body.totalSessions ?? 0),
    created: Number(body.created ?? 0),
    running: Number(body.running ?? 0),
    failed: Number(body.failed ?? 0),
    abandoned: Number(body.abandoned ?? 0),
    completed: Number(body.completed ?? 0),
    completionRate: Number(body.completionRate ?? 0),
    failureRate: Number(body.failureRate ?? 0),
    systemFailureRate: Number(body.systemFailureRate ?? 0),
    humanTerminatedRate: Number(body.humanTerminatedRate ?? 0),
    staleCount: Number(body.staleCount ?? 0),
    maxStaleMins: Number(body.maxStaleMins ?? 0),
    avgDurationMs: Number(body.avgDurationMs ?? 0),
    reclaimThresholdMs: Number(body.reclaimThresholdMs ?? 0),
    todayCalls: Number(body.todayCalls ?? 0)
  }
}

async function fetchLiveVirtuals(): Promise<void> {
  const res = await adminVirtualLearnersApi.getVirtualLearners({ limit: 50 })
  const body = res.data?.data ?? res.data ?? {}
  const items = body.profiles || body.items || []
  liveVirtualsTotal.value = Number(body.pagination?.total ?? items.length)
  const stats = body.sessionStats as Record<string, number> | undefined
  liveVirtualSessionStats.value = {
    created: Number(stats?.created ?? 0),
    running: Number(stats?.running ?? 0),
    failed: Number(stats?.failed ?? 0),
    abandoned: Number(stats?.abandoned ?? 0),
    completed: Number(stats?.completed ?? 0),
    total: Number(stats?.total ?? liveVirtualSessionStats.value.total)
  }
  liveVirtualStaleCount.value = Number(body.staleCount ?? 0)
  // 自动驾驶全局并发（配额条：used/limit）
  const apc = body.autopilotConcurrency as Record<string, number> | undefined
  liveAutopilotConcurrency.value = {
    used: Number(apc?.used ?? 0),
    limit: Number(apc?.limit ?? 10)
  }
  // 运行统计（完成率/失败率/平均时长/卡死最长分钟）独立并行拉取，失败不影响列表
  void fetchLiveVirtualStats().catch(() => {})
  liveVirtuals.value = items.map((p: Record<string, unknown>) => {
    const profile = (p.profile as Record<string, unknown>) || {}
    const pool = Array.isArray(profile.storyPool) ? profile.storyPool : []
    const storyCount = Number(p.storyCount ?? pool.length ?? 0)
    // 运行中信号：后端列表接口已补 runningCount/currentStage/pausedCount；旧缓存（无字段）时由 raw.sessions 兜底推导
    const sessionSample = Array.isArray(p.sessions) ? p.sessions as Record<string, unknown>[] : []
    const runningSessions = sessionSample.filter((s) => String(s.status || '') === 'running')
    const pausedFallback = sessionSample.filter((s) => {
      if (String(s.status || '') !== 'running') return false
      try {
        return JSON.parse(String(s.stageResults || '{}'))?.autopilot?.status === 'stopped'
      } catch { return false }
    })
    return {
      id: String(p.id),
      name: String(profile.name || profile.nameHint || p.userName || p.id),
      goal: String(p.learningGoal || '未设置目标'),
      level: String(p.knowledgeLevel || ''),
      story: String(profile.background || profile.corePersonality || p.notes || ''),
      sessions: Number(p.sessionCount || (p._count as Record<string, number>)?.sessions || 0),
      storyCount,
      runningCount: Number(p.runningCount ?? (runningSessions.length - pausedFallback.length) ?? 0),
      pausedCount: Number(p.pausedCount ?? pausedFallback.length ?? 0),
      failedCount: Number(p.failedCount ?? 0),
      stalledCount: Number(p.stalledCount ?? 0),
      runningSessionIds: (Array.isArray(p.runningSessionIds) ? p.runningSessionIds : runningSessions.map((s) => String(s.id)))
        .map(String)
        .filter(Boolean),
      pausedSessionIds: (Array.isArray(p.pausedSessionIds) ? p.pausedSessionIds : pausedFallback.map((s) => String(s.id)))
        .map(String)
        .filter(Boolean),
      currentStage: String(p.currentStage ?? runningSessions[0]?.currentStage ?? sessionSample[0]?.currentStage ?? '') || null,
      createdAt: String(p.createdAt || ''),
      stageProgress: (p.stageProgress as LiveVirtual['stageProgress']) || null,
      raw: p
    }
  })
}

/**
 * 创建虚拟学习者：返回新样本 id。
 * 「创建」与「列表刷新」错误分离——创建成功但刷新失败时返回 null 而非抛错，
 * 避免调用方误报「创建失败」（创建成功却不导航/不提示刷新问题）。
 */
export async function liveCreateVirtual(data: {
  name: string
  /** 可选长期倾向；真正的当次学习需求来自故事 goalSeed */
  goal?: string
  story: string
  personaSeed?: Record<string, unknown>
  /** 批次备注（可选）：写入 notes 字段便于识别 */
  note?: string
}): Promise<string | null> {
  // personaSeed 存在时展开为完整画像（含 learningStyle 等故事生成必需字段）
  const profile: Record<string, unknown> = data.personaSeed
    ? { ...data.personaSeed, background: data.story || data.personaSeed.background }
    : { background: data.story }
  const res = await adminVirtualLearnersApi.createVirtualLearner({
    name: data.name,
    learningGoal: (data.goal || '').trim(),
    notes: data.note?.trim() ? `${data.note.trim()} · ${data.story}` : data.story,
    profile
  })
  const created = res.data?.data ?? res.data ?? {}
  const createdId = String(
    created.id || created.profileId || created.userId || created.virtualLearnerId || ''
  )
  try {
    await fetchLiveVirtuals()
  } catch {
    // 创建已成功：列表刷新失败不抛错，返回创建响应的 id（无则 null）
    return createdId || null
  }
  return createdId || String(liveVirtuals.value[0]?.id || '') || null
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

export async function refreshLiveOverview(force = false) {
  if (liveLoading.value && !force) return
  // 并发守卫：避免 auto-refresh 在上一次请求未完成时重复发起
  if (liveRefreshing.value && !force) return
  liveRefreshing.value = true
  try {
    liveOverview.value = await fetchLiveOverview()
  } catch (e) {
    console.error('[live] refreshLiveOverview failed:', e)
    // 失败时不更新 liveOverview，保留上一次成功的数据
  } finally {
    liveRefreshing.value = false
  }
}

export async function refreshLiveSkills() {
  if (liveLoading.value) return
  liveSkillStatsMap.value = await fetchLiveSkills()
}

/* ================= 域级 TTL 缓存 =================
 * 性能审计 S5：Admin 每次进入（AdminConsole boot / 各页 retry）都会触发 loadLiveData，
 * 一次导航 ≈ 11+ HTTP 请求、背后 30+ SQL。这里为每个域记录成功拉取时间戳，
 * TTL 内且已有数据的域直接跳过重拉（页面间跳转 / 导航返回命中缓存）；
 * 失败或空数据的域不满足 ready 条件，下次调用自动重拉。
 * loadLiveData(true)（Shell 刷新按钮 / 命令面板 reload）强制绕过缓存全量重拉。
 */
const LIVE_DATA_TTL = 45_000
const liveFetchAt: Record<string, number> = {}

/* ================= 页面级缓存（非 Boot 域用） =================
 * TeachingSessions / GoalConversations / Feedback / AuditLogs / SessionSecurity 等页面
 * 各自有 onMounted 拉取，不在 boot 域内。用此工具避免页面间切换时重复请求。
 * 用法：fetch 前调 isPageCacheFresh()，fetch 成功后调 markPageFetched()。
 */
const pageFetchAt: Record<string, number> = {}
export function isPageCacheFresh(domain: string): boolean {
  const at = pageFetchAt[domain]
  return !!at && Date.now() - at < LIVE_DATA_TTL
}
export function markPageFetched(domain: string): void {
  pageFetchAt[domain] = Date.now()
}
export function clearPageCache(domain?: string): void {
  if (domain) delete pageFetchAt[domain]
  else Object.keys(pageFetchAt).forEach((k) => delete pageFetchAt[k])
}
/** 各域「已有数据」判定：null 型 ref 以非 null 为准，数组型以非空为准（空列表视为未就绪，下次重拉） */
const liveDomainReady: Record<string, () => boolean> = {
  spans: () => liveSpans.value !== null,
  skills: () => liveSkillStatsMap.value !== null,
  overview: () => liveOverview.value !== null,
  users: () => liveUsers.value.length > 0,
  learners: () => liveLearners.value.length > 0,
  virtuals: () => liveVirtuals.value.length > 0,
  apiConfig: () => liveApiConfig.value !== null,
  topology: () => liveTopoNodes.value.length > 0,
  catalog: () => liveSkillCatalog.value.length > 0,
  registration: () => registrationEnabled.value !== null,
  announcements: () => liveAnnouncements.value.length > 0
}

const liveDomainFresh = (key: string): boolean => {
  const at = liveFetchAt[key]
  return !!at && Date.now() - at < LIVE_DATA_TTL
}

const liveDomainSkippable = (key: string, force: boolean): boolean =>
  !force && liveDomainFresh(key) && liveDomainReady[key]()

/* ================= 总入口 ================= */
/**
 * 渐进式加载：首屏只等 spans + overview（落地页所需），
 * 其余 10 个域后台并行，页面响应式填充；liveLoading 到全部结束才复位。
 * @param force 显式刷新（Shell 刷新按钮 / 命令面板 reload）：true 时绕过域级 TTL 缓存全量重拉
 */
export async function loadLiveData(force = false) {
  if (liveLoading.value) return
  liveLoading.value = true
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
    if (!liveDomainSkippable('spans', force)) {
      await jobs.spans()
      liveFetchAt.spans = Date.now()
    }
  } catch (e) {
    liveFailures.value.spans = errMsg(e)
  }
  const { spans: _s, overview, ...rest } = jobs
  try {
    if (!liveDomainSkippable('overview', force)) {
      await overview()
      liveFetchAt.overview = Date.now()
    }
  } catch (e) {
    liveFailures.value.overview = errMsg(e)
  }

  // 核心域（日志）失败才算整体失败；其余局部降级。
  // 阶段 0 R1：后端不可用不再自动降级 demo（杜绝假数据静默展示），
  // 由 AdminConsole 全屏错误页承接（可重试）；dev 离线预览走命令面板手动切换。
  if (liveFailures.value.spans && !liveSpans.value?.length) {
    liveLoading.value = false
    return
  }

  // 关键域就绪即放行首屏；其余域后台继续
  dataSource.value = 'live'
  const entries = Object.entries(rest)
  void Promise.all(
    entries.map(async ([key, fn]) => {
      if (liveDomainSkippable(key, force)) return
      try {
        await fn()
        liveFetchAt[key] = Date.now()
      } catch (e) {
        liveFailures.value[key] = errMsg(e)
      }
    })
  ).then(() => {
    liveLoading.value = false
  })
}

export function backToDemo() {
  // 生产构建禁止回退演示数据（阶段 0 R1）：demo 仅保留为开发态离线预览
  if (import.meta.env.PROD) return
  dataSource.value = 'demo'
}
