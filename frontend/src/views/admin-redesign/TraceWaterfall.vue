<template>
  <div class="mk-page">
    <!-- 状态条：标题固定，当前选中的链路标识在 meta（结论走 dot 色） -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Trace 链路</strong>
      <span v-if="activeSpans.length" class="mk-status__meta mono" :title="viewMode === 'session' ? activeSession : activeTrace">{{ viewMode === 'session' ? `会话 ${activeSession}` : `链路 ${activeTrace}` }}</span>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ activeSpans.length }} 个 span</span>
      <span class="mk-status__meta">总耗时 {{ totalDuration }}</span>
      <span class="mk-status__meta">失败 {{ errorCount }}</span>
      <span v-if="isLive" class="mk-status__meta mono" :title="waterfallTotal ? '本地已加载 vs 服务端全量' : '全量数据待服务端返回'">
        样本 {{ waterfallSpans?.length ?? 0 }} / 全量 {{ waterfallTotal || '—' }}
      </span>
      <span
        v-if="waterfallCapReached"
        class="mk-status__meta"
        title="为保持流畅已停止追加；全量数据见左侧计数"
      >已达本地样本上限 {{ WATERFALL_MAX_SPANS }} 条，停止追加</span>
      <button
        v-if="failedTraceIds.length"
        type="button"
        class="wf-locate mk-link"
        @click="locateFailure"
      >
        {{ failedTraceIds.length }} 条链路含失败，定位 →
      </button>
      <div class="wf-tracepick">
        <span v-if="sessionIds.length" class="mk-pills wf-mode">
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': viewMode === 'trace' }"
            :aria-pressed="viewMode === 'trace'"
            @click="viewMode = 'trace'"
          >链路</button>
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': viewMode === 'session' }"
            :aria-pressed="viewMode === 'session'"
            @click="viewMode = 'session'"
          >会话</button>
        </span>
        <span class="wf-filter">
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': failuresOnly }"
            :aria-pressed="failuresOnly"
            title="只显示失败行（err）"
            @click="failuresOnly = !failuresOnly"
          >仅失败{{ errorTotal > 0 ? ` ${errorTotal}` : '' }}</button>
          <select v-model="sortMode" class="wf-sort mono" aria-label="排序方式" title="按耗时排序">
            <option value="time">默认（时间序）</option>
            <option value="dur-desc">耗时 ↓</option>
            <option value="dur-asc">耗时 ↑</option>
          </select>
        </span>
        <template v-if="viewMode === 'session'">
          <span class="wf-tracepick__count">{{ sessionIds.length }} 个会话</span>
          <select class="wf-tracepick__select mono" v-model="activeSession" aria-label="选择会话">
            <option v-for="s in sessionIds" :key="s" :value="s">
              {{ sessionLabel(s) }}
            </option>
          </select>
        </template>
        <template v-else>
          <span class="wf-tracepick__count">{{ traceIds.length }} 条链路</span>
          <input
            v-model="traceKeyword"
            class="wf-tracepick__search mono"
            placeholder="筛选链路 ID"
            title="按链路 ID 片段过滤；输入完整 ID 后回车可服务端直达"
            @keydown.enter.prevent="searchTrace"
          />
          <select class="wf-tracepick__select mono" v-model="activeTrace" aria-label="选择链路">
            <option v-for="t in traceIds" :key="t" :value="t">
              {{ traceLabel(t) }}
            </option>
          </select>
        </template>
      </div>
    </div>

    <!-- 跳转目标不在当前加载样本内时的提示（trace/session 通用） -->
    <div v-if="notice" class="wf-notice" role="alert">
      <span>{{ notice }}</span>
      <button type="button" class="wf-notice__close" aria-label="关闭提示" @click="notice = ''">×</button>
    </div>

    <!-- 链路概要卡 -->
    <div v-if="traceSummary" class="wf-summary">
      <div class="wf-summary__item"><b>{{ traceSummary.spanCount }}</b><span>span</span></div>
      <div class="wf-summary__item"><b>{{ fmtMs(traceSummary.total) }}</b><span>总耗时</span></div>
      <div class="wf-summary__item" :class="{ 'wf-summary__item--bad': traceSummary.errorCount }"><b>{{ traceSummary.errorCount }}</b><span>失败</span></div>
      <div class="wf-summary__item"><b>{{ fmtMs(traceSummary.avg) }}</b><span>平均耗时</span></div>
      <div class="wf-summary__item wf-summary__models"><span>模型</span><b class="mono">{{ traceSummary.models.length ? traceSummary.models.join(' / ') : '—' }}</b></div>
    </div>

    <div v-if="activeSpans.length" class="wf" ref="wfRoot">
      <!-- 时间刻度 -->
      <div class="wf-ruler">
        <span class="wf-ruler__label">{{ viewMode === 'session' ? '会话内 span' : '阶段 / span' }}</span>
        <div class="wf-ruler__track" :style="rulerTrackW ? { width: rulerTrackW } : undefined">
          <span v-for="tick in ticks" :key="tick" class="wf-ruler__tick" :style="{ left: tickLeft(tick) }">
            {{ fmtTick(tick) }}
          </span>
        </div>
      </div>

      <!-- 瀑布行 -->
      <div
        v-for="span in activeSpans"
        :key="span.id"
        class="wf-row"
        :class="{ 'wf-row--open': openSpanId === span.id, 'wf-row--err': span.status === 'err' }"
      >
        <button type="button" class="wf-row__main" :aria-expanded="openSpanId === span.id" @click="openSpanId = openSpanId === span.id ? '' : span.id">
          <span class="wf-row__stage">
            <span class="wf-row__kind" :class="`wf-row__kind--${span.kind}`">{{ span.kind === 'flow' ? '流程' : '调用' }}</span>
            <span class="wf-row__stage-body">
              <span class="wf-row__stage-name" :title="`${span.stage} · ${span.agent}`">{{ span.stage }}</span>
              <span class="wf-row__stage-id mono" :title="span.agent">{{ span.agent }}</span>
            </span>
          </span>
          <span class="wf-row__track">
            <span
              class="wf-row__bar"
              :class="`wf-row__bar--${span.status}`"
              :style="{ left: barLeft(span), width: barWidth(span) }"
            ></span>
          </span>
          <span class="wf-row__tail">
            <span v-if="span.errorCode" class="wf-row__errcode mono" :title="span.errorMessage">{{ errorCodeLabel(span.errorCode) ?? `[${span.errorCategory || 'err'}] ${span.errorCode}` }}</span>
            <span v-if="promptOf(span)?.drift" class="wf-row__drift">{{ TERMS.driftRuntime }}</span>
            <span v-if="span.gatewayDurMs" class="wf-row__gw mono" :title="`网关层 ${fmtMs(span.gatewayDurMs)}（已合并同一调用记录）`">网关 {{ fmtMs(span.gatewayDurMs) }}</span>
            <span class="wf-row__dur mono">{{ fmtMs(span.durationMs) }}</span>
            <span class="wf-row__arrow" aria-hidden="true">▸</span>
          </span>
        </button>
        <div v-if="openSpanId === span.id" class="wf-row__detail">
          <div class="wf-row__detail-grid">
            <div>
              <span class="wf-detail-label">标题</span>
              <strong>{{ span.title }}</strong>
            </div>
            <div>
              <span class="wf-detail-label">摘要</span>
              <span>{{ span.detail }}</span>
            </div>
            <div>
              <span class="wf-detail-label">状态</span>
              <span class="mk-badge" :class="badgeOf(span.status)">{{ statusText(span.status) }}</span>
            </div>
          </div>
          <!-- 事实区：模型 / HTTP / 重试 / 恢复 -->
          <div v-if="span.model || span.statusCode || (span.attempts ?? 0) > 1" class="wf-facts">
            <span v-if="span.model" class="wf-fact mono" :title="span.model">模型 {{ span.model }}</span>
            <span v-if="span.statusCode" class="wf-fact mono" :class="{ 'wf-fact--bad': span.statusCode >= 400 }">HTTP {{ span.statusCode }}</span>
            <span v-if="(span.attempts ?? 0) > 1" class="wf-fact mono">尝试 {{ span.attempts }}/{{ span.maxAttempts }}</span>
            <span v-if="span.recoveredByRetry" class="wf-fact wf-fact--warn">重试 {{ (span.attempts || 1) - 1 }} 次后成功</span>
          </div>
          <!-- Prompt 契约（与执行日志同源） -->
          <div v-if="promptOf(span)" class="wf-prompt">
            <span class="wf-detail-label">Prompt 契约</span>
            <div class="wf-prompt__meta mono">
              <span>版本 v{{ promptOf(span)!.version || '—' }}</span>
              <span v-if="promptOf(span)!.drift" class="wf-prompt__drift">{{ TERMS.driftRuntime }}</span>
              <span v-if="promptOf(span)!.tokens">{{ promptOf(span)!.tokens }}</span>
              <span v-if="promptOf(span)!.errorCode">{{ errorCodeLabel(promptOf(span)!.errorCode) ?? `[${promptOf(span)!.errorCode}]` }} {{ promptOf(span)!.errorMessage }}</span>
            </div>
            <pre v-if="promptOf(span)!.userPayload" class="wf-payload">{{ promptOf(span)!.userPayload }}</pre>
            <pre v-if="promptOf(span)!.rawModelOutput" class="wf-payload">{{ promptOf(span)!.rawModelOutput }}</pre>
          </div>
          <!-- 重试时间线（live，展开时拉取） -->
          <div v-if="dataSource === 'live' && detailLoading === span.id" class="wf-facts"><span class="wf-fact">拉取重试时间线…</span></div>
          <div v-else-if="detailFailed.has(span.id)" class="wf-facts">
            <span class="wf-fact wf-fact--bad">重试时间线拉取失败</span>
            <button type="button" class="mk-link" @click="openSpanId = ''; void nextTick().then(() => openSpanId = span.id)">重试</button>
          </div>
          <div v-else-if="detailCache[span.id]?.attempts.length" class="wf-attempts">
            <span class="wf-detail-label">调用时间线{{ detailCache[span.id].attemptCount > 1 ? ` · 共 ${detailCache[span.id].attemptCount}/${detailCache[span.id].maxAttempts} 次尝试` : '' }}</span>
            <div
              v-for="(a, i) in detailCache[span.id].attempts"
              :key="i"
              class="wf-attempt"
              :class="{ 'wf-attempt--fail': !a.success, 'wf-attempt--retry': a.willRetry }"
            >
              <span class="wf-attempt__no">P#{{ a.promptAttemptNo }} · N#{{ a.transportAttemptNo }}</span>
              <span class="mk-badge" :class="a.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ a.success ? '成功' : '失败' }}</span>
              <span v-if="a.willRetry" class="wf-attempt__retry">将在 {{ a.backoffMs ?? '—' }}ms 后自动重试</span>
              <span class="wf-attempt__meta mono">
                {{ a.model || a.provider }}<template v-if="a.statusCode"> · HTTP {{ a.statusCode }}</template><template v-if="a.promptTokens != null"> · P {{ a.promptTokens }} / C {{ a.completionTokens ?? 0 }}</template>
              </span>
              <span class="wf-attempt__dur mono">{{ fmtMs(a.durationMs) }}</span>
            </div>
          </div>
          <!-- 输入/输出 -->
          <template v-if="detailCache[span.id]?.input || detailCache[span.id]?.output">
            <span v-if="detailCache[span.id]?.input" class="wf-detail-label">输入</span>
            <pre v-if="detailCache[span.id]?.input" class="wf-payload">{{ detailCache[span.id].input }}</pre>
            <span v-if="detailCache[span.id]?.output" class="wf-detail-label">输出</span>
            <pre v-if="detailCache[span.id]?.output" class="wf-payload">{{ detailCache[span.id].output }}</pre>
          </template>
          <pre v-if="span.payload" class="wf-payload">{{ span.payload }}</pre>
          <div class="wf-row__detail-actions">
            <button type="button" class="mk-link" @click.stop="openSkillDrawer(span.agent)">查看 Skill →</button>
          </div>
        </div>
      </div>

      <!-- 因果摘要：失败链 -->
      <div v-if="errorCount > 0" class="wf-verdict">
        <strong>结论</strong>
        <p>{{ verdictText }}</p>
      </div>

      <!-- 翻页：追加下一页样本（统一 mk-list-more 页脚形态，与全局加载更多页脚同构） -->
      <div v-if="canLoadMoreWaterfall" class="mk-list-more">
        <button
          type="button"
          class="mk-link"
          :disabled="waterfallLoading"
          :title="'加载下一页样本'"
          @click="loadMoreWaterfall"
        >
          {{ waterfallLoading ? '加载中…' : '加载更多样本' }}
        </button>
      </div>
    </div>

    <div v-else class="mk-empty mk-empty--min">
      <template v-if="viewMode === 'session' && !sessionIds.length">
        <strong>暂无会话数据</strong>
        <span>教学 / 目标对话等业务调用产生后，这里按 sessionId 自动跨链路归组。</span>
      </template>
      <template v-else>
        <strong>暂无链路数据</strong>
        <span>有真实调用发生后，这里按 Trace 展开完整链路。</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { spans, intent, openSkillDrawer, dataSource, isLive, type TraceSpan } from './store'
import {
  livePromptIndex,
  loadPromptIndex,
  fetchLogDetail,
  waterfallSpans,
  waterfallTotal,
  waterfallLoading,
  waterfallSyncFromBoot,
  waterfallLoadMore,
  waterfallFetchTrace,
  waterfallFetchSession,
  WATERFALL_MAX_SPANS,
  type LogDetail,
  type PromptMetaRow
} from './live'
import { statusText } from './statusText'
import { TERMS, errorCodeLabel } from './terms'

const activeTrace = ref('')
const openSpanId = ref('')
const traceKeyword = ref('')
const detailCache = ref<Record<string, LogDetail>>({})
const detailLoading = ref('')
/* 跳转目标不在当前加载样本内的提示条（trace/session 共用；用户可手动关闭） */
const notice = ref('')
/* 会话视图：跨 trace 按业务会话归组（sessionId 链路已注入，数据积累后自动出现） */
const viewMode = ref<'trace' | 'session'>('trace')
const activeSession = ref('')
/* W4：失败聚焦 + 耗时排序（作用于当前视图的行） */
const failuresOnly = ref(false)
const sortMode = ref<'time' | 'dur-desc' | 'dur-asc'>('time')

/* W1：瀑布样本源 = 服务端可扩充集合（boot 快照 + 追加页 + 直达重查）；demo 模式沿用 store 演示数据 */
const baseSpans = computed<TraceSpan[]>(() =>
  dataSource.value === 'live' ? (waterfallSpans.value ?? spans.value) : spans.value
)

/* ---- 预聚合概要（性能热点修复）----
 * 此前 pickTrace 的排序比较器每次比较都对 baseSpans 做两次全量 filter（O(t·log t·n)），
 * 下拉每个选项渲染时 traceLabel/sessionLabel 又各做一次全量 filter/reduce。
 * 现改为 baseSpans 变更时单次遍历构建概要 Map，比较器与 label 均为 O(1) 查表。
 * 口径与原实现逐字段一致（见各字段注释），排序语义不变。 */
interface TraceAgg {
  /** span 数 */
  count: number
  /** 失败 span 数 */
  errs: number
  /** 链路内最大 end 偏移 = max(startMs + durationMs)（原 pickTrace/traceLabel 的 total 口径） */
  maxEndMs: number
}
interface SessionAgg {
  spanCount: number
  /** 覆盖的 traceId 集合（traceCount = size） */
  traces: Set<string>
  errs: number
  /** 会话起点 = min(ts ?? 0)，与原 sessionOf 口径一致（缺 ts 记为 0） */
  startTs: number
  /** 会话终点 = max((ts ?? 0) + durationMs) */
  endTs: number
}

const traceAggMap = computed<Map<string, TraceAgg>>(() => {
  const m = new Map<string, TraceAgg>()
  for (const s of baseSpans.value) {
    let a = m.get(s.traceId)
    if (!a) {
      a = { count: 0, errs: 0, maxEndMs: 0 }
      m.set(s.traceId, a)
    }
    a.count++
    if (s.status === 'err') a.errs++
    const end = s.startMs + s.durationMs
    if (end > a.maxEndMs) a.maxEndMs = end
  }
  return m
})

const sessionAggMap = computed<Map<string, SessionAgg>>(() => {
  const m = new Map<string, SessionAgg>()
  for (const s of baseSpans.value) {
    const sid = s.sessionId
    if (!sid) continue
    let a = m.get(sid)
    if (!a) {
      a = { spanCount: 0, traces: new Set(), errs: 0, startTs: Infinity, endTs: -Infinity }
      m.set(sid, a)
    }
    a.spanCount++
    a.traces.add(s.traceId)
    if (s.status === 'err') a.errs++
    // 缺 ts 的 span 不计入时间刻度起点/终点：归零会导致 epoch 偏移使瀑布报废
    if (s.ts != null) {
      const ts = s.ts
      if (ts < a.startTs) a.startTs = ts
      const e = ts + s.durationMs
      if (e > a.endTs) a.endTs = e
    }
  }
  return m
})

/* Prompt 契约索引（与执行日志同源：同 traceId 关联 prompt_call_logs） */
onMounted(() => {
  if (dataSource.value === 'live') void loadPromptIndex()
  waterfallSyncFromBoot()
  observeRowTrack()
})
onBeforeUnmount(() => {
  trackObserver?.disconnect()
})
// demo → live 切换后重载（与 ExecLogs 一致）
watch(dataSource, () => {
  if (dataSource.value === 'live') {
    void loadPromptIndex()
    waterfallSyncFromBoot()
  }
})
function promptOf(span: { traceId: string; agent: string }): PromptMetaRow | undefined {
  const list = livePromptIndex.value[span.traceId]
  if (!list?.length) return undefined
  return list.find((p) => p.agentId.replace(/^skill:/, '') === span.agent || `skill:${span.agent}` === p.agentId)
}

/* 展开时拉取重试时间线 + 输入输出（live）；detailCache 上限见下方 setDetail */
const DETAIL_CACHE_MAX = 50

/** 简单 LRU：插入新条目，超过上限时淘汰最早插入的条目 */
function setDetail(id: string, d: LogDetail) {
  const next = { ...detailCache.value, [id]: d }
  const keys = Object.keys(next)
  if (keys.length > DETAIL_CACHE_MAX) {
    for (const k of keys.slice(0, keys.length - DETAIL_CACHE_MAX)) delete next[k]
  }
  detailCache.value = next
  // 详情拉取成功，清除失败标记（对齐 ExecLogs 的 detailFailed 模式）
  detailFailed.value.delete(id)
}

const detailFailed = ref(new Set<string>())

watch(openSpanId, async (id) => {
  if (!id || dataSource.value !== 'live' || detailCache.value[id]) return
  detailLoading.value = id
  try {
    setDetail(id, await fetchLogDetail(id))
  } catch {
    setDetail(id, { attempts: [], attemptCount: 0, maxAttempts: 1 })
    detailFailed.value.add(id)
  } finally {
    if (detailLoading.value === id) detailLoading.value = ''
  }
})

/* 长 trace ID 在下拉与标题中截断显示 */
/* TDZ 修复：intent.sessionId / intentTraceMiss 的 immediate watch 会引用本函数，必须先于 watch 声明 */
const shortTrace = (t: string) => (t.length > 20 ? `…${t.slice(-16)}` : t)

const allTraceIds = computed(() => [...new Set(baseSpans.value.map((s) => s.traceId))])

// intent.traceId 驱动（从日志/总览跳进来时预填）
// TDZ 修复：必须声明在 allTraceIds 之后（immediate watch 在 const 初始化前执行会抛
// ReferenceError: Cannot access 'allTraceIds' before initialization，见 ADMIN_DEEP_VLAB_TRACE_AUDIT W6）
watch(
  () => intent.traceId,
  async (t) => {
    if (!t) return
    viewMode.value = 'trace'
    if (allTraceIds.value.includes(t)) {
      activeTrace.value = t
      return
    }
    // W1 直达：样本外 trace 不再只给提示——服务端按 traceId 整链路重查后选中
    if (dataSource.value === 'live') {
      const found = await waterfallFetchTrace(t)
      if (found && allTraceIds.value.includes(t)) {
        activeTrace.value = t
        notice.value = ''
      } else if (!found) {
        notice.value = `链路 ${shortTrace(t)} 未找到（服务端无此 traceId 记录）`
      }
    }
  },
  { immediate: true }
)

const traceIds = computed(() => {
  const q = traceKeyword.value.trim().toLowerCase()
  if (!q) return allTraceIds.value
  return allTraceIds.value.filter((t) => t.toLowerCase().includes(q))
})
/** 默认链路选择：span 数多 → 含失败 → 总耗时最长（避开探测型单 span 链路）。
 *  排序语义不变（V8 sort 稳定，键序 count ↓ / 含失败 ↓ / maxEnd ↓）；
 *  分数改读预聚合 traceAggMap——此前每次比较全量 filter 两次，O(t·log t·n)。 */
function pickTrace(ids: string[]): string {
  if (!ids.length) return ''
  const aggs = traceAggMap.value
  const score = (id: string): readonly [number, number, number] => {
    const a = aggs.get(id)
    return [a?.count ?? 0, a && a.errs > 0 ? 1 : 0, a?.maxEndMs ?? 0]
  }
  return [...ids].sort((a, b) => {
    const [sa, ea, ta] = score(a)
    const [sb, eb, tb] = score(b)
    return sb - sa || eb - ea || tb - ta
  })[0]
}
watch(
  allTraceIds,
  (ids) => {
    const cur = activeTrace.value
    if (ids.includes(cur)) return
    const preferred = intent.traceId && ids.includes(intent.traceId) ? intent.traceId : pickTrace(ids)
    activeTrace.value = preferred
  },
  { immediate: true }
)

/* intent.traceId 不在当前加载样本内时提示（样本到达后自动恢复选中并清除提示） */
const intentTraceMiss = computed(() => {
  const t = intent.traceId
  if (!t || !allTraceIds.value.length || allTraceIds.value.includes(t)) return ''
  return t
})
watch(intentTraceMiss, (t) => {
  if (t) notice.value = `链路 ${shortTrace(t)} 不在当前加载范围内（样本截断），已自动展示最相关链路`
  else if (notice.value) notice.value = ''
})

const spansOfTrace = computed(() =>
  baseSpans.value
    .filter((s) => s.traceId === activeTrace.value)
    .sort((a, b) => a.startMs - b.startMs)
)

/* ---- 会话分组视图：同一业务会话的调用跨 trace 汇总 ---- */
const sessionIds = computed(() => {
  const order = new Map<string, number>()
  for (const s of baseSpans.value) {
    if (!s.sessionId) continue
    const t = s.ts ?? Number.MAX_SAFE_INTEGER
    const cur = order.get(s.sessionId)
    if (cur === undefined || t < cur) order.set(s.sessionId, t)
  }
  return [...order.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
})
function sessionOf(id: string) {
  /* 读预聚合 sessionAggMap（此前每次调用对 baseSpans 全量 filter/reduce） */
  const a = sessionAggMap.value.get(id)
  return {
    spanCount: a?.spanCount ?? 0,
    traceCount: a ? a.traces.size : 0,
    errs: a?.errs ?? 0,
    start: a ? a.startTs : Infinity,
    end: a ? a.endTs : -Infinity
  }
}
const spansOfSession = computed(() => {
  const id = activeSession.value
  if (!id) return []
  const mine = baseSpans.value.filter((s) => s.sessionId === id)
  const start = Math.min(...mine.map((s) => s.ts ?? 0))
  return mine
    .map((s) => ({ ...s, startMs: Math.max(0, (s.ts ?? start) - start) }))
    .sort((a, b) => a.startMs - b.startMs)
})
const activeSpans = computed(() => {
  const list = viewMode.value === 'session' ? spansOfSession.value : spansOfTrace.value
  // W4：失败聚焦 + 耗时排序（排序作用于过滤后的行，不改变原视图顺序之外的口径）
  let rows = failuresOnly.value ? list.filter((s) => s.status === 'err') : list
  if (sortMode.value === 'dur-desc') rows = [...rows].sort((a, b) => b.durationMs - a.durationMs)
  else if (sortMode.value === 'dur-asc') rows = [...rows].sort((a, b) => a.durationMs - b.durationMs)
  return rows
})
watch(
  sessionIds,
  (ids) => {
    // 目标会话在样本中出现时恢复选中并清除提示（样本到达的自动恢复）
    const wanted = intent.sessionId
    if (wanted && ids.includes(wanted)) {
      if (activeSession.value !== wanted) activeSession.value = wanted
      notice.value = ''
      return
    }
    const cur = activeSession.value
    if (cur && ids.includes(cur)) return
    activeSession.value = ids[0] ?? ''
  },
  { immediate: true }
)
/* 从日志/总览带 sessionId 跳入时优先会话模式；不在样本内则服务端直达重查（W1），失败再提示 */
watch(
  () => intent.sessionId,
  async (sid) => {
    if (!sid) return
    if (sessionIds.value.includes(sid)) {
      activeSession.value = sid
      viewMode.value = 'session'
      notice.value = ''
      return
    }
    if (dataSource.value === 'live') {
      const found = await waterfallFetchSession(sid)
      if (found && sessionIds.value.includes(sid)) {
        activeSession.value = sid
        viewMode.value = 'session'
        notice.value = ''
      } else if (!found) {
        notice.value = `会话 ${shortTrace(sid)} 未找到（服务端无此 sessionId 记录）`
      }
    } else {
      notice.value = `会话 ${shortTrace(sid)} 不在当前加载范围内（样本截断），无法按会话归组`
    }
  },
  { immediate: true }
)
function sessionLabel(id: string) {
  const m = sessionOf(id)
  return `${shortTrace(id)} · ${m.spanCount} span · ${m.traceCount} trace${m.errs ? ` · ${m.errs} 失败` : ''}`
}

const maxEnd = computed(() => Math.max(1, ...activeSpans.value.map((s) => s.startMs + s.durationMs)))
const errorCount = computed(() => activeSpans.value.filter((s) => s.status === 'err').length)
const totalDuration = computed(() => fmtMs(maxEnd.value))

const statusTone = computed(() => (!activeSpans.value.length ? 'mk-status--muted' : errorCount.value ? 'mk-status--bad' : 'mk-status--ok'))

/* 全链路失败提示 + 定位 */
const failedTraceIds = computed(() => [...new Set(baseSpans.value.filter((s) => s.status === 'err').map((s) => s.traceId))])
function locateFailure() {
  const ids = failedTraceIds.value
  if (!ids.length) return
  if (!ids.includes(activeTrace.value)) activeTrace.value = ids[0]
}

/* W1：加载更多样本（服务端分页追加）+ traceId 直达搜索 */
/* 本地样本上限：行列表无虚拟化，达到 WATERFALL_MAX_SPANS 后停止追加并提示 */
const waterfallCapReached = computed(
  () => dataSource.value === 'live' && (waterfallSpans.value?.length ?? 0) >= WATERFALL_MAX_SPANS
)
const canLoadMoreWaterfall = computed(() =>
  dataSource.value === 'live'
  && waterfallSpans.value !== null
  && waterfallTotal.value > 0
  && (waterfallSpans.value?.length ?? 0) < waterfallTotal.value
  && !waterfallCapReached.value
  && !waterfallLoading.value
)
async function loadMoreWaterfall() {
  if (!isLive.value) return
  await waterfallLoadMore()
}
/** 输入完整 traceId 回车 → 服务端直达重查并选中（与执行日志 traceId 直达同模式） */
async function searchTrace() {
  const q = traceKeyword.value.trim()
  if (!q || !isLive.value) return
  const found = await waterfallFetchTrace(q)
  if (found) {
    activeTrace.value = q
    notice.value = ''
  } else {
    notice.value = `未找到链路 ${shortTrace(q)}（服务端无匹配记录）`
  }
}

/* 链路概要卡 */
const traceSummary = computed(() => {
  const s = activeSpans.value
  if (!s.length) return null
  const models = [...new Set(s.map((x) => x.model).filter(Boolean))]
  const avg = Math.round(s.reduce((a, x) => a + x.durationMs, 0) / s.length)
  return { spanCount: s.length, total: maxEnd.value, errorCount: errorCount.value, models, avg }
})

// 刻度：按总量程取 ~8 档自适应步长（人读友好 1/2/5×10^n 序列），
// 修复长链路固定 10s/格导致 700s 链路渲染 71 个刻度挤爆表头的问题
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000]
function niceTickStep(endMs: number): number {
  const target = endMs / 8
  for (const s of TICK_STEPS) if (target <= s) return s
  return TICK_STEPS[TICK_STEPS.length - 1]
}
const ticks = computed(() => {
  const end = maxEnd.value
  const step = niceTickStep(end)
  const out: number[] = []
  for (let t = 0; t <= end; t += step) out.push(t)
  return out
})
/** 刻度标签紧凑格式：0 / 500ms / 30s / 2m / 1h（长链路不再出现 700s 一长串数字） */
const fmtTick = (t: number) =>
  t === 0 ? '0'
    : t >= 3600000 ? `${Math.round(t / 3600000)}h`
    : t >= 60000 ? `${Math.round(t / 60000)}m`
    : t >= 1000 ? `${Math.round(t / 1000)}s`
    : `${t}ms`

const tickLeft = (t: number) => `${(t / maxEnd.value) * 100}%`
const barLeft = (s: TraceSpan) => `${(s.startMs / maxEnd.value) * 100}%`
const barWidth = (s: TraceSpan) => `${Math.max((s.durationMs / maxEnd.value) * 100, 1.2)}%`

/* 表头刻度与瀑布轨道对齐（F9）：
   .wf-row__main 为 280px 1fr auto 三列，行尾列(auto)宽度随内容变化 → 各行 1fr 轨道宽度不一致；
   刻度行只有两列，若宽度不同则 tick(%) 与 bar(%) 不在同一坐标系（4K 放大后肉眼可见错位）。
   方案：刻度轨道宽度取首行实际轨道宽度。offsetWidth 是布局逻辑宽（zoom 下不受全局缩放影响，
   getBoundingClientRect().width 是物理宽），直接设 width: offsetWidth px 即可与轨道逐像素对齐；
   用 ResizeObserver 监听行轨道，字体加载 / 窗口缩放 / 数据切换导致行尾列宽度变化时自动重校。 */
const wfRoot = ref<HTMLElement | null>(null)
const rulerTrackW = ref<string | null>(null)
let trackObserver: ResizeObserver | null = null
function syncRulerTrack() {
  const root = wfRoot.value
  const track = root?.querySelector<HTMLElement>('.wf-row__track')
  if (!root || !track) {
    rulerTrackW.value = null
    return
  }
  rulerTrackW.value = `${track.offsetWidth}px`
}
function observeRowTrack() {
  trackObserver?.disconnect()
  const root = wfRoot.value
  const track = root?.querySelector<HTMLElement>('.wf-row__track')
  if (!root || !track) {
    rulerTrackW.value = null
    return
  }
  syncRulerTrack()
  trackObserver = new ResizeObserver(() => syncRulerTrack())
  trackObserver.observe(track)
}
watch(activeSpans, async () => {
  await nextTick()
  observeRowTrack()
})

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
const badgeOf = (s: string) => (s === 'err' ? 'mk-badge--bad' : s === 'warn' ? 'mk-badge--warn' : 'mk-badge--ok')

/* 长 trace ID 在下拉与标题中截断显示（shortTrace 已上移至 watch 之前，见文件上方声明） */
function traceLabel(t: string) {
  /* 读预聚合 traceAggMap（此前每个下拉选项渲染都全量 filter/reduce 一次） */
  const a = traceAggMap.value.get(t)
  const count = a?.count ?? 0
  const errs = a?.errs ?? 0
  const total = a?.maxEndMs ?? 0
  return `${shortTrace(t)} · ${count} span · ${fmtMs(total)}${errs ? ` · ${errs} 失败` : ''}`
}

/* 样本内失败总数（「仅失败」按钮角标） */
const errorTotal = computed(() => baseSpans.value.filter((s) => s.status === 'err').length)

/* 结论完全由当前视图数据推导，不带预设立场 */
const verdictText = computed(() => {
  const errs = activeSpans.value.filter((s) => s.status === 'err')
  if (!errs.length) return ''
  const first = errs[0]
  const agents = [...new Set(errs.map((s) => s.agent))]
  const slowest = activeSpans.value.reduce((a, s) => (s.durationMs > (a?.durationMs || 0) ? s : a), errs[0])
  const parts = [
    `首次失败出现在 ${first.agent}（${first.title}，耗时 ${fmtMs(first.durationMs)}）。`,
    `本链路共 ${errs.length} 次失败，涉及 ${agents.length} 个节点：${agents.join('、')}。`,
    `最慢节点为 ${slowest.agent}（${fmtMs(slowest.durationMs)}）。`
  ]
  if (first.payload) parts.push(`首个错误：${first.payload.slice(0, 120)}`)
  return parts.join('')
})
</script>

<style scoped>
.wf {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
}

/* 链路选择器：替代 pills，避免长 trace ID 挤爆状态条 */
.wf-title {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wf-tracepick {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wf-locate { flex-shrink: 0; font-size: 11.5px; }
.wf-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wf-sort {
  padding: 6px 8px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11px;
  color: var(--mk-ink);
  outline: none;
}
.wf-sort:focus { border-color: rgba(44, 99, 208, 0.5); }

/* 跳转目标不在当前加载样本内的提示条（琥珀色，与失败/漂移徽章同族） */
.wf-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 10px;
  background: #fff8ec;
  color: #b45309;
  font-size: 12px;
  box-shadow: var(--mk-shadow-sm);
}
.wf-notice__close {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.wf-notice__close:hover { opacity: 0.7; }

/* 链路 / 会话视图切换 */
.wf-mode {
  margin-bottom: 10px;
}/* 链路概要卡 */
.wf-summary {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: var(--mk-surface);
  overflow: hidden;
}
.wf-summary__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 10px 22px;
  min-width: 96px;
  border-right: 1px solid var(--mk-line);
}
.wf-summary__item:last-child { border-right: none; }
.wf-summary__item b { font-size: 16px; font-weight: 700; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.wf-summary__item span { font-size: 11px; color: var(--mk-faint); }
.wf-summary__item--bad b { color: var(--mk-red); }
.wf-summary__models { flex: 1; align-items: flex-start; justify-content: center; min-width: 0; }
.wf-summary__models b {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.wf-tracepick__count { font-size: 11.5px; color: var(--mk-faint); white-space: nowrap; }
.wf-tracepick__search {
  width: 120px;
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11px;
  color: var(--mk-ink);
  outline: none;
}
.wf-tracepick__search:focus { border-color: rgba(44, 99, 208, 0.5); }
.wf-tracepick__select {
  max-width: 320px;
  padding: 6px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11.5px;
  color: var(--mk-ink);
}

.wf-ruler {
  display: grid;
  grid-template-columns: 280px 1fr;
  /* F9：与 .wf-row__main 同 gap（12px），刻度轨道起始与瀑布轨道一致；
     轨道宽度由 syncRulerTrack() 按首行实测值设置（行尾列 auto 宽度不定） */
  gap: 12px;
  align-items: center;
  /* 表头与数据行对齐：.wf-row__main 有 padding 9px 14px，表头需一致，否则时间刻度条与瀑布轨道错位（4K 放大后肉眼可见） */
  padding: 9px 14px;
  border-bottom: 1px solid var(--mk-line);
  background: #fafbfc;
}
.wf-ruler__label {
  padding: 0;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.wf-ruler__track { position: relative; height: 26px; }
.wf-ruler__tick {
  position: absolute;
  top: 4px;
  font-size: 10px;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  transform: translateX(-50%);
}
.wf-ruler__tick::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 12px;
  width: 1px;
  height: 6px;
  background: var(--mk-line);
}

.wf-row { border-bottom: 1px solid #f0f2f5; }
.wf-row:last-of-type { border-bottom: none; }
.wf-row--open { background: #fafbff; }
.wf-row--err { background: rgba(220, 38, 38, 0.04); }
.wf-row--err.wf-row--open { background: rgba(220, 38, 38, 0.06); }
.wf-row__main {
  display: grid;
  grid-template-columns: 280px 1fr auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 9px 14px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wf-row__main:hover { background: #f6f9ff; }
.wf-row--err .wf-row__main:hover { background: rgba(220, 38, 38, 0.06); }

.wf-row__stage {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wf-row__stage-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.wf-row__stage-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wf-row__stage-id {
  font-size: 10px;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wf-row__kind {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.wf-row__kind--flow { background: #eff6ff; color: var(--mk-blue); }
.wf-row__kind--call { background: #f0f2f5; color: var(--mk-muted); }

.wf-row__track {
  position: relative;
  height: 20px;
  background: #f3f5fa;
  border-radius: 5px;
  overflow: hidden;
}
.wf-row__bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding: 0 6px;
  min-width: 4px;
}
.wf-row__bar--ok { background: linear-gradient(90deg, #6aa0ff, #3d7cff); }
.wf-row__bar--warn { background: linear-gradient(90deg, #fcd34d, #f59e0b); }
.wf-row__bar--err { background: linear-gradient(90deg, #f87171, #dc2626); }

.wf-row__dur { font-size: 11px; color: var(--mk-muted); text-align: right; }
.wf-row__arrow { font-size: 11px; color: var(--mk-faint); transition: transform 0.15s ease; }
.wf-row--open .wf-row__arrow { transform: rotate(90deg); }
.wf-row__gw {
  font-size: 10.5px;
  color: var(--mk-faint);
  background: #f0f2f5;
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
}
.wf-row__tail { display: flex; align-items: center; gap: 8px; justify-content: flex-end; min-width: 0; }
.wf-row__errcode {
  font-size: 10.5px;
  font-weight: 700;
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
}
.wf-row__drift {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-amber);
  background: rgba(217, 119, 6, 0.1);
  border-radius: 4px;
  padding: 1px 6px;
  white-space: nowrap;
}

/* 展开：事实区 / Prompt 契约 / 重试时间线 */
.wf-facts { display: flex; gap: 8px; flex-wrap: wrap; }
.wf-fact {
  font-size: 11px;
  color: var(--mk-muted);
  background: #f0f2f5;
  border-radius: 4px;
  padding: 2px 8px;
}
.wf-fact--bad { color: #dc2626; background: rgba(220, 38, 38, 0.08); }
.wf-fact--warn { color: var(--mk-amber); background: rgba(217, 119, 6, 0.1); font-weight: 700; }
.wf-prompt {
  border-left: 3px solid rgba(217, 119, 6, 0.4);
  padding-left: 10px;
  display: grid;
  gap: 6px;
}
.wf-prompt__meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--mk-faint); }
.wf-prompt__drift { color: var(--mk-amber); font-weight: 700; }
.wf-attempts { display: grid; gap: 6px; }
.wf-attempt {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  border: 1px solid var(--mk-line);
  border-left: 3px solid var(--mk-green);
  border-radius: 8px;
  padding: 7px 10px;
  background: #fff;
}
.wf-attempt--fail { border-left-color: var(--mk-red); background: #fffafa; }
.wf-attempt--retry { border-left-color: var(--mk-amber); }
.wf-attempt__no { font-family: var(--mk-mono); font-size: 10.5px; font-weight: 800; color: var(--mk-muted); }
.wf-attempt__retry { font-size: 10.5px; font-weight: 700; color: var(--mk-amber); }
.wf-attempt__meta { font-size: 10.5px; color: var(--mk-faint); }
.wf-attempt__dur { margin-left: auto; font-size: 10.5px; color: var(--mk-faint); }

.wf-row__detail { padding: 4px 14px 12px 14px; display: grid; gap: 10px; }
.wf-row__detail-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr auto;
  gap: 12px;
  align-items: start;
}
.wf-detail-label {
  display: block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mk-faint);
  margin-bottom: 3px;
}
.wf-payload {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 11px/1.6 var(--mk-mono);
  overflow: auto;
  max-height: 200px;
  white-space: pre-wrap;
  word-break: break-all;
}
.wf-row__detail-actions { display: flex; justify-content: flex-end; }

.wf-verdict {
  margin: 12px 14px 14px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(220, 38, 38, 0.2);
  background: #fef8f8;
  display: grid;
  gap: 4px;
}
.wf-verdict strong { font-size: 12px; color: var(--mk-red); }
.wf-verdict p { margin: 0; font-size: 12.5px; color: var(--mk-muted); line-height: 1.6; }

/* 窄屏：左列 280 → 180，阶段名已有 ellipsis 兜底 */
@media (max-width: 860px) {
  .wf-ruler { grid-template-columns: 180px 1fr; gap: 8px; }
  .wf-row__main { grid-template-columns: 180px 1fr auto; gap: 8px; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .wf-tracepick__count { font-size: 13px; }
  .wf-tracepick__search { font-size: 12.5px; padding: 8px 12px; width: 150px; }
  .wf-tracepick__select { font-size: 13px; padding: 8px 12px; max-width: 380px; }
  .wf-ruler { grid-template-columns: 340px 1fr; padding: 9px 14px; }
  .wf-ruler__label { font-size: 12.5px; }
  .wf-row__main { grid-template-columns: 340px 1fr auto; }
  .wf-row__stage-name { font-size: 13.5px; }
  .wf-row__stage-id { font-size: 11.5px; }
  .wf-row__dur { font-size: 13px; }
  .wf-detail-label { font-size: 12.5px; }
  .wf-payload { font-size: 13px; }
  .wf-verdict strong { font-size: 14px; }
  .wf-verdict p { font-size: 14.5px; }
}
@media (min-width: 2800px) {
  /* zoom 1.15 档：字号沿用 2000px 档 */
  .wf-tracepick__count { font-size: 15.5px; }
  .wf-tracepick__search { font-size: 15px; padding: 10px 14px; width: 180px; }
  .wf-tracepick__select { font-size: 15.5px; padding: 10px 14px; max-width: 460px; }
  .wf-ruler { grid-template-columns: 400px 1fr; padding: 9px 14px; }
  .wf-ruler__label { font-size: 15px; }
  .wf-row__main { grid-template-columns: 400px 1fr auto; }
  .wf-row__stage-name { font-size: 16px; }
  .wf-row__stage-id { font-size: 13.5px; }
  .wf-row__dur { font-size: 15.5px; }
  .wf-detail-label { font-size: 15px; }
  .wf-payload { font-size: 15.5px; }
  .wf-verdict strong { font-size: 16.5px; }
  .wf-verdict p { font-size: 17px; }
}
@media (min-width: 3600px) {
  /* 4K 分辨率（zoom 1.3 档）：字号继续放大 */
  .wf-ruler { grid-template-columns: 460px 1fr; padding: 9px 14px; }
  .wf-ruler__label { font-size: 17.5px; }
  .wf-row__main { grid-template-columns: 460px 1fr auto; }
  .wf-row__stage-name { font-size: 18.5px; }
  .wf-row__stage-id { font-size: 16px; }
  .wf-row__dur { font-size: 18px; }
  .wf-tracepick__search { font-size: 17.5px; padding: 12px 16px; width: 210px; }
  .wf-tracepick__select { font-size: 18px; padding: 12px 16px; max-width: 540px; }
  .wf-detail-label { font-size: 17.5px; }
  .wf-payload { font-size: 18px; }
  .wf-verdict strong { font-size: 19px; }
  .wf-verdict p { font-size: 19.5px; }
}
</style>
