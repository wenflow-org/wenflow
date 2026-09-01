<template>
  <Teleport to="body">
  <div ref="maskRef" class="mk-modal">
    <div ref="panelRef" class="mk-modal__panel faw" role="dialog" :aria-label="dialogTitle">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">{{ dialogTitle }}</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
      </div>
      <div class="mk-modal__body">
        <p class="faw__sub">{{ subText }}</p>

        <!-- systemLocked 只读提示（编辑模式；平台派生/代码消费字段禁止在本向导修改） -->
        <p v-if="mode === 'edit' && form.systemLocked" class="faw__warn faw__warn--err">
          ⚠ {{ props.fieldName }} 为 systemLocked（平台派生 / 代码消费，锁原因见编排文件 systemLocked 声明）：
          只读字段，本向导不可编辑，需走编排文件编辑。
        </p>
        <p v-else-if="mode === 'edit' && form.structureLocked" class="faw__warn">
          ⚠ 结构锁字段（structureLocked）：修改需谨慎，保存将同步改 core 声明与编排路由。
        </p>

        <!-- 成功结果态 -->
        <div v-if="result" class="faw__result">
          <strong class="faw__result-title">{{ resultTitle }}</strong>
          <ul class="faw__result-list">
            <li v-if="result.changed === false">无变化（字段现状与提交内容一致，未写盘未同步）</li>
            <template v-else>
              <li>core.yaml <b>{{ result.coreWritten ? '已写入' : '未写入' }}</b> · 编排文件 <b>{{ result.orchestrationWritten ? '已写入' : '未写入' }}</b></li>
              <li v-if="mode === 'add'">{{ TERMS.syncToDb }} <b :class="result.synced ? 'faw__ok' : 'faw__err'">{{ result.synced ? '已同步' : '失败' }}</b>
                <span class="faw__result-hint">{{ result.syncHint }}</span></li>
              <li v-else>同步对账：fields 更新 <b>{{ result.dbSync?.fieldsUpdated ?? 0 }}</b> · routings 更新 <b>{{ result.dbSync?.routingsUpdated ?? 0 }}</b>
                <span v-if="result.dbSync?.skippedAdminRows?.length" class="faw__result-hint">
                  跳过受保护行 {{ result.dbSync.skippedAdminRows.length }}（{{ result.dbSync.skippedAdminRows.map((r) => r.key).join('，') }}；admin 覆盖行需在编排弹窗手动改）</span></li>
              <li v-if="result.syncCheck">字段同步复检：缺项 <b>{{ result.syncCheck.missing.length }}</b> · 孤儿 <b>{{ result.syncCheck.orphan.length }}</b> · 类型不一致 <b>{{ result.syncCheck.typeMismatch.length }}</b></li>
            </template>
          </ul>
          <p class="faw__result-note">{{ resultNote }}</p>
        </div>

        <template v-else>
          <!-- 表单 -->
          <div class="faw__grid">
            <label class="faw__field faw__field--full">
              <span>字段名 <em class="faw__req">*</em>（kebab-case 或点分路径；首段 = core 顶层字段）</span>
              <input v-model="form.name" type="text" class="mk-input mono" placeholder="如 summary / understanding.motivation" spellcheck="false" :disabled="mode === 'edit'" @input="checkName" />
              <span v-if="mode === 'edit'" class="faw__hint">编辑模式：字段名即身份标识，不可修改</span>
              <span v-else class="faw__hint" :class="nameHintCls">{{ nameHint }}</span>
            </label>

            <label class="faw__field">
              <span>类型（core 侧） <em class="faw__req">*</em></span>
              <select v-model="form.type" class="mk-input">
                <option v-for="t in CORE_TYPES" :key="t" :value="t">{{ t }}</option>
              </select>
              <span class="faw__hint" :class="typeHintCls">{{ typeHint }}</span>
            </label>

            <label class="faw__field">
              <span>promptRole（角色） <em class="faw__req">*</em></span>
              <select v-model="form.role" class="mk-input">
                <option v-for="m in roleMeta" :key="m.id" :value="m.id">{{ m.label }}（{{ m.id }}）</option>
              </select>
              <span class="faw__hint">{{ roleHint }}</span>
            </label>

            <label class="faw__field">
              <span>render（可见性）</span>
              <select v-model="form.render" class="mk-input">
                <option value="visible">visible 可见（对外交付）</option>
                <option value="hidden">hidden 隐藏（仅内部流转）</option>
              </select>
            </label>

            <label class="faw__field">
              <span>handoff（流转目标）</span>
              <input v-model="form.handoff" type="text" class="mk-input mono" placeholder="goal-agent, path, skill:xxx" spellcheck="false" />
              <span class="faw__hint">合法目标：阶段名（{{ STAGE_NAMES.join('/') }}）/ agent / skill:；逗号分隔</span>
            </label>

            <label class="faw__field">
              <span>visibilityPreset（可见性预设）</span>
              <select v-model="form.visibilityPreset" class="mk-input">
                <option value="">缺省（不声明）</option>
                <option value="user-clarification">user-clarification</option>
                <option value="agent-internal">agent-internal</option>
              </select>
            </label>

            <label class="faw__field">
              <span>locked（锁定）</span>
              <select v-model="form.locked" class="mk-input">
                <option value="">不锁定</option>
                <option value="system">system 系统锁（平台派生/代码消费）</option>
                <option value="structure">structure 结构锁（结构约束锁定）</option>
              </select>
            </label>

            <label class="faw__field">
              <span>落库键（persistKey，别名时填）</span>
              <input v-model="form.persistKey" type="text" class="mk-input mono" placeholder="缺省 = 与字段名一致" spellcheck="false" />
            </label>

            <label class="faw__field">
              <span>抽取路径（pathInRawOutput）</span>
              <input v-model="form.pathInRawOutput" type="text" class="mk-input mono" placeholder="internal.ext.xxx.…" spellcheck="false" />
              <span class="faw__hint">嵌套字段建议填；声明字段在产出原始输出里的物理路径</span>
            </label>

            <label class="faw__field faw__field--full">
              <span>desc（生成指令 / 含义） <em class="faw__req">*</em></span>
              <textarea v-model="form.desc" class="mk-input faw__desc" rows="3" placeholder="说明字段语义与生成要求（core 与编排共用）"></textarea>
            </label>
          </div>

          <!-- 开关行 -->
          <div class="faw__checks">
            <label class="faw__check"><input v-model="form.optional" type="checkbox" /> optional（core type 加 ?，仅顶层）</label>
            <label class="faw__check"><input v-model="form.turn" type="checkbox" :disabled="isNested" /> turn（回合输出，仅顶层）</label>
            <label class="faw__check"><input v-model="form.internal" type="checkbox" /> internal（内部标记，与 handoff 互斥）</label>
            <label class="faw__check"><input v-model="form.accumulate" type="checkbox" /> accumulate（累积进学习者状态）</label>
          </div>
          <p v-if="form.internal && handoffList.length" class="faw__warn">⚠ internal 与 handoff 互斥：建议留空 handoff（control-signal 除外）</p>
          <p v-if="isNested" class="faw__warn">⚠ 嵌套字段：core 侧挂到顶层 object 的 desc 子字段说明，编排 fieldId 原样点分；turn 仅顶层直配</p>

          <!-- 双文件 YAML 预览（只读） -->
          <div class="faw__preview">
            <div class="faw__preview-head">
              <span class="faw__preview-title">双文件{{ mode === 'edit' ? '更新' : '生成' }}预览（只读）</span>
              <span class="faw__preview-meta">{{ previewMeta }}</span>
            </div>
            <pre class="faw__preview-code mono">{{ previewYaml }}</pre>
          </div>
        </template>

        <p v-if="msg" class="faw__msg" :class="{ 'is-err': msgErr }">{{ msg }}</p>
      </div>
      <div class="mk-modal__foot">
        <button v-if="result" type="button" class="mk-btn mk-btn--primary" @click="close">完成</button>
        <template v-else>
          <button type="button" class="mk-btn" :disabled="saving" @click="close">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="saving || !canSubmit" @click="submit">
            {{ saving ? '保存中…' : mode === 'edit' ? '保存修改（双文件原子）' : '保存并校验（双文件原子）' }}
          </button>
        </template>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { adminPromptWorkbenchApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import { TERMS } from './terms'

interface RoleMeta { id: string; label: string; hint: string }
interface SyncCheck {
  state?: string
  missing: Array<{ fieldId: string }>
  orphan: Array<{ coreField: string }>
  typeMismatch: Array<{ fieldId: string }>
}
interface DbSyncReport {
  fieldsUpdated: number
  routingsUpdated: number
  contractsUpdated: number
  createdCount: number
  skippedAdminRows: Array<{ table: string; key: string }>
}
interface SaveResult {
  field?: { name: string; fieldId: string }
  changed?: boolean
  coreWritten: boolean
  orchestrationWritten: boolean
  synced?: boolean
  syncHint?: string
  dbSync?: DbSyncReport
  syncCheck: SyncCheck | null
}

export interface FieldEditInitial {
  /** core 类型（可带 ? 后缀） */
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

const props = defineProps<{
  skillId: string
  stage: string
  /** 已有字段名查重：core fields ∪ 编排 fieldId */
  existingNames: string[]
  roleMeta: RoleMeta[]
  /** add = 加字段（POST）；edit = 编辑既有字段（PATCH，name 走 URL） */
  mode?: 'add' | 'edit'
  /** edit 模式必填：被编辑字段名（身份标识，不可改） */
  fieldName?: string
  /** edit 模式预填值（由父组件从当前行数据 + core 声明组装） */
  initial?: FieldEditInitial | null
}>()
const emit = defineEmits<{ saved: []; close: [] }>()

const CORE_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'object[]', 'string[]'] as const
const STAGE_NAMES = ['goal', 'path', 'teaching', 'profile', 'simulation']
/** core → 编排 valueType 归一（与后端 yaml-vocabulary coreTypeToValueType 同源） */
function valueTypeOf(raw: string): string | undefined {
  const base = raw.replace(/\?$/, '').trim()
  switch (base) {
    case 'string': case 'number': case 'boolean': case 'object': return base
    case 'object[]': return 'array<object>'
    case 'string[]': return 'array<string>'
    default: return undefined
  }
}

const form = ref({
  name: props.mode === 'edit' ? (props.fieldName ?? '') : '',
  type: 'string',
  role: 'soft-info',
  render: 'visible',
  handoff: '',
  optional: false,
  turn: false,
  internal: false,
  accumulate: false,
  visibilityPreset: '',
  locked: '' as '' | 'system' | 'structure',
  desc: '',
  persistKey: '',
  pathInRawOutput: '',
  systemLocked: false,
  structureLocked: false
})

const saving = ref(false)
const msg = ref('')
const msgErr = ref(false)
const result = ref<SaveResult | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
/** 向导由父组件 v-if 挂载即打开；关闭 = emit close（父组件卸载） */
const open = ref(true)

useEscape(() => true, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

const isEdit = computed(() => props.mode === 'edit')

const dialogTitle = computed(() => (isEdit.value ? `编辑字段 · ${props.fieldName}` : `加字段 · ${props.skillId}`))
const subText = computed(() =>
  isEdit.value
    ? '一次保存 → 双文件联动修改（core.yaml fields + 编排 fields/routings）→ 原子保存（写盘 / 全量对账同步 / 复检）；字段名不可改'
    : '一次填写 → 双文件生成（core.yaml fields + 编排 fields/routings）→ 原子保存（写入/同步/复检）'
)
const resultTitle = computed(() =>
  result.value?.changed === false
    ? '无变化（幂等）'
    : isEdit.value
      ? '已更新并回填路由 ✓'
      : '已保存并回填路由 ✓'
)
const resultNote = computed(() => {
  if (result.value?.changed === false) return '字段现状与提交内容一致，未写盘 / 未同步 / 未记审计。'
  if (isEdit.value) {
    return '字段修改已生效（core 声明 + 编排路由 + DB 对账）；记得去「协议」tab 编译预览 → 发布 core 变更（发布需 developerApproval 治理，不并入本次保存）。'
  }
  return '新字段已登记路由并同步；记得去「协议」tab 编译预览 → 发布 core 变更（发布需 developerApproval 治理，不并入本次保存）。'
})
const previewMeta = computed(() => (isEdit.value ? 'core.yaml fields + 编排 fields/routings 将更新为' : 'core.yaml fields + 编排 fields/routings 各追加 1 行'))

onMounted(() => {
  if (isEdit.value && props.initial) {
    const i = props.initial
    form.value = {
      name: props.fieldName ?? '',
      type: i.type,
      role: i.role,
      render: i.render,
      handoff: i.handoff.join(', '),
      optional: i.optional,
      turn: i.turn,
      internal: i.internal,
      accumulate: i.accumulate,
      visibilityPreset: i.visibilityPreset,
      locked: i.locked,
      desc: i.desc,
      persistKey: i.persistKey,
      pathInRawOutput: i.pathInRawOutput,
      systemLocked: i.systemLocked,
      structureLocked: i.structureLocked
    }
  }
})

function close() {
  if (saving.value) return
  emit('close')
}

const isNested = computed(() => form.value.name.includes('.'))
const nameSegmentsOk = computed(() => {
  if (!form.value.name.trim()) return false
  return form.value.name.split('.').every((seg) => /^[a-z][A-Za-z0-9_]*$/.test(seg))
})
const handoffList = computed(() =>
  form.value.handoff
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
)
/** 与现有 core fields ∪ 编排 fieldId 查重（首段 / 全名两级提示；编辑模式跳过） */
const nameDup = computed(() => {
  if (isEdit.value) return ''
  const name = form.value.name.trim()
  if (!name) return ''
  if (props.existingNames.includes(name)) return 'full'
  const root = name.split('.')[0]
  if (!isNested.value && props.existingNames.some((n) => n.split('.')[0] === root)) return 'root'
  return ''
})

const nameHint = ref('每段小写字母开头，仅含字母/数字/下划线，可点分嵌套')
const nameHintCls = computed(() => ({ 'faw__hint--ok': !nameProblems.value, 'faw__hint--err': Boolean(nameProblems.value) }))
const nameProblems = computed(() => {
  if (isEdit.value) return ''
  const name = form.value.name.trim()
  if (!name) return '字段名必填'
  if (!nameSegmentsOk.value) return '命名非法：每段须小写字母开头，仅含字母/数字/下划线，可点分嵌套'
  if (nameDup.value === 'full') return '✗ 与现有 core 字段 / 编排 fieldId 重复（如需调整请走既有编辑面）'
  if (nameDup.value === 'root' && !isNested.value) return '✗ 顶层名与现有 core 字段首段重复'
  return ''
})

const typeHint = computed(() => {
  const vt = valueTypeOf(form.value.type)
  if (form.value.type === 'enum') return 'enum 为 core-only：编排侧无对应 valueType，需人工登记或选用其它类型'
  return `core「${form.value.type}${form.value.optional ? '?' : ''}」 ⇔ 编排「${vt}」`
})
const typeHintCls = computed(() => (form.value.type === 'enum' ? 'faw__hint--err' : ''))

const roleHint = computed(() => {
  const m = props.roleMeta.find((r) => r.id === form.value.role)
  return m ? m.hint : ''
})

const formProblems = computed(() => {
  const list: string[] = []
  if (form.value.systemLocked) list.push('systemLocked 字段只读（需走编排文件编辑）')
  const n = nameProblems.value
  if (n) list.push(n)
  if (form.value.type === 'enum') list.push('enum 为 core-only，编排侧无对应 valueType（提交会被 422 拒绝）')
  if (!form.value.desc.trim()) list.push('desc（生成指令/含义）必填')
  if (form.value.internal && handoffList.value.length) list.push('internal 与 handoff 互斥（control-signal 除外）')
  if (form.value.optional && isNested.value) list.push('optional 仅顶层直配生效（嵌套字段不加 ?）')
  return list
})
const canSubmit = computed(() => !saving.value && formProblems.value.length === 0)

const previewYaml = computed(() => {
  const name = form.value.name.trim() || 'new_field'
  const type = `${form.value.type}${form.value.optional ? '?' : ''}`
  const vt = valueTypeOf(form.value.type)
  const desc = form.value.desc.trim() || '字段说明'
  const turn = form.value.turn && !isNested.value ? `\n    turn: true` : ''
  const fieldExtra = [
    form.value.persistKey.trim() ? `\n    persistKey: ${form.value.persistKey.trim()}` : '',
    form.value.pathInRawOutput.trim() ? `\n    pathInRawOutput: ${form.value.pathInRawOutput.trim()}` : '',
    form.value.locked === 'system' ? `\n    systemLocked: true` : '',
    form.value.locked === 'structure' ? `\n    structureLocked: true` : ''
  ].join('')
  const routingExtra = form.value.visibilityPreset ? `\n    visibilityPreset: ${form.value.visibilityPreset}` : ''
  const handoff = handoffList.value.length ? `[${handoffList.value.join(', ')}]` : '[]'
  return `# ── prompts/core/${props.skillId}.yaml（fields）──
  - name: ${name}
    type: ${type}${turn}
    desc: ${desc}

# ── prompts/orchestration/${props.stage}.yaml（fields）──
  - fieldId: ${name}
    promptRole: ${form.value.role}
    valueType: ${vt ?? '⚠ enum 无编排侧拼写'}${fieldExtra}
    description: ${desc}

# ── prompts/orchestration/${props.stage}.yaml（routings）──
  - agentId: skill:${props.skillId}
    fieldId: ${name}
    render: ${form.value.render}
    handoff: ${handoff}
    internal: ${form.value.internal}
    accumulate: ${form.value.accumulate}${routingExtra}`
})

watch(
  () => [form.value.name, form.value.type, form.value.optional, form.value.turn, form.value.internal, form.value.accumulate, form.value.render, form.value.handoff, form.value.desc, form.value.persistKey, form.value.pathInRawOutput, form.value.visibilityPreset, form.value.locked] as const,
  () => {
    if (msg.value) { msg.value = ''; msgErr.value = false }
  }
)

function checkName() {
  nameHint.value = nameProblems.value || '✓ 可用（保存时后端还会做最终查重/校验）'
}

/** 409 / 404 / 422 错误码 → 中文展示（message 取后端原文，code 前缀帮助定位） */
function errText(e: unknown): string {
  const r = e as { response?: { data?: { code?: string; error?: { message?: string } | string } }; message?: string }
  const d = r?.response?.data
  const raw = d?.error ? (typeof d.error === 'string' ? d.error : d.error.message) : r?.message
  const code = d?.code || ''
  const map: Record<string, string> = {
    FIELD_EXISTS: '字段已存在（core fields 或编排 fieldId 重复），如需调整请走既有编辑面',
    FIELD_NOT_FOUND: '字段不存在（core fields / 编排 fields / 编排 routings 三处需同名登记，可能已被删除或仅存在于一侧）',
    FIELD_SYSTEM_LOCKED: '字段为 systemLocked（平台派生/代码消费）：只读，禁止在本向导修改/删除（需走编排文件）',
    FIELD_CONSUMED: '字段仍被下游消费（其他 agent 路由引用 或 其他 skill 的 core inputs 引用），禁止删除；请先解除下游消费',
    FIELD_NAME_REQUIRED: '字段名校验失败',
    FIELD_NAME_INVALID: '字段名校验失败',
    FIELD_NAME_PLATFORM: '字段名是平台包装字段（success/quality/stage/raw），禁止出现在字段表',
    FIELD_TYPE_REQUIRED: '类型（core 侧）必填',
    FIELD_TYPE_UNKNOWN: '类型不在受控词表',
    FIELD_TYPE_INVALID: '类型非法（? 只能作后缀）',
    VALUE_TYPE_UNMAPPABLE: 'enum 为 core-only，编排侧无对应 valueType：请人工登记编排侧或选用其它类型',
    ROLE_UNKNOWN: '角色不在受控词表',
    RENDER_UNKNOWN: 'render 不在受控词表',
    VISIBILITY_PRESET_UNKNOWN: 'visibilityPreset 不在受控词表',
    LOCKED_UNKNOWN: 'locked 非法（可选 system | structure）',
    FIELD_DESC_REQUIRED: 'desc（生成指令/含义）必填',
    SKILL_NOT_FOUND: 'skills.yaml 无该 skill 登记',
    SKILL_NO_STAGE: '该 skill 无编排阶段归属',
    CORE_FILE_MISSING: '核心文件不存在',
    ORCHESTRATION_FILE_MISSING: '编排文件不存在',
    CORE_FILE_INVALID: '核心文件 schema 不合法',
    ORCHESTRATION_FILE_INVALID: '编排文件解析失败',
    NESTED_ROOT_NOT_OBJECT: '嵌套字段的顶层不是 object',
    HANDOFF_SELF_LOOP: 'handoff 自环（指向自身）',
    HANDOFF_TARGET_UNKNOWN: 'handoff 目标不在 manifest，也不是阶段名',
    RENDER_INTERNAL_CONFLICT: 'render=visible 与 internal=true 组合仅允许 control-signal 字段',
    ROUTING_NO_FLOW: 'handoff 为空且非 public-reply/画像终点，缺少流转去向',
    CORE_VALIDATION_FAILED: '修改后核心文件未通过校验',
    ORCHESTRATION_VALIDATION_FAILED: '修改后编排文件未通过校验',
    FIELDS_SYNC_RECHECK_FAILED: 'fields-sync 复检未通过，已回滚双文件（恢复原内容）',
    ORCHESTRATION_WRITE_FAILED: '编排文件写盘失败，core 已回滚原内容'
  }
  const title = code ? (map[code] || (isEdit.value ? '改字段被拒绝' : '加字段被拒绝')) : (isEdit.value ? '改字段失败' : '加字段失败')
  return raw ? `${title}：${raw}` : title
}

function buildPayload() {
  return {
    type: `${form.value.type}${form.value.optional ? '?' : ''}`,
    role: form.value.role,
    render: form.value.render,
    handoff: handoffList.value,
    internal: form.value.internal,
    accumulate: form.value.accumulate,
    turn: form.value.turn && !isNested.value,
    desc: form.value.desc.trim(),
    ...(form.value.visibilityPreset ? { visibilityPreset: form.value.visibilityPreset } : {}),
    ...(form.value.locked ? { locked: form.value.locked } : {}),
    persistKey: form.value.persistKey.trim(),
    pathInRawOutput: form.value.pathInRawOutput.trim()
  }
}

async function submit() {
  const problems = formProblems.value
  if (problems.length) {
    msg.value = problems.join('；')
    msgErr.value = true
    return
  }
  saving.value = true
  msg.value = ''
  msgErr.value = false
  try {
    if (isEdit.value) {
      const res = await adminPromptWorkbenchApi.updateSkillField(props.skillId, props.fieldName ?? '', buildPayload())
      result.value = (res.data?.data || {}) as SaveResult
      if (result.value.changed === false) {
        toast.info('字段无变化（幂等返回）')
      } else {
        toast.success('字段已更新：core 声明 + 编排路由 + DB 对账已同步')
      }
    } else {
      const payload = { name: form.value.name.trim(), ...buildPayload() }
      const res = await adminPromptWorkbenchApi.addSkillField(props.skillId, payload)
      result.value = (res.data?.data || {}) as SaveResult
      toast.success('新字段已登记路由并同步')
    }
    emit('saved')
  } catch (e: any) {
    msg.value = errText(e)
    msgErr.value = true
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.faw { width: min(760px, 100%); }
.faw__sub { margin: 0; font-size: 12px; color: var(--mk-faint, #71809a); }
.faw__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.faw__field { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--mk-muted, #5b6577); }
.faw__field--full { grid-column: 1 / -1; }
.faw__req { color: var(--mk-red, #dc2626); font-style: normal; }
.faw__hint { font-size: 11px; font-weight: 400; color: var(--mk-faint, #71809a); line-height: 1.45; }
.faw__hint--ok { color: var(--mk-green, #15803d); }
.faw__hint--err { color: var(--mk-red, #dc2626); font-weight: 600; }
.faw__desc { resize: vertical; min-height: 64px; }
.faw__checks { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 4px 0; }
.faw__check { display: inline-flex; gap: 6px; align-items: center; font-size: 12.5px; color: var(--mk-muted, #5b6577); font-weight: 600; cursor: pointer; }
.faw__check input { accent-color: var(--mk-blue, #2c63d0); }
.faw__warn { margin: 0; padding: 6px 10px; border: 1px dashed rgba(180, 83, 9, 0.45); border-radius: 8px; background: var(--mk-amber-bg, #fffbeb); color: var(--mk-amber, #b45309); font-size: 11.5px; font-weight: 600; }
.faw__warn--err { border-color: rgba(220, 38, 38, 0.45); background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.faw__preview { border: 1px solid var(--mk-line, #e6ebf4); border-radius: 10px; overflow: hidden; }
.faw__preview-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 12px; background: #fafbfd; border-bottom: 1px solid var(--mk-line, #e6ebf4); }
.faw__preview-title { font-size: 11.5px; font-weight: 700; color: var(--mk-ink, #1a2a44); }
.faw__preview-meta { font-size: 11px; color: var(--mk-faint, #71809a); }
.faw__preview-code { margin: 0; padding: 12px; background: #0f172a; color: #dbeafe; font-size: 11.5px; line-height: 1.55; overflow: auto; max-height: 240px; }
.faw__msg { margin: 0; padding: 9px 12px; border: 1px solid rgba(44, 99, 208, 0.35); border-radius: 9px; background: #f0f5ff; color: var(--mk-blue, #2c63d0); font-size: 12px; font-weight: 600; line-height: 1.5; white-space: pre-wrap; }
.faw__msg.is-err { border-color: rgba(220, 38, 38, 0.4); background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }
.faw__result { border: 1px solid rgba(21, 128, 61, 0.3); border-radius: 10px; padding: 12px 14px; background: var(--mk-green-bg, #ecfdf5); }
.faw__result-title { color: var(--mk-green, #15803d); font-size: 13.5px; }
.faw__result-list { margin: 8px 0 0; padding: 0 0 0 18px; display: grid; gap: 4px; font-size: 12.5px; color: var(--mk-muted, #5b6577); }
.faw__result-hint { color: var(--mk-faint, #71809a); font-size: 11.5px; }
.faw__result-note { margin: 10px 0 0; font-size: 12px; font-weight: 600; color: var(--mk-ink, #1a2a44); line-height: 1.55; }
.faw__ok { color: var(--mk-green, #15803d); }
.faw__err { color: var(--mk-red, #dc2626); }

@media (max-width: 860px) {
  .faw__grid { grid-template-columns: 1fr; }
}

/* 4K：向导弹窗内容跟随全站节奏（Teleport 覆盖层） */
@media (min-width: 2000px) {
  .faw__preview-code { font-size: 13px; }
  .faw__result-list { font-size: 14px; }
  .faw__result-title { font-size: 15px; }
  .faw__result-note { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .faw__preview-code { font-size: 15.5px; }
  .faw__result-list { font-size: 16.5px; }
  .faw__result-title { font-size: 17.5px; }
  .faw__result-note { font-size: 16px; }
}
@media (min-width: 3600px) {
  .faw__preview-code { font-size: 18px; }
  .faw__result-list { font-size: 19.5px; }
  .faw__result-title { font-size: 20.5px; }
  .faw__result-note { font-size: 18.5px; }
}
</style>
