<template>
  <div class="mk-page">
    <!-- 终端状态条 -->
    <div class="log-status" :class="`log-status--${statusTone}`">
      <span class="log-status__dot"></span>
      <strong>{{ statusTitle }}</strong>
      <span class="log-status__sep"></span>
      <span class="log-status__meta mono">{{ filtered.length }} / {{ totalCount }} 条</span>
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
        <input
          v-if="isLive"
          v-model="keyword"
          class="log-keyword"
          placeholder="关键词，回车查询"
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
    <div v-else-if="filtered.length" class="log-body" role="log">
      <div class="tline-head" aria-hidden="true">
        <span class="tline-head__time">时间</span>
        <span class="tline-head__kind">类型</span>
        <span class="tline-head__agent">节点</span>
        <span class="tline-head__msg">消息</span>
        <span class="tline-head__dur">耗时</span>
        <span class="tline-head__badge">状态</span>
        <span class="tline-head__trace">Trace</span>
      </div>
      <div
        v-for="log in shown"
        :key="log.id"
        class="tline"
        :class="[`tline--${log.status}`, { 'tline--open': openId === log.id }]"
      >
        <button type="button" class="tline__main" @click="openId = openId === log.id ? '' : log.id">
          <span class="tline__time mono" :title="log.ts ? new Date(log.ts).toLocaleString() : ''">{{ fmtTime(log.ts) }}</span>
          <span class="tline__kind" :class="`tline__kind--${kindTone(log)}`">{{ kindText(log) }}</span>
          <span class="tline__agent mono" @click.stop="openSkillDrawer(log.agent)">{{ log.stage }}</span>
          <span class="tline__msg" :title="[log.title, log.detail].filter(Boolean).join(' · ')">
            <b>{{ log.title }}</b>
            <span v-if="log.errorCode" class="tline__errcode mono">[{{ log.errorCategory || 'err' }}] {{ log.errorCode }}</span>
            <span v-if="log.statusCode && log.statusCode >= 400" class="tline__http mono">HTTP {{ log.statusCode }}</span>
            <em v-if="log.detail">{{ log.detail }}</em>
            <span v-if="log.recoveredByRetry" class="tline__recovered">重试 {{ (log.attempts || 1) - 1 }} 次后成功</span>
            <span v-if="promptOf(log)?.drift" class="tline__drift">漂移</span>
            <span v-if="promptOf(log)?.tokens" class="tline__tokens mono">{{ promptOf(log)!.tokens }}</span>
            <span v-if="log.model" class="tline__model mono">{{ log.model }}</span>
            <span
              v-if="log.sessionId"
              class="tline__session mono"
              title="按业务会话在瀑布中归组查看"
              @click.stop="openSession(log.sessionId)"
            >会话 {{ shortTrace(log.sessionId) }}</span>
          </span>
          <span class="tline__dur mono" :title="`${log.durationMs}ms`">{{ fmtMs(log.durationMs) }}</span>
          <span class="tline__badge" :class="`tline__badge--${log.status}`">{{ statusBadge[log.status] }}</span>
          <span class="tline__trace mono" title="在瀑布中查看完整链路" @click.stop="openTrace(log.traceId)">{{ shortTrace(log.traceId) }}</span>
        </button>
        <div v-if="openId === log.id" class="tline__payload">
          <div class="tline__payload-meta">
            <span>trace {{ log.traceId }}</span>
            <button type="button" class="mk-link" @click.stop="openTrace(log.traceId)">在瀑布中查看完整链路 →</button>
            <button v-if="log.sessionId" type="button" class="mk-link" @click.stop="openSession(log.sessionId)">按会话归组查看 →</button>
          </div>
          <template v-if="isLive">
            <p v-if="detailLoading === log.id" class="tline__none">拉取日志详情…</p>
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
                    <p v-if="a.errorMessage" class="tline-attempt__err">{{ a.errorCategory ? `[${a.errorCategory}] ` : '' }}{{ a.errorCode ? `${a.errorCode} · ` : '' }}{{ a.errorMessage }}</p>
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
                  <span v-if="promptOf(log)!.drift" class="tline__prompt-drift">漂移</span>
                  <span v-if="promptOf(log)!.tokens">{{ promptOf(log)!.tokens }}</span>
                  <span v-if="promptOf(log)!.errorCode">[{{ promptOf(log)!.errorCode }}] {{ promptOf(log)!.errorMessage }}</span>
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
      <div v-if="canMore" class="tline-more">
        <button type="button" class="mk-link" @click="loadMore">加载更多（已显示 {{ shown.length }} / {{ isLive ? liveLogsTotal || filtered.length : filtered.length }}）</button>
      </div>
    </div>

    <div v-else class="mk-empty">
      <strong>{{ isFiltered ? '当前筛选无日志' : '暂无日志' }}</strong>
      <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilter">清除筛选</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { spans, intent, openTrace, openSession, openSkillDrawer, clearInvestigation, dataSource, isLive } from './store'
import { fetchLogDetail, reloadLiveSpans, loadMoreLiveSpans, liveLoading, liveLogsLoading, liveLogsError, liveLogsTotal, liveLogsHasMore, liveLogStats, livePromptIndex, liveLogsFiltered, loadPromptIndex, type LogDetail, type PromptMetaRow } from './live'
import { useLoadMore } from './useLoadMore'
import MockSkeletonTable from './SkeletonTable.vue'

const openId = ref('')
const statusFilter = ref('')
const agentFilter = ref('')
const timeRange = ref<'today' | 'yesterday' | 'week' | 'month' | 'all'>('week')
const keyword = ref('')
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

/* live 模式：服务端筛选（时间范围/关键词）。
   reloadLiveSpans 写入独立的 liveLogsFiltered（不污染全局 liveSpans）；
   并发与 last-wins 由 live.ts 串行化保证（loading 反馈见 liveLogsLoading） */
async function applyServerQuery() {
  if (!isLive.value) return
  await reloadLiveSpans({
    timeRange: timeRange.value,
    keyword: keyword.value.trim() || undefined
  })
}

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
      void applyServerQuery()
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

// 从排查意图进入时应用过滤
watch(
  () => [intent.agentFilter, intent.statusFilter],
  () => {
    agentFilter.value = intent.agentFilter
    statusFilter.value = intent.statusFilter
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

/* 长列表分批渲染：每批 50 行（demo）；live 模式展示服务端已加载的全部行，
   「加载更多」改为拉取后端下一页（liveLogsHasMore 驱动按钮显隐） */
const { shown: demoShown, canMore: demoCanMore, loadMore: demoLoadMore } = useLoadMore(filtered, 50)
const shown = computed(() => (isLive.value ? filtered.value : demoShown.value))
const canMore = computed(() => (isLive.value ? liveLogsHasMore.value : demoCanMore.value))
function loadMore() {
  if (isLive.value) {
    void loadMoreLiveSpans({
      timeRange: timeRange.value,
      keyword: keyword.value.trim() || undefined
    })
    return
  }
  demoLoadMore()
}

const isFiltered = computed(() => !!(agentFilter.value || statusFilter.value || keyword.value.trim()))
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
/* 排查徽章：读本地筛选（修复此前读 intent 导致的空值）；live 下补充关键词与时间范围 */
const timeRangeLabels = { today: '今天', yesterday: '昨天', week: '近 7 天', month: '近 30 天', all: '全部' } as const
const filterLabel = computed(() =>
  [
    isLive.value && timeRange.value !== 'week' ? timeRangeLabels[timeRange.value] : '',
    agentFilter.value || '',
    statusFilter.value === 'err' ? '仅失败' : statusFilter.value === 'warn' ? '仅超时' : statusFilter.value === 'ok' ? '仅成功' : '',
    keyword.value.trim() ? `关键词「${keyword.value.trim()}」` : ''
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
  clearInvestigation()
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
const statusBadge = { ok: '成功', warn: '超时', err: '失败' } as const
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
.log-adv:hover { border-color: rgba(52, 120, 246, 0.4); color: var(--mk-ink); }
.log-adv--on { border-color: rgba(52, 120, 246, 0.5); color: var(--mk-blue); background: #eef5ff; }
.log-adv__caret { font-style: normal; font-size: 10px; transition: transform 0.15s ease; }
.log-adv__caret.is-open { transform: rotate(180deg); }
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
/* 窄屏：压缩时间/节点固定列，给消息列腾空间（时间 72→56、节点 240→160） */
@media (max-width: 860px) {
  .tline-head,
  .tline__main { grid-template-columns: 56px 40px 160px minmax(200px, 480px) 44px 44px 56px; gap: 8px; }
  .tline__payload { padding-left: 56px; }
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

/* 表头：与全站表格页同规范（sticky 顶部、uppercase 小号标签） */
.tline-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: 72px 40px 240px minmax(200px, 480px) 44px 44px 72px;
  gap: 10px;
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

.tline { border-left: 3px solid transparent; border-bottom: 1px solid #f0f2f5; }
.tline:last-child { border-bottom: none; }.tline--ok { border-left-color: var(--mk-green); }
.tline--err { border-left-color: var(--mk-red); background: rgba(220, 38, 38, 0.04); }
.tline--warn { border-left-color: var(--mk-amber); }

.tline__main {
  display: grid;
  grid-template-columns: 72px 40px 240px minmax(200px, 480px) 44px 44px 72px;
  gap: 10px;
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
.tline__tokens {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--mk-muted);
  white-space: nowrap;
}
.tline__model {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--mk-faint);
  white-space: nowrap;
}
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
.tline__badge--err { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
.tline__trace { font-size: 11px; color: var(--mk-faint); text-align: right; }
.tline__session { font-size: 11px; color: #3478f6; cursor: pointer; }
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
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.6 'JetBrains Mono', monospace;
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
  .tline-head,
  .tline__main { grid-template-columns: 84px 48px 285px minmax(240px, 560px) 52px 52px 84px; gap: 12px; padding: 11px 18px; }
  .tline-head { font-size: 12.5px; }
  .tline__time,
  .tline__agent,
  .tline__dur,
  .tline__trace { font-size: 13px; }
  .tline__msg { font-size: 14.5px; }
  .tline__msg em { font-size: 13px; }
  .tline__kind { font-size: 11.5px; }
  .tline__badge { font-size: 12px; }
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
  .tline-head,
  .tline__main { grid-template-columns: 100px 56px 340px minmax(260px, 640px) 62px 62px 100px; gap: 14px; padding: 13px 22px; }
  .tline-head { font-size: 14.5px; }
  .tline__time,
  .tline__agent,
  .tline__dur,
  .tline__trace { font-size: 15.5px; }
  .tline__msg { font-size: 17px; }
  .tline__msg em { font-size: 15px; }
  .tline__kind { font-size: 13.5px; }
  .tline__badge { font-size: 14px; }
  .tline__payload { padding-left: 100px; }
  .tline__payload pre { font-size: 15.5px; }
  .tline-attempt__no { font-size: 14px; }
  .tline-attempt__meta { font-size: 13.5px; }
}
</style>
