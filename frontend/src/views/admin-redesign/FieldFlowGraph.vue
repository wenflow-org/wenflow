<template>
  <div class="ffg">
    <!-- 工具栏：状态 + 图例 + 操作 -->
    <div class="ffg-toolbar">
      <div class="ffg-toolbar__status">
        <span class="ffg-dot" :class="loading ? 'is-loading' : 'is-ok'"></span>
        <strong class="ffg-title">字段流转</strong>
        <span class="ffg-sep"></span>
        <span class="ffg-meta"><b>{{ totalFields }}</b> 个字段</span>
        <span class="ffg-meta"><b>{{ edgeCount }}</b> 条流转</span>
        <span class="ffg-hint">泳道 = 阶段 · 字段按产出分组 · 箭头 = handoff 去向</span>
      </div>
      <div class="ffg-toolbar__controls">
        <label class="ffg-switch" :title="showHidden ? '隐藏字段也会显示' : '仅显示对外/流转字段'">
          <input type="checkbox" v-model="showHidden" />
          <span>含隐藏字段</span>
        </label>
        <span class="ffg-legend"><i class="lg lg--handoff"></i>移交</span>
        <span class="ffg-legend"><i class="lg lg--accumulate"></i>累积</span>
        <span class="ffg-legend"><i class="lg lg--internal"></i>内部</span>
        <span class="ffg-legend"><i class="lg lg--end"></i>终点</span>
      </div>
    </div>

    <div v-if="loading" class="ffg-empty">加载中…</div>
    <div v-else-if="error" class="ffg-empty ffg-empty--error">
      {{ error }}
      <button type="button" class="mk-empty__action" @click="load">重试</button>
    </div>
    <template v-else>
      <div class="ffg-canvas" :style="{ height: canvasStyleH }">
        <!-- 连线层（在泳道之下，跨阶段弧线从字段节点引出） -->
        <svg class="ffg-edges" :width="canvasW" :height="canvasH" aria-hidden="true">
          <defs>
            <marker id="ffg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
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
            marker-end="url(#ffg-arrow)"
            class="ffg-edge"
          />
        </svg>

        <!-- 泳道（阶段）绝对定位 -->
        <div
          v-for="lane in layouts"
          :key="lane.stage.id"
          class="ffg-lane"
          :style="{
            left: `${lane.x}px`,
            top: '0px',
            height: `${lane.laneHeight}px`,
            '--hue': toneOf(lane.stage.id).hue,
            '--soft': toneOf(lane.stage.id).soft
          }"
        >
          <div class="ffg-lane__head">
            <span class="ffg-lane__idx">{{ lane.stage.order }}</span>
            <strong class="ffg-lane__name">{{ lane.stage.name }}</strong>
            <span class="ffg-lane__id mono">{{ lane.stage.agentId }}</span>
            <span class="ffg-lane__count">{{ lane.stage.fieldCount }} 字段</span>
          </div>

          <!-- 阶段内 Skill 分组 -->
          <div v-for="slot in lane.slots" :key="slot.agentId" class="ffg-group" :class="{ 'is-bridge': slot.bridge }">
            <div class="ffg-group__head">
              <span v-if="slot.bridge" class="ffg-group__badge">桥接</span>
              <span class="ffg-group__name mono">{{ displayNameOf(slot.agentId) }}</span>
              <span class="ffg-group__count">{{ slot.fields.length }} 字段</span>
            </div>

            <div class="ffg-fields">
              <button
                v-for="fs in slot.fields"
                :key="fs.field.id"
                type="button"
                class="ffg-field"
                :class="{
                  'is-hidden': fs.field.render === 'hidden',
                  'is-accum': fs.field.accumulate,
                  'is-internal': fs.field.internal,
                  'is-locked': fs.field.locked,
                  'is-handoff': fs.field.handoffTargets.length > 0
                }"
                :title="fieldTitle(fs.field)"
                @click="openField(fs.field)"
              >
                <span class="ffg-field__name mono">{{ fs.field.fieldId }}</span>
                <span class="ffg-field__desc">{{ fs.field.description || '—' }}</span>
                <span class="ffg-field__meta">
                  <span v-if="fs.field.locked" class="mk-badge mk-badge--lock-system" title="系统锁/结构锁：需改编排文件">锁</span>
                  <span v-if="fs.field.internal" class="ffg-tag ffg-tag--internal">内部</span>
                  <span v-if="fs.field.accumulate" class="ffg-tag ffg-tag--accum">累积</span>
                  <span class="ffg-tag ffg-tag--role">{{ roleLabel(fs.field.role) }}</span>
                </span>
              </button>
              <div v-if="!slot.fields.length" class="ffg-group__empty">该组无字段</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 字段详情抽屉 -->
    <Teleport to="body">
      <div v-if="selected" class="ffg-drawer-mask" @click.self="selected = null">
        <aside class="ffg-drawer" role="dialog" aria-label="字段详情">
          <div class="ffg-drawer__head">
            <div>
              <h3 class="ffg-drawer__title mono">{{ selected.fieldId }}</h3>
              <p class="ffg-drawer__sub">{{ selected.description || '—' }}</p>
            </div>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="selected = null">✕</button>
          </div>

          <div class="ffg-drawer__body">
            <dl class="ffg-dl">
              <div class="ffg-dl__row">
                <dt>产出方</dt>
                <dd class="mono">{{ selected.agentId }}</dd>
              </div>
              <div class="ffg-dl__row">
                <dt>类型</dt>
                <dd class="mono">{{ selected.valueType || '—' }}</dd>
              </div>
              <div class="ffg-dl__row">
                <dt>角色</dt>
                <dd><span class="mk-badge" :class="`mk-badge--role-${selected.role}`">{{ roleLabel(selected.role) }}（{{ selected.role }}）</span></dd>
              </div>
              <div class="ffg-dl__row">
                <dt>可见性</dt>
                <dd>
                  <span class="mk-badge" :class="`mk-badge--render-${selected.render}`">{{ selected.render }}</span>
                  <span v-if="selected.internal" class="ffg-tag ffg-tag--internal">内部信令</span>
                  <span v-if="selected.accumulate" class="ffg-tag ffg-tag--accum">累积进学习者状态</span>
                </dd>
              </div>
              <div class="ffg-dl__row">
                <dt>落库键</dt>
                <dd class="mono">{{ selected.persistKey || selected.fieldId }}</dd>
              </div>
              <div class="ffg-dl__row" v-if="selected.pathInRawOutput">
                <dt>抽取路径</dt>
                <dd class="mono">{{ selected.pathInRawOutput }}</dd>
              </div>
              <div class="ffg-dl__row">
                <dt>锁定</dt>
                <dd><span class="mk-badge" :class="`mk-badge--lock-${selected.lockLevel}`">{{ lockLabel(selected.lockLevel) }}</span></dd>
              </div>
              <div class="ffg-dl__row" v-if="selected.notes">
                <dt>备注</dt>
                <dd>{{ selected.notes }}</dd>
              </div>
            </dl>

            <!-- 流转去向 -->
            <div class="ffg-flow">
              <h4 class="ffg-flow__title">流转去向</h4>
              <div v-if="selected.handoffTargets.length" class="ffg-flow__list">
                <span v-for="t in selected.handoffTargets" :key="t" class="ffg-flow__chip mono">{{ t }}</span>
                <span class="ffg-flow__arrow">→</span>
                <span class="ffg-flow__hint">下游阶段 / Skill 消费</span>
              </div>
              <div v-else class="ffg-flow__none">
                {{ selected.internal ? '内部信令，不进业务流转' : selected.accumulate ? '累积进学习者状态（画像/上下文）' : '对话终点（不转交）' }}
              </div>
            </div>

            <!-- 行级编辑（仅可编辑行） -->
            <div v-if="!selected.locked" class="ffg-edit">
              <h4 class="ffg-flow__title">行级编辑（会同步回写编排文件）</h4>
              <div class="ffg-edit__row">
                <span class="ffg-edit__label">可见性</span>
                <span class="ffg-edit__pills">
                  <button
                    type="button"
                    class="ffg-pill"
                    :class="{ 'is-on': editDraft.render === 'visible' }"
                    @click="editDraft.render = 'visible'"
                  >visible</button>
                  <button
                    type="button"
                    class="ffg-pill"
                    :class="{ 'is-on': editDraft.render === 'hidden' }"
                    @click="editDraft.render = 'hidden'"
                  >hidden</button>
                </span>
              </div>
              <div class="ffg-edit__row">
                <span class="ffg-edit__label">移交（handoff）</span>
                <input
                  v-model="editDraft.handoffText"
                  class="ffg-edit__input mono"
                  placeholder="阶段名 / skill:id / agent，逗号分隔；空 = 不转交"
                  spellcheck="false"
                />
              </div>
              <div class="ffg-edit__row">
                <span class="ffg-edit__label">累积</span>
                <label class="ffg-check"><input type="checkbox" v-model="editDraft.accumulate" /><span>accumulate（累积进学习者状态）</span></label>
              </div>
              <div class="ffg-edit__row">
                <span class="ffg-edit__label">内部</span>
                <label class="ffg-check"><input type="checkbox" v-model="editDraft.internal" /><span>internal（仅供 UI / 平台内部消费）</span></label>
              </div>
              <div class="ffg-edit__row">
                <span class="ffg-edit__label">备注</span>
                <input v-model="editDraft.notes" class="ffg-edit__input" placeholder="备注（可选）" spellcheck="false" />
              </div>
              <p v-if="editMsg" class="ffg-edit__msg" :class="{ 'is-error': editError }">{{ editMsg }}</p>
              <div class="ffg-edit__actions">
                <button type="button" class="mk-btn" :disabled="saving" @click="resetDraft">还原</button>
                <button type="button" class="mk-btn mk-btn--primary" :disabled="saving || !dirty" @click="saveEdit">
                  {{ saving ? '保存中…' : '保存修改' }}
                </button>
              </div>
            </div>
            <div v-else class="ffg-edit ffg-edit--locked">
              <h4 class="ffg-flow__title">行级编辑</h4>
              <p class="ffg-edit__locked-hint">该字段为系统锁/结构锁：属性由编排文件或代码派生，请使用「编排文件」入口修改。</p>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { adminFieldRoutingsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'
import { AGENT_TONES } from './store'

/* ================= 类型 ================= */
interface FieldItem {
  fieldId: string
  valueType?: string
  promptRole?: string
  description?: string | null
  enumValues?: unknown
  locks?: { level?: string }
  pathInRawOutput?: string | null
  persistKey?: string | null
}
interface RoutingItem {
  id: string
  agentId: string
  fieldId: string
  render: string
  handoff: string | string[] | null
  internal: boolean
  accumulate: boolean
  locks?: { level?: string }
  notes?: string | null
  visibilityPreset?: string | null
}
interface StageDetail {
  stage: string
  fields: FieldItem[]
  agents: Array<{ agentId: string; description?: string }>
  routings: RoutingItem[]
  promptRoleMeta?: Array<{ id: string; label: string; hint: string }>
}

interface FlowField {
  id: string
  fieldId: string
  agentId: string
  description: string
  valueType: string
  role: string
  render: string
  internal: boolean
  accumulate: boolean
  locked: boolean
  lockLevel: string
  handoffTargets: string[]
  pathInRawOutput: string
  persistKey: string
  notes: string
}
interface FlowGroup {
  agentId: string
  bridge: boolean
  description: string
  fields: FlowField[]
}
interface FlowStage {
  id: string
  order: string
  name: string
  agentId: string
  fieldCount: number
  groups: FlowGroup[]
}

/* ================= props ================= */
const props = defineProps<{ stage: string }>()
const emit = defineEmits<{ changed: [] }>()

/** 全阶段顺序（泳道顺序 = 编排链路顺序） */
const STAGE_ORDER = ['goal', 'path', 'teaching', 'profile', 'simulation']
const STAGE_LABELS: Record<string, string> = {
  goal: '澄清', path: '规划', teaching: '教学', profile: '画像', simulation: '仿真',
}

/* ================= 状态 ================= */
const loading = ref(false)
const error = ref('')
const detailByStage = ref<Record<string, StageDetail | null>>({})
const showHidden = ref(false)
const selected = ref<FlowField | null>(null)
const saving = ref(false)
const editMsg = ref('')
const editError = ref(false)
const editDraft = reactive({ render: 'visible', handoffText: '', accumulate: false, internal: false, notes: '' })

/* ================= 角色词表（后端下发，前端回退内置） ================= */
const roleMeta = computed(() => {
  for (const s of STAGE_ORDER) {
    const meta = detailByStage.value[s]?.promptRoleMeta
    if (meta?.length) return meta
  }
  return []
})
function roleLabel(role: string) {
  const m = roleMeta.value.find((r) => r.id === role)
  return m?.label || role
}
function lockLabel(level?: string) {
  if (level === 'system-locked') return '系统锁'
  if (level === 'structure-locked') return '结构锁'
  return '可编辑'
}

const toneOf = (id: string) => AGENT_TONES[`${id}-agent`] || { hue: '#64748b', soft: 'rgba(100,116,139,0.08)' }

/* ================= 数据组装 ================= */
/** 加载全部阶段（泳道需要看到跨阶段流转），单阶段失败不影响其它阶段 */
async function load() {
  loading.value = true
  error.value = ''
  try {
    const results = await Promise.allSettled(
      STAGE_ORDER.map(async (s) => {
        const res = await adminFieldRoutingsApi.getStageDetail(s)
        return { stage: s, detail: (res.data?.data as StageDetail) || null }
      })
    )
    const next: Record<string, StageDetail | null> = {}
    let firstErr = ''
    results.forEach((r, i) => {
      const s = STAGE_ORDER[i]
      if (r.status === 'fulfilled') {
        next[s] = r.value.detail
      } else {
        next[s] = null
        if (!firstErr) firstErr = (r.reason as any)?.response?.data?.error?.message || (r.reason as any)?.message || `阶段 ${s} 加载失败`
      }
    })
    detailByStage.value = next
    if (!Object.values(next).some((d) => d)) error.value = firstErr || '字段流转加载失败'
  } catch (e: any) {
    error.value = e?.response?.data?.error?.message || e?.message || '字段流转加载失败'
  } finally {
    loading.value = false
  }
}
watch(() => props.stage, () => { selected.value = null; void load() }, { immediate: true })
defineExpose({ reload: load })

function parseHandoff(raw: string | string[] | null): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function buildStage(s: string, d: StageDetail): FlowStage {
  const fieldById = new Map(d.fields.map((f) => [f.fieldId, f]))
  const byAgent = new Map<string, RoutingItem[]>()
  for (const r of d.routings) {
    const list = byAgent.get(r.agentId) || []
    list.push(r)
    byAgent.set(r.agentId, list)
  }
  // 阶段内 agent 顺序：skill:<id> 在前（产出组），<stage>-agent 桥接组殿后
  const agentOrder = (a: string) => (a.startsWith('skill:') ? 0 : 1)
  const groups = [...byAgent.entries()]
    .sort((a, b) => agentOrder(a[0]) - agentOrder(b[0]) || a[0].localeCompare(b[0]))
    .map(([agentId, routings]): FlowGroup => {
      const bridge = agentId.endsWith('-agent') && !agentId.startsWith('skill:')
      const fields: FlowField[] = routings
        .map((r): FlowField => {
          const f = fieldById.get(r.fieldId)
          return {
            id: `${agentId}\0${r.fieldId}`,
            fieldId: r.fieldId,
            agentId,
            description: f?.description || '',
            valueType: f?.valueType || '',
            role: f?.promptRole || '',
            render: r.render,
            internal: r.internal,
            accumulate: r.accumulate,
            locked: r.locks?.level === 'system-locked' || r.locks?.level === 'structure-locked',
            lockLevel: r.locks?.level || 'fully-editable',
            handoffTargets: parseHandoff(r.handoff),
            pathInRawOutput: f?.pathInRawOutput || '',
            persistKey: f?.persistKey || '',
            notes: r.notes || '',
          }
        })
        .sort((a, b) => a.fieldId.localeCompare(b.fieldId))
      const contract = d.agents.find((a) => a.agentId === agentId)
      return { agentId, bridge, description: contract?.description || '', fields }
    })
  const fieldCount = groups.reduce((s2, g) => s2 + g.fields.length, 0)
  return {
    id: s,
    order: String(STAGE_ORDER.indexOf(s) + 1),
    name: STAGE_LABELS[s] || s,
    agentId: `${s}-agent`,
    fieldCount,
    groups,
  }
}

/** 全阶段泳道（有数据的阶段才显示；保证泳道顺序 = 链路顺序） */
const stages = computed<FlowStage[]>(() => {
  const out: FlowStage[] = []
  for (const s of STAGE_ORDER) {
    const d = detailByStage.value[s]
    if (!d) continue
    out.push(buildStage(s, d))
  }
  return out
})

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] || stage
}
void stageLabel

function visibleFields(fields: FlowField[]) {
  return showHidden.value ? fields : fields.filter((f) => f.render === 'visible' || f.handoffTargets.length > 0 || f.accumulate)
}

const totalFields = computed(() => stages.value.reduce((s, st) => s + st.fieldCount, 0))

/* ================= 画布与连线（真实坐标 + 跨阶段边） ================= */
const LANE_W = 292
const LANE_GAP = 14
const LANE_X0 = 12
const HEAD_H = 46
const GROUP_H = 34
const FIELD_H = 66
const FIELD_GAP = 8
const FIELD_X = 14
const FIELD_W = LANE_W - FIELD_X * 2
const PAD_BOTTOM = 16
const PAD_TOP = 12

interface StageLayout {
  stage: FlowStage
  x: number
  /** 该泳道内字段节点的绝对坐标表：agentId → 字段列表（每个带 y） */
  slots: Array<{ agentId: string; bridge: boolean; fields: Array<{ field: FlowField; y: number }> }>
  laneHeight: number
}
const layouts = computed<StageLayout[]>(() => {
  const out: StageLayout[] = []
  let x = LANE_X0
  for (const st of stages.value) {
    let y = PAD_TOP + HEAD_H
    const slots: StageLayout['slots'] = []
    for (const g of st.groups) {
      const list = visibleFields(g.fields)
      const fieldSlots: StageLayout['slots'][number]['fields'] = []
      if (list.length) {
        y += GROUP_H
        for (const f of list) {
          fieldSlots.push({ field: f, y })
          y += FIELD_H + FIELD_GAP
        }
      }
      slots.push({ agentId: g.agentId, bridge: g.bridge, fields: fieldSlots })
    }
    out.push({ stage: st, x, slots, laneHeight: y + PAD_BOTTOM })
    x += LANE_W + LANE_GAP
  }
  return out
})

const canvasW = computed(() => (layouts.value.length ? LANE_X0 * 2 + layouts.value.length * LANE_W + (layouts.value.length - 1) * LANE_GAP : 400))
const canvasH = computed(() => Math.max(560, ...layouts.value.map((l) => l.laneHeight)))
/** 画布容器高度 = 最大泳道高度（避免绝对定位泳道被容器裁切） */
const canvasStyleH = computed(() => `${canvasH.value}px`)

/** 字段 → 画布绝对坐标 */
function fieldPos(layout: StageLayout, _slot: StageLayout['slots'][number], f: { field: FlowField; y: number }) {
  return {
    x: layout.x + FIELD_X,
    y: f.y,
    w: FIELD_W,
    h: FIELD_H,
    cx: layout.x + FIELD_X + FIELD_W / 2,
    cy: f.y + FIELD_H / 2,
  }
}

/** skill:<id> / <stage>-agent → 所属阶段 id */
function stageOfTarget(target: string): string | null {
  if (STAGE_ORDER.includes(target)) return target
  const bare = target.replace(/^skill:/, '')
  // 编排定义里的成员 skill 按名映射到阶段（与编排文件 contracts 归属一致）
  const bySkill: Record<string, string> = {
    'goal-conversation': 'goal',
    'path-planning': 'path',
    'stage-designer': 'path',
    'teaching-turn': 'teaching',
    'peer-reinforcement': 'teaching',
    'session-wrapup': 'teaching',
    'adaptive-guidance-copy': 'teaching',
    'learner-model': 'profile',
    'lesson-knowledge-enricher': 'profile',
    'virtual-learner-goal-dialogue-simulator': 'simulation',
    'virtual-learner-path-evaluator': 'simulation',
    'virtual-learner-learn-turn-simulator': 'simulation',
    'virtual-learner-referee': 'simulation',
    'virtual-learner-actor-auditor': 'simulation',
    'virtual-learner-persona-designer': 'simulation',
    'virtual-learner-scenario-designer': 'simulation',
  }
  if (bySkill[bare]) return bySkill[bare]
  for (const s of STAGE_ORDER) {
    if (target === `${s}-agent`) return s
  }
  return null
}

/** 目标 → 目标泳道内的锚点（找该泳道里与目标同 id 的产出组；找不到用泳道中线） */
function targetAnchor(layoutsList: StageLayout[], target: string): { x: number; y: number } | null {
  const tStage = stageOfTarget(target)
  if (!tStage) return null
  const lane = layoutsList.find((l) => l.stage.id === tStage)
  if (!lane) return null
  const slot = lane.slots.find((s) => s.agentId === target || (target.startsWith('skill:') && s.agentId === target))
  if (slot && slot.fields.length) {
    const first = slot.fields[0]
    return { x: lane.x + FIELD_X + FIELD_W / 2, y: first.y + FIELD_H / 2 }
  }
  // 兜底：泳道中线（头部下方）
  return { x: lane.x + LANE_W / 2, y: PAD_TOP + HEAD_H + 20 }
}

interface Edge {
  d: string
  stroke: string
  width: number
  dashed: boolean
  from: string
  to: string
}
const edges = computed<Edge[]>(() => {
  const out: Edge[] = []
  const ls = layouts.value
  if (!ls.length) return out
  for (const lane of ls) {
    for (const slot of lane.slots) {
      for (const fs of slot.fields) {
        for (const t of fs.field.handoffTargets) {
          const tStage = stageOfTarget(t)
          if (!tStage) continue
          const from = fieldPos(lane, slot, fs)
          // 目标就在本泳道（段内桥接：如 skill:goal-conversation → goal-agent）
          if (tStage === lane.stage.id) {
            const tSlot = lane.slots.find((s) => s.agentId === t)
            if (tSlot && tSlot.fields.length) {
              const first = tSlot.fields[0]
              const to = { x: lane.x + FIELD_X + FIELD_W / 2, y: first.y - 6 }
              out.push({
                d: `M ${from.cx} ${from.cy} C ${from.cx} ${from.cy + 26}, ${to.x} ${to.y - 26}, ${to.x} ${to.y}`,
                stroke: '#2c63d0',
                width: 1.4,
                dashed: fs.field.render === 'hidden',
                from: fs.field.fieldId,
                to: t,
              })
            }
            continue
          }
          // 跨阶段：水平弧线连到目标泳道
          const to = targetAnchor(ls, t)
          if (!to) continue
          const midX = (from.cx + to.x) / 2
          out.push({
            d: `M ${from.cx} ${from.cy} C ${midX} ${from.cy}, ${midX} ${to.y}, ${to.x} ${to.y}`,
            stroke: '#2c63d0',
            width: 1.5,
            dashed: fs.field.render === 'hidden',
            from: fs.field.fieldId,
            to: t,
          })
        }
      }
    }
  }
  return out
})

const edgeCount = computed(() => edges.value.length)

/* ================= 字段标题 ================= */
function fieldTitle(f: FlowField) {
  const parts = [f.description || f.fieldId]
  if (f.handoffTargets.length) parts.push(`移交 → ${f.handoffTargets.join(', ')}`)
  if (f.pathInRawOutput) parts.push(`抽取路径：${f.pathInRawOutput}`)
  if (f.persistKey && f.persistKey !== f.fieldId) parts.push(`落库键：${f.persistKey}`)
  return parts.join('\n')
}
function displayNameOf(agentId: string) {
  return agentId.replace(/^skill:/, '').replace(/-agent$/, '')
}

/* ================= 抽屉 ================= */
function openField(f: FlowField) {
  selected.value = f
  editMsg.value = ''
  editError.value = false
  editDraft.render = f.render
  editDraft.handoffText = f.handoffTargets.join(', ')
  editDraft.accumulate = f.accumulate
  editDraft.internal = f.internal
  editDraft.notes = f.notes || ''
}
useEscape(() => !!selected.value, () => { selected.value = null })

const dirty = computed(() => {
  if (!selected.value) return false
  return (
    editDraft.render !== selected.value.render ||
    editDraft.handoffText !== selected.value.handoffTargets.join(', ') ||
    editDraft.accumulate !== selected.value.accumulate ||
    editDraft.internal !== selected.value.internal ||
    editDraft.notes !== (selected.value.notes || '')
  )
})
function resetDraft() {
  if (!selected.value) return
  editDraft.render = selected.value.render
  editDraft.handoffText = selected.value.handoffTargets.join(', ')
  editDraft.accumulate = selected.value.accumulate
  editDraft.internal = selected.value.internal
  editDraft.notes = selected.value.notes || ''
  editMsg.value = ''
  editError.value = false
}

async function saveEdit() {
  const f = selected.value
  if (!f || saving.value) return
  saving.value = true
  editMsg.value = ''
  editError.value = false
  try {
    const handoff = editDraft.handoffText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    await adminFieldRoutingsApi.patchRouting(f.agentId, f.fieldId, {
      render: editDraft.render as 'visible' | 'hidden',
      handoff,
      internal: editDraft.internal,
      accumulate: editDraft.accumulate,
      notes: editDraft.notes || null,
    })
    editMsg.value = '已保存：编排文件与 DB 已同步（admin 覆盖行后续全量同步将保留）'
    toast.success('字段路由已更新')
    await load()
    emit('changed')
    // 刷新后重新选中同一字段（按 agentId + fieldId 精确定位，跨阶段同名字段不串）
    const refreshed = stages.value
      .flatMap((s) => s.groups)
      .flatMap((g) => g.fields)
      .find((x) => x.agentId === f.agentId && x.fieldId === f.fieldId)
    if (refreshed) selected.value = refreshed
  } catch (e: any) {
    editError.value = true
    editMsg.value = e?.response?.data?.error?.message || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* ========== 工具栏 ========== */
.ffg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-sm);
}
.ffg-toolbar__status { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.ffg-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-line); flex-shrink: 0; }
.ffg-dot.is-ok { background: var(--mk-green); box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12); }
.ffg-title { font-size: 13.5px; font-weight: 800; color: var(--mk-ink); }
.ffg-sep { width: 1px; height: 13px; background: var(--mk-line); }
.ffg-meta { font-size: 12px; font-weight: 600; color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.ffg-meta b { color: var(--mk-ink); margin-right: 2px; }
.ffg-hint { font-size: 11.5px; color: var(--mk-faint); }
.ffg-toolbar__controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ffg-switch { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--mk-muted); cursor: pointer; }
.ffg-legend { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--mk-muted); }
.lg { width: 9px; height: 5px; display: inline-block; border-radius: 2px; }
.lg--handoff { background: #2c63d0; }
.lg--accumulate { background: #d97706; }
.lg--internal { background: #7c3aed; }
.lg--end { background: #94a3b8; }

/* ========== 画布 ========== */
.ffg-canvas {
  position: relative;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: linear-gradient(180deg, #fbfcff, #f2f5fa);
  overflow-x: auto;
  /* 高度自适应内容：绝对定位泳道 + SVG 边层需要容器高度 = 内容高度，
     不允许 max-height 截断（泳道 2000-4200px 高，页面滚动承接纵向） */
  min-height: 560px;
  height: auto;
}
.ffg-canvas::after {
  content: '';
  display: block;
  width: 1px;
  /* 撑开容器高度的占位：等于最大泳道高度（由 JS 设到 style 高度，占位仅兜底） */
}
.ffg-lane {
  position: absolute;
  width: 292px;
  border: 1px solid color-mix(in srgb, var(--hue) 22%, #e6ecf6);
  border-radius: 12px;
  background: #fff;
  overflow: visible;
}
.ffg-lane__head {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--hue) 6%, #ffffff), #fff 60%);
  border-bottom: 1px solid color-mix(in srgb, var(--hue) 14%, #e6ecf6);
  border-radius: 12px 12px 0 0;
}
.ffg-lane__idx {
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px;
  background: var(--hue);
  color: #fff;
  font-size: 11px; font-weight: 800;
  flex-shrink: 0;
}
.ffg-lane__name { font-size: 13px; font-weight: 800; color: var(--mk-ink); }
.ffg-lane__id { font-size: 10px; color: var(--mk-faint); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ffg-lane__count { font-size: 10.5px; font-weight: 700; color: var(--mk-faint); background: #eef2fa; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }

/* 泳道 z 序：泳道内容高于连线（节点可点），但泳道本身在边层之上 */
.ffg-group, .ffg-fields { position: relative; z-index: 2; }

.ffg-group { border-bottom: 1px solid #f1f4f9; }
.ffg-group:last-child { border-bottom: none; }
.ffg-group.is-bridge { background: #fafbfd; }
.ffg-group__head {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px 4px;
}
.ffg-group__badge {
  padding: 0 6px; border-radius: 999px;
  background: #eef2fa; color: var(--mk-muted);
  font-size: 9.5px; font-weight: 800;
}
.ffg-group__name { font-size: 10.5px; font-weight: 700; color: var(--mk-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ffg-group__count { font-size: 10px; color: var(--mk-faint); }

.ffg-fields { display: grid; gap: 6px; padding: 4px 12px 12px; }
.ffg-field {
  display: grid; gap: 2px;
  text-align: left; font: inherit;
  padding: 7px 9px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
}
.ffg-field:hover { border-color: var(--mk-blue); box-shadow: 0 2px 8px rgba(44, 99, 208, 0.1); transform: translateY(-1px); }
.ffg-field.is-hidden { background: rgba(255, 255, 255, 0.6); }
.ffg-field.is-hidden .ffg-field__name { color: var(--mk-faint); }
.ffg-field.is-accum { border-left: 3px solid #d97706; }
.ffg-field.is-internal { border-left: 3px solid #7c3aed; }
.ffg-field.is-handoff { border-left: 3px solid var(--mk-blue); }
.ffg-field__name { font-size: 11px; font-weight: 700; color: var(--mk-ink); word-break: break-all; }
.ffg-field__desc {
  font-size: 10.5px; color: var(--mk-muted);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  line-height: 1.45;
}
.ffg-field__meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.ffg-tag { padding: 0 6px; border-radius: 999px; font-size: 9.5px; font-weight: 700; }
.ffg-tag--internal { background: #f3e8ff; color: #7c3aed; }
.ffg-tag--accum { background: #fffbeb; color: #b45309; }
.ffg-tag--role { background: #eef2fa; color: var(--mk-muted); }
.ffg-group__empty { padding: 8px 12px; font-size: 11px; color: var(--mk-faint); }

.ffg-edges { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 1; }
.ffg-edge { animation: ffg-dash 0.5s ease backwards; }
@keyframes ffg-dash { from { opacity: 0; } }

.ffg-empty { padding: 40px; text-align: center; color: var(--mk-faint); }
.ffg-empty--error { color: #dc2626; }
.ffg-empty .mk-empty__action { margin-top: 10px; }

/* ========== 抽屉 ========== */
.ffg-drawer-mask {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(15, 23, 42, 0.4);
  display: flex; justify-content: flex-end;
}
.ffg-drawer {
  width: min(460px, 100%);
  height: 100%;
  background: #fff;
  display: flex; flex-direction: column;
  box-shadow: -8px 0 30px rgba(15, 23, 42, 0.12);
  animation: ffg-slide 0.22s ease;
}
@keyframes ffg-slide { from { transform: translateX(24px); opacity: 0; } }
.ffg-drawer__head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--mk-line);
}
.ffg-drawer__title { font-size: 14px; font-weight: 800; color: var(--mk-ink); word-break: break-all; }
.ffg-drawer__sub { margin-top: 3px; font-size: 12px; color: var(--mk-muted); }
.ffg-drawer__body { flex: 1; overflow-y: auto; padding: 14px 18px 24px; display: grid; gap: 16px; align-content: start; }

.ffg-dl { margin: 0; display: grid; gap: 7px; }
.ffg-dl__row { display: grid; grid-template-columns: 76px 1fr; gap: 8px; align-items: baseline; }
.ffg-dl__row dt { font-size: 11px; font-weight: 800; color: var(--mk-faint); text-transform: uppercase; letter-spacing: 0.04em; }
.ffg-dl__row dd { margin: 0; font-size: 12px; color: var(--mk-ink); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.ffg-flow { border: 1px dashed rgba(44, 99, 208, 0.4); border-radius: 10px; padding: 10px 12px; background: #f0f5ff; }
.ffg-flow__title { margin: 0 0 8px; font-size: 11px; font-weight: 800; color: var(--mk-blue); text-transform: uppercase; letter-spacing: 0.04em; }
.ffg-flow__list { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ffg-flow__chip { padding: 2px 9px; border-radius: 999px; background: var(--mk-blue); color: #fff; font-size: 11px; font-weight: 700; }
.ffg-flow__arrow { color: var(--mk-blue); font-weight: 800; }
.ffg-flow__hint { font-size: 11px; color: var(--mk-muted); }
.ffg-flow__none { font-size: 12px; color: var(--mk-muted); }

.ffg-edit { border: 1px solid var(--mk-line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 10px; }
.ffg-edit--locked { background: #fafbfd; }
.ffg-edit__row { display: grid; grid-template-columns: 84px 1fr; gap: 8px; align-items: center; }
.ffg-edit__label { font-size: 11.5px; font-weight: 700; color: var(--mk-muted); }
.ffg-edit__pills { display: inline-flex; gap: 4px; padding: 2px; background: #f1f5f9; border-radius: 8px; width: fit-content; }
.ffg-pill {
  padding: 4px 12px; border: 0; border-radius: 6px;
  background: transparent; font: inherit; font-size: 11.5px; font-weight: 700;
  color: var(--mk-muted); cursor: pointer;
}
.ffg-pill.is-on { background: #fff; color: var(--mk-blue); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); }
.ffg-edit__input {
  padding: 6px 10px;
  border: 1px solid var(--mk-line); border-radius: 8px;
  font: inherit; font-size: 12px;
  background: #fbfcfe;
  outline: none;
}
.ffg-edit__input:focus { border-color: var(--mk-blue); }
.ffg-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mk-muted); cursor: pointer; }
.ffg-edit__msg { margin: 0; padding: 8px 10px; border-radius: 8px; background: #f0f5ff; color: var(--mk-blue); font-size: 11.5px; font-weight: 600; }
.ffg-edit__msg.is-error { background: #fef2f2; color: #dc2626; }
.ffg-edit__locked-hint { margin: 0; font-size: 12px; color: var(--mk-muted); }
.ffg-edit__actions { display: flex; justify-content: flex-end; gap: 8px; }

/* 4K */
@media (min-width: 2000px) {
  .ffg-title { font-size: 15px; }
  .ffg-meta, .ffg-hint { font-size: 13px; }
  .ffg-lane { width: 330px; }
  .ffg-field__name { font-size: 12px; }
  .ffg-field__desc { font-size: 11.5px; }
}</style>
