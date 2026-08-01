<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">流程 {{ flowCount }}</span>
      <span class="mk-status__meta">调用 {{ callCount }}</span>
      <span class="mk-status__meta">瀑布 {{ waterfallCount }}</span>
      <input
        class="mk-filter__input"
        style="margin-left: auto"
        v-model="trace"
        placeholder="粘贴 Trace ID 跨 Tab 联查"
      />
      <button type="button" class="mk-status__action" :disabled="loading" @click="refresh">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="ec-tabs">
      <button type="button" class="ec-tab" :class="{ 'ec-tab--active': tab === 'flow' }" @click="tab = 'flow'">
        流程事件 <b>{{ flowCount }}</b>
      </button>
      <button type="button" class="ec-tab" :class="{ 'ec-tab--active': tab === 'call' }" @click="tab = 'call'">
        Prompt 调用 <b>{{ callCount }}</b>
      </button>
      <button type="button" class="ec-tab" :class="{ 'ec-tab--active': tab === 'waterfall' }" @click="tab = 'waterfall'">
        Trace 瀑布 <b>{{ waterfallCount }}</b>
      </button>
    </div>

    <!-- 流程事件 / Prompt 调用时间线 -->
    <div v-if="tab !== 'waterfall' && filtered.length" class="ec-timeline">
      <div
        v-for="(e, i) in filtered"
        :key="i"
        class="ec-row"
        :class="{ 'ec-row--hit': trace && e.trace.includes(trace) }"
      >
        <span class="ec-row__dot" :class="`ec-row__dot--${e.tone}`"></span>
        <span class="ec-row__time mono">{{ e.time }}</span>
        <span class="ec-row__stage">{{ e.stage }}</span>
        <div class="ec-row__main">
          <strong>{{ e.title }}</strong>
          <span>{{ e.detail }}</span>
        </div>
        <span class="mk-badge" :class="e.statusCls">{{ e.status }}</span>
        <button
          v-if="e.trace && e.trace !== '—'"
          type="button"
          class="ec-row__trace mono mk-link"
          @click="trace = e.trace"
        >
          {{ e.trace }}
        </button>
        <span v-else class="ec-row__trace mono">—</span>
      </div>
    </div>

    <div v-else-if="tab !== 'waterfall'" class="mk-empty">
      <strong>{{ emptyTitle }}</strong>
      <span>{{ emptyHint }}</span>
    </div>

    <!-- Trace 瀑布（原 event-center 实现，保留为第三 Tab） -->
    <MockTraceWaterfall v-else :state="state" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { dataSource } from './mockStore'
import { errMsg, timeAgo } from './mockLive'
import { adminRuntimeDefinitionsApi } from '@/api/adminApi'
import MockTraceWaterfall from './MockTraceWaterfall.vue'

const props = defineProps<{ state: 'normal' | 'empty' | 'incident' | 'fresh' }>()

interface Ev {
  kind: 'flow' | 'call'
  time: string
  stage: string
  title: string
  detail: string
  status: string
  statusCls: string
  trace: string
  tone: 'ok' | 'warn' | 'bad'
}

const isLive = computed(() => dataSource.value === 'live')
const tab = ref<'flow' | 'call' | 'waterfall'>('flow')
const trace = ref('')
const loading = ref(false)
const flowEvents = ref<Ev[]>([])
const callEvents = ref<Ev[]>([])
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2800)
}

const DEMO_FLOW: Ev[] = [
  { kind: 'flow', time: '16:42:07', stage: '阶段任务设计', title: '路径生成完成', detail: '4 阶段 · 18 任务 · 用时 42s', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'flow', time: '16:41:31', stage: '核心路径生成', title: '路径草稿就绪', detail: '学习者基础：零基础 · 每周 4 小时', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'flow', time: '16:35:40', stage: '核心路径生成', title: '路径生成失败', detail: '上游超时 30s · 已回退重试', status: '失败', statusCls: 'mk-badge--bad', trace: 'tr:8f318f', tone: 'bad' }
]
const DEMO_CALL: Ev[] = [
  { kind: 'call', time: '16:41:58', stage: 'stage-designer', title: 'Prompt 调用', detail: 'deepseek-v4-pro · 3.2s · P 1180 / C 642', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'call', time: '16:40:55', stage: 'generic-planner', title: 'Prompt 调用', detail: 'deepseek-v4-pro · 5.1s · P 2040 / C 1130', status: '成功', statusCls: 'mk-badge--ok', trace: 'tr:8f31a2', tone: 'ok' },
  { kind: 'call', time: '16:38:12', stage: 'teaching-round', title: 'Prompt 调用', detail: 'deepseek-v4-flash · 1.1s · 漂移', status: '漂移', statusCls: 'mk-badge--warn', trace: 'tr:8f319b', tone: 'warn' }
]

function toneOf(status: string): 'ok' | 'warn' | 'bad' {
  const s = status.toLowerCase()
  if (s.includes('fail') || s.includes('error') || s.includes('失败')) return 'bad'
  if (s.includes('drift') || s.includes('warn') || s.includes('漂移')) return 'warn'
  return 'ok'
}
function badgeOf(status: string) {
  const t = toneOf(status)
  return t === 'ok' ? 'mk-badge--ok' : t === 'warn' ? 'mk-badge--warn' : 'mk-badge--bad'
}
function statusLabel(status: string) {
  const s = String(status || '')
  if (/success|ok|成功/i.test(s)) return '成功'
  if (/fail|error|失败/i.test(s)) return '失败'
  if (/drift|漂移/i.test(s)) return '漂移'
  return s || '—'
}

function mapFlowItem(raw: Record<string, unknown>): Ev {
  const createdAt = String(raw.createdAt || raw.timestamp || raw.time || '')
  const status = String(raw.status || raw.outcome || 'success')
  const phase = String(raw.phase || raw.stage || raw.eventType || '流程')
  const title = String(raw.title || raw.message || raw.eventType || '路径生成事件')
  const detail = String(raw.detail || raw.summary || raw.error || raw.pathId || '')
  const tr = String(raw.traceId || raw.trace || '—')
  return {
    kind: 'flow',
    time: createdAt ? timeAgo(createdAt) : '—',
    stage: phase,
    title,
    detail: detail.slice(0, 160) || '—',
    status: statusLabel(status),
    statusCls: badgeOf(status),
    trace: tr,
    tone: toneOf(status)
  }
}

function mapCallItem(raw: Record<string, unknown>): Ev {
  const createdAt = String(raw.createdAt || raw.timestamp || '')
  const status = String(raw.status || 'success')
  const agent = String(raw.agentId || raw.skillId || raw.callerAgent || 'prompt')
  const model = String(raw.model || raw.modelName || '')
  const latency = raw.latencyMs != null ? `${raw.latencyMs}ms` : ''
  const tokens = raw.promptTokens != null || raw.completionTokens != null
    ? `P ${raw.promptTokens ?? '—'} / C ${raw.completionTokens ?? '—'}`
    : ''
  const detail = [model, latency, tokens].filter(Boolean).join(' · ') || String(raw.summary || '')
  const tr = String(raw.traceId || raw.trace || '—')
  return {
    kind: 'call',
    time: createdAt ? timeAgo(createdAt) : '—',
    stage: agent,
    title: 'Prompt 调用',
    detail: detail.slice(0, 160) || '—',
    status: statusLabel(status),
    statusCls: badgeOf(status),
    trace: tr,
    tone: toneOf(status)
  }
}

async function loadLive() {
  loading.value = true
  try {
    const [flowRes, callRes] = await Promise.all([
      adminRuntimeDefinitionsApi.getPathGenerationEvents({ limit: 80 }),
      adminRuntimeDefinitionsApi.getPromptCallLogs({ limit: 80 })
    ])
    const flowBody = flowRes.data?.data ?? flowRes.data ?? []
    const flowItems = Array.isArray(flowBody) ? flowBody : flowBody.items || flowBody.events || []
    flowEvents.value = flowItems.map((x: Record<string, unknown>) => mapFlowItem(x))

    const callBody = callRes.data?.data ?? callRes.data ?? []
    const callItems = Array.isArray(callBody) ? callBody : callBody.items || callBody.logs || []
    callEvents.value = callItems.map((x: Record<string, unknown>) => mapCallItem(x))
  } catch (e) {
    showToast(`加载事件失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    loading.value = false
  }
}

function loadDemo() {
  const empty = props.state === 'empty' || props.state === 'fresh'
  flowEvents.value = empty ? [] : DEMO_FLOW
  callEvents.value = empty ? [] : DEMO_CALL
}

async function refresh() {
  if (isLive.value) await loadLive()
  else loadDemo()
}

watch(
  () => [isLive.value, props.state] as const,
  () => {
    void refresh()
  },
  { immediate: true }
)

onMounted(() => {
  void refresh()
})

const flowCount = computed(() => flowEvents.value.length)
const callCount = computed(() => callEvents.value.length)
/** 瀑布 Tab 计数 = 两事件流合并后的去重 Trace 数 */
const waterfallCount = computed(() => {
  const traces = new Set(
    [...flowEvents.value, ...callEvents.value]
      .map((e) => e.trace)
      .filter((t) => t && t !== '—')
  )
  return traces.size || '·'
})

const filtered = computed(() => {
  const src = tab.value === 'flow' ? flowEvents.value : callEvents.value
  const q = trace.value.trim()
  if (!q) return src
  return src.filter((e) => e.trace.includes(q))
})

const statusTone = computed(() => {
  if (loading.value) return 'mk-status--muted'
  if (!flowCount.value && !callCount.value) return 'mk-status--muted'
  if (flowEvents.value.some((e) => e.tone === 'bad') || callEvents.value.some((e) => e.tone === 'bad')) {
    return 'mk-status--warn'
  }
  return 'mk-status--ok'
})
const statusTitle = computed(() => {
  if (loading.value) return '加载事件…'
  if (!flowCount.value && !callCount.value) return '暂无事件'
  return '事件流正常'
})
const emptyTitle = computed(() =>
  trace.value ? `Trace ${trace.value} 没有匹配事件` : '暂无事件'
)
const emptyHint = computed(() =>
  trace.value
    ? '检查 ID 是否完整，或清除后浏览全部。'
    : isLive.value
      ? '路径生成与 Prompt 调用发生后会出现在这里。'
      : '演示模式下可切换「正常」状态查看样例。'
)
</script>

<style scoped>
.ec-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--mk-line);
}
.ec-tab {
  border: 0;
  background: transparent;
  padding: 9px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--mk-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.ec-tab b {
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}
.ec-tab--active {
  color: var(--mk-ink);
  border-bottom-color: var(--mk-blue);
}
.ec-timeline {
  display: grid;
  gap: 0;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--mk-surface);
}
.ec-row {
  display: grid;
  grid-template-columns: 10px 72px 110px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #f0f2f5;
  font-size: 12.5px;
}
.ec-row:last-child {
  border-bottom: none;
}
.ec-row--hit {
  background: #eef5ff;
}
.ec-row__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.ec-row__dot--ok {
  background: var(--mk-green);
}
.ec-row__dot--warn {
  background: var(--mk-amber);
}
.ec-row__dot--bad {
  background: var(--mk-red);
}
.ec-row__time {
  color: var(--mk-faint);
  font-size: 11px;
}
.ec-row__stage {
  color: var(--mk-muted);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ec-row__main {
  display: grid;
  min-width: 0;
}
.ec-row__main strong {
  font-size: 13px;
}
.ec-row__main span {
  font-size: 11.5px;
  color: var(--mk-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ec-row__trace {
  font-size: 10.5px;
  color: var(--mk-faint);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
}
@media (max-width: 1100px) {
  .ec-row {
    grid-template-columns: 10px 1fr auto;
  }
  .ec-row__time,
  .ec-row__stage {
    display: none;
  }
}
</style>
