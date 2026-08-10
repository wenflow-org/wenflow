<template>
  <div class="mk-page">
    <!-- 状态条：当前选中的链路 -->
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title wf-title" :title="activeTrace">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ activeSpans.length }} 个 span</span>
      <span class="mk-status__meta">总耗时 {{ totalDuration }}</span>
      <span class="mk-status__meta">失败 {{ errorCount }}</span>
      <button
        v-if="failedTraceIds.length"
        type="button"
        class="wf-locate mk-link"
        @click="locateFailure"
      >
        {{ failedTraceIds.length }} 条链路含失败，定位 →
      </button>
      <div class="wf-tracepick">
        <span v-if="sessionIds.length" class="wf-mode">
          <button
            type="button"
            class="wf-mode__btn"
            :class="{ 'wf-mode__btn--on': viewMode === 'trace' }"
            @click="viewMode = 'trace'"
          >链路</button>
          <button
            type="button"
            class="wf-mode__btn"
            :class="{ 'wf-mode__btn--on': viewMode === 'session' }"
            @click="viewMode = 'session'"
          >会话</button>
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
            title="按链路 ID 片段过滤"
          />
          <select class="wf-tracepick__select mono" v-model="activeTrace" aria-label="选择链路">
            <option v-for="t in traceIds" :key="t" :value="t">
              {{ traceLabel(t) }}
            </option>
          </select>
        </template>
      </div>
    </div>

    <!-- 链路概要卡 -->
    <div v-if="traceSummary" class="wf-summary">
      <div class="wf-summary__item"><b>{{ traceSummary.spanCount }}</b><span>span</span></div>
      <div class="wf-summary__item"><b>{{ fmtMs(traceSummary.total) }}</b><span>总耗时</span></div>
      <div class="wf-summary__item" :class="{ 'wf-summary__item--bad': traceSummary.errorCount }"><b>{{ traceSummary.errorCount }}</b><span>失败</span></div>
      <div class="wf-summary__item"><b>{{ fmtMs(traceSummary.avg) }}</b><span>平均耗时</span></div>
      <div class="wf-summary__item wf-summary__models"><span>模型</span><b class="mono">{{ traceSummary.models.length ? traceSummary.models.join(' / ') : '—' }}</b></div>
    </div>

    <div v-if="activeSpans.length" class="wf">
      <!-- 时间刻度 -->
      <div class="wf-ruler">
        <span class="wf-ruler__label">{{ viewMode === 'session' ? '会话内 span' : '阶段 / span' }}</span>
        <div class="wf-ruler__track">
          <span v-for="tick in ticks" :key="tick" class="wf-ruler__tick" :style="{ left: tickLeft(tick) }">
            {{ tick >= 1000 ? `${tick / 1000}s` : `${tick}ms` }}
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
        <button type="button" class="wf-row__main" @click="openSpanId = openSpanId === span.id ? '' : span.id">
          <span class="wf-row__stage">
            <span class="wf-row__kind" :class="`wf-row__kind--${span.kind}`">{{ span.kind === 'flow' ? '流程' : '调用' }}</span>
            <span class="wf-row__stage-body">
              <span class="wf-row__stage-name" :title="`${span.stage} · ${span.agent}`">{{ span.stage }}</span>
              <span class="wf-row__stage-id mono">{{ span.agent }}</span>
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
            <span v-if="span.errorCode" class="wf-row__errcode mono" :title="span.errorMessage">[{{ span.errorCategory || 'err' }}] {{ span.errorCode }}</span>
            <span v-if="promptOf(span)?.drift" class="wf-row__drift">漂移</span>
            <span v-if="span.gatewayDurMs" class="wf-row__gw mono" :title="`网关层 ${fmtMs(span.gatewayDurMs)}（已合并同一调用记录）`">网关 {{ fmtMs(span.gatewayDurMs) }}</span>
            <span class="wf-row__dur mono">{{ fmtMs(span.durationMs) }}</span>
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
              <span v-if="promptOf(span)!.drift" class="wf-prompt__drift">漂移</span>
              <span v-if="promptOf(span)!.tokens">{{ promptOf(span)!.tokens }}</span>
              <span v-if="promptOf(span)!.errorCode">[{{ promptOf(span)!.errorCode }}] {{ promptOf(span)!.errorMessage }}</span>
            </div>
            <pre v-if="promptOf(span)!.userPayload" class="wf-payload">{{ promptOf(span)!.userPayload }}</pre>
            <pre v-if="promptOf(span)!.rawModelOutput" class="wf-payload">{{ promptOf(span)!.rawModelOutput }}</pre>
          </div>
          <!-- 重试时间线（live，展开时拉取） -->
          <div v-if="dataSource === 'live' && detailLoading === span.id" class="wf-facts"><span class="wf-fact">拉取重试时间线…</span></div>
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
    </div>

    <div v-else class="mk-empty">
      <template v-if="viewMode === 'session' && !sessionIds.length">
        <strong>暂无会话数据</strong>
        <span>教学 / 目标对话等业务调用产生后，这里按 sessionId 自动跨链路归组。</span>
      </template>
      <template v-else>
        <strong>暂无链路数据</strong>
        <span>有真实调用发生后，这里按 Trace 展开完整瀑布。</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { spans, intent, openSkillDrawer, dataSource, type TraceSpan } from './store'
import { livePromptIndex, loadPromptIndex, fetchLogDetail, type LogDetail, type PromptMetaRow } from './live'
import { statusText } from './statusText'

const activeTrace = ref('')
const openSpanId = ref('')
const traceKeyword = ref('')
const detailCache = ref<Record<string, LogDetail>>({})
const detailLoading = ref('')
/* 会话视图：跨 trace 按业务会话归组（sessionId 链路已注入，数据积累后自动出现） */
const viewMode = ref<'trace' | 'session'>('trace')
const activeSession = ref('')

/* Prompt 契约索引（与执行日志同源：同 traceId 关联 prompt_call_logs） */
onMounted(() => {
  if (dataSource.value === 'live') void loadPromptIndex()
})
// demo → live 切换后重载（与 ExecLogs 一致）
watch(dataSource, () => {
  if (dataSource.value === 'live') void loadPromptIndex()
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
}

watch(openSpanId, async (id) => {
  if (!id || dataSource.value !== 'live' || detailCache.value[id]) return
  detailLoading.value = id
  try {
    setDetail(id, await fetchLogDetail(id))
  } catch {
    setDetail(id, { attempts: [], attemptCount: 0, maxAttempts: 1 })
  } finally {
    if (detailLoading.value === id) detailLoading.value = ''
  }
})

// intent.traceId 驱动（从日志/总览跳进来时预填）
watch(
  () => intent.traceId,
  (t) => {
    if (t) {
      activeTrace.value = t
      viewMode.value = 'trace'
    }
  },
  { immediate: true }
)

const allTraceIds = computed(() => [...new Set(spans.value.map((s) => s.traceId))])
const traceIds = computed(() => {
  const q = traceKeyword.value.trim().toLowerCase()
  if (!q) return allTraceIds.value
  return allTraceIds.value.filter((t) => t.toLowerCase().includes(q))
})
/** 默认链路选择：span 数多 → 含失败 → 总耗时最长（避开探测型单 span 链路） */
function pickTrace(ids: string[]): string {
  if (!ids.length) return ''
  const score = (id: string) => {
    const mine = spans.value.filter((s) => s.traceId === id)
    const errs = mine.filter((s) => s.status === 'err').length
    const total = mine.reduce((a, s) => Math.max(a, s.startMs + s.durationMs), 0)
    return [mine.length, errs > 0 ? 1 : 0, total] as const
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

const spansOfTrace = computed(() =>
  spans.value
    .filter((s) => s.traceId === activeTrace.value)
    .sort((a, b) => a.startMs - b.startMs)
)

/* ---- 会话分组视图：同一业务会话的调用跨 trace 汇总 ---- */
const sessionIds = computed(() => {
  const order = new Map<string, number>()
  for (const s of spans.value) {
    if (!s.sessionId) continue
    const t = s.ts ?? Number.MAX_SAFE_INTEGER
    const cur = order.get(s.sessionId)
    if (cur === undefined || t < cur) order.set(s.sessionId, t)
  }
  return [...order.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
})
function sessionOf(id: string) {
  const mine = spans.value.filter((s) => s.sessionId === id)
  const start = Math.min(...mine.map((s) => s.ts ?? 0))
  const end = Math.max(...mine.map((s) => (s.ts ?? 0) + s.durationMs))
  return {
    spanCount: mine.length,
    traceCount: new Set(mine.map((s) => s.traceId)).size,
    errs: mine.filter((s) => s.status === 'err').length,
    start,
    end
  }
}
const spansOfSession = computed(() => {
  const id = activeSession.value
  if (!id) return []
  const mine = spans.value.filter((s) => s.sessionId === id)
  const start = Math.min(...mine.map((s) => s.ts ?? 0))
  return mine
    .map((s) => ({ ...s, startMs: Math.max(0, (s.ts ?? start) - start) }))
    .sort((a, b) => a.startMs - b.startMs)
})
const activeSpans = computed(() => (viewMode.value === 'session' ? spansOfSession.value : spansOfTrace.value))
watch(
  sessionIds,
  (ids) => {
    const cur = activeSession.value
    if (cur && ids.includes(cur)) return
    activeSession.value = ids[0] ?? ''
  },
  { immediate: true }
)
/* 从日志/总览带 sessionId 跳入时优先会话模式 */
watch(
  () => intent.sessionId,
  (sid) => {
    if (sid && sessionIds.value.includes(sid)) {
      activeSession.value = sid
      viewMode.value = 'session'
    }
  }
)

function sessionLabel(id: string) {
  const m = sessionOf(id)
  return `${shortTrace(id)} · ${m.spanCount} span · ${m.traceCount} trace${m.errs ? ` · ${m.errs} 失败` : ''}`
}

const maxEnd = computed(() => Math.max(1, ...activeSpans.value.map((s) => s.startMs + s.durationMs)))
const errorCount = computed(() => activeSpans.value.filter((s) => s.status === 'err').length)
const totalDuration = computed(() => fmtMs(maxEnd.value))

const statusTone = computed(() => (!activeSpans.value.length ? 'mk-status--muted' : errorCount.value ? 'mk-status--bad' : 'mk-status--ok'))
const statusTitle = computed(() => {
  if (!activeSpans.value.length) return viewMode.value === 'session' ? '暂无会话数据' : '暂无链路数据'
  const scope = viewMode.value === 'session' ? `会话 ${activeSession.value}` : `链路 ${activeTrace.value}`
  return errorCount.value ? `${scope} 存在失败` : `${scope} 执行成功`
})

/* 全链路失败提示 + 定位 */
const failedTraceIds = computed(() => [...new Set(spans.value.filter((s) => s.status === 'err').map((s) => s.traceId))])
function locateFailure() {
  const ids = failedTraceIds.value
  if (!ids.length) return
  if (!ids.includes(activeTrace.value)) activeTrace.value = ids[0]
}

/* 链路概要卡 */
const traceSummary = computed(() => {
  const s = activeSpans.value
  if (!s.length) return null
  const models = [...new Set(s.map((x) => x.model).filter(Boolean))]
  const avg = Math.round(s.reduce((a, x) => a + x.durationMs, 0) / s.length)
  return { spanCount: s.length, total: maxEnd.value, errorCount: errorCount.value, models, avg }
})

// 刻度：按总量程取 4-5 档
const ticks = computed(() => {
  const end = maxEnd.value
  const step = end > 20000 ? 10000 : end > 8000 ? 4000 : end > 3000 ? 1000 : 500
  const out: number[] = []
  for (let t = 0; t <= end; t += step) out.push(t)
  return out
})

const tickLeft = (t: number) => `${(t / maxEnd.value) * 100}%`
const barLeft = (s: TraceSpan) => `${(s.startMs / maxEnd.value) * 100}%`
const barWidth = (s: TraceSpan) => `${Math.max((s.durationMs / maxEnd.value) * 100, 1.2)}%`

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
const badgeOf = (s: string) => (s === 'err' ? 'mk-badge--bad' : s === 'warn' ? 'mk-badge--warn' : 'mk-badge--ok')

/* 长 trace ID 在下拉与标题中截断显示 */
const shortTrace = (t: string) => (t.length > 20 ? `…${t.slice(-16)}` : t)
function traceLabel(t: string) {
  const mine = spans.value.filter((s) => s.traceId === t)
  const errs = mine.filter((s) => s.status === 'err').length
  const total = mine.reduce((a, s) => Math.max(a, s.startMs + s.durationMs), 0)
  return `${shortTrace(t)} · ${mine.length} span · ${fmtMs(total)}${errs ? ` · ${errs} 失败` : ''}`
}

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
/* 页面撑满视口：瀑布列表内部滚动（同执行日志模式；高度 = 100vh − 顶栏 52 − 页脚 42） */
.mk-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 94px);
  min-height: 480px;
}
.wf {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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

/* 链路 / 会话视图切换 */
.wf-mode {
  display: inline-flex;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}
.wf-mode__btn {
  padding: 5px 12px;
  background: var(--mk-surface);
  border: none;
  border-right: 1px solid var(--mk-line);
  font-size: 11.5px;
  color: var(--mk-faint);
  cursor: pointer;
}
.wf-mode__btn:last-child { border-right: none; }
.wf-mode__btn--on { background: #eef3fd; color: #3478f6; font-weight: 600; }

/* 链路概要卡 */
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
.wf-tracepick__search:focus { border-color: rgba(52, 120, 246, 0.5); }
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
  align-items: center;
  border-bottom: 1px solid var(--mk-line);
  background: #fafbfc;
}
.wf-ruler__label {
  padding: 8px 14px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.wf-ruler__track { position: relative; height: 26px; margin-right: 74px; }
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
  border-radius: 5px;
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
.wf-row__gw {
  font-size: 10.5px;
  color: var(--mk-faint);
  background: #f0f2f5;
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.wf-row__tail { display: flex; align-items: center; gap: 8px; justify-content: flex-end; min-width: 0; }
.wf-row__errcode {
  font-size: 10.5px;
  font-weight: 700;
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.wf-row__drift {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-amber);
  background: rgba(217, 119, 6, 0.1);
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.mono { font-family: var(--mk-mono); }

/* 展开：事实区 / Prompt 契约 / 重试时间线 */
.wf-facts { display: flex; gap: 8px; flex-wrap: wrap; }
.wf-fact {
  font-size: 11px;
  color: var(--mk-muted);
  background: #f0f2f5;
  border-radius: 6px;
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
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.6 'JetBrains Mono', monospace;
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

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  /* 顶栏升 64px：页面高度跟随（100vh − 顶栏 64 − 页脚 42） */
  .mk-page { height: calc(100vh - 106px); }
  .wf-tracepick__count { font-size: 13px; }
  .wf-tracepick__search { font-size: 12.5px; padding: 8px 12px; width: 150px; }
  .wf-tracepick__select { font-size: 13px; padding: 8px 12px; max-width: 380px; }
  .wf-ruler { grid-template-columns: 340px 1fr; }
  .wf-ruler__label { font-size: 12.5px; padding: 10px 16px; }
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
  /* zoom 1.15 档：高度换算回逻辑坐标（100vh ÷ 1.15 − 顶栏 78 − 页脚 42） */
  .mk-page { height: calc(100vh / 1.15 - 120px); }
  .wf-tracepick__count { font-size: 15.5px; }
  .wf-tracepick__search { font-size: 15px; padding: 10px 14px; width: 180px; }
  .wf-tracepick__select { font-size: 15.5px; padding: 10px 14px; max-width: 460px; }
  .wf-ruler { grid-template-columns: 400px 1fr; }
  .wf-ruler__label { font-size: 15px; padding: 12px 20px; }
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
  /* 4K 分辨率（zoom 1.3 档）：高度换算回逻辑坐标（100vh ÷ 1.3 − 顶栏 78 − 页脚 42），字号继续放大 */
  .mk-page { height: calc(100vh / 1.3 - 120px); }
  .wf-ruler { grid-template-columns: 460px 1fr; }
  .wf-ruler__label { font-size: 17.5px; padding: 14px 24px; }
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
