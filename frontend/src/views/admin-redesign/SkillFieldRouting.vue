<template>
  <div class="sfr">
    <!-- 加载 / 失败降级 -->
    <div v-if="loading" class="sfr__empty">加载中…</div>
    <div v-else-if="error" class="sfr__empty">
      <p class="sfr__error-text">{{ error }}</p>
      <button type="button" class="mk-empty__action" @click="load">重试</button>
    </div>
    <template v-else-if="data">
      <!-- 状态条（mk-status 白底统一形态） -->
      <div class="mk-status" :class="syncToneTone">
        <span class="mk-status__dot"></span>
        <strong>契约 · 阶段 {{ data.stage }}</strong>
        <span class="mk-badge mk-badge--muted">产出行 {{ data.routings.length }} 行</span>
        <template v-if="syncReport">
          <span v-if="syncReport.state === 'ok'" class="mk-badge mk-badge--ok">{{ TERMS.fieldsSynced }} ✓</span>
          <span v-else-if="syncReport.state === 'no-core'" class="mk-badge mk-badge--bad">core 缺失</span>
          <span v-else-if="syncReport.state === 'no-routings'" class="mk-badge mk-badge--muted">无产出行</span>
          <template v-else>
            <span v-if="syncReport.missing.length" class="mk-badge mk-badge--bad">{{ TERMS.statusMissing }} {{ syncReport.missing.length }}</span>
            <span v-if="syncReport.orphan.length" class="mk-badge mk-badge--warn">{{ TERMS.statusOrphan }} {{ syncReport.orphan.length }}</span>
            <span v-if="syncReport.typeMismatch.length" class="mk-badge mk-badge--warn">类型不一致 {{ syncReport.typeMismatch.length }}</span>
          </template>
        </template>
        <span v-else class="mk-badge mk-badge--muted">无 core 声明（core 缺失）</span>
        <span class="sfr__status-actions">
          <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="!canAdd" @click="openWizard">＋ 加字段</button>
          <button type="button" class="mk-btn mk-btn--sm" @click="goOrchestration">→ 编排结构页（{{ data.stage }}）</button>
        </span>
      </div>

      <!-- 与协议 tab 的 core 对账摘要（analyzeCoreFieldsSync 单 skill 投影） -->
      <div v-if="syncReport && (syncReport.missing.length || syncReport.orphan.length || syncReport.typeMismatch.length)" class="sfr__sync">
        <strong class="sfr__sync-title">与协议 tab 的 core 对账</strong>
        <span v-for="m in syncReport.missing" :key="'m' + m.fieldId" class="sfr__sync-item sfr__sync-item--err" :title="m.detail">
          {{ TERMS.statusMissing }}：<code class="mono">{{ m.fieldId }}</code>
        </span>
        <span v-for="t in syncReport.typeMismatch" :key="'t' + t.fieldId" class="sfr__sync-item sfr__sync-item--warn" :title="`core ${t.coreType} ↔ 编排 ${t.routingValueType}（应为 ${t.expectedValueType}）`">
          类型不一致：<code class="mono">{{ t.fieldId }}</code>（core {{ t.coreType }} ↔ 编排 {{ t.routingValueType }}）
        </span>
      </div>

      <!-- core 有但未路由（孤儿） -->
      <div v-if="syncReport?.orphan?.length" class="sfr__orphan">
        <strong class="sfr__orphan-title">core 有但未路由（{{ TERMS.statusOrphan }}）</strong>
        <span v-for="o in syncReport.orphan" :key="o.coreField" class="sfr__orphan-item" :title="o.detail">
          <code class="mono">{{ o.coreField }}</code> 未出现在产出行首段
        </span>
      </div>

      <!-- 图例：角色 / render / 流转 / 落库键 / 锁定（与编排结构页同源人话表） -->
      <details class="sfr__legend" @toggle="legendOpen = ($event.target as HTMLDetailsElement).open">
        <summary class="sfr__legend-summary">图例：字段角色 / render / 锁定 / 流转 —— 不懂就看这里</summary>
        <div class="sfr__legend-body">
          <div class="sfr__legend-group sfr__legend-group--roles">
            <h5 class="sfr__legend-title">字段角色（promptRole）</h5>
            <ul v-if="roleMeta.length" class="sfr__legend-list">
              <li v-for="m in roleMeta" :key="m.id" class="sfr__legend-item">
                <span class="mk-badge" :class="`mk-badge--role-${m.id}`">{{ m.label }}</span>
                <span class="sfr__legend-en mono">{{ m.id }}</span>
                <span class="sfr__legend-hint">{{ m.hint }}</span>
              </li>
            </ul>
            <p v-else class="sfr__legend-hint">角色词表待后端下发…</p>
          </div>
          <div class="sfr__legend-group">
            <h5 class="sfr__legend-title">render（是否对外可见）</h5>
            <ul class="sfr__legend-list">
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--render-visible">visible</span><span class="sfr__legend-hint">可见：会出现在对外交付（用户 / 界面）</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--render-hidden">hidden</span><span class="sfr__legend-hint">隐藏：仅内部流转，不对外展示</span></li>
            </ul>
            <h5 class="sfr__legend-title">流转（handoff / internal / accumulate）</h5>
            <ul class="sfr__legend-list">
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--flow-handoff">handoff</span><span class="sfr__legend-hint">移交：字段产完后交给谁——下一阶段名（如 path）/ agent / skill；空 = 不转交</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--flow-internal">internal</span><span class="sfr__legend-hint">内部信令：仅供平台内部 / UI 控制使用，不进业务状态</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--flow-accumulate">accumulate</span><span class="sfr__legend-hint">累积：值会累积进学习者状态（画像 / 上下文），供后续阶段持续使用</span></li>
            </ul>
            <h5 class="sfr__legend-title">落库键（persistKey）</h5>
            <ul class="sfr__legend-list">
              <li class="sfr__legend-item"><span class="sfr__legend-hint">字段值最终写入主库的键路径；与字段名不一致的字段单独标注，一致时默认显示字段名</span></li>
            </ul>
            <h5 class="sfr__legend-title">锁定 / core 状态</h5>
            <ul class="sfr__legend-list">
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--lock-system">系统锁</span><span class="sfr__legend-hint">平台派生 / 代码消费，admin 不可直接改（需改编排文件）</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--lock-structure">结构锁</span><span class="sfr__legend-hint">结构约束锁定，修改需谨慎</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--core-declared">✓ 已声明</span><span class="sfr__legend-hint">编排路由首段在 core fields 中且有声明</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--core-missing">⚠ {{ TERMS.statusMissing }}</span><span class="sfr__legend-hint">编排路由首段不在 core fields（error 级，阻断字段同步）</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--core-mismatch">⚠ 类型不一致</span><span class="sfr__legend-hint">core type ↔ 编排 valueType 不一致（warn）</span></li>
              <li class="sfr__legend-item"><span class="mk-badge mk-badge--core-orphan">{{ TERMS.statusOrphan }}</span><span class="sfr__legend-hint">core 字段未出现在任何产出路由行首段（warn，见上方对账条）</span></li>
            </ul>
          </div>
        </div>
      </details>

      <!-- 搜索 -->
      <div class="mk-filter sfr__filter">
        <input v-model="keyword" class="mk-filter__input" type="search" placeholder="搜索字段名 / 含义 / 角色 / render / 移交…" />
        <select v-model="roleFilter" class="mk-filter__select" aria-label="按角色过滤">
          <option value="">全部角色</option>
          <option v-for="m in roleMeta" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
        </select>
        <span v-if="filterActive" class="sfr__filter-count">命中 {{ rows.length }} / {{ data.routings.length }} 行</span>
      </div>

      <!-- 产出字段表 -->
      <div class="sfr__scroll">
        <table class="sfr__table">
          <thead>
            <tr>
              <th scope="col">字段</th>
              <th scope="col">含义</th>
              <th scope="col">类型</th>
              <th scope="col">角色</th>
              <th scope="col">render</th>
              <th scope="col">handoff</th>
              <th scope="col">internal</th>
              <th scope="col">accumulate</th>
              <th scope="col">落库键</th>
              <th scope="col">锁定</th>
              <th scope="col">core 状态</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.fieldId">
              <td class="sfr__fieldcell">
                <span class="mono sfr__field">{{ row.fieldId }}</span>
                <span v-if="row.pathInRawOutput" class="sfr__fieldpath" :title="`抽取路径（pathInRawOutput）：${row.pathInRawOutput}`">抽取 → {{ row.pathInRawOutput }}</span>
              </td>
              <td class="sfr__meaning">
                <span class="sfr__meaning-text" :title="row.desc">{{ row.desc || '—' }}</span>
              </td>
              <td class="mono">{{ row.valueType }}</td>
              <td>
                <span v-if="row.role" class="mk-badge" :class="`mk-badge--role-${row.role}`" :title="roleHintOf(row.role)">{{ roleLabelOf(row.role) }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td>
                <span class="mk-badge" :class="`mk-badge--render-${row.render}`" :title="renderHintOf(row)">{{ row.render }}</span>
              </td>
              <td><span class="mono sfr__handoff" :title="handoffTitleOf(row)">{{ formatHandoff(row.handoff) }}</span></td>
              <td>{{ row.internal ? '是' : '否' }}</td>
              <td>{{ row.accumulate ? '是' : '否' }}</td>
              <td>
                <span class="mono sfr__persist" :class="{ 'sfr__persist--alias': row.persistKey !== row.fieldId }" :title="row.persistKey === row.fieldId ? '落库键与字段名一致' : `落库键与字段名不一致：值实际写入 ${row.persistKey}（见编排文件 persistKey 声明）`">{{ row.persistKey }}</span>
              </td>
              <td><span class="mk-badge" :class="`mk-badge--lock-${row.lockLevel}`" :title="lockHintOf(row.lockLevel)">{{ lockLabelOf(row.lockLevel) }}</span></td>
              <td>
                <span v-if="row.coreState === 'missing'" class="mk-badge mk-badge--core-missing" :title="row.coreStateTitle">⚠ {{ TERMS.statusMissing }}</span>
                <span v-else-if="row.coreState === 'mismatch'" class="mk-badge mk-badge--core-mismatch" :title="row.coreStateTitle">⚠ 类型不一致</span>
                <span v-else class="mk-badge mk-badge--core-declared" :title="row.coreStateTitle">✓ 已声明</span>
              </td>
              <td class="sfr__ops">
                <button type="button" class="mk-btn mk-btn--sm" :disabled="!canEditRow(row)" :title="editTitleOf(row)" @click="openEdit(row)">编辑</button>
                <button type="button" class="mk-btn mk-btn--sm mk-btn--danger" :disabled="!canDeleteRow(row)" :title="deleteTitleOf(row)" @click="onDelete(row)">删除</button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="12" class="sfr__emptyrow">{{ data.routings.length ? '无匹配行，试试调整搜索或角色过滤' : '该 skill 暂无产出行（无编排路由声明）' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 加字段向导 -->
      <FieldAddWizard
        v-if="wizardOpen"
        :skill-id="skillId"
        :stage="data.stage"
        :existing-names="existingNames"
        :role-meta="roleMeta"
        @saved="load"
        @close="wizardOpen = false"
      />

      <!-- 编辑字段向导（双模式：预填当前值 → PATCH 原子改） -->
      <FieldAddWizard
        v-if="editingRow"
        :skill-id="skillId"
        :stage="data.stage"
        :existing-names="existingNames"
        :role-meta="roleMeta"
        mode="edit"
        :field-name="editingRow.fieldId"
        :initial="editInitialOf(editingRow)"
        @saved="load"
        @close="editingRow = null"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminFieldRoutingsApi, adminPromptWorkbenchApi } from '@/api/adminApi'
import FieldAddWizard from './FieldAddWizard.vue'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import { TERMS } from './terms'

interface RoleMeta { id: string; label: string; hint: string }
interface CoreField { name: string; type: string; turn?: boolean; desc?: string }
interface SyncReport {
  skillId: string
  stage: string
  state: 'ok' | 'missing' | 'no-routings' | 'no-core'
  missing: Array<{ fieldId: string; root: string; detail: string }>
  orphan: Array<{ coreField: string; detail: string }>
  typeMismatch: Array<{ fieldId: string; coreType: string; routingValueType: string; expectedValueType: string }>
}
interface FieldRow {
  fieldId: string
  promptRole?: string
  valueType?: string
  description?: string
  pathInRawOutput?: string
  persistKey?: string
  systemLocked?: boolean
  structureLocked?: boolean
  locks?: { level?: string }
}
interface RoutingRow {
  agentId: string
  fieldId: string
  render: string
  handoff: string[]
  internal: boolean
  accumulate: boolean
  visibilityPreset?: string
  notes?: string
}
interface SkillRoutingsData {
  skillId: string
  stage: string
  agentId: string
  routings: RoutingRow[]
  fields: FieldRow[]
  promptRoleMeta: RoleMeta[]
  core: {
    exists: boolean
    fields: CoreField[]
    diagnostics: unknown[]
    sync: SyncReport | null
  }
}

const props = defineProps<{ skillId: string }>()
const router = useRouter()

const loading = ref(false)
const error = ref('')
const data = ref<SkillRoutingsData | null>(null)
const keyword = ref('')
const roleFilter = ref('')
const legendOpen = ref(false)
const wizardOpen = ref(false)
const editingRow = ref<Record<string, any> | null>(null)
const deleting = ref(false)

const fieldMap = computed(() => new Map((data.value?.fields || []).map((f) => [f.fieldId, f])))
const coreFieldNames = computed(() => new Set((data.value?.core.fields || []).map((f) => f.name)))
const syncReport = computed(() => data.value?.core.sync ?? null)
const roleMeta = computed(() => data.value?.promptRoleMeta || [])

const syncToneTone = computed(() => {
  const s = syncReport.value
  if (!s || s.state === 'no-routings' || s.state === 'no-core') return 'mk-status--muted'
  if (s.missing.length) return 'mk-status--bad'
  if (s.orphan.length || s.typeMismatch.length) return 'mk-status--warn'
  return 'mk-status--ok'
})

const existingNames = computed(() => {
  const set = new Set<string>()
  for (const f of data.value?.core.fields || []) set.add(f.name)
  for (const f of data.value?.fields || []) set.add(f.fieldId)
  return [...set]
})

const canAdd = computed(() => Boolean(data.value?.core.exists && syncReport.value))

const filterActive = computed(() => Boolean(keyword.value.trim() || roleFilter.value))

function roleMetaOf(id?: string) {
  if (!id) return undefined
  return roleMeta.value.find((m) => m.id === id) || { id, label: id, hint: id }
}
function roleLabelOf(id: string) { return roleMetaOf(id)!.label }
function roleHintOf(id: string) { return roleMetaOf(id)!.hint }
function formatHandoff(raw?: string[] | string | null) {
  if (!raw) return ''
  if (Array.isArray(raw)) return raw.join(', ')
  return String(raw)
}
function renderHintOf(row: { render: string; visibilityPreset?: string; notes?: string }) {
  const base = row.render === 'hidden' ? '隐藏：仅内部流转，不对外展示' : '可见：会出现在对外交付（用户 / 界面）'
  const parts = [base]
  if (row.visibilityPreset) parts.push(`可见性预设：${row.visibilityPreset}`)
  if (row.notes) parts.push(`备注：${row.notes}`)
  return parts.join('\n')
}
function handoffTitleOf(row: RoutingRow) {
  const parts: string[] = []
  if (row.handoff?.length) parts.push(`移交 → ${formatHandoff(row.handoff)}`)
  if (row.visibilityPreset) parts.push(`可见性预设：${row.visibilityPreset}`)
  if (row.notes) parts.push(`备注：${row.notes}`)
  return parts.join('\n')
}
function lockLevelOf(field: FieldRow | undefined): string {
  if (!field) return 'editable'
  const system = Boolean(field.systemLocked) || Boolean(field.locks?.level === 'system-locked')
  if (system) return 'system-locked'
  const structure = Boolean(field.structureLocked) || Boolean(field.locks?.level === 'structure-locked')
  return structure ? 'structure-locked' : 'editable'
}
function lockLabelOf(level: string) {
  if (level === 'system-locked') return '系统锁'
  if (level === 'structure-locked') return '结构锁'
  return '可编辑'
}
function lockHintOf(level: string) {
  if (level === 'system-locked') return '系统锁：平台派生 / 代码消费，admin 不可直接改（需改编排文件）'
  if (level === 'structure-locked') return '结构锁：结构约束锁定，修改需谨慎'
  return '可编辑：可自由调整（仍走编排文件入口）'
}

/** 单行 core 状态：缺声明（error）/ 类型不一致（warn）/ 已声明 */
function coreStateOf(row: RoutingRow): { state: 'declared' | 'missing' | 'mismatch'; title: string } {
  const root = row.fieldId.split('.')[0]
  const s = syncReport.value
  if (s) {
    const missing = s.missing.find((m) => m.fieldId === row.fieldId || m.root === root)
    if (missing) return { state: 'missing', title: missing.detail }
    const mismatch = s.typeMismatch.find((m) => m.fieldId === row.fieldId)
    if (mismatch) {
      return {
        state: 'mismatch',
        title: `core 声明 ${mismatch.coreType} ↔ 编排 valueType ${mismatch.routingValueType}（应为 ${mismatch.expectedValueType}）`
      }
    }
  }
  if (coreFieldNames.value.has(root)) return { state: 'declared', title: '编排路由首段已在 core fields 声明（类型一致）' }
  if (s?.state === 'no-core') return { state: 'missing', title: 'core 文件缺失，无法比对（请先在协议 tab 建立 core 声明）' }
  return { state: 'declared', title: '编排路由首段已在 core fields 声明（或命中平台豁免清单）' }
}

/** 行 = 产出行（routing）∪ fields 段详情 ∪ core 状态 */
const rows = computed(() => {
  const s = syncReport.value
  return (data.value?.routings || [])
    .map((r) => {
      const field = fieldMap.value.get(r.fieldId)
      const core = coreStateOf(r)
      return {
        ...r,
        desc: field?.description || '',
        valueType: field?.valueType || '—',
        role: field?.promptRole || '',
        persistKey: field?.persistKey || r.fieldId,
        pathInRawOutput: field?.pathInRawOutput || '',
        lockLevel: lockLevelOf(field),
        coreState: core.state,
        coreStateTitle: core.title,
        visibilityPreset: r.visibilityPreset || ''
      }
    })
    .filter((row) => {
      if (roleFilter.value && row.role !== roleFilter.value) return false
      const kw = keyword.value.trim().toLowerCase()
      if (!kw) return true
      const hay = [
        row.fieldId,
        row.desc,
        roleLabelOf(row.role),
        roleHintOf(row.role),
        row.render,
        row.visibilityPreset,
        formatHandoff(row.handoff),
        lockLabelOf(row.lockLevel),
        row.coreState,
        row.persistKey,
        row.pathInRawOutput,
        ...(s ? s.missing.map((m) => m.detail) : []),
        ...(s ? s.orphan.map((o) => o.detail) : [])
      ].join(' ').toLowerCase()
      return hay.includes(kw)
    })
})

async function load() {
  // 首次加载显示骨架；已有数据时静默刷新（保留向导成功态与表格在位）
  if (!data.value) loading.value = true
  error.value = ''
  try {
    const res = await adminFieldRoutingsApi.getSkillRoutings(props.skillId)
    data.value = res.data?.data ?? null
  } catch (e: any) {
    const r = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string }
    const d = r?.response?.data?.error
    const message = typeof d === 'string' ? d : d?.message || r?.message || '加载失败'
    const status = (e as { response?: { status?: number } })?.response?.status
    if (data.value) {
      // 静默刷新失败：保留已有数据，不打断向导
      return
    }
    if (status === 404) {
      error.value = `该 skill 无字段路由数据：${message}`
    } else if (status === 422) {
      error.value = `字段路由暂不可用：${message}`
    } else {
      error.value = `字段路由加载失败：${message}`
    }
  } finally {
    loading.value = false
  }
}

function openWizard() {
  wizardOpen.value = true
}

/** 编排 valueType → core 类型（反向归一，与后端 valueTypeToCoreType 同源） */
function coreTypeOfValueType(vt: string): string {
  if (vt === 'array<string>') return 'string[]'
  if (vt === 'array<object>') return 'object[]'
  if (['string', 'number', 'boolean', 'object'].includes(vt)) return vt
  return 'string'
}

interface EditInitialShape {
  type: string
  optional: boolean
  turn: boolean
  role: string
  render: string
  handoff: string[]
  internal: boolean
  accumulate: boolean
  visibilityPreset: string
  locked: '' | 'system' | 'structure'
  desc: string
  persistKey: string
  pathInRawOutput: string
  systemLocked: boolean
  structureLocked: boolean
}

/** 编辑预填：行数据 + core 声明组装（core 类型优先 core 侧；嵌套从 desc 子字段说明解析） */
function editInitialOf(row: Record<string, any>): EditInitialShape {
  const isNested = row.fieldId.includes('.')
  const root = row.fieldId.split('.')[0]
  const coreField = data.value?.core.fields.find((f) => f.name === root)
  let type = coreTypeOfValueType(row.valueType || '')
  let desc = row.desc || ''
  let turn = false
  if (coreField) {
    if (isNested) {
      const childPath = row.fieldId.slice(root.length + 1)
      const noteRe = new RegExp(`(?:^|\\n)\\s*·\\s*${childPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*（([^），）]*)）\\s*([^\\n]*)`)
      const m = coreField.desc?.match(noteRe)
      if (m) {
        type = m[1].trim() || type
        desc = m[2].trim() || desc
      }
    } else {
      type = coreField.type || type
      turn = Boolean(coreField.turn)
      desc = coreField.desc || desc
    }
  }
  const optional = type.endsWith('?')
  return {
    type: optional ? type.slice(0, -1) : type,
    optional,
    turn,
    role: row.role || 'soft-info',
    render: row.render || 'visible',
    handoff: Array.isArray(row.handoff) ? [...row.handoff] : [],
    internal: Boolean(row.internal),
    accumulate: Boolean(row.accumulate),
    visibilityPreset: row.visibilityPreset || '',
    locked: row.lockLevel === 'system-locked' ? 'system' : row.lockLevel === 'structure-locked' ? 'structure' : '',
    desc,
    persistKey: row.persistKey && row.persistKey !== row.fieldId ? row.persistKey : '',
    pathInRawOutput: row.pathInRawOutput || '',
    systemLocked: row.lockLevel === 'system-locked',
    structureLocked: row.lockLevel === 'structure-locked'
  }
}

function openEdit(row: Record<string, any>) {
  editingRow.value = row
}

/** systemLocked 只读 / core 缺声明不可编辑；structureLocked 可编辑（向导内提示） */
function canEditRow(row: Record<string, any>): boolean {
  if (row.lockLevel === 'system-locked') return false
  if (row.coreState === 'missing') return false
  return true
}
function editTitleOf(row: Record<string, any>): string {
  if (row.lockLevel === 'system-locked') return 'systemLocked 只读：平台派生 / 代码消费，需走编排文件编辑'
  if (row.coreState === 'missing') return 'core 缺项：无法编辑 core 侧（先在协议 tab 补声明，或走编排弹窗）'
  return '编辑字段（core 声明 + 编排路由 + DB 对账原子修改）'
}
function canDeleteRow(row: Record<string, any>): boolean {
  return row.lockLevel !== 'system-locked'
}
function deleteTitleOf(row: Record<string, any>): string {
  if (row.lockLevel === 'system-locked') return 'systemLocked 字段禁止删除（平台派生 / 代码消费，锁原因见编排文件）'
  return '删除字段（移除 core 声明 + 编排字段/路由 + DB 行；下游消费会被后端 409 拦截）'
}

/** 404 / 409 删除错误码 → 中文 */
function deleteErrText(e: unknown): string {
  const r = e as { response?: { data?: { code?: string; error?: { message?: string } | string } }; message?: string }
  const d = r?.response?.data
  const raw = d?.error ? (typeof d.error === 'string' ? d.error : d.error.message) : r?.message
  const code = d?.code || ''
  const map: Record<string, string> = {
    FIELD_NOT_FOUND: '字段不存在（可能已被删除，或仅声明于一侧）',
    FIELD_SYSTEM_LOCKED: '字段为 systemLocked，禁止删除（平台派生 / 代码消费）',
    FIELD_CONSUMED: '字段仍被下游消费（其他 agent 路由 / 其他 skill 的 core inputs），已拒绝删除'
  }
  const title = code ? (map[code] || '删除被拒绝') : '删除失败'
  return raw ? `${title}：${raw}` : title
}

async function onDelete(row: Record<string, any>) {
  if (deleting.value) return
  const ok = await askConfirm({
    title: `删除字段 ${row.fieldId}？`,
    message: `将同时移除 core.yaml 声明、编排 fields 定义与 skill:${props.skillId} 名下的路由行，并清理 DB 落库行（文件备份保留在 prompts/backups/unified-edit）。\n\n删除前请确认下游无消费：其他 agent 的路由引用、其他 skill 的 core inputs 引用会被后端 409 拦截并列出。`,
    confirmText: '确认删除（不可恢复）'
  })
  if (!ok) return
  deleting.value = true
  try {
    const res = await adminPromptWorkbenchApi.deleteSkillField(props.skillId, row.fieldId)
    const d = res.data?.data
    toast.success(`已删除字段 ${row.fieldId}（双文件与 DB 均已清理）`)
    if (d?.protectedRows?.length) {
      toast.warning(`受保护行未删：${d.protectedRows.map((p: any) => p.key).join('，')}（admin 覆盖行需走编排弹窗处理）`)
    }
    await load()
  } catch (e: any) {
    toast.error(deleteErrText(e))
  } finally {
    deleting.value = false
  }
}

function goOrchestration() {
  if (!data.value) return
  void router.push({ path: '/admin/orchestrator', query: { stage: data.value.stage, tab: 'field-routings' } })
}

onMounted(() => void load())
</script>

<style scoped>
.sfr__status-actions { margin-left: auto; display: inline-flex; gap: 8px; }
.sfr__sync {
  display: flex;
  align-items: baseline;
  gap: 6px 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 8px 12px;
  border: 1px dashed rgba(220, 38, 38, 0.4);
  border-radius: 9px;
  background: var(--mk-red-bg, #fef2f2);
  font-size: 12px;
  line-height: 1.5;
}
.sfr__sync-title { color: var(--mk-red, #dc2626); font-size: 11.5px; }
.sfr__sync-item { display: inline-flex; gap: 4px; align-items: center; }
.sfr__sync-item--err { color: var(--mk-red, #dc2626); font-weight: 600; }
.sfr__sync-item--warn { color: var(--mk-amber, #b45309); font-weight: 600; }

.sfr__orphan {
  display: flex;
  align-items: baseline;
  gap: 6px 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  padding: 8px 12px;
  border: 1px dashed rgba(180, 83, 9, 0.45);
  border-radius: 9px;
  background: var(--mk-amber-bg, #fffbeb);
  font-size: 12px;
}
.sfr__orphan-title { color: var(--mk-amber, #b45309); font-size: 11.5px; }
.sfr__orphan-item { display: inline-flex; gap: 4px; align-items: center; color: var(--mk-muted, #5b6577); }
.sfr__orphan-item code { color: var(--mk-amber, #b45309); font-weight: 700; }

/* ========== 图例（可折叠，与编排结构页同款语义） ========== */
.sfr__legend {
  margin: 0 0 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 10px;
  background: var(--mk-surface, #fff);
  box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06));
}
.sfr__legend-summary {
  padding: 9px 14px;
  cursor: pointer;
  user-select: none;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-muted, #5b6577);
  list-style: none;
}
.sfr__legend-summary::-webkit-details-marker { display: none; }
.sfr__legend-summary::before { content: '▸'; display: inline-block; margin-right: 7px; color: var(--mk-blue, #2c63d0); transition: transform 0.14s ease; }
.sfr__legend[open] .sfr__legend-summary::before { transform: rotate(90deg); }
.sfr__legend-body { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; padding: 4px 14px 10px; }
@media (max-width: 860px) { .sfr__legend-body { grid-template-columns: 1fr; } }
.sfr__legend-title { margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mk-faint, #71809a); }
.sfr__legend-group--roles + .sfr__legend-group .sfr__legend-title { margin-top: 10px; }
.sfr__legend-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.sfr__legend-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sfr__legend-en { flex-shrink: 0; font-size: 11px; color: var(--mk-faint, #71809a); }
.sfr__legend-hint { font-size: 12px; color: var(--mk-muted, #5b6577); min-width: 0; }

.sfr__filter { margin-bottom: 12px; }
.sfr__filter-count { font-size: 11.5px; color: var(--mk-faint, #71809a); font-weight: 600; }

/* ========== 表格 ========== */
.sfr__scroll { overflow-x: auto; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 12px; background: var(--mk-surface, #fff); box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06)); }
@media (max-width: 860px) { .sfr__table { min-width: 1180px; } }
.sfr__table { width: 100%; border-collapse: collapse; }
.sfr__table th, .sfr__table td { padding: 8px 12px; text-align: left; }
.sfr__table th {
  background: #fafbfc;
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-faint, #71809a);
  white-space: nowrap;
}
.sfr__table td { border-bottom: 1px solid #f6f7f9; font-size: 12.5px; vertical-align: middle; }
.sfr__table tr:last-child td { border-bottom: none; }
.sfr__table tbody tr { transition: background 0.12s; }
.sfr__table tbody tr:hover { background: #f6f9ff; }
.sfr__fieldcell { max-width: 300px; display: grid; gap: 2px; min-width: 0; }
.sfr__field { word-break: break-all; color: var(--mk-ink, #1a2a44); }
.sfr__fieldpath { font-size: 10.5px; color: var(--mk-faint, #71809a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sfr__meaning { min-width: 200px; max-width: 340px; }
.sfr__meaning-text { display: block; color: var(--mk-muted, #5b6577); line-height: 1.5; max-height: 3em; overflow: hidden; }
.sfr__handoff { max-width: 220px; color: var(--mk-faint, #71809a); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sfr__ops { display: flex; gap: 6px; white-space: nowrap; }
.sfr__ops .mk-btn { padding: 3px 10px; font-size: 11.5px; }

/* 角色徽章（与编排结构页同款 7 类着色） */
.sfr__persist { display: inline-block; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mk-muted, #5b6577); font-size: 11px; }
.sfr__persist--alias { color: var(--mk-amber, #b45309); background: #fffbeb; border-radius: 5px; padding: 0 5px; }

/* core 状态列 */
.sfr__empty { padding: 30px; color: var(--mk-faint, #71809a); text-align: center; }
.sfr__emptyrow { color: var(--mk-faint, #71809a); text-align: center; padding: 14px; }
.sfr__error-text { margin: 0 0 10px; font-size: 12.5px; line-height: 1.6; }
</style>
