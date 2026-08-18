<template>
  <div class="mk-page">
    <!-- 终端状态条 -->
    <div class="log-status" :class="`log-status--${statusTone}`">
      <span class="log-status__dot"></span>
      <strong>{{ statusTitle }}</strong>
      <span class="log-status__sep"></span>
      <span class="log-status__meta mono">{{ isLive ? `共 ${liveLogsTotal} 条` : `${filtered.length} / ${totalCount} 条` }}</span>
      <span v-if="logs.length" class="log-status__meta mono">
        失败 {{ errCount }} · 成功率 {{ successRate }}%
      </span>
      <span v-if="isFiltered" class="log-status__filter">
        排查中：{{ filterLabel }}
        <button type="button" class="log-status__clear" aria-label="清除筛选" @click="clearFilter">×</button>
      </span>
      <div class="log-status__filters">
        <div class="mk-pills">
          <button
            v-for="p in statusPills"
            :key="p.id"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': statusFilter === p.id }"
            @click="statusFilter = statusFilter === p.id ? '' : p.id"
          >
            {{ p.label }}
          </button>
        </div>
        <button
          v-if="isLive && errorCategory"
          type="button"
          class="log-cat"
          :title="`仅看 ${errorCategory} 类别失败（含空类别启发式归并）`"
          @click="errorCategory = ''; applyServerQuery()"
        >
          类别「{{ errorCategory }}」×
        </button>
        <input
          v-if="isLive"
          v-model="keyword"
          class="log-keyword"
          placeholder="关键词，回车查询"
          @keydown.enter="applyServerQuery"
        />
        <input
          v-if="isLive"
          v-model="traceId"
          class="log-keyword log-trace"
          placeholder="traceId 直达，回车查询"
          title="按 traceId 服务端查询：直达该链路日志（不受 200 条样本截断影响）"
          @keydown.enter="applyServerQuery"
        />
        <button type="button" class="log-adv" :class="{ 'log-adv--on': advOpen }" @click="advOpen = !advOpen">
          高级筛选 <i class="log-adv__caret" :class="{ 'is-open': advOpen }">▾</i>
        </button>
        <button v-if="isLive" type="button" class="mk-link" @click="exportJson">导出</button>
      </div>
      <div v-if="advOpen" class="log-advpanel">
        <select v-model="agentFilter" class="log-agent mono">
          <option value="">全部节点</option>
          <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
        </select>
        <input
          v-if="isLive"
          v-model="sessionId"
          class="log-keyword log-trace"
          placeholder="sessionId 搜索，回车查询"
          title="按业务会话 ID 服务端查询（跨 trace 归组查看前置）"
          @keydown.enter="applyServerQuery"
        />
        <select v-if="isLive" v-model="timeRange" class="log-agent" @change="applyServerQuery">
          <option value="today">今天</option>
          <option value="yesterday">昨天</option>
          <option value="week">近 7 天</option>
          <option value="month">近 30 天</option>
          <option value="all">全部</option>
        </select>
        <label v-if="isLive" class="log-auto">
          <input type="checkbox" v-model="autoRefresh" />
          自动刷新
        </label>
      </div>
    </div>

    <!-- 日志流 -->
    <!-- P0 修复：加载失败显示错误横幅 + 重试，不再伪装成「暂无日志」 -->
    <div v-if="liveLogsError" class="exec-error" role="alert">
      <span>{{ liveLogsError }}</span>
      <button type="button" @click="retryLiveLogs">重试</button>
    </div>
    <MockSkeletonTable v-else-if="(liveLoading || liveLogsLoading) && !logs.length" :cols="4" :rows="6" />
    <div v-else-if="filtered.length" class="log-body">
      <div class="tline-head" aria-hidden="true">
        <span class="tline-head__time">时间</span>
        <span class="tline-head__kind">类型</span>
        <span class="tline-head__agent">节点</span>
        <span class="tline-head__msg">消息</span>
        <span class="tline-head__model">模型</span>
        <span class="tline-head__tokens">Tokens</span>
        <span class="tline-head__dur">耗时</span>
        <span class="tline-head__badge">状态</span>
        <span class="tline-head__trace">Trace</span>
        <span class="tline-head__arrow" aria-hidden="true"></span>
      </div>
      <div
        v-for="log in shown"
        :key="log.id"
        class="tline"
        :class="[`tline--${log.status}`, { 'tline--open': openId === log.id }]"
      >
        <button
          type="button"
          class="tline__main"
          :aria-expanded="openId === log.id"
          :aria-controls="`exec-payload-${log.id}`"
          @click="openId = openId === log.id ? '' : log.id"
        >
          <span class="tline__time mono" :title="fmtFull(log.ts)">{{ fmtTime(log.ts) }}</span>
          <span class="tline__kind" :class="`tline__kind--${kindTone(log)}`">{{ kindText(log) }}</span>
          <span class="tline__agent mono" @click.stop="openSkillDrawer(log.agent)">{{ log.stage }}</span>
          <span class="tline__msg" :title="[log.title, !isLive && log.detail ? log.detail : ''].filter(Boolean).join(' · ')">
            <b>{{ log.title }}</b>
            <span v-if="log.errorCode" class="tline__errcode mono">{{ errorCodeLabel(log.errorCode) ?? `[${log.errorCategory || 'err'}] ${log.errorCode}` }}</span>
            <span v-if="log.statusCode && log.statusCode >= 400" class="tline__http mono">HTTP {{ log.statusCode }}</span>
            <em v-if="log.detail && !isLive">{{ log.detail }}</em>
            <span v-if="log.recoveredByRetry" class="tline__recovered">重试 {{ (log.attempts || 1) - 1 }} 次后成功</span>
            <span v-if="promptOf(log)?.drift" class="tline__drift">{{ TERMS.driftRuntime }}</span>
            <span
              v-if="log.sessionId"
              class="tline__session mono"
              :title="`按业务会话在链路中归组查看：${log.sessionId}`"
              @click.stop="openSession(log.sessionId)"
            >会话 {{ shortTrace(log.sessionId) }}</span>
          </span>
          <span class="tline__model mono" :title="log.model || undefined">{{ log.model || '—' }}</span>
          <span class="tline__tokens mono" :title="tokensTitle(log)">{{ tokensText(log) }}</span>
          <span class="tline__dur mono" :title="fmtMs(log.durationMs)">{{ fmtMs(log.durationMs) }}</span>
          <span class="tline__badge" :class="`tline__badge--${log.status}`">{{ statusBadge[log.status] }}</span>
          <span class="tline__trace mono" :title="`${log.traceId} · 在链路中查看完整 Trace`" @click.stop="openTrace(log.traceId)">{{ shortTrace(log.traceId) }}</span>
          <span class="tline__arrow" aria-hidden="true">▸</span>
        </button>
        <div v-if="openId === log.id" :id="`exec-payload-${log.id}`" class="tline__payload">
          <div class="tline__payload-meta">
            <span>trace {{ log.traceId }}</span>
            <button type="button" class="mk-link" @click.stop="openTrace(log.traceId)">在链路中查看完整 Trace →</button>
            <button v-if="log.sessionId" type="button" class="mk-link" @click.stop="openSession(log.sessionId)">按会话归组查看 →</button>
          </div>
          <template v-if="isLive">
            <p v-if="detailLoading === log.id" class="tline__none"><span class="mk-spinner" aria-hidden="true"></span> 拉取日志详情…</p>
            <template v-else-if="detailCache[log.id]">
              <!-- 重试时间线：网关升级后的逐次尝试遥测 -->
              <div v-if="detailCache[log.id].attempts.length" class="tline__section">
                <span class="tline__label">调用时间线{{ detailCache[log.id].attemptCount > 1 ? ` · 共 ${detailCache[log.id].attemptCount}/${detailCache[log.id].maxAttempts} 次尝试` : '' }}</span>
                <div class="tline-attempts">
                  <div
                    v-for="(a, i) in detailCache[log.id].attempts"
                    :key="i"
                    class="tline-attempt"
                    :class="{ 'tline-attempt--fail': !a.success, 'tline-attempt--retry': a.willRetry }"
                  >
                    <div class="tline-attempt__head">
                      <span class="tline-attempt__no">P#{{ a.promptAttemptNo }} · N#{{ a.transportAttemptNo }}</span>
                      <span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span>
                      <span v-if="a.willRetry" class="tline-attempt__retry">将在 {{ a.backoffMs ?? '—' }}ms 后自动重试</span>
                      <span class="tline-attempt__dur mono">{{ fmtMs(a.durationMs) }}</span>
                    </div>
                    <div class="tline-attempt__meta mono">
                      <span>{{ a.provider || 'provider?' }}</span>
                      <span>{{ a.model || 'model?' }}</span>
                      <span v-if="a.statusCode">HTTP {{ a.statusCode }}</span>
                      <span v-if="a.promptTokens != null">P {{ a.promptTokens }} / C {{ a.completionTokens ?? 0 }}</span>
                      <span v-if="a.ttftMs != null" :title="'TTFT（首字节）'">TTFT {{ a.ttftMs }}ms</span>
                      <span v-if="a.promptCacheHitTokens" class="tline-attempt__cache" :title="'DeepSeek 自动前缀缓存命中'">缓存 {{ a.promptCacheHitTokens }} token</span>
                      <span v-if="a.routeSource">路由 {{ a.routeSource }}</span>
                      <span v-if="a.endpointHost">{{ a.endpointHost }}</span>
                    </div>
                    <p v-if="a.errorMessage" class="tline-attempt__err">{{ a.errorCode ? `${errorCodeLabel(a.errorCode) ?? a.errorCode} · ` : '' }}{{ a.errorMessage }}</p>
                  </div>
                </div>
              </div>
              <div v-if="detailCache[log.id].error" class="tline__section">
                <span class="tline__label tline__label--err">错误</span>
                <pre>{{ detailCache[log.id].error }}</pre>
              </div>
              <div v-if="log.gatewayDurMs" class="tline__section">
                <span class="tline__label">网关层</span>
                <p class="tline__none">{{ fmtMs(log.gatewayDurMs) }}（同一调用的 api-gateway 记录，已合并）</p>
              </div>
              <div v-if="detailCache[log.id].input" class="tline__section">
                <span class="tline__label">输入</span>
                <pre>{{ detailCache[log.id].input }}</pre>
              </div>
              <div v-if="detailCache[log.id].output" class="tline__section">
                <span class="tline__label">输出</span>
                <pre>{{ detailCache[log.id].output }}</pre>
              </div>
              <!-- Prompt 契约维度（prompt_call_logs，同 traceId 关联） -->
              <div v-if="promptOf(log)" class="tline__section tline__prompt">
                <span class="tline__label">Prompt 契约</span>
                <div class="tline__prompt-meta mono">
                  <span>版本 v{{ promptOf(log)!.version || '—' }}</span>
                  <span v-if="promptOf(log)!.drift" class="tline__prompt-drift">{{ TERMS.driftRuntime }}</span>
                  <span v-if="promptOf(log)!.tokens">{{ promptOf(log)!.tokens }}</span>
                  <span v-if="promptOf(log)!.errorCode">{{ errorCodeLabel(promptOf(log)!.errorCode) ?? `[${promptOf(log)!.errorCode}]` }} {{ promptOf(log)!.errorMessage }}</span>
                </div>
                <pre v-if="promptOf(log)!.userPayload">{{ promptOf(log)!.userPayload }}</pre>
                <pre v-if="promptOf(log)!.rawModelOutput">{{ promptOf(log)!.rawModelOutput }}</pre>
                <pre v-if="promptOf(log)!.extractedJson">{{ promptOf(log)!.extractedJson }}</pre>
                <pre v-if="promptOf(log)!.normalizedOutput">{{ promptOf(log)!.normalizedOutput }}</pre>
              </div>
              <p v-if="detailFailed[log.id]" class="tline__none tline__none--err">详情拉取失败，请稍后重试</p>
              <p v-else-if="!detailCache[log.id].attempts.length && !detailCache[log.id].error && !detailCache[log.id].input && !detailCache[log.id].output" class="tline__none">无 payload 记录</p>
            </template>
            <p v-else class="tline__none">详情不可用</p>
          </template>
          <template v-else>
            <pre v-if="log.payload">{{ log.payload }}</pre>
            <p v-else class="tline__none">无 payload 记录</p>
          </template>
        </div>
      </div>
      <!-- 传统分页（方案 A）：页码器替代「加载更多」；demo 模式保留本地分批加载 -->
      <Pagination
        v-if="isLive"
        v-model:page="currentPage"
        v-model:pageSize="currentPageSize"
        :total="liveLogsTotal"
        :loading="liveLogsLoading"
      />
      <div v-else-if="demoCanMore" class="tline-more">
        <button type="button" class="mk-link" @click="demoLoadMore">加载更多（已显示 {{ demoShown.length }} / {{ filtered.length }}）</button>
      </div>
    </div>

    <div v-else class="mk-empty">
      <strong v-if="traceMiss">未找到「{{ traceMiss }}」的日志（可能超出保留期或 ID 不完整）</strong>
      <strong v-else>{{ isFiltered ? '当前筛选无日志' : '暂无日志' }}</strong>
      <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { spans, intent, openTrace, openSession, openSkillDrawer, clearInvestigation, dataSource, isLive } from './store'
import { fetchLogDetail, reloadLiveSpans, liveLoading, liveLogsLoading, liveLogsError, liveLogsTotal, liveLogsPage, liveLogsPageSize, liveLogStats, livePromptIndex, liveLogsFiltered, loadPromptIndex, type LogDetail, type PromptMetaRow, type SpanQuery } from './live'
import { useLoadMore } from './useLoadMore'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import { TERMS, errorCodeLabel } from './terms'

const openId = ref('')
const statusFilter = ref('')
const agentFilter = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('week')
const keyword = ref('')
const traceId = ref('')
const sessionId = ref('')
const errorCategory = ref('')
const autoRefresh = ref(false)
const advOpen = ref(false)

/* prompt 契约维度：与执行日志同 traceId 关联（版本/漂移/tokens/JSON） */
onMounted(() => {
  if (!isLive.value) return
  void loadPromptIndex()
  // 首屏必须触发服务端查询：liveLogsFiltered 只有 applyServerQuery 一个写入点，
  // 不查则页面永远空列表（后端有数据也显示「暂无日志」）
  void applyServerQuery()
})
watch(dataSource, () => {
  if (dataSource.value !== 'live') return
  void loadPromptIndex()
  // demo → live 切换后同样触发首次查询
  void applyServerQuery()
})
function promptOf(log: { traceId: string; agent: string }): PromptMetaRow | undefined {
  const list = livePromptIndex.value[log.traceId]
  if (!list?.length) return undefined
  const agentId = `skill:${log.agent}`
  return list.find((p) => p.agentId === agentId || p.agentId.replace(/^skill:/, '') === log.agent)
}

/* Tokens 列语义（P2）：传输层（agent_call_logs.promptTokens/completionTokens）优先——
   有真实用量展示实际值；无 token 数据的行显示「未统计」（区别于 0，工具提示说明数据来源与含义） */
type TokenRow = { traceId: string; agent: string; promptTokens?: number | null; completionTokens?: number | null }
function tokensText(log: TokenRow): string {
  if (log.promptTokens != null || log.completionTokens != null) {
    return `P ${log.promptTokens ?? 0} / C ${log.completionTokens ?? 0}`
  }
  const p = promptOf(log)
  return p?.tokens || '未统计'
}
function tokensTitle(log: TokenRow): string {
  if (log.promptTokens != null || log.completionTokens != null) {
    return `Prompt ${log.promptTokens ?? 0} / Completion ${log.completionTokens ?? 0} token（agent_call_logs 传输层统计）`
  }
  const p = promptOf(log)
  if (p?.tokens) return `${p.tokens}（prompt_call_logs 契约层统计）`
  return '该日志未记录 token 用量（无传输层与契约层数据）'
}

/* live 模式：服务端筛选（时间范围/关键词/状态/节点/traceId/sessionId/错误类别）。
   reloadLiveSpans 写入独立的 liveLogsFiltered（不污染全局 liveSpans）；
   并发与 last-wins 由 live.ts 串行化保证（loading 反馈见 liveLogsLoading） */
function currentQuery(): SpanQuery {
  const status = statusFilter.value === 'err' ? 'error' : statusFilter.value === 'warn' ? 'timeout' : statusFilter.value === 'ok' ? 'success' : undefined
  return {
    timeRange: timeRange.value,
    keyword: keyword.value.trim() || undefined,
    status,
    agentId: agentFilter.value || undefined,
    traceId: traceId.value.trim() || undefined,
    sessionId: sessionId.value.trim() || undefined,
    errorCategory: errorCategory.value || undefined
  }
}

async function applyServerQuery() {
  if (!isLive.value) return
  /* 筛选/搜索/traceId/sessionId 直达/每页条数等变化：回第 1 页（传统分页语义） */
  await reloadLiveSpans(currentQuery())
}

/** 自动刷新：保留当前页码重查（区别于筛选变化回第 1 页） */
function refreshLivePage() {
  if (!isLive.value) return
  void reloadLiveSpans(currentQuery(), liveLogsPage.value)
}

/* 传统分页：页码器 v-model 桥接。翻页 = reloadLiveSpans(page) 整页替换 + 滚动回顶；
   每页条数变更 = 回第 1 页 + 按新 pageSize 重查 */
const currentPage = computed({
  get: () => liveLogsPage.value,
  set: (p: number) => {
    void goPage(p)
  }
})
const currentPageSize = computed({
  get: () => liveLogsPageSize.value,
  set: (s: number) => {
    if (s === liveLogsPageSize.value) return
    liveLogsPageSize.value = s
    if (isLive.value) void reloadLiveSpans(currentQuery())
  }
})
async function goPage(p: number) {
  if (!isLive.value || p < 1 || p === liveLogsPage.value) return
  await reloadLiveSpans(currentQuery(), p)
  /* 翻页替换列表后滚动回顶部（列表长于视口时保持位置感） */
  window.scrollTo(0, 0)
}

/* P0 分页正确性：状态/节点过滤上移服务端（status/agentId 参数，API 已支持），
   消除「本地过滤 × 服务端分页」组合缺陷（旧实现下第 2 页整页被滤掉时，
   「加载更多」空转无感知变化）；demo 模式仍走本地 filtered 过滤 */
watch([statusFilter, agentFilter], () => {
  if (isLive.value) void applyServerQuery()
})

/* P0 修复：错误横幅重试 */
function retryLiveLogs() {
  void applyServerQuery()
}

/* 自动刷新：10s 间隔，离开页面清除 */
let autoTimer: ReturnType<typeof setInterval> | null = null
watch(autoRefresh, (on) => {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  if (on && isLive.value) {
    autoTimer = setInterval(() => {
      if (document.hidden) return
      /* 自动刷新保留当前页：不再把页码重置回 1（旧「加载更多 × 10s 重查互斥」已消除） */
      refreshLivePage()
    }, 10000)
  }
})
onBeforeUnmount(() => {
  if (autoTimer) clearInterval(autoTimer)
})

/* 导出当前筛选结果为 JSON */
function exportJson() {
  const blob = new Blob([JSON.stringify(filtered.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `execution-logs-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* live 模式：展开行时拉真实 input/output + 重试时间线 */
const DETAIL_CACHE_MAX = 50
const detailCache = ref<Record<string, LogDetail>>({})
const detailLoading = ref('')
/** 详情拉取失败标记（与「无 payload 记录」区分） */
const detailFailed = ref<Record<string, boolean>>({})

/** 简单 LRU：插入新条目，超过上限时淘汰最早插入的条目 */
function setDetail(id: string, d: LogDetail) {
  const next = { ...detailCache.value, [id]: d }
  const keys = Object.keys(next)
  if (keys.length > DETAIL_CACHE_MAX) {
    for (const k of keys.slice(0, keys.length - DETAIL_CACHE_MAX)) delete next[k]
  }
  detailCache.value = next
}

watch(openId, async (id) => {
  if (!id || !isLive.value || detailCache.value[id]) return
  detailLoading.value = id
  try {
    const d = await fetchLogDetail(id)
    setDetail(id, d)
    const f = { ...detailFailed.value }
    delete f[id]
    detailFailed.value = f
  } catch {
    setDetail(id, { attempts: [], attemptCount: 0, maxAttempts: 1 })
    detailFailed.value = { ...detailFailed.value, [id]: true }
  } finally {
    if (detailLoading.value === id) detailLoading.value = ''
  }
})

// 从排查意图进入时应用过滤（含失败归因跳转的错误类别与时间范围）
watch(
  () => [intent.agentFilter, intent.statusFilter, intent.errorCategory, intent.timeRange],
  () => {
    agentFilter.value = intent.agentFilter
    statusFilter.value = intent.statusFilter
    if (intent.errorCategory) errorCategory.value = intent.errorCategory
    const TR = ['today', 'yesterday', 'week', 'month', 'all'] as const
    if ((TR as readonly string[]).includes(intent.timeRange)) timeRange.value = intent.timeRange as typeof timeRange.value
  },
  { immediate: true }
)

const logs = computed(() => (isLive.value ? liveLogsFiltered.value : spans.value))
const agentOptions = computed(() => [...new Set(logs.value.map((s) => s.agent))].sort())

const filtered = computed(() =>
  logs.value.filter((l) => {
    if (agentFilter.value && l.agent !== agentFilter.value) return false
    if (statusFilter.value && l.status !== statusFilter.value) return false
    return true
  })
)

/* 长列表分批渲染：每批 30 行（仅 demo 模式，滚动修复 #5）；
   live 模式整页替换（传统分页），不再需要「加载更多」——页码器替代 */
const { shown: demoShown, canMore: demoCanMore, loadMore: demoLoadMore } = useLoadMore(filtered, 30)
const shown = computed(() => (isLive.value ? filtered.value : demoShown.value))

const isFiltered = computed(() => !!(agentFilter.value || statusFilter.value || keyword.value.trim() || traceId.value.trim() || sessionId.value.trim() || errorCategory.value))
/* traceId/sessionId 服务端查询未命中时的空态提示（与 TraceWaterfall 的 wf-notice「样本截断」兜底互补：
   此处是服务端精确查询的直接未命中） */
const traceMiss = computed(() => {
  if (!isLive.value || filtered.value.length) return ''
  if (traceId.value.trim()) return `traceId ${traceId.value.trim()}`
  if (sessionId.value.trim()) return `sessionId ${sessionId.value.trim()}`
  return ''
})
/* live：全量统计来自后端 stats（非 200 行样本）；demo 回退样本计算 */
const liveStats = computed(() => (isLive.value ? liveLogStats.value : null))
const totalCount = computed(() => liveStats.value?.total ?? logs.value.length)
const errCount = computed(() =>
  liveStats.value ? liveStats.value.error : logs.value.filter((l) => l.status === 'err').length
)
const successRate = computed(() => {
  const st = liveStats.value
  if (st) return st.total ? Math.round((st.success / st.total) * 100) : '—'
  if (!logs.value.length) return '—'
  const ok = logs.value.filter((l) => l.status === 'ok').length
  return Math.round((ok / logs.value.length) * 100)
})
const statusTone = computed(() => (!logs.value.length ? 'muted' : errCount.value ? 'bad' : 'ok'))
const statusTitle = computed(() => {
  if (!logs.value.length) return '暂无日志'
  if (errCount.value) return `执行日志 · ${errCount.value} 次失败`
  return '执行日志 · 运行平稳'
})
/* 排查徽章：读本地筛选（修复此前读 intent 导致的空值）；live 下补充关键词/时间范围/trace/会话 */
const timeRangeLabels = { today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部' } as const
const filterLabel = computed(() =>
  [
    isLive.value && timeRange.value !== 'week' ? timeRangeLabels[timeRange.value] : '',
    agentFilter.value || '',
    statusFilter.value === 'err' ? '仅失败' : statusFilter.value === 'warn' ? '仅超时' : statusFilter.value === 'ok' ? '仅成功' : '',
    errorCategory.value ? `类别「${errorCategory.value}」` : '',
    keyword.value.trim() ? `关键词「${keyword.value.trim()}」` : '',
    traceId.value.trim() ? `trace「${traceId.value.trim()}」` : '',
    sessionId.value.trim() ? `会话「${sessionId.value.trim()}」` : ''
  ]
    .filter(Boolean)
    .join(' · ')
)

const statusPills = [
  { id: 'err', label: '失败' },
  { id: 'warn', label: '超时' },
  { id: 'ok', label: '成功' }
]

function clearFilter() {
  agentFilter.value = ''
  statusFilter.value = ''
  keyword.value = ''
  traceId.value = ''
  sessionId.value = ''
  errorCategory.value = ''
  clearInvestigation()
  /* 服务端筛选下必须重查：仅清本地值不会刷新列表（traceId/sessionId 不在 watch 内，
     避免输入即查询；状态/节点变化由 watch 触发，此处兜底全清场景） */
  if (isLive.value) void applyServerQuery()
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
/* 绝对时间：今天内 HH:MM:SS，跨天 MM-DD HH:MM */
function fmtTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm.slice(0, 5)}`
}
function shortTrace(id: string): string {
  const m = id.match(/^(\w{2}):?([\w-]+)$/)
  if (!m) return id.slice(0, 12)
  const body = m[2] || id
  return body.length > 14 ? `${m[1]}:…${body.slice(-6)}` : id
}
/* 绝对时间 tooltip：YYYY-MM-DD HH:MM:SS（与审计页同格式）；ts 为 epoch 毫秒 */
function fmtFull(ts?: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const statusBadge = { ok: '✅ 成功', warn: '⚠ 降级', err: '❌ 失败' } as const
/* 类型列：demo 按 flow/call；live 按执行层（api-gateway→网关 / skill→Skill） */
function kindText(log: { kind: 'flow' | 'call'; execLayer?: string }): string {
  if (log.kind === 'flow') return '流程'
  if (log.execLayer === 'skill') return 'Skill'
  if (log.execLayer === 'api-gateway') return '网关'
  return '调用'
}
function kindTone(log: { kind: 'flow' | 'call'; execLayer?: string }): string {
  if (log.kind === 'flow') return 'flow'
  if (log.execLayer === 'skill') return 'skill'
  return 'call'
}
</script>

<style scoped>
.log-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-sm);
  flex-wrap: wrap;
  /* 终端页例外：字号/圆角与 mk-status 基础规格一致，
     内边距略大是为容纳状态条内的筛选区（pills + 关键词 + 高级筛选） */
}
.log-status__dot { width: 9px; height: 9px; border-radius: 50%; }
.log-status--ok .log-status__dot { background: var(--mk-green); }
.log-status--bad .log-status__dot { background: var(--mk-red); }
.log-status--muted .log-status__dot { background: var(--mk-faint); }
.log-status strong { font-size: 14px; }
.log-status__sep { width: 1px; height: 14px; background: var(--mk-line); }
.log-status__meta { color: var(--mk-muted); font-size: 12px; }

.log-status__filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: 11.5px;
  font-weight: 700;
}
.log-status__clear {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  padding: 0 2px;
}

.log-status__filters {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  min-width: 0;
}
.log-adv {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  color: var(--mk-muted);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.log-adv:hover { border-color: rgba(44, 99, 208, 0.4); color: var(--mk-ink); }
.log-adv--on { border-color: rgba(44, 99, 208, 0.5); color: var(--mk-blue); background: #eef5ff; }
.log-adv__caret { font-style: normal; font-size: 10px; transition: transform 0.15s ease; }
.log-adv__caret.is-open { transform: rotate(180deg); }
/* 错误类别筛选 chip（失败归因/异常流跳转进入） */
.log-cat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid rgba(220, 38, 38, 0.35);
  border-radius: 999px;
  background: #fff1f1;
  color: #b91c1c;
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: 0.12s ease;
}
.log-cat:hover { background: #fee2e2; border-color: rgba(220, 38, 38, 0.55); }
.log-advpanel {
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 2px;
  animation: log-adv-in 0.15s ease;
}
@keyframes log-adv-in {
  from { opacity: 0; transform: translateY(-3px); }
}
@media (max-width: 1000px) {
  .log-status__filters {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }
  .log-keyword { flex: 1 1 140px; min-width: 0; }
}
.log-agent {
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11.5px;
  color: var(--mk-ink);
}
.log-keyword {
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font: inherit;
  font-size: 11.5px;
  color: var(--mk-ink);
  width: 150px;
}
/* traceId/sessionId 直达输入：稍窄的等宽输入，与关键词输入同规格 */
.log-trace { width: 172px; font-family: var(--mk-mono); font-size: 11px; }
.log-auto {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--mk-muted);
  cursor: pointer;
  white-space: nowrap;
}

.log-body {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow-x: auto;
}

/* P0 修复：执行日志加载失败横幅（对齐 ts-error 规范） */
.exec-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: #c0454a;
  font-size: 13px;
  font-weight: 600;
}
.exec-error button {
  border: 1px solid rgba(239, 117, 120, 0.4);
  background: transparent;
  color: #c0454a;
  border-radius: 8px;
  padding: 4px 12px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.exec-error button:hover {
  background: rgba(239, 117, 120, 0.12);
}

/* 表头：与全站表格页同规范（sticky 顶部、uppercase 小号标签）。
   10 列模板（时间/类型/节点/消息(弹性)/模型/Tokens/耗时/状态/Trace/箭头）：
   列宽全部引用 --mk-col-* token（main.css + shared.css 4K 档覆盖，一处变量全站同步） */
.tline-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: var(--mk-col-time) 40px 200px minmax(var(--mk-col-flex-min), var(--mk-col-flex-max)) var(--mk-col-model) var(--mk-col-num-wide) 44px var(--mk-col-badge) 88px 18px;
  gap: 8px;
  align-items: baseline;
  padding: 9px 14px;
  background: #fafbfc;
  border-bottom: 1px solid var(--mk-line);
  border-radius: 12px 12px 0 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint);
  white-space: nowrap;
}
.tline-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
}

.tline { border-bottom: 1px solid #f0f2f5; box-shadow: inset 3px 0 0 0 transparent; }
.tline:last-child { border-bottom: none; }.tline--ok { box-shadow: inset 3px 0 0 0 var(--mk-green); }
.tline--err { box-shadow: inset 3px 0 0 0 var(--mk-red); background: rgba(220, 38, 38, 0.04); }
.tline--warn { box-shadow: inset 3px 0 0 0 var(--mk-amber); }

.tline__main {
  display: grid;
  grid-template-columns: var(--mk-col-time) 40px 200px minmax(var(--mk-col-flex-min), var(--mk-col-flex-max)) var(--mk-col-model) var(--mk-col-num-wide) 44px var(--mk-col-badge) 88px 18px;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  padding: 9px 14px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tline__main:hover { background: #f6f9ff; }

/* 窄屏压缩档（<860px）：时间/节点固定列再压缩，给消息列腾空间（时间 72→56、节点 200→150）。
   断点 Bug 修复：本块必须声明在 .tline-head/.tline__main 基础规则之后——
   级联按源顺序后声明者胜，旧位置（基础规则之前）的媒体块从未生效，窄屏横向滚动溢出 243px。
   列宽合计（682px）+ gap 4×9 + padding 28 ≈ 746px ≤ 860 容器 747px：压缩后不再横向溢出 */
@media (max-width: 860px) {
  .tline-head,
  .tline__main { grid-template-columns: 56px 40px 150px minmax(110px, 480px) 90px 84px 44px 44px 52px 12px; gap: 4px; }
  .tline__payload { padding-left: 56px; }
}

.tline__time {
  font-size: 11px;
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tline__kind {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.tline__kind--flow { background: #eff6ff; color: var(--mk-blue); }
.tline__kind--call { background: #f0f2f5; color: var(--mk-muted); }
.tline__kind--skill { background: #f0f7f6; color: var(--mk-teal); }
.tline__agent {
  font-size: 11px;
  color: var(--mk-blue);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tline__agent:hover { text-decoration: underline; }
.tline__msg {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  overflow: hidden;
}
.tline__msg b {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
  flex: 0 1 auto;
}
.tline__errcode {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.tline__http {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: #dc2626;
  white-space: nowrap;
}
.tline__recovered {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-amber);
  white-space: nowrap;
}
.tline__drift {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-amber);
  background: rgba(217, 119, 6, 0.1);
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
/* 模型 / Tokens 独立列（P2：从消息列 chip 提出；单行截断 + title 全值，避免行宽爆炸） */
.tline__tokens,
.tline__model {
  min-width: 0;
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tline__tokens { color: var(--mk-muted); text-align: right; }
.tline__model { color: var(--mk-faint); }
/* Prompt 契约展开区 */
.tline__prompt { border-left: 3px solid rgba(217, 119, 6, 0.4); padding-left: 10px; }
.tline__prompt-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--mk-faint); }
.tline__prompt-drift { color: var(--mk-amber); font-weight: 700; }
.tline__msg em {
  font-style: normal;
  color: var(--mk-faint);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}
.tline__dur { font-size: 11px; color: var(--mk-muted); text-align: right; font-variant-numeric: tabular-nums; }
.tline__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
}
.tline__badge--ok { background: var(--mk-green-bg); color: var(--mk-green); }
.tline__badge--warn { background: var(--mk-amber-bg); color: var(--mk-amber); }
.tline__badge--err { background: var(--mk-red-bg); color: var(--mk-red); }
/* Trace 列：单行 ellipsis（修复 30/30 行折行、行高 56px；列宽 64→88px 容纳 shortTrace「gw:…8y4tm4」） */
.tline__trace { font-size: 11px; color: var(--mk-faint); text-align: right; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tline__arrow { font-size: 11px; color: var(--mk-faint); text-align: right; transition: transform 0.15s ease; }
.tline--open .tline__arrow { transform: rotate(90deg); }
.tline__session { font-size: 11px; color: var(--mk-blue, #2c63d0); cursor: pointer; }
.tline__session:hover { text-decoration: underline; }
.tline__trace:hover { color: var(--mk-amber); text-decoration: underline; }

.tline__payload { padding: 2px 14px 12px 68px; display: grid; gap: 8px; }
.tline__payload-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
}
.tline__payload pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 240px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tline__none { margin: 0; font-size: 11.5px; color: var(--mk-faint); }
.tline__none--err { color: var(--mk-red); font-weight: 600; }
.tline__section { display: grid; gap: 4px; }
.tline__label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--mk-faint); }
.tline__label--err { color: var(--mk-red); }

/* 重试时间线 */
.tline-attempts { display: grid; gap: 6px; }
.tline-attempt {
  border: 1px solid var(--mk-line);
  border-left: 3px solid var(--mk-green);
  border-radius: 8px;
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  background: #fff;
}
.tline-attempt--fail { border-left-color: var(--mk-red); background: #fffafa; }
.tline-attempt--retry { border-left-color: var(--mk-amber); }
.tline-attempt__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tline-attempt__no { font-family: var(--mk-mono); font-size: 10.5px; font-weight: 800; color: var(--mk-muted); }
.tline-attempt__retry { font-size: 10.5px; font-weight: 700; color: var(--mk-amber); }
.tline-attempt__cache { font-weight: 700; color: var(--mk-green, #15803d); }
.tline-attempt__dur { margin-left: auto; font-size: 10.5px; color: var(--mk-faint); }
.tline-attempt__meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 10px; color: var(--mk-faint); }
.tline-attempt__err { margin: 0; font-size: 11px; color: var(--mk-red); word-break: break-all; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3，高度换算回逻辑坐标） ========== */
@media (min-width: 2000px) {
  .log-status { padding: 10px 16px; }
  .log-status strong { font-size: 15.5px; }
  .log-status__meta { font-size: 13px; }
  .log-keyword { font-size: 13px; padding: 8px 12px; border-radius: 10px; width: 180px; }
  .log-trace { width: 210px; font-size: 12.5px; }
  .log-agent { font-size: 13px; padding: 8px 12px; border-radius: 10px; width: 100px; }
  .log-auto { font-size: 13px; }
  .log-adv { font-size: 13px; }
  .log-status__filter { font-size: 13px; }
  .log-status__clear { font-size: 14.5px; }
  /* 4K 档列宽由 shared.css 4K 段 token 覆盖（--mk-col-*），此处不再逐列复制模板 */
  .tline-head,
  .tline__main { gap: 12px; padding: 11px 18px; }
  .tline-head { font-size: 12.5px; }
  .tline__time,
  .tline__agent,
  .tline__dur,
  .tline__trace { font-size: 13px; }
  .tline__arrow { font-size: 13px; }
  .tline__msg { font-size: 14.5px; }
  .tline__msg em { font-size: 13px; }
  .tline__kind { font-size: 11.5px; }
  .tline__badge { font-size: 12px; }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift,
  .tline__tokens,
  .tline__model { font-size: 12px; }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: 13px; }
  .tline__none,
  .tline__label { font-size: 13px; }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: 12px; }
  .tline-attempt__err { font-size: 13px; }
  .tline__payload { padding-left: 84px; }
  .tline__payload pre { font-size: 13px; }
  .tline-attempt__no { font-size: 12px; }
  .tline-attempt__meta { font-size: 11.5px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000px 档 */
  .log-status { padding: 12px 18px; border-radius: 14px; }
}
@media (min-width: 3600px) {
  /* zoom 1.3 档：字号继续放大 */
  .log-status { padding: 14px 22px; }
  .log-status strong { font-size: 18px; }
  .log-status__meta { font-size: 15px; }
  .log-keyword { font-size: 15.5px; padding: 9px 14px; width: 215px; }
  .log-trace { width: 250px; font-size: 15px; }
  .log-agent { font-size: 15.5px; padding: 9px 14px; width: 115px; }
  .log-auto { font-size: 15.5px; }
  .log-adv { font-size: 15.5px; }
  .log-status__filter { font-size: 15.5px; }
  .log-status__clear { font-size: 17px; }
  /* 4K 档列宽由 shared.css 4K 段 token 覆盖 */
  .tline-head,
  .tline__main { gap: 14px; padding: 13px 22px; }
  .tline-head { font-size: 14.5px; }
  .tline__time,
  .tline__agent,
  .tline__dur,
  .tline__trace { font-size: 15.5px; }
  .tline__arrow { font-size: 15.5px; }
  .tline__msg { font-size: 17px; }
  .tline__msg em { font-size: 15px; }
  .tline__kind { font-size: 13.5px; }
  .tline__badge { font-size: 14px; }
  .tline__errcode,
  .tline__http,
  .tline__recovered,
  .tline__drift,
  .tline__tokens,
  .tline__model { font-size: 14px; }
  .tline__session,
  .tline__prompt-meta,
  .tline__payload-meta { font-size: 15.5px; }
  .tline__none,
  .tline__label { font-size: 15.5px; }
  .tline-attempt__retry,
  .tline-attempt__dur { font-size: 14px; }
  .tline-attempt__err { font-size: 15.5px; }
  .tline__payload { padding-left: 100px; }
  .tline__payload pre { font-size: 15.5px; }
  .tline-attempt__no { font-size: 14px; }
  .tline-attempt__meta { font-size: 13.5px; }
}
</style>
