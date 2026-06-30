<!--
  SectionedPromptEditor (V4 — v2 分块 + 分权保护)
  ============================================================
  - v2：遍历 schema.blocks 按 8 类块渲染，按耦合度分权：
      prose 块可编辑 textarea；contract/flow 块只读（🔒 受代码保护）。
      块内 wf-* 字段表只读（契约，运营只能看）。
  - archetype 徽章 + code-only 空态。
  - compose() 1:1 复刻后端 composePromptSchema 的 blocks 分支。
  - 老数据/解析失败（schema.blocks 为空）→ 回退 v1 渲染路径。

  父组件传入完整 schema，本组件 emit 修改后的 systemPrompt 文本。
  存储仍是 .md 文件 / DB 字符串，结构在内存里临时拆/拼。
-->
<template>
  <div class="sectioned-editor">
    <!-- Lint 状态 + archetype 徽章 -->
    <div :class="['lint-strip', schema.conformant ? 'lint-strip--ok' : 'lint-strip--warn']">
      <span class="lint-strip__icon">{{ schema.conformant ? '✓' : '⚠' }}</span>
      <span class="lint-strip__title">
        {{ schema.conformant ? 'Prompt 结构合规' : '尚未完全符合统一 schema' }}
      </span>
      <span v-if="archetype" :class="['archetype-badge', 'archetype-badge--' + archetype]">
        {{ archetypeLabel }}
      </span>
      <span class="lint-strip__meta">
        身份 {{ hasIdentity ? '✓' : '×' }} · 规则
        {{ hasRules ? `✓ ${schema.rules.length}` : '×' }} · 输出 {{ hasOutput ? '✓' : '×' }}
      </span>
    </div>
    <ul v-if="schema.warnings.length > 0" class="warning-list">
      <li v-for="w in schema.warnings" :key="w">{{ w }}</li>
    </ul>

    <!-- code-only 空态：纯逻辑 skill，无可编辑话术 -->
    <div v-if="archetype === 'code-only'" class="code-only-empty">
      <span class="code-only-empty__icon">⚙️</span>
      <p class="code-only-empty__text">
        这是纯逻辑 skill（code-only），没有可编辑的 LLM 话术。<br />
        其行为由 <code>skills/&lt;name&gt;/index.ts</code> 代码决定。
      </p>
    </div>

    <!-- ============ v2：按 blocks 分块渲染 ============ -->
    <template v-else-if="useV2">
      <article
        v-for="(blk, idx) in local.blocks"
        :key="blk.section + ':' + blk.order + ':' + idx"
        :class="['block-card', 'block-card--' + blk.section, blockLocked(blk) ? 'block-card--locked' : '']"
      >
        <header class="block-card__head">
          <span class="block-card__tag">{{ blockTitle(blk) }}</span>
          <span v-if="blockLocked(blk)" class="block-card__lock">
            🔒 {{ blockCoupling(blk) === 'flow' ? '受代码保护（状态机）' : '受代码保护（契约）' }}
          </span>
          <span v-else class="block-card__hint">可编辑话术</span>
        </header>

        <!-- 锁定块：只读展示 -->
        <pre v-if="blockLocked(blk)" class="block-card__readonly">{{ blk.body }}</pre>

        <!-- prose 块：可编辑 -->
        <el-input
          v-else
          v-model="blk.body"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 20 }"
          resize="vertical"
          @input="emitChange"
        />

        <!-- 字段表：从 ## 输出规格 / ## 输入说明 的 JSON schema 自动抽取（只读，JSON 即真相源） -->
        <WfFieldTable
          v-if="blk.section === 'output' && (schema.outputFields?.length ?? 0) > 0"
          kind="wf-output"
          :fields="schema.outputFields || []"
        />
        <WfFieldTable
          v-if="blk.section === 'input' && (schema.inputFields?.length ?? 0) > 0"
          kind="wf-input"
          :fields="schema.inputFields || []"
        />

        <!-- 软字段创建入口：仅在 governed stage 的输出块下出现 -->
        <div v-if="blk.section === 'output' && fieldStage" class="soft-field-add">
          <el-button size="small" plain @click="openSoftFieldDialog">+ 添加软字段</el-button>
          <span class="soft-field-add__hint">
            软字段（soft-info / hidden-inference / derived-presentation）写入 field_definitions，systemLocked=false，可编辑。
          </span>
        </div>
      </article>
    </template>

    <!-- ============ v1 回退渲染 ============ -->
    <template v-else>
      <!-- ## 身份定义 -->
      <article class="block-card block-card--identity">
        <header class="block-card__head">
          <span class="block-card__tag">## 身份定义</span>
          <span class="block-card__hint">一句话定位这个 agent / skill 是谁、负责什么</span>
        </header>
        <el-input
          v-model="local.identity"
          type="textarea"
          :rows="3"
          resize="vertical"
          placeholder="例：你是教育标签设计师，负责把学术框架转成用户友好的白话标签。"
          @input="emitChange"
        />
      </article>

      <!-- ## 执行规则 -->
      <article class="block-card block-card--rules">
        <header class="block-card__head">
          <span class="block-card__tag">## 执行规则</span>
          <span class="block-card__hint">
            R-{{ effectivePrefix }}-NN 编号规则项 · 推荐 prefix:
            <code>{{ suggestedRulePrefix }}</code>
          </span>
          <div class="block-card__actions">
            <el-input
              v-model="rulePrefixInput"
              size="small"
              placeholder="prefix"
              style="width: 80px"
              maxlength="6"
              @blur="onRulePrefixChange"
            />
            <el-button size="small" type="primary" @click="addRule">+ 添加规则</el-button>
          </div>
        </header>
        <ul v-if="local.rules.length === 0" class="rules-empty">
          <li>还没有规则。点击右上「+ 添加规则」开始。</li>
          <li>
            规则会自动编号为 <code>R-{{ effectivePrefix }}-01</code>、<code
              >R-{{ effectivePrefix }}-02</code
            >…
          </li>
        </ul>
        <ul v-else class="rules-list">
          <li v-for="(rule, idx) in local.rules" :key="rule.id + ':' + idx" class="rule-item">
            <span class="rule-id">{{ rule.id }}</span>
            <el-input
              v-model="rule.text"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 4 }"
              placeholder="规则正文"
              @input="emitChange"
              @blur="emitChange"
            />
            <div class="rule-actions">
              <el-button size="small" link :disabled="idx === 0" @click="moveRule(idx, -1)"
                >↑</el-button
              >
              <el-button
                size="small"
                link
                :disabled="idx === local.rules.length - 1"
                @click="moveRule(idx, 1)"
                >↓</el-button
              >
              <el-button size="small" link type="danger" @click="removeRule(idx)">×</el-button>
            </div>
          </li>
        </ul>

        <details v-if="hasFreeRulesText" class="rules-extras">
          <summary>
            + 该 prompt 在执行规则段还有 {{ freeRulesText.split('\n').length }} 行非编号文本
            <span class="rules-extras__hint">（建议规整化）</span>
          </summary>
          <pre class="rules-extras__pre">{{ freeRulesText }}</pre>
        </details>
      </article>

      <!-- ## 输出规格 -->
      <article class="block-card block-card--output">
        <header class="block-card__head">
          <span class="block-card__tag">## 输出规格</span>
          <span class="block-card__hint">通常写「只输出 JSON」+ 字段 schema</span>
        </header>
        <el-input
          v-model="local.output"
          type="textarea"
          :rows="8"
          resize="vertical"
          placeholder="例：&#10;只输出 JSON：&#10;&#10;{ &#10;  &quot;displayLabel&quot;: &quot;…&quot;&#10;}"
          @input="emitChange"
        />
      </article>

      <!-- 其他自由 sections -->
      <article
        v-for="(extra, idx) in local.extras"
        :key="extra.heading + ':' + idx"
        class="block-card block-card--extra"
      >
        <header class="block-card__head">
          <span class="block-card__tag block-card__tag--extra">## {{ extra.heading }}</span>
          <span class="block-card__hint">自由扩展段</span>
          <el-button size="small" link type="danger" @click="removeExtra(idx)">删除</el-button>
        </header>
        <el-input
          v-model="extra.heading"
          size="small"
          placeholder="段落标题"
          style="margin-bottom: 6px"
          @input="emitChange"
          @blur="emitChange"
        />
        <el-input
          v-model="extra.body"
          type="textarea"
          :rows="4"
          resize="vertical"
          @input="emitChange"
        />
      </article>

      <div class="add-extra">
        <el-button size="small" @click="addExtra"
          >+ 添加扩展段（如「字段说明」「上下文说明」）</el-button
        >
      </div>
    </template>
    <!-- 添加软字段弹框（放在根 div 末尾，不影响 v-if/v-else 链） -->
    <el-dialog v-model="softDialog.visible" title="添加软字段" width="520px">
      <el-form label-width="96px" size="small">
        <el-form-item label="fieldId" required>
          <el-input v-model="softDialog.fieldId" placeholder="如 understanding.learner_note" />
        </el-form-item>
        <el-form-item label="promptRole" required>
          <el-select v-model="softDialog.promptRole" style="width: 100%">
            <el-option label="soft-info（可选信息）" value="soft-info" />
            <el-option label="hidden-inference（隐藏推断）" value="hidden-inference" />
            <el-option label="derived-presentation（派生展示）" value="derived-presentation" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="softDialog.valueType" placeholder="string / number / boolean / string[] / object" />
        </el-form-item>
        <el-form-item label="语义说明">
          <el-input v-model="softDialog.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="stage">
          <el-input :model-value="fieldStage || ''" disabled />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="softDialog.visible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="softDialog.saving" @click="submitSoftField">
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import WfFieldTable from './WfFieldTable.vue'
import { adminFieldRoutingsApi } from '@/api/adminApi'

// ============ 类型对齐后端 v2（services/prompt-schema/index.ts） ============

type PromptSection =
  | 'identity'
  | 'input'
  | 'rules'
  | 'state_machine'
  | 'output'
  | 'constraints'
  | 'quality'
  | 'examples'
  | 'extras'

type Archetype =
  | 'conversational'
  | 'generator'
  | 'extractor'
  | 'distiller'
  | 'copywriter'
  | 'code-only'

type Coupling = 'prose' | 'contract' | 'flow'

interface PromptRuleItem {
  id: string
  prefix: string
  index: number
  sub?: number
  text: string
  style?: 'legacy' | 'block'
}

interface PromptExtraSection {
  heading: string
  body: string
  order: number
}

interface WfField {
  path: string
  valueType: string | null
  enumValues?: string[]
  coupling?: Coupling
  note: string
}

interface WfBlock {
  kind: 'wf-input' | 'wf-output' | 'wf-state'
  fields: WfField[]
  comments: string[]
  raw: string
}

interface PromptBlock {
  section: PromptSection
  heading: string
  body: string
  rules: PromptRuleItem[]
  wfBlocks: WfBlock[]
  promotedFromH3?: boolean
  order: number
}

interface PromptSchema {
  // ---- v1 兼容字段 ----
  title: string | null
  identity: string
  rulesRaw: string
  rules: PromptRuleItem[]
  output: string
  extras: PromptExtraSection[]
  conformant: boolean
  warnings: string[]
  // ---- v2 新增字段 ----
  archetype?: Archetype | null
  blocks?: PromptBlock[]
  wfBlocks?: WfBlock[]
  outputFields?: WfField[]
  inputFields?: WfField[]
  input?: string
  stateMachine?: string
  constraints?: string
  quality?: string
}

interface Props {
  /** 后端解析好的 schema（来自 GET /admin/prompt-ops/prompt-schema/:agentId） */
  schema: PromptSchema
  /** 推荐的 R prefix */
  suggestedRulePrefix: string
  /** 该 skill 所属 stage（用于软字段写入 field_definitions）；无则不显示添加软字段入口 */
  fieldStage?: string | null
  /** 当前 agentId */
  agentId?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'change', payload: { systemPrompt: string; rules: PromptRuleItem[] }): void
  (e: 'field-created'): void
}>()

// ---- 软字段创建 ----
const softDialog = ref({
  visible: false,
  fieldId: '',
  promptRole: 'soft-info' as 'soft-info' | 'hidden-inference' | 'derived-presentation',
  valueType: 'string',
  description: '',
  saving: false
})

function openSoftFieldDialog() {
  softDialog.value = {
    visible: true,
    fieldId: '',
    promptRole: 'soft-info',
    valueType: 'string',
    description: '',
    saving: false
  }
}

async function submitSoftField() {
  const d = softDialog.value
  if (!d.fieldId.trim()) {
    ElMessage.warning('fieldId 必填')
    return
  }
  if (!props.fieldStage) {
    ElMessage.error('当前 skill 没有 governed stage，无法创建软字段')
    return
  }
  d.saving = true
  try {
    await adminFieldRoutingsApi.createField({
      fieldId: d.fieldId.trim(),
      stage: props.fieldStage,
      promptRole: d.promptRole,
      valueType: d.valueType.trim() || 'string',
      description: d.description.trim() || undefined,
      reason: `admin 在 prompt 编辑器为 ${props.agentId || ''} 创建软字段`
    })
    ElMessage.success('软字段已创建')
    d.visible = false
    emit('field-created')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error?.message || e?.message || '创建失败')
  } finally {
    d.saving = false
  }
}

// 标准标题映射 —— 与后端 STANDARD_HEADINGS 1:1（compose 保真依赖此映射）
const STANDARD_HEADINGS: Record<PromptSection, string> = {
  identity: '身份定义',
  input: '输入说明',
  rules: '执行规则',
  state_machine: '状态机',
  output: '输出规格',
  constraints: '边界约束',
  quality: '质量控制',
  examples: '示例',
  extras: ''
}

// 块类型中文名（卡头展示）
const SECTION_LABELS: Record<PromptSection, string> = {
  identity: '身份定义',
  input: '输入契约',
  rules: '执行规则',
  state_machine: '状态机',
  output: '输出规格',
  constraints: '约束',
  quality: '质量控制',
  examples: '示例',
  extras: '自由段'
}

// ============ 本地可编辑副本 ============

function cloneSchema(s: PromptSchema) {
  return {
    title: s.title,
    identity: s.identity,
    rules: JSON.parse(JSON.stringify(s.rules)) as PromptRuleItem[],
    output: s.output,
    extras: JSON.parse(JSON.stringify(s.extras)) as PromptExtraSection[],
    // blocks 深拷贝 —— 用户只编辑 prose 块 body，contract/flow 块 body 原样写回
    blocks: JSON.parse(JSON.stringify(s.blocks || [])) as PromptBlock[]
  }
}

const local = ref(cloneSchema(props.schema))

// v2 切换：有 blocks 走分块渲染，否则回退 v1
const useV2 = computed(() => (props.schema.blocks?.length ?? 0) > 0)

// archetype（顶部徽章 / code-only 空态）
const archetype = computed<Archetype | null>(() => props.schema.archetype ?? null)
const archetypeLabel = computed(() => {
  const map: Record<Archetype, string> = {
    conversational: '对话型',
    generator: '生成型',
    extractor: '抽取型',
    distiller: '蒸馏型',
    copywriter: '文案型',
    'code-only': '纯逻辑'
  }
  return archetype.value ? map[archetype.value] : ''
})

// ============ 块级耦合度推断（前端 heuristic） ============
// 后端只在 wf-field 行给 coupling，块级没有；这里按 section 语义推断：
//   - state_machine / promotedFromH3 → flow：状态机/阶段流转留代码，运营改了会破坏流程
//   - constraints → contract：约束是硬边界，等同契约，不许运营随手放宽
//   - output：整体可编辑（prose），但若含 wfBlocks，wf 字段表只读（见模板）
//   - 其余（identity / examples / extras / 普通 rules / 普通 output）→ prose 可编辑
function blockCoupling(block: PromptBlock): Coupling {
  if (block.promotedFromH3 || block.section === 'state_machine') return 'flow'
  if (block.section === 'constraints') return 'contract'
  return 'prose'
}

// prose=可编辑，contract/flow=只读锁定
function blockLocked(block: PromptBlock): boolean {
  return blockCoupling(block) !== 'prose'
}

// 卡头标题：块类型中文名（promoted 的状态机额外标注）
function blockTitle(block: PromptBlock): string {
  const label = SECTION_LABELS[block.section] || block.section
  if (block.promotedFromH3) return `${label}（阶段子段）`
  return label
}

// ============ v1 回退路径用的计算/方法 ============

const rulePrefixInput = ref(local.value.rules[0]?.prefix || props.suggestedRulePrefix || 'R')

const effectivePrefix = computed(() => {
  return (rulePrefixInput.value || props.suggestedRulePrefix || 'R').toUpperCase()
})

const hasIdentity = computed(() => local.value.identity.trim().length > 0)
const hasRules = computed(() => local.value.rules.length > 0)
const hasOutput = computed(() => local.value.output.trim().length > 0)

const freeRulesText = computed(() => {
  const raw = props.schema.rulesRaw || ''
  const lines = raw.split('\n').filter((line) => {
    return !/^\s*R-[A-Z]+-\d+\s*[:：]/.test(line) && line.trim().length > 0
  })
  return lines.join('\n').trim()
})

const hasFreeRulesText = computed(() => freeRulesText.value.length > 0)

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function nextRuleIndex(prefix: string): number {
  const max = local.value.rules
    .filter((r) => r.prefix === prefix)
    .reduce((m, r) => Math.max(m, r.index), 0)
  return max + 1
}

function addRule() {
  const prefix = effectivePrefix.value
  const idx = nextRuleIndex(prefix)
  local.value.rules.push({
    id: `R-${prefix}-${pad2(idx)}`,
    prefix,
    index: idx,
    text: ''
  })
  emitChange()
}

function removeRule(idx: number) {
  local.value.rules.splice(idx, 1)
  renumberRules()
  emitChange()
}

function moveRule(idx: number, dir: -1 | 1) {
  const target = idx + dir
  if (target < 0 || target >= local.value.rules.length) return
  const [item] = local.value.rules.splice(idx, 1)
  local.value.rules.splice(target, 0, item)
  renumberRules()
  emitChange()
}

function renumberRules() {
  const counters: Record<string, number> = {}
  for (const r of local.value.rules) {
    counters[r.prefix] = (counters[r.prefix] || 0) + 1
    r.index = counters[r.prefix]
    r.id = `R-${r.prefix}-${pad2(r.index)}`
  }
}

function onRulePrefixChange() {
  const next = (rulePrefixInput.value || '').toUpperCase().trim()
  if (!next) {
    rulePrefixInput.value = effectivePrefix.value
    return
  }
  for (const r of local.value.rules) {
    r.prefix = next
  }
  renumberRules()
  rulePrefixInput.value = next
  emitChange()
}

function addExtra() {
  local.value.extras.push({
    heading: '上下文说明',
    body: '',
    order: local.value.extras.length + 100
  })
  emitChange()
}

function removeExtra(idx: number) {
  local.value.extras.splice(idx, 1)
  emitChange()
}

// ============ compose：1:1 复刻后端 composePromptSchema ============

// v2 分支：基于 local.blocks 按 order 还原（保真往返）
// 只有 prose 块 body 被用户编辑；contract/flow 块 body 保持原样写回。
function composeV2(): string {
  const parts: string[] = []
  if (local.value.title) {
    parts.push(`# ${local.value.title}`)
    parts.push('')
  }
  const ordered = [...local.value.blocks].sort((a, b) => a.order - b.order)
  for (const b of ordered) {
    // promoted state_machine 的 body 已含 ### 标题，还原时不重复加 ## 标题
    if (b.promotedFromH3) {
      if (b.body.trim()) {
        parts.push(b.body.trim())
        parts.push('')
      }
      continue
    }
    const heading = b.section === 'extras' ? b.heading : STANDARD_HEADINGS[b.section] || b.heading
    parts.push(`## ${heading}`)
    parts.push('')
    if (b.body.trim()) {
      parts.push(b.body.trim())
      parts.push('')
    }
  }
  return parts.join('\n').trim() + '\n'
}

// v1 分支：老数据回退（与原实现一致）
function composeV1(): string {
  const parts: string[] = []
  if (local.value.title) {
    parts.push(`# ${local.value.title}`)
    parts.push('')
  }
  if (local.value.identity.trim()) {
    parts.push('## 身份定义')
    parts.push('')
    parts.push(local.value.identity.trim())
    parts.push('')
  }
  if (local.value.rules.length > 0) {
    parts.push('## 执行规则')
    parts.push('')
    const sorted = [...local.value.rules].sort((a, b) => {
      if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix)
      return a.index - b.index
    })
    for (const r of sorted) {
      parts.push(`${r.id}: ${r.text}`)
    }
    parts.push('')
  } else if (props.schema.rulesRaw) {
    parts.push('## 执行规则')
    parts.push('')
    parts.push(props.schema.rulesRaw.trim())
    parts.push('')
  }
  if (local.value.output.trim()) {
    parts.push('## 输出规格')
    parts.push('')
    parts.push(local.value.output.trim())
    parts.push('')
  }
  for (const e of [...local.value.extras].sort((a, b) => a.order - b.order)) {
    parts.push(`## ${e.heading}`)
    parts.push('')
    parts.push((e.body || '').trim())
    parts.push('')
  }
  return parts.join('\n').trim() + '\n'
}

function compose(): string {
  return useV2.value ? composeV2() : composeV1()
}

// 聚合 rules：v2 从各块 rules 汇总，v1 用 local.rules
function collectRules(): PromptRuleItem[] {
  if (useV2.value) {
    return local.value.blocks.flatMap((b) => b.rules || [])
  }
  return local.value.rules
}

function emitChange() {
  emit('change', {
    systemPrompt: compose(),
    rules: collectRules()
  })
}

watch(
  () => props.schema,
  (next) => {
    local.value = cloneSchema(next)
    rulePrefixInput.value = next.rules[0]?.prefix || props.suggestedRulePrefix || 'R'
  },
  { deep: true }
)
</script>

<style scoped>
.sectioned-editor {
  display: grid;
  gap: 12px;
  width: 100%;
  min-width: 0;
}

.lint-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}

.lint-strip--ok {
  background: rgba(22, 163, 74, 0.08);
  color: #15803d;
}

.lint-strip--warn {
  background: rgba(245, 158, 11, 0.08);
  color: #b45309;
}

.lint-strip__icon {
  font-weight: 800;
  font-size: 16px;
}

.lint-strip__title {
  font-weight: 700;
}

.lint-strip__meta {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  margin-left: auto;
}

.archetype-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 10px;
  background: #eef2ff;
  color: #4338ca;
}

.archetype-badge--code-only {
  background: #f1f5f9;
  color: #475569;
}

.archetype-badge--generator {
  background: #ecfdf5;
  color: #047857;
}

.archetype-badge--extractor {
  background: #fef3c7;
  color: #b45309;
}

.warning-list {
  margin: 0;
  padding: 6px 12px 6px 28px;
  list-style: disc;
  background: #fff7ed;
  border-radius: 6px;
  font-size: 11.5px;
  color: #9a3412;
  line-height: 1.7;
}

.code-only-empty {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px 20px;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
}

.code-only-empty__icon {
  font-size: 28px;
}

.code-only-empty__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: #475569;
}

.code-only-empty__text code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.95em;
  background: white;
  border: 1px solid #e2e8f0;
  padding: 1px 5px;
  border-radius: 3px;
  color: #6d28d9;
}

.block-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: white;
  padding: 12px 14px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border-left: 3px solid #94a3b8;
}

.block-card--identity {
  border-left-color: #3478f6;
}

.block-card--rules {
  border-left-color: #8b5cf6;
}

.block-card--input {
  border-left-color: #0ea5e9;
}

.block-card--output {
  border-left-color: #16a34a;
}

.block-card--quality {
  border-left-color: #14b8a6;
}

.block-card--examples {
  border-left-color: #f59e0b;
}

.block-card--extra,
.block-card--extras {
  border-left-color: #94a3b8;
}

/* 锁定块：状态机 / 约束 受代码保护 */
.block-card--state_machine,
.block-card--constraints,
.block-card--locked {
  border-left-color: #dc2626;
  background: #fef9f9;
}

.block-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.block-card__tag {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  color: #1a2a44;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 4px;
}

.block-card__tag--extra {
  background: #f8fafc;
  color: #64748b;
  font-weight: 700;
}

.block-card__hint {
  font-size: 11px;
  color: #94a3b8;
  flex: 1;
}

.block-card__hint code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.95em;
  background: rgba(139, 92, 246, 0.08);
  color: #6d28d9;
  padding: 1px 5px;
  border-radius: 3px;
}

.block-card__lock {
  font-size: 11px;
  font-weight: 700;
  color: #dc2626;
  margin-left: auto;
}

.block-card__readonly {
  margin: 0;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: #475569;
  max-height: 360px;
  overflow: auto;
}

.block-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rules-empty {
  margin: 0;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: 6px;
  list-style: disc;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.7;
}

.rules-empty code {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 0.95em;
  background: white;
  border: 1px solid #e2e8f0;
  padding: 1px 5px;
  border-radius: 3px;
  color: #475569;
}

.rules-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.rule-item {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 10px;
  align-items: start;
  padding: 8px 10px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px solid #f1f5f9;
}

.rule-id {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11.5px;
  font-weight: 700;
  color: #6d28d9;
  background: rgba(139, 92, 246, 0.08);
  padding: 4px 8px;
  border-radius: 4px;
  text-align: center;
  white-space: nowrap;
}

.rule-actions {
  display: flex;
  gap: 2px;
}

.rules-extras {
  margin-top: 10px;
  padding: 8px 12px;
  background: #fff7ed;
  border-radius: 6px;
  font-size: 11.5px;
}

.rules-extras summary {
  cursor: pointer;
  color: #9a3412;
  font-weight: 600;
}

.rules-extras__hint {
  color: #b45309;
  font-weight: 400;
  font-size: 11px;
}

.rules-extras__pre {
  margin: 6px 0 0;
  padding: 8px;
  background: white;
  border-radius: 4px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: #475569;
  max-height: 160px;
  overflow: auto;
}

.add-extra {
  display: flex;
  justify-content: center;
  padding: 4px 0;
}

.soft-field-add {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.soft-field-add__hint {
  font-size: 11px;
  color: #94a3b8;
}
</style>
