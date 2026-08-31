<template>
  <div class="ffg">
    <div v-if="loading" class="ffg-empty">加载中…</div>
    <div v-else-if="error" class="ffg-empty ffg-empty--error">
      {{ error }}
      <button type="button" class="mk-empty__action" @click="load">重试</button>
    </div>
    <!-- 工作区卡片：工具栏头 + 画布体（一体，消除漂浮条） -->
    <div v-else class="ffg-frame">
      <div class="ffg-toolbar">
        <div class="ffg-toolbar__status">
          <strong class="ffg-title">{{ stages.find(s=>s.id===focusStage)?.name?.replace(/阶段$/, '') || '' }}</strong>
          <span class="ffg-meta">{{ currentFieldCount }} 字段 · {{ currentGroupCount }} 组</span>
          <template v-if="stageRunStat">
            <span class="ffg-meta" :class="{ 'ffg-meta--bad': stageRunStat.failed > 0 }">
              {{ fmtCalls(stageRunStat.calls) }} 调用 · {{ stageRunStat.rate }}% 失败
            </span>
          </template>
        </div>
        <div class="ffg-toolbar__controls">
          <div class="ffg-search">
            <input
              v-model="query"
              type="search"
              class="ffg-search__input"
              placeholder="搜索字段 / Skill…"
              spellcheck="false"
              @input="onQueryInput"
            />
            <button v-if="query" type="button" class="ffg-search__clear" title="清除" @click="clearQuery">✕</button>
          </div>
          <label class="ffg-switch" :title="groupMode ? '当前为组级视图：只显示组头主干，点组展开字段' : '所有组展开，显示全部字段'">
            <input type="checkbox" v-model="groupMode" @change="onGroupModeChange" />
            <span>组级</span>
          </label>
          <label class="ffg-switch" :title="showHidden ? '隐藏字段也会显示' : '仅显示对外/流转字段'">
            <input type="checkbox" v-model="showHidden" />
            <span>隐藏字段</span>
          </label>
          <span class="ffg-legend" title="蓝=移交 · 琥珀=累积 · 紫=内部信令"><i class="lg lg--handoff"></i><i class="lg lg--accumulate"></i><i class="lg lg--internal"></i>图例</span>
        </div>
      </div>
      <div
        ref="ffgCanvasRef"
        class="ffg-canvas"
        :style="{ height: canvasStyleH }"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
      >
        <!-- 缩放控件 -->
        <div class="ffg-zoom" v-if="!isEmpty">
          <button class="ffg-ctrl" type="button" title="缩小" @click="stepZoom(-1)">−</button>
          <button class="ffg-ctrl ffg-ctrl--zoom" type="button" :title="zoom === 1 && tx === 0 && ty === 0 ? '当前缩放' : '重置视图'" @click="resetView">{{ Math.round(zoom * 100) }}%</button>
          <button class="ffg-ctrl" type="button" title="放大" @click="stepZoom(1)">+</button>
        </div>

        <div class="ffg-viewport" :style="viewportStyle">
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

        <!-- 聚焦模式：上游流量摘要（来源 agent → 本阶段，聚合卡） -->
        <div
          v-if="layouts.length"
          class="ffg-anchor ffg-anchor--up"
          :style="{ left: `${ANCHOR_X0}px`, top: '0px', height: `${anchorColH}px` }"
        >
          <div class="ffg-anchor__title">↑ 上游输入</div>
          <button
            v-for="it in anchorLayout.upItems"
            :key="it.id"
            type="button"
            class="ffg-flow"
            :style="{ top: `${it.y}px` }"
            :title="`${it.sub} · ${it.label} → 本阶段（${it.fieldCount} 字段）`"
            @click="jumpToStage(it.stageId)"
          >
            <span class="ffg-flow__head">
              <span class="ffg-flow__name mono">{{ it.label }}</span>
              <span class="ffg-flow__sub">{{ it.sub }}</span>
            </span>
            <span class="ffg-flow__meta">
              <b>{{ it.fieldCount }}</b> 字段<template v-if="groupStatOf(it.id)"> · <b :class="{ 'is-err': groupStatOf(it.id)!.failed > 0 }">{{ fmtCalls(groupStatOf(it.id)!.calls) }}</b> 调用{{ groupStatOf(it.id)!.failed ? ` · ${groupStatOf(it.id)!.failed}✗` : '' }}</template>
            </span>
          </button>
          <div v-if="!anchorLayout.upItems.length" class="ffg-anchor__empty">无上游输入</div>
        </div>

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

          <!-- 阶段内 Skill 分组（绝对定位：组头/字段位置 = JS 布局坐标，杜绝 grid 与坐标两套系统错位） -->
          <div
            v-for="slot in lane.slots"
            :key="slot.agentId"
            class="ffg-group"
            :class="{ 'is-bridge': slot.bridge, 'is-collapsed': slot.fields.length === 0 && slot.foldedCount > 0 }"
            :style="{ top: `${slot.headY}px`, height: `${30 + slot.fields.length * 42 + (slot.foldedCount ? 22 : 0)}px` }"
          >
            <div
              class="ffg-group__head"
              :class="{ 'is-clickable': slot.bridge || slot.foldedCount > 0 || groupMode }"
              :title="groupMode ? '点击展开/折叠该组字段' : (slot.foldedCount > 0 ? '点击展开/折叠次要字段' : '')"
              @click="toggleSlot(slot)"
            >
              <span v-if="slot.bridge" class="ffg-group__badge">{{ slot.fields.length === 0 && slot.foldedCount > 0 ? '桥接 ▸' : '桥接 ▾' }}</span>
              <span class="ffg-group__name mono">{{ displayNameOf(slot.agentId) }}</span>
              <template v-if="groupStatOf(slot.agentId)">
                <span class="ffg-group__stat" :class="{ 'is-err': groupStatOf(slot.agentId)!.failed > 0 }">
                  {{ groupStatOf(slot.agentId)!.calls }} 调用{{ groupStatOf(slot.agentId)!.failed ? ` · ${groupStatOf(slot.agentId)!.failed}✗` : '' }}
                </span>
              </template>
              <span class="ffg-group__count">{{ slot.fields.length }} 字段</span>
              <span v-if="slot.foldedCount" class="ffg-group__fold" :title="minorRoleOf(slot) ? '次要字段（可选补充/控制信号）已折叠，点击展开' : '字段已折叠，点击展开'">▸ {{ slot.foldedCount }}</span>
            </div>
            <!-- 组级视图：折叠组显示字段预览（渐进披露），未折叠组直接显示完整字段 -->
            <div v-if="groupMode && slot.foldedCount" class="ffg-group__preview">
              <button
                v-for="fs in slot.fields"
                :key="fs.field.id"
                type="button"
                class="ffg-field ffg-field--preview"
                :class="{
                  'is-hidden': fs.field.render === 'hidden',
                  'is-accum': fs.field.accumulate,
                  'is-internal': fs.field.internal,
                  'is-locked': fs.field.locked,
                  'is-handoff': fs.field.handoffTargets.length > 0,
                  'is-focused': focusId === fs.field.id,
                  'is-dimmed': dimmed,
                  'is-related': dimmed && isRelated(fs.field)
                }"
                :style="{ top: `${fs.y - slot.headY}px` }"
                :title="fieldTitle(fs.field)"
                @click="openField(fs.field)"
              >
                <span class="ffg-field__name mono" :title="fs.field.fieldId">{{ shortName(fs.field.fieldId) }}</span>
                <template v-if="fieldStatOf(fs.field.agentId)">
                  <span class="ffg-field__stat" :class="{ 'is-err': fieldStatOf(fs.field.agentId)!.failed > 0 }">
                    {{ fieldStatOf(fs.field.agentId)!.calls }}{{ fieldStatOf(fs.field.agentId)!.failed ? ` · ${fieldStatOf(fs.field.agentId)!.failed}✗` : '' }}
                  </span>
                </template>
                <span class="ffg-field__dot" :title="roleLabel(fs.field.role)"></span>
              </button>
              <button
                v-if="slot.foldedCount"
                type="button"
                class="ffg-group__more"
                :style="{ top: `${30 + slot.fields.length * 42 + 2}px` }"
                title="展开该组全部字段"
                @click.stop="toggleSlot(slot)"
              >+{{ slot.foldedCount }} 更多</button>
            </div>

            <button
              v-for="fs in slot.fields"
              v-show="!groupMode || !slot.foldedCount"
              :key="fs.field.id"
              type="button"
              class="ffg-field"
              :class="{
                'is-hidden': fs.field.render === 'hidden',
                'is-accum': fs.field.accumulate,
                'is-internal': fs.field.internal,
                'is-locked': fs.field.locked,
                'is-handoff': fs.field.handoffTargets.length > 0,
                'is-focused': focusId === fs.field.id,
                'is-dimmed': dimmed,
                'is-related': dimmed && isRelated(fs.field)
              }"
              :style="{ top: `${fs.y - slot.headY}px` }"
              :title="fieldTitle(fs.field)"
              @click="openField(fs.field)"
            >
              <span class="ffg-field__name mono" :title="fs.field.fieldId">{{ shortName(fs.field.fieldId) }}</span>
              <template v-if="fieldStatOf(fs.field.agentId)">
                <span class="ffg-field__stat" :class="{ 'is-err': fieldStatOf(fs.field.agentId)!.failed > 0 }">
                  {{ fieldStatOf(fs.field.agentId)!.calls }}{{ fieldStatOf(fs.field.agentId)!.failed ? ` · ${fieldStatOf(fs.field.agentId)!.failed}✗` : '' }}
                </span>
              </template>
              <span class="ffg-field__dot" :title="roleLabel(fs.field.role)"></span>
              <span v-if="fs.field.handoffTargets.length" class="ffg-field__out" title="移交去向">{{ fs.field.handoffTargets[0] }}{{ fs.field.handoffTargets.length > 1 ? ` +${fs.field.handoffTargets.length - 1}` : '' }}</span>
            </button>
            <div v-if="!slot.fields.length" class="ffg-group__empty">
              {{ slot.foldedCount ? `▸ ${slot.foldedCount} 个字段已折叠` : '该组无字段' }}
            </div>
          </div>
        </div>

        <!-- 聚焦模式：下游输出列（本阶段 → 目标 agent，聚合卡） -->
        <div
          v-if="layouts.length"
          class="ffg-anchor ffg-anchor--down"
          :style="{ left: `${ANCHOR_X0 + ANCHOR_W + ANCHOR_GAP + LANE_W + ANCHOR_GAP}px`, top: '0px', height: `${anchorColH}px` }"
        >
          <div class="ffg-anchor__title">↓ 下游输出</div>
          <button
            v-for="it in anchorLayout.downItems"
            :key="it.id"
            type="button"
            class="ffg-flow"
            :style="{ top: `${it.y}px` }"
            :title="`本阶段 → ${it.sub} · ${it.label}（${it.fieldCount} 字段）`"
            @click="jumpToStage(it.stageId)"
          >
            <span class="ffg-flow__head">
              <span class="ffg-flow__name mono">{{ it.label }}</span>
              <span class="ffg-flow__sub">{{ it.sub }}</span>
            </span>
            <span class="ffg-flow__meta">
              <b>{{ it.fieldCount }}</b> 字段<template v-if="groupStatOf(it.id)"> · <b :class="{ 'is-err': groupStatOf(it.id)!.failed > 0 }">{{ fmtCalls(groupStatOf(it.id)!.calls) }}</b> 调用{{ groupStatOf(it.id)!.failed ? ` · ${groupStatOf(it.id)!.failed}✗` : '' }}</template>
            </span>
          </button>
          <div v-if="!anchorLayout.downItems.length" class="ffg-anchor__empty">无下游输出</div>
        </div>
        </div>
      </div>
    </div>

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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { adminFieldRoutingsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'
import { AGENT_TONES } from './store'
import { liveTopoNodes } from './live'

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

type FlowField = import('./fieldFlowLayout').FlowField
type FlowStage = import('./fieldFlowLayout').FlowStage
type StageLayout = import('./fieldFlowLayout').StageLayout
type SlotLayout = import('./fieldFlowLayout').SlotLayout
import {
  STAGE_ORDER as _STAGE_ORDER, STAGE_LABELS, computeLayouts, computeEdges,
  canvasW as _canvasW, canvasH as _canvasH, shortName, stageOfTarget,
  LANE_W,
  ANCHOR_W, ANCHOR_X0, ANCHOR_GAP, focusLaneX, focusCanvasW,
  computeFocusAnchors, computeFocusEdges, type EdgeGeom,
  buildStage as _buildStage, parseHandoff as _parseHandoff, FOLD_ROLES,
} from './fieldFlowLayout'

/* ================= props ================= */
const props = defineProps<{ stage: string }>()
const emit = defineEmits<{ changed: []; stage: [string] }>()

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
  for (const s of _STAGE_ORDER) {
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
      _STAGE_ORDER.map(async (s) => {
        const res = await adminFieldRoutingsApi.getStageDetail(s)
        return { stage: s, detail: (res.data?.data as StageDetail) || null }
      })
    )
    const next: Record<string, StageDetail | null> = {}
    let firstErr = ''
    results.forEach((r, i) => {
      const s = _STAGE_ORDER[i]
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
  return _parseHandoff(raw)
}
void parseHandoff

function buildStage(s: string, d: StageDetail): FlowStage {
  return _buildStage(s, d as Parameters<typeof _buildStage>[1])
}

/** 全阶段泳道（有数据的阶段才显示；保证泳道顺序 = 链路顺序） */
const stages = computed<FlowStage[]>(() => {
  const out: FlowStage[] = []
  for (const s of _STAGE_ORDER) {
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
void visibleFields

/* ================= 画布与连线（共享布局模块：与拓扑运行时视图同源） ================= */
/** 当前聚焦阶段概要（工具栏） */
const currentFieldCount = computed(() => stages.value.find((s) => s.id === focusStage.value)?.fieldCount || 0)
const currentGroupCount = computed(() => stages.value.find((s) => s.id === focusStage.value)?.groups.length || 0)
/** 折叠状态：桥接组（<stage>-agent）与次要字段组均可点组头展开 */
const collapsedGroups = ref<Set<string>>(new Set(['goal-agent', 'path-agent', 'teaching-agent', 'profile-agent', 'simulation-agent']))
const expandedMinorGroups = ref<Set<string>>(new Set())
/** 组级视图：非桥接 Skill 组默认折叠为组头 + 前 2 字段预览（点组头/"+N 更多"展开）。默认开启——渐进披露，默认只展示主干 */
const groupMode = ref(true)
/** 搜索聚焦：输入的字段名 / Skill 名 */
const query = ref('')
const focusId = ref('')
const dimmed = computed(() => !!focusId.value)
function onGroupModeChange() {
  // 切换组级视图：清空聚焦（布局高度变化），保持选中
  focusId.value = ''
}
function isRelated(f: FlowField): boolean {
  if (!focusId.value) return false
  const focus = allFields.value.find((x) => x.id === focusId.value)
  if (!focus) return false
  if (f.id === focus.id) return true
  // 下游：焦点字段 handoff 指向 f（字段名精确匹配 / 目标 agent 匹配 / 目标阶段匹配）
  for (const t of focus.handoffTargets) {
    if (t === f.fieldId || t === f.agentId) return true
    const tStage = stageOfTarget(t)
    if (tStage && stageOfField(f) === tStage) return true
  }
  // 上游：f 的 handoff 指向焦点字段
  for (const t of f.handoffTargets) {
    if (t === focus.fieldId || t === focus.agentId) return true
    const tStage = stageOfTarget(t)
    if (tStage && stageOfField(focus) === tStage) return true
  }
  return false
}
/** 字段所属阶段（按 agentId 找组所在泳道） */
function stageOfField(f: FlowField): string | null {
  for (const s of stages.value) {
    if (s.groups.some((g) => g.agentId === f.agentId)) return s.id
  }
  return null
}
/** 聚焦字段的 key（用于 handoff 匹配：跨阶段同名字段会串，这里匹配 fieldId 即可） */
function focusFieldKey(): string {
  return focusId.value.split('\0').pop() || ''
}
void focusFieldKey
function onQueryInput() {
  const q = query.value.trim().toLowerCase()
  if (!q) {
    focusId.value = ''
    return
  }
  // 在全部字段中找匹配（fieldId / agentId / description / persistKey）
  const hit = allFields.value.find((f) =>
    f.fieldId.toLowerCase().includes(q) ||
    f.agentId.toLowerCase().includes(q) ||
    f.description.toLowerCase().includes(q) ||
    (f.persistKey || '').toLowerCase().includes(q)
  )
  if (!hit) {
    focusId.value = ''
    return
  }
  // 命中字段不在当前聚焦阶段：自动切阶段（同步父级 active）
  const hitStage = stageOfField(hit)
  if (hitStage && hitStage !== focusStage.value) {
    focusStage.value = hitStage
    emit('stage', hitStage)
  }
  focusId.value = hit.id
  // 展开所在组：确保能看到它（桥接组 + 组级折叠组都展开）
  const next = new Set(collapsedGroups.value)
  next.delete(hit.agentId)
  collapsedGroups.value = next
  const nextMinor = new Set(expandedMinorGroups.value)
  nextMinor.add(hit.agentId)
  expandedMinorGroups.value = nextMinor
}
function clearQuery() {
  query.value = ''
  focusId.value = ''
}
/** 搜索候选：全部字段（含折叠态不可见的） */
const allFields = computed<FlowField[]>(() =>
  stages.value.flatMap((s) => s.groups).flatMap((g) => g.fields)
)
function toggleGroup(agentId: string) {
  const next = new Set(collapsedGroups.value)
  if (next.has(agentId)) next.delete(agentId)
  else next.add(agentId)
  collapsedGroups.value = next
}
function toggleMinor(agentId: string) {
  const next = new Set(expandedMinorGroups.value)
  if (next.has(agentId)) next.delete(agentId)
  else next.add(agentId)
  expandedMinorGroups.value = next
}
/** 组头点击：桥接组折叠 / 次要组展开 / 组级视图下 Skill 组展开 */
function toggleSlot(slot: SlotLayout) {
  if (slot.bridge) { toggleGroup(slot.agentId); return }
  if (minorRoleOf(slot)) { toggleMinor(slot.agentId); return }
  if (groupMode.value) { toggleMinor(slot.agentId); return }
}
const isGroupCollapsed = (agentId: string) => collapsedGroups.value.has(agentId)
const isMinorExpanded = (agentId: string) => expandedMinorGroups.value.has(agentId)
/** 组级视图下，非桥接 Skill 组默认折叠；搜索聚焦时强制展开 */
const isSkillGroupCollapsed = (agentId: string) => groupMode.value && !expandedMinorGroups.value.has(agentId)
/** 该组折叠是否因次要角色（用于折叠提示文案；查原始组字段而非折叠后空列表） */
function minorRoleOf(slot: SlotLayout) {
  for (const s of stages.value) {
    const group = s.groups.find((g) => g.agentId === slot.agentId)
    if (group) return group.fields.length > 0 && group.fields.every((f) => FOLD_ROLES.has(f.role))
  }
  return slot.fields.length === 0
}

/* ================= 阶段聚焦模式（逻辑共享自 fieldFlowLayout） ================= */
const focusStage = ref(props.stage)

watch(() => props.stage, (s) => { if (s) focusStage.value = s }, { immediate: true })

/** 运行统计叠加（有 live 拓扑数据时显示）：skillId → { calls, failed } */
const skillStats = computed(() => {
  const map = new Map<string, { calls: number; failed: number }>()
  for (const n of liveTopoNodes.value) {
    if (n.type !== 'skill') continue
    map.set(n.id.replace(/^skill:/, ''), { calls: n.stats.totalCalls, failed: n.stats.failed })
  }
  return map
})
/** 字段卡的运行统计（按产出 skill） */
function fieldStatOf(agentId: string) {
  if (!agentId.startsWith('skill:')) return null
  return skillStats.value.get(agentId.replace(/^skill:/, '')) || null
}
/** 组头统计：skill 组直取；桥接 agent 聚合其下 skill；阶段名 → 顶层 agent 聚合 */
function groupStatOf(agentId: string) {
  const bare = agentId.replace(/^skill:/, '')
  const direct = skillStats.value.get(bare)
  if (direct) return direct
  // 阶段名目标（如 handoff → 'path'）→ 顶层 agent
  const agentKey = _STAGE_ORDER.includes(bare as (typeof _STAGE_ORDER)[number]) ? `${bare}-agent` : agentId
  let calls = 0
  let failed = 0
  let found = false
  for (const n of liveTopoNodes.value) {
    if (n.type !== 'skill' || n.parentAgentId !== agentKey) continue
    calls += n.stats.totalCalls
    failed += n.stats.failed
    found = true
  }
  return found ? { calls, failed } : null
}

/** 上下游锚点（共享计算） */
const anchorLayout = computed(() => computeFocusAnchors(stages.value, focusStage.value))

const anchorColH = computed(() => {
  if (!layouts.value.length) return 480
  return Math.max(layouts.value[0].laneHeight, anchorLayout.value.upH, anchorLayout.value.downH)
})

const layouts = computed<StageLayout[]>(() => {
  // 折叠前先过滤隐藏字段（visibleFields 语义保留在组件层）
  const filtered = stages.value.map((st) => ({
    ...st,
    groups: st.groups.map((g) => ({
      ...g,
      fields: showHidden.value ? g.fields : g.fields.filter((f) => f.render === 'visible' || f.handoffTargets.length > 0 || f.accumulate),
    })),
  }))
  const all = computeLayouts(filtered, isGroupCollapsed, isMinorExpanded, isSkillGroupCollapsed)
  const cur = all.find((l) => l.stage.id === focusStage.value)
  if (!cur) return []
  // 泳道右移：让出左侧上游锚点列
  cur.x = focusLaneX
  return [cur]
})

const canvasW = computed(() => (layouts.value.length ? focusCanvasW : _canvasW(layouts.value)))
const canvasH = computed(() =>
  layouts.value.length ? Math.max(480, anchorColH.value) : _canvasH(layouts.value)
)
/** 画布容器高度：内容缩放后高度（超高部分容器内滚动，不压扁字号） */
const canvasStyleH = computed(() => {
  if (isEmpty.value) return '480px'
  const scaled = canvasH.value * zoom.value
  return `${Math.max(480, Math.round(Math.min(scaled, availHeight() * 1.5)))}px`
})

const edges = computed<EdgeGeom[]>(() => {
  const base = computeEdges(layouts.value)
  if (!layouts.value.length) return base
  return [...base, ...computeFocusEdges(layouts.value[0], anchorLayout.value.upItems, anchorLayout.value.downItems)]
})
const isEmpty = computed(() => layouts.value.length === 0)
/** 切换聚焦阶段（同步父级 active，供字段路由/编辑联动） */
function switchStage(s: string) {
  if (s === focusStage.value) return
  focusStage.value = s
  emit('stage', s)
  focusId.value = ''
  selected.value = null
}
/** 点摘要卡：跳转对应阶段 */
function jumpToStage(stageId: string) {
  switchStage(stageId)
}
/** 调用量缩写：2820 → 2.8k */
function fmtCalls(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
/** 本阶段运行指标（阶段指标条） */
const stageRunStat = computed(() => {
  const agentId = `${focusStage.value}-agent`
  let calls = 0
  let failed = 0
  let found = false
  for (const n of liveTopoNodes.value) {
    if (n.type !== 'skill' || n.parentAgentId !== agentId) continue
    calls += n.stats.totalCalls
    failed += n.stats.failed
    found = true
  }
  return found ? { calls, failed, rate: calls ? Math.round((failed / calls) * 1000) / 10 : 0 } : null
})

/* ================= 缩放 / 平移（画布适配视口，根治长图一屏看不完） ================= */
const ffgCanvasRef = ref<HTMLElement | null>(null)
const zoom = ref(1)
const tx = ref(0)
const ty = ref(0)
const panning = ref(false)
const MIN_ZOOM = 0.35
const MAX_ZOOM = 2.6
let userInteracted = false
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
  width: `${canvasW.value}px`,
  height: `${canvasH.value}px`,
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${zoom.value})`,
}))

/** 可视高度（逻辑空间）：窗口减顶栏与页面内边距 */
const availHeight = () => Math.max(420, winH.value / globalZoom.value - 104)

/** 初始/重置视图：横向适配视口；只缩小不放大（内容设计尺寸即可读尺寸，杜绝字段卡忽大忽小） */
function fitView() {
  const rect = ffgCanvasRef.value?.getBoundingClientRect()
  if (!rect || rect.width === 0 || isEmpty.value) return
  const padding = 20
  const zx = (rect.width / globalZoom.value - padding * 2) / canvasW.value
  zoom.value = Math.min(1, Math.max(MIN_ZOOM, zx))
  tx.value = Math.max(padding, (rect.width / globalZoom.value - canvasW.value * zoom.value) / 2)
  ty.value = padding
}

function zoomAt(anchor: { x: number; y: number }, nextZoomRaw: number) {
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw))
  if (nextZoom === zoom.value) return
  userInteracted = true
  const ratio = nextZoom / zoom.value
  tx.value = anchor.x - (anchor.x - tx.value) * ratio
  ty.value = anchor.y - (anchor.y - ty.value) * ratio
  zoom.value = nextZoom
}
function onWheel(event: WheelEvent) {
  // 按住 Ctrl/⌘ 或明确缩放意图时缩放；否则纵向滚动画布
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14
    zoomAt(toCanvasPoint(event), zoom.value * factor)
    return
  }
  const canvas = ffgCanvasRef.value
  if (!canvas) return
  // 画布内纵向滚动（内容超高时）
  const maxScroll = canvas.scrollHeight - canvas.clientHeight
  if (maxScroll > 0) {
    canvas.scrollTop = Math.min(maxScroll, Math.max(0, canvas.scrollTop + event.deltaY))
    if (event.shiftKey) canvas.scrollLeft = Math.min(canvas.scrollWidth - canvas.clientWidth, Math.max(0, canvas.scrollLeft + event.deltaY))
    return
  }
  // 内容未超高：滚轮缩放（保留）
  const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14
  zoomAt(toCanvasPoint(event), zoom.value * factor)
}
function stepZoom(direction: 1 | -1) {
  const rect = ffgCanvasRef.value?.getBoundingClientRect()
  const center = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 }
  zoomAt(center, zoom.value * (direction > 0 ? 1.25 : 1 / 1.25))
}
function resetView() {
  userInteracted = false
  fitView()
}
function toCanvasPoint(event: { clientX: number; clientY: number }) {
  const rect = ffgCanvasRef.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
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
    userInteracted = true
    ffgCanvasRef.value?.setPointerCapture(panOrigin.pointerId)
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

onMounted(() => {
  refreshViewport()
  // 布局数据就绪后再 fitView
  const t = setTimeout(() => { if (!isEmpty.value) fitView() }, 80)
  resizeObserver = new ResizeObserver(() => {
    if (!userInteracted) fitView()
  })
  if (ffgCanvasRef.value) resizeObserver.observe(ffgCanvasRef.value)
  watch(layouts, () => {
    if (!userInteracted) fitView()
  })
  onBeforeUnmount(() => {
    clearTimeout(t)
    resizeObserver?.disconnect()
    window.removeEventListener('resize', refreshViewport)
  })
})

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
/* ========== 工作区卡片：工具栏头 + 画布体一体 ========== */
.ffg-frame {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  box-shadow: var(--mk-shadow-sm);
}
.ffg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: linear-gradient(180deg, #fbfcff, #f6f8fc);
  border-bottom: 1px solid var(--mk-line);
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
.ffg-search { position: relative; display: inline-flex; align-items: center; }
.ffg-search__input {
  width: 190px;
  padding: 5px 26px 5px 10px;
  border: 1px solid var(--mk-line); border-radius: 8px;
  font: inherit; font-size: 12px;
  background: #fbfcfe;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.ffg-search__input:focus { border-color: var(--mk-blue); box-shadow: 0 0 0 3px rgba(44, 99, 208, 0.12); }
.ffg-search__clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 50%; background: #e2e8f0; color: var(--mk-muted);
  font-size: 9px; line-height: 1; cursor: pointer; padding: 0;
}
.ffg-search__clear:hover { background: #cbd5e1; color: var(--mk-ink); }

/* 聚焦模式：上下游锚点列 */
.ffg-anchor {  position: absolute; top: 0; z-index: 2;
  width: 240px; box-sizing: border-box;
  background: #f8fafd; border: 1px solid var(--mk-line);
  border-radius: 10px;
}
.ffg-anchor--up { border-color: color-mix(in srgb, #2c63d0 25%, var(--mk-line)); }
.ffg-anchor--down { border-color: color-mix(in srgb, #8aa6d8 40%, var(--mk-line)); }
.ffg-anchor__title {
  position: absolute; top: 0; left: 0; right: 0;
  padding: 8px 12px;
  font-size: 11px; font-weight: 800; color: var(--mk-muted);
  background: linear-gradient(180deg, #eef2fa, #f8fafd);
  border-bottom: 1px solid var(--mk-line);
  border-radius: 10px 10px 0 0;
}
.ffg-anchor--down .ffg-anchor__title { color: var(--mk-blue); }
.ffg-anchor__item {
  position: absolute; left: 12px; width: 216px; height: 34px;
  display: flex; align-items: center; gap: 6px;
  padding: 0 8px; box-sizing: border-box;
  border: 1px solid var(--mk-line); border-radius: 8px;
  background: #fff; font: inherit; cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.ffg-anchor__item:hover { border-color: var(--mk-blue); box-shadow: 0 2px 8px rgba(44, 99, 208, 0.1); }
.ffg-anchor__label { font-size: 10.5px; font-weight: 700; color: var(--mk-ink); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ffg-anchor__sub { font-size: 9.5px; font-weight: 700; color: var(--mk-blue); background: #eff6ff; border-radius: 6px; padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
.ffg-anchor__empty { position: absolute; left: 12px; top: 40px; font-size: 11px; color: var(--mk-faint); }

/* 流量摘要卡（两行：agent 名+阶段 / 字段数+调用统计） */
.ffg-flow {
  position: absolute; left: 12px; width: 216px; height: 64px;
  display: flex; flex-direction: column; justify-content: center; gap: 3px;
  padding: 0 10px; box-sizing: border-box;
  border: 1px solid var(--mk-line); border-radius: 9px;
  background: #fff; font: inherit; text-align: left; cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.ffg-flow:hover { border-color: var(--mk-blue); box-shadow: 0 2px 10px rgba(44, 99, 208, 0.12); }
.ffg-flow__head { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.ffg-flow__name { font-size: 11.5px; font-weight: 800; color: var(--mk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ffg-flow__sub { flex-shrink: 0; font-size: 9.5px; font-weight: 700; color: var(--mk-blue); background: #eff6ff; border-radius: 6px; padding: 1px 6px; }
.ffg-flow__meta { font-size: 10px; font-weight: 600; color: var(--mk-muted); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ffg-flow__meta b { color: var(--mk-ink); font-weight: 800; }
.ffg-flow__meta b.is-err { color: #dc2626; }
.ffg-meta--bad { color: #dc2626; font-weight: 700; }
.ffg-switch { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--mk-muted); cursor: pointer; }
.ffg-legend { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--mk-muted); }
.lg { width: 9px; height: 5px; display: inline-block; border-radius: 2px; }
.lg--handoff { background: #2c63d0; }
.lg--accumulate { background: #d97706; }
.lg--internal { background: #7c3aed; }
.lg--end { background: #94a3b8; }

/* ========== 画布（卡片体：无独立边框，由 frame 承载） ========== */
.ffg-canvas {
  position: relative;
  background: linear-gradient(180deg, #fbfcff, #f2f5fa);
  overflow: auto;
  min-height: 560px;
  height: auto;
  cursor: default;
  touch-action: none;
  user-select: none;
}
.ffg-canvas.is-panning { cursor: grabbing; }
.ffg-viewport { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.ffg-zoom {
  position: absolute; right: 14px; bottom: 12px; z-index: 5;
  display: flex; align-items: center; gap: 4px; padding: 5px;
  background: var(--mk-surface); border: 1px solid var(--mk-line); border-radius: 10px;
  box-shadow: 0 6px 20px rgba(30, 58, 110, 0.1);
}
.ffg-ctrl {
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--mk-line); background: var(--mk-surface); color: var(--mk-muted);
  border-radius: 8px; font-size: 14px; line-height: 1; cursor: pointer;
}
.ffg-ctrl:hover { color: var(--mk-blue); border-color: var(--mk-blue); }
.ffg-ctrl--zoom { width: auto; min-width: 48px; padding: 0 8px; font-size: 11px; font-family: var(--mk-mono); }
.ffg-lane {
  position: absolute;
  width: 380px;
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
.ffg-group { z-index: 2; }

.ffg-group {
  position: absolute;
  left: 0;
  right: 0;
  border-bottom: 1px solid #f1f4f9;
  background: #fff;
}
.ffg-group:last-child { border-bottom: none; }
.ffg-group.is-bridge { background: #fafbfd; }
.ffg-group.is-collapsed { background: #f6f8fc; }
.ffg-group__head {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px 4px;
  height: 30px;
  box-sizing: border-box;
}
.ffg-group__head.is-clickable { cursor: pointer; }
.ffg-group__head.is-clickable:hover .ffg-group__name { color: var(--mk-blue); }
.ffg-group__badge {
  padding: 0 6px; border-radius: 999px;
  background: #eef2fa; color: var(--mk-muted);
  font-size: 9.5px; font-weight: 800;
}
.ffg-group__name { font-size: 10.5px; font-weight: 700; color: var(--mk-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ffg-group__count { font-size: 10px; color: var(--mk-faint); }
.ffg-group__stat { flex-shrink: 0; font-size: 9.5px; font-weight: 700; color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.ffg-group__stat.is-err { color: #dc2626; }
.ffg-group__fold {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 999px;
  background: #eef2fa; color: var(--mk-muted);
  font-size: 9.5px; font-weight: 700;
  cursor: default;
}

/* 紧凑字段行：绝对定位（top = JS 布局坐标），单行（名称 + 标签 + 去向） */
.ffg-field {
  position: absolute;
  left: 12px;
  width: 356px;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 9px;
  box-sizing: border-box;
  text-align: left; font: inherit;
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
/* 聚焦高亮：聚焦字段提亮描边，其余压暗；上下游相关字段保持可见 */
.ffg-field.is-focused { border-color: var(--mk-blue); box-shadow: 0 0 0 3px rgba(44, 99, 208, 0.18); z-index: 4; }
.ffg-field.is-dimmed { opacity: 0.35; filter: saturate(0.4); }
.ffg-field.is-dimmed.is-related { opacity: 1; filter: none; border-color: rgba(44, 99, 208, 0.55); }
.ffg-field__name {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
/* 角色色点（替代旧的多标签：锁/内/累进抽屉与 title） */
.ffg-field__dot {
  flex-shrink: 0;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--mk-faint);
  box-shadow: 0 0 0 2px rgba(100, 116, 139, 0.14);
}
.ffg-field__stat {
  flex-shrink: 0;
  font-size: 9.5px; font-weight: 700;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
}
.ffg-field__stat.is-err { color: #dc2626; }
.ffg-field.is-accum .ffg-field__dot { background: #d97706; box-shadow: 0 0 0 2px rgba(217, 119, 6, 0.16); }
.ffg-field.is-internal .ffg-field__dot { background: #7c3aed; box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.16); }
.ffg-field.is-handoff .ffg-field__dot { background: var(--mk-blue); box-shadow: 0 0 0 2px rgba(44, 99, 208, 0.16); }
.ffg-field.is-locked .ffg-field__dot { background: #dc2626; box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.16); }
.ffg-field__out {
  flex-shrink: 0;
  max-width: 88px;
  font-size: 9.5px;
  font-family: var(--mk-mono);
  font-weight: 700;
  color: var(--mk-blue);
  background: #eff6ff;
  border-radius: 6px;
  padding: 1px 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ffg-tag { padding: 0 5px; border-radius: 999px; font-size: 9px; font-weight: 800; line-height: 1.6; }
.ffg-tag--lock { background: #fef2f2; color: #dc2626; }
.ffg-tag--internal { background: #f3e8ff; color: #7c3aed; }
.ffg-tag--accum { background: #fffbeb; color: #b45309; }
.ffg-tag--role { background: #eef2fa; color: var(--mk-muted); }
.ffg-group__empty {
  position: absolute;
  left: 12px;
  top: 30px;
  padding: 4px 8px;
  font-size: 10.5px;
  color: var(--mk-faint);
}

/* 组级视图：组头下的字段预览（微缩卡，仅名字+角色点）——容器覆盖组头区域，字段/按钮 top 统一相对组头 */
.ffg-group__preview { position: absolute; left: 0; right: 0; top: 0; height: 0; }
.ffg-field--preview {
  height: 34px;
  border-color: transparent;
  background: #f8fafd;
  box-shadow: none;
  cursor: pointer;
}
.ffg-field--preview:hover { border-color: var(--mk-blue); background: #fff; }
.ffg-field--preview.is-focused { border-color: var(--mk-blue); box-shadow: 0 0 0 3px rgba(44, 99, 208, 0.18); z-index: 4; }
.ffg-field--preview.is-dimmed { opacity: 0.35; filter: saturate(0.4); }
.ffg-field--preview.is-dimmed.is-related { opacity: 1; filter: none; border-color: rgba(44, 99, 208, 0.55); }
.ffg-field--preview .ffg-field__name { font-size: 10.5px; }
.ffg-group__more {
  position: absolute;
  left: 12px;
  padding: 2px 9px;
  border: 1px dashed var(--mk-line);
  border-radius: 999px;
  background: #fff;
  font: inherit; font-size: 10px; font-weight: 700;
  color: var(--mk-blue);
  cursor: pointer;
}
.ffg-group__more:hover { border-color: var(--mk-blue); background: #eff6ff; }

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

/* 4K（全站 zoom 已放大，泳道宽度随 JS 常量，不覆盖） */
@media (min-width: 2000px) {
  .ffg-title { font-size: 15px; }
  .ffg-meta, .ffg-hint { font-size: 13px; }
  .ffg-field__name { font-size: 12.5px; }
  .ffg-field__out { font-size: 10px; }
}

/* ================= 暗色模式（D1 补完）：字段编排图 ================= */
html[data-theme='dark'] {
  /* 工作区卡片 + 画布 */
  .ffg-frame { background: #141c2b; border-color: #232f45; }
  .ffg-toolbar { background: linear-gradient(180deg, #1a2436, #151e2e); border-bottom-color: #232f45; }
  .ffg-search__input { background: #131b2a; border-color: #2a3850; color: var(--mk-ink); }
  .ffg-search__clear { background: #2a3850; color: #9fb0c8; }
  .ffg-search__clear:hover { background: #3a4a68; color: #e6edf7; }
  .ffg-canvas { background: linear-gradient(180deg, #141c2b, #101725); }

  /* 锚点列 */
  .ffg-anchor { background: #151e2e; }
  .ffg-anchor__title { background: linear-gradient(180deg, #1b2638, #151e2e); border-bottom-color: #232f45; }
  .ffg-anchor__item { background: #17202f; }
  .ffg-anchor__sub { background: #1b2a45; color: #7aa2ff; }

  /* 流量摘要卡 */
  .ffg-flow { background: #17202f; }
  .ffg-flow__sub { background: #1b2a45; color: #7aa2ff; }

  /* 泳道 */
  .ffg-lane { background: #141c2b; border-color: color-mix(in srgb, var(--hue) 22%, #232f45); }
  .ffg-lane__head {
    background: linear-gradient(180deg, color-mix(in srgb, var(--hue) 8%, #17202f), #141c2b 60%);
    border-bottom-color: color-mix(in srgb, var(--hue) 14%, #232f45);
  }
  .ffg-lane__count, .ffg-group__badge, .ffg-group__fold { background: #253049; color: #9fb0c8; }

  /* agent 卡片标题：暗色下从近白 #e6edf7 降为柔和浅灰蓝，避免刺眼（用户反馈"标题太白"） */
  .ffg-lane__name { color: #c7d3e8; }
  .ffg-flow__name { color: #c7d3e8; }
  .ffg-flow__meta b { color: #c7d3e8; }

  /* 组 */
  .ffg-group { background: #141c2b; border-bottom-color: #1f2937; }
  .ffg-group.is-bridge { background: #161f2f; }
  .ffg-group.is-collapsed { background: #131b2b; }

  /* 字段卡 */
  .ffg-field { background: #17202f; }
  .ffg-field.is-hidden { background: rgba(23, 32, 47, 0.6); }
  .ffg-field--preview { background: #151e2e; }
  .ffg-field--preview:hover { background: #1a2436; }
  .ffg-field__out { background: #1b2a45; color: #7aa2ff; }

  /* 组折叠 / 更多按钮 */
  .ffg-group__more { background: #17202f; }
  .ffg-group__more:hover { background: #1b2a45; }

  /* 标签（彩色浅底 → 深底等价） */
  .ffg-tag--lock { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
  .ffg-tag--internal { background: rgba(192, 132, 252, 0.16); color: #d8b4fe; }
  .ffg-tag--accum { background: rgba(251, 191, 36, 0.14); color: #fcd34d; }
  .ffg-tag--role { background: #253049; color: #9fb0c8; }

  /* 抽屉 */
  .ffg-drawer { background: #141c2b; }
  .ffg-drawer__head { border-bottom-color: #232f45; }
  .ffg-drawer__body { background: #141c2b; }
  .ffg-flow-block { background: #1b2a45; }

  /* 编辑区 */
  .ffg-edit--locked { background: #131b2a; }
  .ffg-edit__pills { background: #1a2436; }
  .ffg-pill.is-on { background: #232f45; color: #7aa2ff; }
  .ffg-edit__input { background: #131b2a; border-color: #2a3850; color: var(--mk-ink); }
  .ffg-edit__msg { background: #1b2a45; color: #7aa2ff; }
  .ffg-edit__msg.is-error { background: rgba(248, 113, 113, 0.14); color: #fca5a5; }
}
</style>
