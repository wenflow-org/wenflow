<template>
  <div class="topo-page">
    <!-- 工作区卡片：工具栏头 + 画布体（与字段图同款一体结构） -->
    <div class="topo-frame">
    <!-- 工具栏：健康状态 + 时间范围（紧凑单行） -->
    <div class="topo-toolbar">
      <div class="topo-toolbar__status">
        <span class="topo-status-dot" :class="hasError ? 'is-error' : 'is-ok'"></span>
        <strong class="topo-toolbar__title" :title="statusTitleHint">{{ statusTitle }}</strong>
        <span class="topo-toolbar__meta"><b>{{ totalCalls }}</b> 次调用</span>
      </div>
      <div class="topo-toolbar__controls">
        <span v-if="isLive" class="mk-pills topo-range">
          <button
            v-for="r in rangeOptions"
            :key="r.id"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': liveTopoRange === r.id }"
            :disabled="rangeLoading"
            @click="switchRange(r.id)"
          >
            {{ r.label }}
          </button>
        </span>
        <span class="topo-legend"><i class="lg lg--ok"></i>正常</span>
        <span class="topo-legend"><i class="lg lg--idle"></i>空闲</span>
        <span class="topo-legend"><i class="lg lg--err"></i>异常</span>
      </div>
    </div>

    <!-- 画布：滚轮缩放 + 拖拽平移（与字段图同布局） -->
    <div
      ref="canvasRef"
      class="topo-canvas"
      :class="{ 'is-panning': panning }"
      :style="{ height: `${canvasHeight}px` }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <div v-if="isEmpty" class="topo-empty">
        <div class="topo-empty__icon" aria-hidden="true">!</div>
        <p>暂无运行时数据</p>
        <p class="topo-empty__sub">检查时间范围或稍后刷新</p>
      </div>

      <div class="topo-hint" aria-hidden="true">滚轮缩放 · 拖拽平移 · 点 Skill 看详情 · 点 Agent 查日志</div>

      <div class="topo-zoom" v-if="!isEmpty">
        <button class="topo-ctrl" type="button" title="缩小" @click="stepZoom(-1)">−</button>
        <button class="topo-ctrl topo-ctrl--zoom" type="button" :title="zoom === 1 && tx === 0 && ty === 0 ? '当前缩放' : '重置视图'" @click="resetView">{{ Math.round(zoom * 100) }}%</button>
        <button class="topo-ctrl" type="button" title="放大" @click="stepZoom(1)">+</button>
      </div>

      <div class="topo-viewport" :style="viewportStyle">
        <!-- 连线层（在泳道之下） -->
        <svg class="topo-edges" :width="cW" :height="cH" aria-hidden="true">
          <defs>
            <marker id="topo-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="#2c63d0" />
            </marker>
          </defs>
          <path
            v-for="(e, i) in edges"
            :key="`e-${i}`"
            :d="e.d"
            fill="none"
            :stroke="e.stroke"
            :stroke-width="e.width"
            :stroke-dasharray="e.dashed ? '3 5' : undefined"
            marker-end="url(#topo-arrow)"
          />
        </svg>

        <!-- 聚焦模式：上游输入列（来源 skill 调用数叠加） -->
        <div
          v-if="viewScope === 'focus' && layouts.length"
          class="topo-anchor"
          :style="{ left: `${ANCHOR_X0}px`, top: '0px', height: `${anchorColH}px` }"
        >
          <div class="topo-anchor__title">↑ 上游输入</div>
          <button
            v-for="it in anchorLayout.upItems"
            :key="it.id"
            type="button"
            class="topo-anchor__item"
            :style="{ top: `${it.y}px` }"
            :title="`${it.label} · ${it.sub} → 当前阶段`"
          >
            <span class="topo-anchor__label mono">{{ it.label }}</span>
            <span class="topo-anchor__stat" v-if="anchorStat(it)">{{ anchorStat(it) }}</span>
            <span class="topo-anchor__sub">{{ it.sub }}</span>
          </button>
          <div v-if="!anchorLayout.upItems.length" class="topo-anchor__empty">无上游字段</div>
        </div>

        <!-- 泳道（阶段） -->
        <div
          v-for="lane in layouts"
          :key="lane.stage.id"
          class="topo-lane"
          :style="{ left: `${lane.x}px`, top: '0px', height: `${lane.laneHeight}px`, '--hue': toneOf(lane.stage.id).hue, '--soft': toneOf(lane.stage.id).soft }"
        >
          <div class="topo-lane__head">
            <span class="topo-lane__idx">{{ lane.stage.order }}</span>
            <strong class="topo-lane__name">{{ lane.stage.name }}</strong>
            <span class="topo-lane__id mono">{{ lane.stage.agentId }}</span>
            <span class="topo-lane__count">{{ lane.stage.fieldCount }} 字段</span>
          </div>

          <!-- Skill 组：组头叠运行时汇总 -->
          <div
            v-for="slot in lane.slots"
            :key="slot.agentId"
            class="topo-group"
            :class="{ 'is-bridge': slot.bridge, 'is-collapsed': slot.fields.length === 0 && slot.foldedCount > 0 }"
            :style="{ top: `${slot.headY}px` }"
          >
            <div class="topo-group__head">
              <span v-if="slot.bridge" class="topo-group__badge">桥接</span>
              <span class="topo-group__name mono">{{ displayNameOf(slot.agentId) }}</span>
              <span class="topo-group__stat">
                <template v-if="groupStat(slot.agentId)">
                  <b :class="groupTone(slot.agentId) || ''">{{ (groupStat(slot.agentId) as any).calls }}</b> 调用
                  <em v-if="(groupStat(slot.agentId) as any).failed"> · {{ (groupStat(slot.agentId) as any).failed }} 失败</em>
                </template>
                <template v-else>—</template>
              </span>
              <span v-if="slot.foldedCount" class="topo-group__fold">▸ {{ slot.foldedCount }}</span>
            </div>

            <!-- 字段节点 + 运行时角标 -->
            <button
              v-for="fs in slot.fields"
              :key="fs.field.id"
              type="button"
              class="topo-field"
              :class="{ 'is-idle': isIdle(fs.field), 'is-err': isErr(fs.field), 'is-handoff': fs.field.handoffTargets.length > 0 }"
              :style="{ top: `${fs.y - slot.headY}px` }"
              :title="fieldTitle(fs.field)"
              @click="onFieldClick(fs.field)"
            >
              <span class="topo-field__name mono" :title="fs.field.fieldId">{{ shortName(fs.field.fieldId) }}</span>
              <span class="topo-field__stat" v-if="fieldStatsById.get(fs.field.id)">
                <b :class="statTone(fieldStatsById.get(fs.field.id)!)">{{ fieldStatsById.get(fs.field.id)!.calls }}</b>
                <em v-if="fieldStatsById.get(fs.field.id)!.failed"> {{ fieldStatsById.get(fs.field.id)!.failed }}✗</em>
              </span>
              <span class="topo-field__ms" v-if="fieldStatsById.get(fs.field.id)">{{ fmtMs(fieldStatsById.get(fs.field.id)!.avgMs) }}</span>
            </button>
          </div>
        </div>

        <!-- 聚焦模式：下游输出列（目标 agent 聚合统计） -->
        <div
          v-if="viewScope === 'focus' && layouts.length"
          class="topo-anchor topo-anchor--down"
          :style="{ left: `${ANCHOR_X0 + ANCHOR_W + ANCHOR_GAP + LANE_W + ANCHOR_GAP}px`, top: '0px', height: `${anchorColH}px` }"
        >
          <div class="topo-anchor__title">↓ 下游输出</div>
          <button
            v-for="it in anchorLayout.downItems"
            :key="it.id"
            type="button"
            class="topo-anchor__item"
            :style="{ top: `${it.y}px` }"
            :title="`当前阶段 → ${it.sub} · ${it.label}`"
          >
            <span class="topo-anchor__label mono">{{ it.label }}</span>
            <span class="topo-anchor__stat" v-if="anchorStat(it)">{{ anchorStat(it) }}</span>
            <span class="topo-anchor__sub">{{ it.sub }}</span>
          </button>
          <div v-if="!anchorLayout.downItems.length" class="topo-anchor__empty">无下游目标</div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { openSkillDrawer, investigateAgent, dataSource } from './store'
import { liveTopoNodes, liveTopoRange, reloadLiveTopology } from './live'
import { adminFieldRoutingsApi } from '@/api/adminApi'
import { AGENT_TONES } from './store'
import {
  computeLayouts, computeEdges, canvasW as cw, canvasH as ch,
  buildStage, shortName, type StageDetailLike, type FlowStage, type FlowField,
  type StageLayout, type EdgeGeom,
  ANCHOR_W, ANCHOR_X0, ANCHOR_GAP, LANE_W, focusLaneX, focusCanvasW,
  computeFocusAnchors, computeFocusEdges, type FocusAnchor,
} from './fieldFlowLayout'

const props = defineProps<{ stage?: string; scope?: 'focus' | 'all' }>()

// 范围/阶段切换后重新适配画布（与字段图同款：布局变化即 fitView）
watch([() => props.scope, () => props.stage], () => {
  void nextTick(() => { if (!userInteracted.value) fitView() })
})

/* ================= 缩放 / 平移（沿用原拓扑交互） ================= */
const canvasRef = ref<HTMLElement | null>(null)
const zoom = ref(1)
const tx = ref(0)
const ty = ref(0)
const panning = ref(false)
const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.6
const userInteracted = ref(false)
let resizeObserver: ResizeObserver | null = null

const winH = ref(window.innerHeight)
const globalZoom = ref(1)
function refreshViewport() {
  const ac = document.querySelector('.ac')
  const z = ac ? parseFloat((getComputedStyle(ac) as unknown as { zoom?: string }).zoom || '1') : 1
  globalZoom.value = Number.isFinite(z) && z > 0 ? z : 1
  winH.value = window.innerHeight
}
window.addEventListener('resize', refreshViewport)

const viewportStyle = computed(() => ({
  width: `${cW.value}px`,
  height: `${cH.value}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${zoom.value})`,
}))

function toCanvasPoint(event: { clientX: number; clientY: number }) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
const availHeight = () => Math.max(420, winH.value / globalZoom.value - 104)

function fitView() {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  const padding = 20
  // 横向适配视口；只缩小不放大（与字段图同款缩放口径，杜绝卡片忽大忽小）
  const zx = (rect.width / globalZoom.value - padding * 2) / cW.value
  zoom.value = Math.min(1, Math.max(MIN_ZOOM, zx))
  tx.value = Math.max(padding, (rect.width / globalZoom.value - cW.value * zoom.value) / 2)
  ty.value = padding
}
function zoomAt(anchor: { x: number; y: number }, nextZoomRaw: number) {
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw))
  if (nextZoom === zoom.value) return
  userInteracted.value = true
  const ratio = nextZoom / zoom.value
  tx.value = anchor.x - (anchor.x - tx.value) * ratio
  ty.value = anchor.y - (anchor.y - ty.value) * ratio
  zoom.value = nextZoom
}
function onWheel(event: WheelEvent) {
  // Ctrl/⌘ 缩放；否则画布内纵向滚动（内容超高时）
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14
    zoomAt(toCanvasPoint(event), zoom.value * factor)
    return
  }
  const canvas = canvasRef.value
  if (!canvas) return
  const maxScroll = canvas.scrollHeight - canvas.clientHeight
  if (maxScroll > 0) {
    canvas.scrollTop = Math.min(maxScroll, Math.max(0, canvas.scrollTop + event.deltaY))
    if (event.shiftKey) canvas.scrollLeft = Math.min(canvas.scrollWidth - canvas.clientWidth, Math.max(0, canvas.scrollLeft + event.deltaY))
    return
  }
  const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14
  zoomAt(toCanvasPoint(event), zoom.value * factor)
}
function stepZoom(direction: 1 | -1) {
  const rect = canvasRef.value?.getBoundingClientRect()
  const center = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 }
  zoomAt(center, zoom.value * (direction > 0 ? 1.25 : 1 / 1.25))
}
function resetView() {
  userInteracted.value = false
  fitView()
}

onMounted(() => {
  refreshViewport()
  fitView()
  resizeObserver = new ResizeObserver(() => {
    if (!userInteracted.value) fitView()
  })
  if (canvasRef.value) resizeObserver.observe(canvasRef.value)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', refreshViewport)
})

let panOrigin: { x: number; y: number; tx: number; ty: number; pointerId: number } | null = null
let didPan = false
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const point = toCanvasPoint(event)
  panOrigin = { x: point.x, y: point.y, tx: tx.value, ty: ty.value, pointerId: event.pointerId }
  didPan = false
  panning.value = true
}
function onPointerMove(event: PointerEvent) {
  if (!panOrigin) return
  const point = toCanvasPoint(event)
  const dx = point.x - panOrigin.x
  const dy = point.y - panOrigin.y
  if (!didPan && Math.abs(dx) + Math.abs(dy) > 4) {
    didPan = true
    userInteracted.value = true
    canvasRef.value?.setPointerCapture(panOrigin.pointerId)
  }
  if (didPan) {
    tx.value = panOrigin.tx + dx
    ty.value = panOrigin.ty + dy
  }
}
function onPointerUp() {
  panOrigin = null
  panning.value = false
}
function guarded(fn: () => void) {
  if (didPan) {
    didPan = false
    return
  }
  fn()
}

/* ================= 数据 ================= */
const isLive = computed(() => dataSource.value === 'live')

/** 运行时 Skill 统计：skillId（裸名）→ { calls, failed, avgMs } */
const skillStats = computed(() => {
  const map = new Map<string, { calls: number; failed: number; avgMs: number }>()
  for (const n of liveTopoNodes.value) {
    if (n.type !== 'skill' || !n.parentAgentId) continue
    const id = n.id.replace(/^skill:/, '')
    map.set(id, { calls: n.stats.totalCalls, failed: n.stats.failed, avgMs: n.stats.avgDuration })
  }
  return map
})

/** 阶段详情（定义态骨架）：全阶段加载，供泳道布局 */
const detailByStage = ref<Record<string, StageDetailLike | null>>({})
const defsLoaded = ref(false)
async function loadDefs() {
  if (!isLive.value) return
  try {
    const stages = ['goal', 'path', 'teaching', 'profile', 'simulation']
    const results = await Promise.allSettled(
      stages.map(async (s) => {
        const res = await adminFieldRoutingsApi.getStageDetail(s)
        return { stage: s, detail: (res.data?.data as StageDetailLike) || null }
      })
    )
    const next: Record<string, StageDetailLike | null> = {}
    results.forEach((r, i) => {
      const s = stages[i]
      next[s] = r.status === 'fulfilled' ? r.value.detail : null
    })
    detailByStage.value = next
    defsLoaded.value = true
  } catch {
    defsLoaded.value = false
  }
}
watch(isLive, (v) => { if (v) void loadDefs() }, { immediate: true })
// 拓扑数据变化（时间范围切换）后重新适配视图
watch(liveTopoNodes, () => { void nextTick(() => fitView()) })

/** 全阶段泳道（定义骨架；有拓扑 Agent 的阶段才展示） */
const stages = computed<FlowStage[]>(() => {
  const out: FlowStage[] = []
  for (const s of ['goal', 'path', 'teaching', 'profile', 'simulation']) {
    const d = detailByStage.value[s]
    if (!d) continue
    out.push(buildStage(s, d))
  }
  return out
})

/** 桥接组折叠 / 次要字段折叠：运行时视图保持与字段图一致（桥接默认折叠） */
const collapsedBridges = new Set(['goal-agent', 'path-agent', 'teaching-agent', 'profile-agent', 'simulation-agent'])
const isBridgeCollapsed = (agentId: string) => collapsedBridges.has(agentId)
const isMinorExpanded = () => false

/** 视图范围：聚焦（单阶段+上下游锚点，与字段图同款）/ 全览（5 泳道） */
const viewScope = computed<'focus' | 'all'>(() => props.scope || 'all')

/** 上下游锚点（共享计算） */
const anchorLayout = computed(() => computeFocusAnchors(stages.value, props.stage || ''))

const anchorColH = computed(() => {
  if (!layouts.value.length) return 520
  return Math.max(layouts.value[0].laneHeight, anchorLayout.value.upH, anchorLayout.value.downH)
})

const layouts = computed<StageLayout[]>(() => {
  const all = computeLayouts(stages.value, isBridgeCollapsed, isMinorExpanded)
  if (viewScope.value !== 'focus' || !props.stage) return all
  const cur = all.find((l) => l.stage.id === props.stage)
  if (!cur) return []
  cur.x = focusLaneX
  return [cur]
})
const edges = computed<EdgeGeom[]>(() => {
  const base = computeEdges(layouts.value)
  if (viewScope.value !== 'focus' || !layouts.value.length) return base
  return [...base, ...computeFocusEdges(layouts.value[0], anchorLayout.value.upItems, anchorLayout.value.downItems)]
})
const cW = computed(() =>
  viewScope.value === 'focus' && layouts.value.length ? focusCanvasW : cw(layouts.value)
)
const cH = computed(() =>
  viewScope.value === 'focus' && layouts.value.length
    ? Math.max(520, anchorColH.value)
    : ch(layouts.value)
)
const canvasHeight = computed(() => (isEmpty.value ? 520 : Math.round(availHeight())))

const isEmpty = computed(() => layouts.value.length === 0 || liveTopoNodes.value.length === 0)

/* ================= 运行时叠加 ================= */
const skillNodes = computed(() => liveTopoNodes.value.filter((n) => n.type === 'skill'))
const totalCalls = computed(() => skillNodes.value.reduce((s, n) => s + n.stats.totalCalls, 0))
const hasError = computed(() => skillNodes.value.some((n) => n.stats.failed > 0))
const statusTitle = computed(() => {
  if (!hasError.value) return '拓扑运行正常'
  const bad = skillNodes.value.filter((n) => n.stats.failed > 0).length
  return `异常节点 ${bad} 个 Skill`
})
const statusTitleHint = computed(() =>
  hasError.value
    ? `口径：${skillNodes.value.filter((n) => n.stats.failed > 0).length} 个 Skill 存在失败调用（${rangeLabel.value}）`
    : `口径：${rangeLabel.value} 内所有 Skill 调用均无失败`
)
const rangeLabel = computed(() => {
  const map: Record<string, string> = { '24h': '近 24h', '7d': '近 7 天', '30d': '近 30 天', all: '全部' }
  return map[liveTopoRange.value] || '全部'
})

const rangeOptions: Array<{ id: '24h' | '7d' | '30d' | 'all'; label: string }> = [
  { id: '24h', label: '24h' }, { id: '7d', label: '7d' }, { id: '30d', label: '30d' }, { id: 'all', label: '全部' },
]
const rangeLoading = ref(false)
async function switchRange(r: '24h' | '7d' | '30d' | 'all') {
  if (rangeLoading.value || liveTopoRange.value === r) return
  rangeLoading.value = true
  try {
    await reloadLiveTopology(r)
    await nextTick()
    fitView()
  } finally {
    rangeLoading.value = false
  }
}

/** 组（skill / bridge agent）→ 统计聚合 */
function groupStat(agentId: string) {
  const bare = agentId.replace(/^skill:/, '')
  const stats = skillStats.value.get(bare)
  if (stats) return stats
  // bridge agent：聚合其下 skill（拓扑 parentAgentId 匹配）
  const members = skillNodes.value.filter((n) => n.parentAgentId === agentId)
  if (!members.length) return null
  return {
    calls: members.reduce((s, n) => s + n.stats.totalCalls, 0),
    failed: members.reduce((s, n) => s + n.stats.failed, 0),
    avgMs: members.length
      ? Math.round(members.reduce((s, n) => s + n.stats.avgDuration, 0) / members.length)
      : 0,
  }
}
/** 字段所属 Skill 的运行时统计（字段 → 产出 skill） */
function fieldStat(agentId: string) {
  if (agentId.startsWith('skill:')) {
    const s = skillStats.value.get(agentId.replace(/^skill:/, ''))
    return s || null
  }
  return null
}
/** 锚点统计徽标：上游字段=来源 skill 调用数；下游目标=目标 agent 聚合调用数 */
function anchorStat(item: FocusAnchor): string | null {
  let agentId = ''
  if (item.kind === 'field') {
    // item.id = `${agentId}\0${fieldId}` → 来源 skill
    agentId = item.id.split('\0')[0] || ''
    const stat = fieldStat(agentId)
    if (!stat) return null
    return `${stat.calls} 调用${stat.failed ? ` · ${stat.failed}✗` : ''}`
  }
  // 下游 agent：t:<agentId>
  agentId = item.id.startsWith('t:') ? item.id.slice(2) : ''
  if (!agentId) return null
  const stat = groupStat(agentId)
  if (!stat) return null
  return `${stat.calls} 调用${stat.failed ? ` · ${stat.failed}✗` : ''}`
}
/** 渲染用：字段 id → 统计（模板内单次取值，避免 null 判空问题） */
const fieldStatsById = computed(() => {
  const map = new Map<string, { calls: number; failed: number; avgMs: number }>()
  for (const lane of layouts.value) {
    for (const slot of lane.slots) {
      for (const fs of slot.fields) {
        const s = fieldStat(fs.field.agentId)
        if (s) map.set(fs.field.id, s)
      }
    }
  }
  return map
})

function isIdle(f: FlowField) {
  const s = fieldStat(f.agentId)
  return !s || s.calls === 0
}
function isErr(f: FlowField) {
  const s = fieldStat(f.agentId)
  return !!s && s.failed > 0
}
function statTone(s: { calls: number; failed: number }) {
  if (s.failed > 0) return 'is-bad'
  if (s.calls === 0) return 'is-idle'
  return 'is-ok'
}
function groupTone(agentId: string) {
  const s = groupStat(agentId)
  if (!s) return ''
  if (s.failed > 0) return 'is-bad'
  if (s.calls === 0) return 'is-idle'
  return 'is-ok'
}
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

/* ================= 交互 ================= */
function onFieldClick(f: FlowField) {
  if (f.agentId.startsWith('skill:')) {
    guarded(() => openSkillDrawer(f.agentId.replace(/^skill:/, '')))
  } else if (f.agentId.endsWith('-agent')) {
    guarded(() => investigateAgent(f.agentId))
  }
}
function displayNameOf(agentId: string) {
  return agentId.replace(/^skill:/, '').replace(/-agent$/, '')
}
function fieldTitle(f: FlowField) {
  const parts = [f.description || f.fieldId]
  const s = fieldStat(f.agentId)
  if (s) parts.push(`调用 ${s.calls} · 失败 ${s.failed} · 均耗 ${fmtMs(s.avgMs)}`)
  if (f.handoffTargets.length) parts.push(`移交 → ${f.handoffTargets.join(', ')}`)
  return parts.join('\n')
}
const toneOf = (id: string) => AGENT_TONES[`${id}-agent`] || { hue: '#64748b', soft: 'rgba(100,116,139,0.08)' }
</script>

<style scoped>
/* ========== 工具栏 ========== */
.topo-toolbar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 8px 14px; background: var(--mk-surface); border: 1px solid var(--mk-line); border-radius: 10px; box-shadow: var(--mk-shadow-sm);
}
.topo-toolbar__status { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
.topo-status-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.topo-status-dot.is-ok { background: var(--mk-green); animation: tk-pulse 2.6s ease-out infinite; }
.topo-status-dot.is-error { background: #dc2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14); }
@keyframes tk-pulse { 0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.32); } 70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); } 100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); } }
.topo-toolbar__title { font-size: 14px; font-weight: 700; color: var(--mk-ink); }
.topo-toolbar__sep { width: 1px; height: 14px; background: var(--mk-line); }
.topo-toolbar__meta { font-size: 12px; font-weight: 600; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.topo-toolbar__meta b { color: var(--mk-ink); font-weight: 600; margin-right: 3px; }
.topo-toolbar__hint { font-size: 12px; color: var(--mk-faint); }
.topo-toolbar__controls { display: flex; align-items: center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }
.topo-legend { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--mk-muted); }
.lg { width: 7px; height: 7px; display: inline-block; border-radius: 50%; }
.lg--ok { background: var(--mk-green); }
.lg--idle { background: #c3cede; }
.lg--err { background: #dc2626; }
.topo-toolbar__vsep { width: 1px; height: 16px; background: var(--mk-line); }

/* ========== 画布（与字段图一致：绝对定位泳道 + 字段） ========== */
.topo-canvas {
  position: relative;
  border: 1px solid var(--mk-line); border-radius: 12px;
  background: radial-gradient(640px 320px at 14% 0%, rgba(44, 99, 208, 0.04), transparent 70%),
    linear-gradient(90deg, rgba(214, 223, 238, 0.2) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(180deg, rgba(214, 223, 238, 0.2) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(180deg, #fbfcff, #f2f5fa);
  overflow: auto; cursor: default; touch-action: none; user-select: none;
}
.topo-canvas.is-panning { cursor: grabbing; }
.topo-hint {
  position: absolute; left: 14px; bottom: 12px; z-index: 2;
  font-size: 11px; color: var(--mk-faint);
  background: rgba(255, 255, 255, 0.82); border: 1px solid rgba(203, 213, 231, 0.65); border-radius: 8px;
  padding: 4px 9px; pointer-events: none;
}
.topo-zoom {
  position: absolute; right: 14px; bottom: 12px; z-index: 2;
  display: flex; align-items: center; gap: 4px; padding: 5px;
  background: var(--mk-surface); border: 1px solid var(--mk-line); border-radius: 10px;
  box-shadow: 0 6px 20px rgba(30, 58, 110, 0.1);
}
.topo-ctrl {
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--mk-line); background: var(--mk-surface); color: var(--mk-muted);
  border-radius: 8px; font-size: 14px; line-height: 1; cursor: pointer;
}
.topo-ctrl:hover { color: var(--mk-blue); border-color: var(--mk-blue); }
.topo-ctrl--zoom { width: auto; min-width: 48px; padding: 0 8px; font-size: 11px; font-family: var(--mk-mono); }
.topo-empty {
  position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%); z-index: 2;
  text-align: center; color: var(--mk-faint); font-size: 13px;
}
.topo-empty__icon { width: 56px; height: 56px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; border-radius: 12px; background: #fff; border: 1px dashed var(--mk-line); color: #b3c0d6; }
.topo-empty__sub { font-size: 11.5px; margin-top: 4px; }

.topo-viewport { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.topo-edges { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 1; }

/* 聚焦模式：上下游锚点列（与字段图同款布局） */
.topo-anchor {
  position: absolute; top: 0; z-index: 2;
  width: 240px; box-sizing: border-box;
  background: #f8fafd; border: 1px solid var(--mk-line);
  border-radius: 10px;
}
.topo-anchor__title {
  position: absolute; top: 0; left: 0; right: 0;
  padding: 8px 12px;
  font-size: 11px; font-weight: 800; color: var(--mk-muted);
  background: linear-gradient(180deg, #eef2fa, #f8fafd);
  border-bottom: 1px solid var(--mk-line);
  border-radius: 10px 10px 0 0;
}
.topo-anchor--down .topo-anchor__title { color: var(--mk-blue); }
.topo-anchor__item {
  position: absolute; left: 12px; width: 216px; height: 34px;
  display: flex; align-items: center; gap: 5px;
  padding: 0 8px; box-sizing: border-box;
  border: 1px solid var(--mk-line); border-radius: 8px;
  background: #fff; font: inherit; cursor: pointer;
}
.topo-anchor__item:hover { border-color: var(--mk-blue); }
.topo-anchor__label { font-size: 10px; font-weight: 700; color: var(--mk-ink); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topo-anchor__stat { font-size: 9px; font-weight: 700; color: var(--mk-muted); white-space: nowrap; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.topo-anchor__sub { font-size: 9.5px; font-weight: 700; color: var(--mk-blue); background: #eff6ff; border-radius: 6px; padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
.topo-anchor__empty { position: absolute; left: 12px; top: 40px; font-size: 11px; color: var(--mk-faint); }

.topo-lane {
  position: absolute;
  width: 380px;
  border: 1px solid color-mix(in srgb, var(--hue) 22%, #e6ecf6);
  border-radius: 12px; background: #fff; overflow: visible;
}
.topo-lane__head {
  position: sticky; top: 0; z-index: 3;
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--hue) 6%, #ffffff), #fff 60%);
  border-bottom: 1px solid color-mix(in srgb, var(--hue) 14%, #e6ecf6);
  border-radius: 12px 12px 0 0;
}
.topo-lane__idx {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px; background: var(--hue); color: #fff; font-size: 11px; font-weight: 800; flex-shrink: 0;
}
.topo-lane__name { font-size: 13px; font-weight: 800; color: var(--mk-ink); }
.topo-lane__id { font-size: 10px; color: var(--mk-faint); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topo-lane__count { font-size: 10.5px; font-weight: 700; color: var(--mk-faint); background: #eef2fa; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }

.topo-group {
  position: absolute; left: 0; right: 0; z-index: 2;
  border-bottom: 1px solid #f1f4f9; background: #fff;
}
.topo-group.is-bridge { background: #fafbfd; }
.topo-group.is-collapsed { background: #f6f8fc; }
.topo-group__head {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px 4px; height: 30px; box-sizing: border-box;
}
.topo-group__badge { padding: 0 6px; border-radius: 999px; background: #eef2fa; color: var(--mk-muted); font-size: 9.5px; font-weight: 800; }
.topo-group__name { font-size: 10.5px; font-weight: 700; color: var(--mk-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topo-group__stat { font-size: 10px; color: var(--mk-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.topo-group__stat b { font-weight: 700; }
.topo-group__stat b.is-bad { color: #dc2626; }
.topo-group__stat b.is-idle { color: #c3cede; }
.topo-group__stat b.is-ok { color: var(--mk-green); }
.topo-group__stat em { font-style: normal; color: #dc2626; font-weight: 700; }
.topo-group__fold { margin-left: auto; padding: 0 6px; border-radius: 999px; background: #eef2fa; color: var(--mk-muted); font-size: 9.5px; font-weight: 700; }

.topo-field {
  position: absolute; left: 12px; width: 356px; box-sizing: border-box;
  display: flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 9px;
  text-align: left; font: inherit;
  border: 1px solid var(--mk-line); border-radius: 8px; background: #fff;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.topo-field:hover { border-color: var(--mk-blue); box-shadow: 0 2px 8px rgba(44, 99, 208, 0.1); }
.topo-field.is-idle { background: rgba(255, 255, 255, 0.55); border-style: dashed; }
.topo-field.is-err { border-color: rgba(220, 38, 38, 0.45); }
.topo-field.is-handoff { border-left: 3px solid var(--mk-blue); }
.topo-field__name {
  font-size: 11.5px; font-weight: 700; color: var(--mk-ink);
  flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.topo-field.is-idle .topo-field__name { color: var(--mk-faint); }
.topo-field__stat { font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
.topo-field__stat b { font-weight: 700; }
.topo-field__stat b.is-bad { color: #dc2626; }
.topo-field__stat b.is-idle { color: #c3cede; }
.topo-field__stat b.is-ok { color: var(--mk-green); }
.topo-field__stat em { font-style: normal; color: #dc2626; font-weight: 700; }
.topo-field__ms { font-size: 10px; color: var(--mk-faint); font-variant-numeric: tabular-nums; flex-shrink: 0; }

/* 4K */
@media (min-width: 2000px) {
  .topo-toolbar__title { font-size: 16px; }
  .topo-toolbar__meta, .topo-toolbar__hint { font-size: 13.5px; }
  .topo-field__name { font-size: 12.5px; }
}
</style>
