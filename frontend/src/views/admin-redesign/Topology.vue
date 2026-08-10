<template>
  <div class="mk-page">
    <!-- 工具栏：状态 + 统计 + 图例 + 视图控制 -->
    <div class="topo-toolbar">
      <div class="topo-toolbar__status">
        <span class="topo-status-dot" :class="hasError ? 'is-error' : 'is-ok'"></span>
        <strong class="topo-toolbar__title">{{ hasError ? '拓扑存在异常节点' : '拓扑运行正常' }}</strong>
        <span class="topo-toolbar__sep"></span>
        <span class="topo-toolbar__meta"><b>{{ agentNodes.length }}</b> 个 Agent</span>
        <span class="topo-toolbar__meta"><b>{{ skillNodes.length }}</b> 个 Skill</span>
        <span class="topo-toolbar__meta"><b>{{ totalCalls }}</b> 次调用</span>
        <span class="topo-toolbar__hint">点 Skill 看详情 · 点 Agent 查日志</span>
      </div>
      <div class="topo-toolbar__controls">
        <span v-if="isLive" class="topo-range">
          <button
            v-for="r in rangeOptions"
            :key="r.id"
            type="button"
            class="topo-range__btn"
            :class="{ 'topo-range__btn--active': liveTopoRange === r.id }"
            :disabled="rangeLoading"
            @click="switchRange(r.id)"
          >
            {{ r.label }}
          </button>
        </span>
        <span class="topo-toolbar__vsep"></span>
        <span class="topo-legend"><i class="lg lg--ok"></i>正常</span>
        <span class="topo-legend"><i class="lg lg--idle"></i>空闲</span>
        <span class="topo-legend"><i class="lg lg--err"></i>异常</span>
      </div>
    </div>

    <!-- 画布：滚轮缩放 + 拖拽平移 -->
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
      <!-- 图纸角标 -->
      <i class="tk tk--tl"></i>
      <i class="tk tk--tr"></i>
      <i class="tk tk--bl"></i>
      <i class="tk tk--br"></i>

      <!-- 空态 -->
      <div v-if="isEmpty" class="topo-empty">
        <div class="topo-empty__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="6" r="2.6" />
            <circle cx="18" cy="6" r="2.6" />
            <circle cx="6" cy="18" r="2.6" />
            <circle cx="18" cy="18" r="2.6" />
            <path d="M8.3 7.4l7.4 9.2M15.7 7.4l-7.4 9.2" />
          </svg>
        </div>
        <p>暂无可展示的 Agent / Skill 节点</p>
        <p class="topo-empty__sub">检查时间范围或稍后刷新</p>
      </div>

      <!-- 交互提示（左下角） -->
      <div class="topo-hint" aria-hidden="true">
        滚轮缩放 · 拖拽平移 · 点 Skill 看详情 · 点 Agent 查日志
      </div>

      <!-- 缩放控制（右下角浮层） -->
      <div class="topo-zoom" v-if="!isEmpty">
        <button class="topo-ctrl" type="button" title="缩小" @click="stepZoom(-1)">−</button>
        <button
          class="topo-ctrl topo-ctrl--zoom"
          type="button"
          :title="zoom === 1 && tx === 0 && ty === 0 ? '当前缩放' : '重置视图'"
          @click="resetView"
        >
          {{ Math.round(zoom * 100) }}%
        </button>
        <button class="topo-ctrl" type="button" title="放大" @click="stepZoom(1)">+</button>
      </div>

      <div class="topo-viewport" :style="viewportStyle">
        <!-- 连线层 -->
        <svg class="topo-edges" :width="contentW" :height="contentH" aria-hidden="true">
          <defs>
            <linearGradient
              v-for="f in flows"
              :id="`tfg-${f.i}`"
              :key="`g-${f.i}`"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" :stop-color="f.from" stop-opacity="0.7" />
              <stop offset="100%" :stop-color="f.to" stop-opacity="0.7" />
            </linearGradient>
          </defs>

          <!-- Agent → Skill 连线（底层） -->
          <path
            v-for="(e, i) in edges"
            :key="`e-${i}`"
            :d="e.d"
            fill="none"
            :stroke="e.stroke"
            :stroke-opacity="e.opacity"
            :stroke-width="e.width"
            :stroke-dasharray="e.dashed ? '3 5' : undefined"
            :stroke-linecap="e.dashed ? 'round' : undefined"
            class="topo-edge"
          />

          <!-- 活跃边的数据流（dash 动画层） -->
          <path
            v-for="(e, i) in flowEdges"
            :key="`f-${i}`"
            :d="e.d"
            fill="none"
            :stroke="e.stroke"
            stroke-opacity="0.95"
            stroke-width="1.5"
            stroke-linecap="round"
            class="topo-flow"
          />

          <!-- Agent 间的流水线箭头 -->
          <g v-for="f in flows" :key="`f-${f.i}`">
            <line
              :x1="f.x1"
              :y1="f.y"
              :x2="f.x2 - 6"
              :y2="f.y"
              :stroke="`url(#tfg-${f.i})`"
              stroke-width="1.6"
            />
            <polygon :points="f.arrow" :fill="f.to" fill-opacity="0.85" />
          </g>
        </svg>

        <!-- Agent 阶段头卡片 -->
        <div
          v-for="a in agentCards"
          :key="a.id"
          class="agent-card"
          :class="{ 'is-error': a.errorCount > 0 }"
          :style="{
            left: `${a.x}px`,
            top: `${a.y}px`,
            '--hue': a.stage.hue,
            '--soft': a.stage.soft,
            '--d': `${a.delay}ms`
          }"
          role="button"
          tabindex="0"
          @click="guardedInvestigate(a.id)"
          @keydown.enter="guardedInvestigate(a.id)"
        >
          <span class="agent-card__band" aria-hidden="true"></span>
          <div class="agent-card__top">
            <span class="agent-card__icon" aria-hidden="true">
              <svg v-if="a.idx === 0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                <circle cx="8" cy="8" r="5.2" />
                <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
              </svg>
              <svg v-else-if="a.idx === 1" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                <circle cx="4" cy="12" r="1.9" />
                <circle cx="12" cy="4" r="1.9" />
                <path d="M4 10.1V7a3 3 0 0 1 3-3h3.1" />
              </svg>
              <svg v-else-if="a.idx === 2" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3.2 3h9.6A1.7 1.7 0 0 1 14.5 4.7v4.6a1.7 1.7 0 0 1-1.7 1.7H8L4.9 13v-2H3.2A1.7 1.7 0 0 1 1.5 9.3V4.7A1.7 1.7 0 0 1 3.2 3Z" />
              </svg>
              <svg v-else-if="a.idx === 3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                <circle cx="8" cy="5.2" r="2.5" />
                <path d="M3.1 13.3c.8-2.5 2.7-3.8 4.9-3.8s4.1 1.3 4.9 3.8" />
              </svg>
              <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                <rect x="2.6" y="5.6" width="10.8" height="6.9" rx="2" />
                <path d="M8 5.6V3.7" />
                <circle cx="8" cy="2.8" r="0.9" fill="currentColor" stroke="none" />
                <path d="M5.9 9.1h.01M10.1 9.1h.01" stroke-width="2" />
              </svg>
            </span>
            <div class="agent-card__idbox">
              <div class="agent-card__name" :title="a.id">{{ a.name }}</div>
              <div class="agent-card__sub">{{ a.id }}</div>
            </div>
            <span v-if="a.errorCount > 0" class="agent-card__dot is-error">{{ a.errorCount > 9 ? '9+' : a.errorCount }}</span>
            <span v-else class="agent-card__dot is-ok" title="状态正常" aria-label="状态正常"></span>
          </div>
          <div class="agent-card__meta">
            <span class="agent-card__calls"><b>{{ a.calls }}</b>&nbsp;<i>调用</i></span>
            <span
              v-if="a.rate != null"
              class="agent-card__pct"
              :class="a.rate >= 0.99 ? 'is-ok' : a.rate >= 0.9 ? 'is-warn' : 'is-bad'"
              :title="`${a.calls} 调用 · ${a.errorCount} 异常 · 成功率 ${(a.rate * 100).toFixed(1)}%`"
            >{{ (a.rate * 100).toFixed(1) }}%</span>
          </div>
          <div v-if="a.rate != null" class="agent-card__ratebar">
            <span
              class="agent-card__rate"
              :class="a.rate >= 0.99 ? 'is-ok' : a.rate >= 0.9 ? 'is-warn' : 'is-bad'"
              :style="{ width: `${Math.max(3, a.rate * 100)}%` }"
            ></span>
          </div>
        </div>

        <!-- Skill 卡片 -->
        <div
          v-for="s in skillCards"
          :key="s.id"
          class="skill-card"
          :class="{
            'is-idle': s.idle,
            'is-error': s.error
          }"
          :style="{
            left: `${s.x}px`,
            top: `${s.y}px`,
            '--hue': s.hue,
            '--d': `${s.delay}ms`
          }"
          @click="guardedOpenSkill(s.skillId)"
        >
          <span
            class="skill-card__tick"
            :title="s.error ? '状态异常' : s.idle ? '未调用' : '状态正常'"
            :aria-label="s.error ? '状态异常' : s.idle ? '未调用' : '状态正常'"
          ></span>
          <div class="skill-card__body">
            <div class="skill-card__name" :title="s.name">{{ s.skillId }}</div>
            <div class="skill-card__meta">
              <template v-if="s.idle">未调用</template>
              <template v-else>
                <b>{{ s.calls }}</b> 调用 · {{ fmtMs(s.avgMs) }}<template v-if="s.error"> · <em>{{ s.errors }}</em> 失败</template>
              </template>
              <span v-if="s.ioContract || s.model" class="skill-card__def" :title="`IO 契约 ${s.ioContract || '—'} · 模型 ${s.model || '—'}`">
                {{ s.ioContract || '' }}<template v-if="s.model"> · {{ s.model }}</template>
              </span>
            </div>
          </div>
          <button
            type="button"
            class="skill-card__go"
            title="打开 Prompt 设计页"
            @click.stop="goDesign(s.skillId)"
            @keydown.enter.stop="goDesign(s.skillId)"
          >
            ↗
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { skillProfiles, skillStatOf, openSkillDrawer, investigateAgent, spans, dataSource } from './store'
import { liveTopoNodes, liveTopoRange, reloadLiveTopology } from './live'

/* ========== 布局常量 ========== */
const COL_W = 208
const COL_GAP = 34
const COL_X0 = 30
const AGENT_Y = 34
const AGENT_H = 88
const SKILL_Y0 = 178
const SKILL_H = 56
const SKILL_GAP = 12
const CANVAS_PAD_BOTTOM = 40

/* ========== 阶段身份色（仅用于标识，状态语义仍走绿/红） ========== */
interface StageTone { hue: string; soft: string }
// 色相统一走共享 token：紫/靛同色系合并为 --mk-purple，其余一一对应
const STAGES: StageTone[] = [
  { hue: 'var(--mk-purple)', soft: 'rgba(79, 70, 229, 0.1)' }, // 目标 · 紫
  { hue: 'var(--mk-teal)', soft: 'rgba(13, 148, 136, 0.1)' }, // 路径 · 青
  { hue: 'var(--mk-blue)', soft: 'rgba(52, 120, 246, 0.1)' }, // 教学 · 品牌蓝
  { hue: 'var(--mk-amber)', soft: 'rgba(217, 119, 6, 0.1)' }, // 学习者 · 琥珀
  { hue: 'var(--mk-purple)', soft: 'rgba(124, 58, 237, 0.1)' } // 虚拟 · 紫（与目标合并同色系）
]
const stageOf = (i: number): StageTone => STAGES[i] ?? STAGES[STAGES.length - 1]

/* ========== 视图缩放与平移 ========== */
const canvasRef = ref<HTMLElement | null>(null)
const zoom = ref(1)
const tx = ref(0)
const ty = ref(0)
const panning = ref(false)

const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.6

/** 用户手动缩放/平移过后，窗口尺寸变化不再自动重排视图 */
const userInteracted = ref(false)
let resizeObserver: ResizeObserver | null = null

/* 响应式窗口状态：4K 下全站 zoom 1.3（≥2000px 1.15），fitView/画布高度需在逻辑坐标系下计算 */
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
  width: `${contentW.value}px`,
  height: `${contentH.value}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${zoom.value})`,
}))

function toCanvasPoint(event: { clientX: number; clientY: number }) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** 可视高度（逻辑空间）：窗口减顶栏与页面内边距，用于 4K 自适应 */
const availHeight = () => Math.max(420, winH.value / globalZoom.value - 104)

/** 初始/重置视图：内容完整适配画布并水平居中（zoom 不受 1 限制，4K 自动放大） */
function fitView() {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return
  const padding = 20
  const zx = (rect.width / globalZoom.value - padding * 2) / contentW.value
  const zy = (availHeight() - padding * 2) / contentH.value
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(zx, zy)))
  const nextH = availHeight()
  tx.value = Math.max(padding, (rect.width / globalZoom.value - contentW.value * zoom.value) / 2)
  ty.value = Math.max(padding, (nextH - contentH.value * zoom.value) / 2)
}

function zoomAt(anchor: { x: number; y: number }, nextZoomRaw: number) {
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw))
  if (nextZoom === zoom.value) return
  userInteracted.value = true
  const ratio = nextZoom / zoom.value
  // 以锚点为不动点：渲染位置 = 内容 × zoom + t
  tx.value = anchor.x - (anchor.x - tx.value) * ratio
  ty.value = anchor.y - (anchor.y - ty.value) * ratio
  zoom.value = nextZoom
}

function onWheel(event: WheelEvent) {
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
  // 注意：不在此处 setPointerCapture——捕获会把 click 重定向到画布，
  // 导致节点卡片的 @click 永远不触发；改为实际开始拖拽时才捕获（见 onPointerMove）
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

/* 拖拽后不触发节点点击 */
function guardedInvestigate(id: string) {
  if (didPan) {
    didPan = false
    return
  }
  investigateAgent(id)
}

function guardedOpenSkill(id: string) {
  if (didPan) {
    didPan = false
    return
  }
  openSkillDrawer(id)
}

/** Skill 卡 ↗ → Prompt 二级设计页 */
const router = useRouter()
function goDesign(id: string) {
  void router.push(`/admin/skills/${id}`)
}

/* ========== 数据（保持 store 接口不变） ========== */
interface AgentDef { id: string; name: string }
interface SkillItem { id: string; name: string; agentId: string; calls: number; errors: number; avgMs: number; ioContract?: string; model?: string }

// live 模式判定与拓扑是否非空解耦：空拓扑也走 live 分支显示空态，不回退 demo agentDefs
const isLive = computed(() => dataSource.value === 'live')

const liveAgents = computed<AgentDef[]>(() =>
  liveTopoNodes.value.filter((n) => n.type === 'agent').map((n) => ({ id: n.id, name: n.label }))
)
const liveSkills = computed<SkillItem[]>(() =>
  liveTopoNodes.value
    .filter((n) => n.type === 'skill' && n.parentAgentId)
    .map((n) => ({
      id: n.id.replace(/^skill:/, ''),
      name: n.label.replace(/ Skill$/, ''),
      agentId: n.parentAgentId as string,
      calls: n.stats.totalCalls,
      errors: n.stats.failed,
      avgMs: n.stats.avgDuration,
      ioContract: n.ioContractVersion,
      model: n.modelConfig?.model
    }))
)

// demo-only：离线兜底的 Agent 清单，派生自演示 skillProfiles（无硬编码清单，顺序与名称与历史一致）
const demoAgentDefs = computed<AgentDef[]>(() => {
  const seen = new Map<string, string>()
  for (const p of skillProfiles) {
    if (p.agentId && !seen.has(p.agentId)) seen.set(p.agentId, p.agentName)
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
})

// live 模式全量消费拓扑 Agent 节点（无 5 上限）；demo 模式走演示档案
const agentDefs = computed<AgentDef[]>(() => (isLive.value ? liveAgents.value : demoAgentDefs.value))

function skillsOf(agentId: string): SkillItem[] {
  if (isLive.value) return liveSkills.value.filter((s) => s.agentId === agentId)
  return skillProfiles
    .filter((p) => p.agentId === agentId)
    .map((p) => {
      const st = skillStatOf(p.id)
      return { id: p.id, name: p.name, agentId: p.agentId, calls: st.calls, errors: st.errors, avgMs: st.avgMs }
    })
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

/* 时间范围（live） */
const rangeOptions: Array<{ id: '24h' | '7d' | '30d' | 'all'; label: string }> = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: '全部' }
]
const rangeLoading = ref(false)
async function switchRange(r: '24h' | '7d' | '30d' | 'all') {
  if (rangeLoading.value || liveTopoRange.value === r) return
  rangeLoading.value = true
  try {
    await reloadLiveTopology(r)
    // 内容尺寸（节点数/技能数）变化后重新适配视图
    await nextTick()
    fitView()
  } finally {
    rangeLoading.value = false
  }
}

const hasError = computed(() =>
  isLive.value ? liveSkills.value.some((s) => s.errors > 0) : spans.value.some((s) => s.status === 'err')
)

/* ========== 布局计算 ========== */
const agentCards = computed(() =>
  agentDefs.value.map((a, i) => {
    const members = skillsOf(a.id)
    const errorCount = members.filter((m) => m.errors > 0).length
    const calls = members.reduce((sum, m) => sum + m.calls, 0)
    const failures = members.reduce((sum, m) => sum + m.errors, 0)
    const rate = calls ? (calls - failures) / calls : null
    return {
      ...a,
      idx: i,
      stage: stageOf(i),
      memberCount: members.length,
      calls,
      errorCount,
      rate,
      delay: i * 60,
      x: COL_X0 + i * (COL_W + COL_GAP),
      y: AGENT_Y,
    }
  })
)

const skillCards = computed(() => {
  const out: Array<{
    id: string; skillId: string; name: string
    x: number; y: number; idle: boolean; error: boolean; errors: number; calls: number; avgMs: number
    hue: string; delay: number; agentIdx: number
    ioContract?: string; model?: string
  }> = []
  agentDefs.value.forEach((a, i) => {
    skillsOf(a.id).forEach((p, j) => {
      out.push({
        id: `${a.id}-${j}`,
        skillId: p.id,
        name: p.name,
        calls: p.calls,
        avgMs: p.avgMs,
        x: COL_X0 + i * (COL_W + COL_GAP),
        y: SKILL_Y0 + j * (SKILL_H + SKILL_GAP),
        idle: p.calls === 0,
        error: p.errors > 0,
        errors: p.errors,
        hue: stageOf(i).hue,
        delay: 120 + i * 50 + j * 35,
        agentIdx: i,
        ioContract: p.ioContract,
        model: p.model,
      })
    })
  })
  return out
})

const agentNodes = agentCards
const skillNodes = skillCards

const isEmpty = computed(() => agentCards.value.length === 0)

const totalCalls = computed(() => agentCards.value.reduce((sum, a) => sum + a.calls, 0))

const maxSkillCount = computed(() =>
  Math.max(1, ...agentDefs.value.map((a) => skillsOf(a.id).length))
)

const contentW = computed(() => COL_X0 * 2 + agentDefs.value.length * COL_W + (agentDefs.value.length - 1) * COL_GAP)
const contentH = computed(() => SKILL_Y0 + maxSkillCount.value * (SKILL_H + SKILL_GAP) + CANVAS_PAD_BOTTOM)

/** 画布高度 = 可视逻辑高度（zoom 上限时内容居中，4K 下撑满可视区） */
const canvasHeight = computed(() => (isEmpty.value ? 520 : Math.round(availHeight())))

/* ========== 连线 ========== */
interface TopoEdge {
  d: string
  stroke: string
  opacity: number
  width: number
  dashed?: boolean
  agentIdx: number
  skillKey: string
  active: boolean
}

const edges = computed<TopoEdge[]>(() => {
  const out: TopoEdge[] = []
  agentCards.value.forEach((a, i) => {
    const ax = a.x + COL_W / 2
    const ay = a.y + AGENT_H
    const hue = stageOf(i).hue
    skillsOf(a.id).forEach((p, j) => {
      const sx = COL_X0 + i * (COL_W + COL_GAP) + COL_W / 2
      const sy = SKILL_Y0 + j * (SKILL_H + SKILL_GAP)
      const idle = p.calls === 0
      const error = p.errors > 0
      out.push({
        d: `M ${ax} ${ay} C ${ax} ${ay + 30}, ${sx} ${sy - 30}, ${sx} ${sy}`,
        stroke: error ? '#dc2626' : idle ? '#b9c5da' : hue,
        opacity: error ? 0.75 : idle ? 0.55 : 0.5,
        width: error ? 1.6 : Math.min(1.4 + p.calls / 3, 3),
        dashed: idle,
        agentIdx: i,
        skillKey: `${a.id}-${j}`,
        active: !idle,
      })
    })
  })
  return out
})

/** 活跃边上的流动层（数据包动画） */
const flowEdges = computed(() => edges.value.filter((e) => e.active))

/** Agent 之间的流水线箭头（渐变 + 三角箭头） */
const flows = computed(() => {
  const out: Array<{ i: number; x1: number; x2: number; y: number; from: string; to: string; arrow: string }> = []
  const y = AGENT_Y + 42
  for (let i = 0; i < agentCards.value.length - 1; i++) {
    const a = agentCards.value[i]
    const x1 = a.x + COL_W + 5
    const x2 = a.x + COL_W + COL_GAP - 5
    out.push({
      i,
      x1,
      x2,
      y,
      from: stageOf(i).hue,
      to: stageOf(i + 1).hue,
      arrow: `${x2 - 6},${y - 3.6} ${x2},${y} ${x2 - 6},${y + 3.6}`,
    })
  }
  return out
})
</script>

<style scoped>
/* ========== 工具栏 ========== */
.topo-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 2px 2px 12px;
}
.topo-toolbar__status {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}
.topo-status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.topo-status-dot.is-ok {
  background: var(--mk-green);
  animation: tk-pulse 2.6s ease-out infinite;
}
.topo-status-dot.is-error { background: #dc2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14); }
@keyframes tk-pulse {
  0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.32); }
  70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
}
.topo-toolbar__title { font-size: 13px; font-weight: 600; color: #16233c; }
.topo-toolbar__sep { width: 1px; height: 14px; background: var(--mk-line); }
.topo-toolbar__meta {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--mk-faint);
  font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
}
.topo-toolbar__meta b { color: var(--mk-ink); font-weight: 600; margin-right: 3px; }
.topo-toolbar__hint { font-size: 12px; color: var(--mk-faint); }
.topo-toolbar__controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.topo-legend { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--mk-muted); }
.lg { width: 7px; height: 7px; display: inline-block; border-radius: 50%; }
.lg--ok { background: var(--mk-green); }
.lg--idle { background: #c3cede; }
.lg--err { background: #dc2626; }
.topo-toolbar__vsep { width: 1px; height: 16px; background: var(--mk-line); }
.topo-ctrl {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-muted);
  border-radius: 8px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.topo-ctrl:hover { color: #3478f6; border-color: #3478f6; }
.topo-ctrl--zoom {
  width: auto;
  min-width: 48px;
  padding: 0 8px;
  font-size: 11px;
  font-family: var(--mk-mono);
  font-variant-numeric: tabular-nums;
}

/* ========== 画布 ========== */
.topo-canvas {
  position: relative;
  border: 1px solid var(--mk-line);
  border-radius: 16px;
  background:
    radial-gradient(640px 320px at 14% 0%, rgba(52, 120, 246, 0.06), transparent 70%),
    linear-gradient(90deg, rgba(214, 223, 238, 0.55) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(180deg, rgba(214, 223, 238, 0.55) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(180deg, #fbfcff, #f2f5fa);
  overflow: hidden;
  cursor: default;
  touch-action: none;
  user-select: none;
}
/* 拖拽平移中显示抓取反馈 */
.topo-canvas.is-panning { cursor: grabbing; }

/* 图纸角标刻度 */
.tk {
  position: absolute;
  width: 13px;
  height: 13px;
  pointer-events: none;
  opacity: 0.75;
  z-index: 1;
}
.tk--tl { top: 10px; left: 10px; border-top: 1.5px solid #c3cfe4; border-left: 1.5px solid #c3cfe4; border-top-left-radius: 3px; }
.tk--tr { top: 10px; right: 10px; border-top: 1.5px solid #c3cfe4; border-right: 1.5px solid #c3cfe4; border-top-right-radius: 3px; }
.tk--bl { bottom: 10px; left: 10px; border-bottom: 1.5px solid #c3cfe4; border-left: 1.5px solid #c3cfe4; border-bottom-left-radius: 3px; }
.tk--br { bottom: 10px; right: 10px; border-bottom: 1.5px solid #c3cfe4; border-right: 1.5px solid #c3cfe4; border-bottom-right-radius: 3px; }

/* 交互提示（左下角） */
.topo-hint {
  position: absolute;
  left: 14px;
  bottom: 12px;
  z-index: 2;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--mk-faint);
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(203, 213, 231, 0.65);
  border-radius: 8px;
  padding: 4px 9px;
  pointer-events: none;
  user-select: none;
}

/* 缩放控制（右下角浮层） */
.topo-zoom {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(30, 58, 110, 0.1);
}
.topo-zoom .topo-ctrl {
  width: 27px;
  height: 27px;
  font-size: 15px;
}
/* 窄屏：hint 与缩放控件同处底角会重叠，隐藏 hint（同文案工具栏已展示） */
@media (max-width: 416px) {
  .topo-hint { display: none; }
}

/* 空态 */
.topo-empty {
  position: absolute;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%);
  z-index: 2;
  text-align: center;
  pointer-events: none;
  user-select: none;
}
.topo-empty__icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: #fff;
  border: 1px dashed var(--mk-line);
  color: #b3c0d6;
}
.topo-empty__icon svg { width: 26px; height: 26px; }
.topo-empty p { font-size: 13px; font-weight: 600; color: var(--mk-muted); }
.topo-empty__sub { font-weight: 400 !important; font-size: 11.5px !important; color: var(--mk-faint) !important; margin-top: 4px; }

.topo-viewport {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
.topo-edges {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}
.topo-edges path { animation: tk-fade 0.6s ease backwards; }
@keyframes tk-fade { from { opacity: 0; } }
.topo-edge { transition: stroke-opacity 0.18s ease; }

/* 活跃边数据流：dash 滚动（特异性须高于通用淡入） */
.topo-edges path.topo-flow {
  stroke-dasharray: 2.5 9;
  animation: tk-flow 1.5s linear infinite;
  pointer-events: none;
}
@keyframes tk-flow {
  to { stroke-dashoffset: -23; }
}

/* 时间范围切换 */
.topo-range {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: #eef2fa;
  border-radius: 8px;
}
.topo-range__btn {
  border: 0;
  background: transparent;
  padding: 3px 9px;
  border-radius: 6px;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--mk-mono);
  color: var(--mk-muted);
  cursor: pointer;
}
.topo-range__btn--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(23, 32, 51, 0.1); }
.topo-range__btn:disabled { opacity: 0.55; cursor: not-allowed; }

/* ========== Agent 阶段头卡片 ========== */
.agent-card {
  position: absolute;
  width: 208px;
  height: 88px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--hue) 5%, #ffffff), #ffffff 55%);
  border: 1px solid color-mix(in srgb, var(--hue) 18%, #e6ecf6);
  border-radius: 13px;
  padding: 12px 13px 11px;
  box-shadow: 0 1px 2px rgba(30, 58, 110, 0.04), 0 8px 20px rgba(30, 58, 110, 0.06);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: opacity 0.18s ease, transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  animation: tk-rise 0.48s cubic-bezier(0.22, 0.8, 0.32, 1) backwards;
  animation-delay: var(--d, 0ms);
  overflow: hidden;
}
/* 左侧身份色带：恒为阶段色；异常由红点 + 指标数字提示 */
.agent-card__band {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--hue);
  opacity: 0.85;
}
/* 卡片平时默认箭头，悬停时提示可点击 */
.agent-card:hover,
.skill-card:hover { cursor: pointer; }
.agent-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--hue) 40%, #e6ecf6);
  box-shadow: 0 2px 4px rgba(30, 58, 110, 0.05), 0 14px 30px color-mix(in srgb, var(--hue) 14%, transparent);
}
.agent-card__top {
  display: flex;
  align-items: center;
  gap: 9px;
}
.agent-card__icon {
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--hue) 16%, #ffffff), color-mix(in srgb, var(--hue) 5%, #ffffff));
  color: var(--hue);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hue) 22%, transparent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.agent-card__icon svg { width: 15px; height: 15px; }
.agent-card__idbox { min-width: 0; flex: 1; }
/* 主标题：中文名（sans 13/700）；身份行：id + 成员数（mono 灰） */
.agent-card__name {
  font-size: 13px;
  font-weight: 700;
  color: #16233c;
  letter-spacing: 0.01em;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-card__sub {
  margin-top: 2px;
  font-family: var(--mk-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--mk-faint);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 状态：ok 绿点；error 红色计数徽标 */
.agent-card__dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-family: var(--mk-mono);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.agent-card__dot.is-ok {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mk-green);
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12);
}
.agent-card__dot.is-error {
  min-width: 17px;
  height: 17px;
  padding: 0 3px;
  border-radius: 999px;
  background: #dc2626;
  color: #ffffff;
  font-size: 10px;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.14);
}
/* 指标行：调用数（左） + 成功率（右） */
.agent-card__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-left: 30px;
  white-space: nowrap;
}
.agent-card__calls b {
  font-family: var(--mk-mono);
  font-weight: 600;
  font-size: 12.5px;
  color: #1a2a44;
  font-variant-numeric: tabular-nums;
}
.agent-card__calls i {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--mk-faint);
  margin-left: 2px;
}
.agent-card__pct {
  font-family: var(--mk-mono);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.agent-card__pct.is-ok { color: var(--mk-green); }
.agent-card__pct.is-warn { color: #b45309; }
.agent-card__pct.is-bad { color: #dc2626; }

/* 成功率条（轨道 + 填充），与指标行同左缘成组 */
.agent-card__ratebar {
  margin-left: 30px;
  margin-top: 7px;
  height: 3px;
  border-radius: 2px;
  background: #edf1f8;
  overflow: hidden;
}
.agent-card__rate {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}
.agent-card__rate.is-ok { background: linear-gradient(90deg, #16a34a, #4ade80); }
.agent-card__rate.is-warn { background: linear-gradient(90deg, #b45309, #fbbf24); }
.agent-card__rate.is-bad { background: linear-gradient(90deg, #dc2626, #f87171); }

/* ========== Skill 卡片 ========== */
.skill-card {
  position: absolute;
  width: 208px;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #e6ecf6;
  border-radius: 11px;
  padding: 0 12px;
  box-shadow: 0 1px 2px rgba(30, 58, 110, 0.04), 0 4px 12px rgba(30, 58, 110, 0.04);
  transition: opacity 0.18s ease, transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  animation: tk-rise 0.48s cubic-bezier(0.22, 0.8, 0.32, 1) backwards;
  animation-delay: var(--d, 0ms);
}
.skill-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--hue) 40%, #e6ecf6);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--hue) 12%, transparent);
}
.skill-card.is-idle {
  background: rgba(255, 255, 255, 0.55);
  border-style: dashed;
  box-shadow: none;
}
/* 左侧短色条：层级区分（Agent 为全高色带 + 淡色底，Skill 为短条 + 纯白底） */
.skill-card__tick {
  width: 4px;
  height: 24px;
  border-radius: 3px;
  background: var(--hue);
  flex-shrink: 0;
  opacity: 0.9;
}
.skill-card.is-idle .skill-card__tick { background: #d3dbe9; }
.skill-card.is-error .skill-card__tick { background: #dc2626; }
.skill-card__body { min-width: 0; flex: 1; }
/* 主标题：英文 skillId（mono）；中文名入 tooltip */
.skill-card__name {
  font-family: var(--mk-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: #223252;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.skill-card.is-idle .skill-card__name { color: var(--mk-faint); }
.skill-card__meta {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--mk-faint);
  font-variant-numeric: tabular-nums;
  padding-right: 22px;
}
.skill-card__meta b {
  font-family: var(--mk-mono);
  font-weight: 600;
  color: #41516e;
}
.skill-card__meta em { font-style: normal; font-family: var(--mk-mono); font-weight: 600; color: #dc2626; }

/* ↗ 设计页直达：absolute 右上浮层，不占内容布局（hover 显现） */
.skill-card__go {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: #8492ab;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.skill-card:hover .skill-card__go,
.skill-card__go:focus-visible { opacity: 1; }
.skill-card__go:hover {
  color: var(--hue);
  background: color-mix(in srgb, var(--hue) 10%, transparent);
  border-color: color-mix(in srgb, var(--hue) 30%, transparent);
}

@keyframes tk-rise {
  from { opacity: 0; transform: translateY(12px); }
}
</style>
