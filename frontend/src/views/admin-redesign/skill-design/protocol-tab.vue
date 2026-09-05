<template>
  <!-- 协议（core YAML · SSOT 编辑与发布） -->
  <div class="sdp-pw">
    <!-- 左：core 编辑器 -->
    <section class="sdp-block">
      <header class="sdp-block__head">
        <h4>核心文件 <code class="mono">prompts/core/{{ skillId }}.yaml</code></h4>
        <span class="sdp-block__meta">
          <span v-if="coreEditorState.dirty" class="mk-badge mk-badge--muted">未保存</span>
          <button type="button" class="mk-link" :disabled="!coreLoaded || coreSaving || coreCompiling" @click="saveAndCompile">
            {{ coreSaving ? '保存中…' : '保存并编译' }}
          </button>
          <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="!coreLoaded || corePublishing || coreEditorState.dirty" :title="coreEditorState.dirty ? '有未保存修改，请先保存' : ''" @click="publishCore(false)">
            {{ corePublishing ? '发布中…' : '发布' }}
          </button>
        </span>
      </header>
      <p class="sdp-pw__hint">
        core YAML 是业务定义的唯一声明源：保存即编译（dry run 出五块产物与门禁），发布后确定性编译为五块 Prompt（<code class="mono">skill.{{ skillId }}.md</code> + 数据库 ACTIVE），运行时立即生效。
      </p>
      <div class="sdp-pw__viewswitch">
        <button
          type="button"
          class="sdp-pw__viewbtn"
          :class="{ 'sdp-pw__viewbtn--active': coreViewMode === 'form' }"
          @click="switchCoreView('form')"
        >表单</button>
        <button
          type="button"
          class="sdp-pw__viewbtn"
          :class="{ 'sdp-pw__viewbtn--active': coreViewMode === 'raw' }"
          @click="switchCoreView('raw')"
        >源码</button>
      </div>
      <div v-if="coreClassification" class="sdp-pw__classify" :class="`sdp-pw__classify--${coreClassification.level}`">
        <strong>编辑分级：{{ coreLevelLabel(coreClassification.level) }}</strong>
        <ul><li v-for="(m, i) in coreClassification.messages" :key="i">{{ m }}</li></ul>
      </div>
      <div v-if="coreDiagnostics.length" class="sdp-pw__diag">
        <div v-for="(dg, i) in coreDiagnostics" :key="i" class="sdp-pw__diag-item">
          <span class="mono">{{ dg.code }}</span>
          <span>{{ dg.message }}</span>
        </div>
      </div>
      <div v-if="coreInputWarnings.length" class="sdp-pw__diag sdp-pw__diag--warn">
        <div v-for="(w, i) in coreInputWarnings" :key="i" class="sdp-pw__diag-item">
          <span class="mono">{{ w.code }}</span>
          <span>{{ w.message }}</span>
        </div>
      </div>

      <!-- 表单视图 -->
      <div v-if="coreViewMode === 'form'" class="sdp-pwform">
        <template v-if="coreForm">
          <!-- 身份 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('identity')">
              <span>身份</span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('identity') }">▾</i>
            </button>
            <div v-show="openFormSections.has('identity')" class="sdp-pwform__cardbody">
            <label class="sdp-pwform__field">
              <span>identity（角色定位）</span>
              <textarea v-model="coreForm.identity" rows="3" class="mk-input" @input="markDirty"></textarea>
            </label>
            <div class="sdp-pwform__field">
              <span>channels（材料池，至少一个）</span>
              <div class="sdp-pwform__checks">
                <label v-for="c in CORE_CHANNELS" :key="c" class="sdp-pwform__check">
                  <input type="checkbox" :checked="coreForm.channels.includes(c)" @change="toggleChannel(c)" />
                  <code class="mono">{{ c }}</code>
                </label>
              </div>
            </div>
            <div class="sdp-pwform__row3">
              <label class="sdp-pwform__check">
                <input v-model="coreForm.stateAdvance" type="checkbox" @change="markDirty" />
                stateAdvance
              </label>
              <label class="sdp-pwform__check">
                <input v-model="coreForm.deltaOutput" type="checkbox" @change="markDirty" />
                deltaOutput
              </label>
              <label class="sdp-pwform__field">
                <span>outputMedia</span>
                <select v-model="coreForm.outputMedia" class="mk-input" @change="markDirty">
                  <option v-for="m in CORE_OUTPUT_MEDIA" :key="m" :value="m">{{ m }}</option>
                </select>
              </label>
            </div>
            </div>
          </section>

          <!-- 输入声明（上游字段引用） -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('inputs')">
              <span>输入声明 <b class="mono">{{ coreForm.inputs.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('inputs') }">▾</i>
            </button>
            <div v-show="openFormSections.has('inputs')" class="sdp-pwform__cardbody">
            <p class="sdp-pwform__note">
              声明本 Skill 消费的输入。ref 前缀 = 来源分类：<code class="mono">skill:xxx.fieldPath</code>（上游 Skill 模型输出）/
              <code class="mono">sandbox:agent.key</code>（编排注入，对照沙盘说明书 <code class="mono">prompts/agent-snapshots.md</code>）/
              <code class="mono">user:path</code>（用户/平台，绿灯）。保存/发布时对账（skill→handoff、sandbox→沙盘注册表、user→通过）。
            </p>
            <div v-for="(input, i) in coreForm.inputs" :key="i" class="sdp-pwform__inputrow">
              <input v-model="input.name" class="mk-input" placeholder="别名 name（可选）" @input="markDirty" />
              <input v-model="input.type" class="mk-input" placeholder="类型 type（可选）" @input="markDirty" />
              <input v-model="input.ref" class="mk-input mono" placeholder="skill:path-planning.milestones | sandbox:path.normalizedInput | user:latestMessage" @input="markDirty" />
              <input v-model="input.desc" class="mk-input" placeholder="用途说明 desc（可选）" @input="markDirty" />
              <button type="button" class="mk-link mk-link--danger" @click="removeInput(i)">删除</button>
            </div>
            <button type="button" class="mk-link" @click="addInput">+ 添加输入声明</button>
            </div>
          </section>

          <!-- 规则 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('rules')">
              <span>执行规则 <b class="mono">{{ coreForm.rules.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('rules') }">▾</i>
            </button>
            <div v-show="openFormSections.has('rules')" class="sdp-pwform__cardbody">
            <div v-for="i in coreForm.rules.length" :key="i - 1" class="sdp-pwform__listitem">
              <span class="sdp-pwform__idx mono">{{ i }}</span>
              <textarea v-model="coreForm.rules[i - 1]" rows="2" class="mk-input" @input="markDirty"></textarea>
              <span class="sdp-pwform__itemops">
                <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.rules, i - 1, -1)">↑</button>
                <button type="button" class="mk-link" :disabled="i === coreForm.rules.length" @click="moveItem(coreForm.rules, i - 1, 1)">↓</button>
                <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.rules, i - 1)">删除</button>
              </span>
            </div>
            <button type="button" class="mk-link" @click="addItem(coreForm.rules)">+ 添加规则</button>
            </div>
          </section>

          <!-- 输出字段（高危：字段冻结守门） -->
          <section class="sdp-pwform__card sdp-pwform__card--danger">
            <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('fields')">
              <span>输出字段 <b class="mono">{{ coreForm.fields.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('fields') }">▾</i>
            </button>
            <div v-show="openFormSections.has('fields')" class="sdp-pwform__cardbody">
            <p class="sdp-pwform__warn">增删字段、改型、改名会触发字段冻结守门。</p>
            <div class="sdp-pwform__fields">
              <div class="sdp-pwform__fieldrow sdp-pwform__fieldrow--head">
                <span>name</span><span>type</span><span>可选</span><span>desc（生成指令）</span><span>turn</span><span></span>
              </div>
              <div v-for="(f, i) in coreForm.fields" :key="i" class="sdp-pwform__fieldrow">
                <input v-model="f.name" class="mk-input mono" placeholder="fieldName" @input="markDirty" />
                <select v-model="f.baseType" class="mk-input" @change="markDirty">
                  <option v-for="t in CORE_FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
                <input v-model="f.optional" type="checkbox" aria-label="可选" @change="markDirty" />
                <input v-model="f.desc" class="mk-input" placeholder="功能描述" @input="markDirty" />
                <input v-model="f.turn" type="checkbox" aria-label="turn（回合输出）" @change="markDirty" />
                <button type="button" class="mk-link mk-link--danger" @click="removeField(i)">删除</button>
              </div>
            </div>
            <button type="button" class="mk-link" @click="addField">+ 添加字段</button>
            </div>
          </section>

          <!-- 约束 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('constraints')">
              <span>自检约束 <b class="mono">{{ coreForm.constraints.length }}</b></span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('constraints') }">▾</i>
            </button>
            <div v-show="openFormSections.has('constraints')" class="sdp-pwform__cardbody">
            <div v-for="i in coreForm.constraints.length" :key="i - 1" class="sdp-pwform__listitem">
              <span class="sdp-pwform__idx mono">-</span>
              <textarea v-model="coreForm.constraints[i - 1]" rows="2" class="mk-input" @input="markDirty"></textarea>
              <span class="sdp-pwform__itemops">
                <button type="button" class="mk-link" :disabled="i === 1" @click="moveItem(coreForm.constraints, i - 1, -1)">↑</button>
                <button type="button" class="mk-link" :disabled="i === coreForm.constraints.length" @click="moveItem(coreForm.constraints, i - 1, 1)">↓</button>
                <button type="button" class="mk-link mk-link--danger" @click="removeItem(coreForm.constraints, i - 1)">删除</button>
              </span>
            </div>
            <button type="button" class="mk-link" @click="addItem(coreForm.constraints)">+ 添加约束</button>
            </div>
          </section>

          <!-- 参数 -->
          <section class="sdp-pwform__card">
            <button type="button" class="sdp-pwform__cardhead" @click="toggleFormSection('params')">
              <span>生成参数</span><i class="sdp-pwform__caret" :class="{ 'is-open': openFormSections.has('params') }">▾</i>
            </button>
            <div v-show="openFormSections.has('params')" class="sdp-pwform__cardbody">
            <div class="sdp-pwform__row3">
              <label class="sdp-pwform__field">
                <span>temperature</span>
                <input v-model.number="coreForm.params.temperature" type="number" step="0.1" min="0" max="2" class="mk-input" @input="markDirty" />
              </label>
              <label class="sdp-pwform__field">
                <span>maxTokens</span>
                <input v-model.number="coreForm.params.maxTokens" type="number" step="100" min="1" class="mk-input" @input="markDirty" />
              </label>
              <label class="sdp-pwform__field">
                <span>failurePolicy</span>
                <select v-model="coreForm.params.failurePolicy" class="mk-input" @change="markDirty">
                  <option v-for="p in CORE_FAILURE_POLICIES" :key="p" :value="p">{{ p }}</option>
                </select>
              </label>
            </div>
            </div>
          </section>
        </template>
        <p v-else class="sdp-none">{{ coreMissing ? '该 Skill 暂无核心文件' : '加载中…' }}</p>
      </div>

      <!-- 源码视图（YAML 语法高亮覆盖层） -->
      <div v-else class="sdp-codehl">
        <pre class="sdp-codehl__pre mono" aria-hidden="true"><code v-html="coreHighlighted"></code></pre>
        <textarea
          ref="coreTextareaRef"
          v-model="coreText"
          class="sdp-pw__textarea mono sdp-codehl__ta"
          spellcheck="false"
          wrap="off"
          :placeholder="coreMissing ? '该 Skill 暂无核心文件（prompts/core/' + skillId + '.yaml）' : '加载中…'"
          :disabled="!coreLoaded"
          @input="markDirty; syncHlScroll()"
          @scroll="syncHlScroll"
        ></textarea>
      </div>
      <div v-if="corePublishResult" class="sdp-pw__publish" :class="`sdp-pw__publish--${corePublishResult.ok ? 'ok' : 'bad'}`">
        <template v-if="corePublishResult.ok">
          已发布：{{ corePublishResult.agentId }} v{{ corePublishResult.version }} · coreHash
          <span class="mono" :title="corePublishResult.coreHash">{{ coreShortHash(corePublishResult.coreHash) }}</span>
        </template>
        <template v-else>{{ corePublishResult.message }}</template>
      </div>
      <div v-if="coreUncertain" class="sdp-pw__uncertain">
        <strong>含义冻结判定不确定</strong>
        <p>{{ coreUncertain.rationale || 'judge 无法确定语义等价性' }}</p>
        <ul><li v-for="(f, i) in coreUncertain.findings || []" :key="i">[{{ f.severity }}] {{ f.aspect }}：{{ f.issue }}</li></ul>
        <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="corePublishing || coreEditorState.dirty" @click="publishCore(true)">
          人工确认无误，强制发布
        </button>
      </div>
      <div v-if="corePublishIssues.length" class="sdp-pw__uncertain">
        <strong>发布被阻断（{{ corePublishIssues.length }} 个问题）</strong>
        <p>{{ corePublishIssues[0].message || '编译/校验未通过，请先处理以下问题' }}</p>
        <ul>
          <li v-for="(f, i) in corePublishIssues" :key="i">
            <template v-if="f.code || f.severity">[{{ f.code || f.severity }}]</template>
            {{ f.message || f.aspect || f.issue }}
          </li>
        </ul>
      </div>
    </section>

    <!-- 右：编译预览（门禁 + 编译产物，双层 tab 压平后直接内嵌） -->
    <section class="sdp-block">
      <header class="sdp-block__head">
        <h4>编译预览</h4>
        <span class="sdp-block__meta">保存后自动编译（dry run，不写入）</span>
      </header>
      <div class="sdp-pw__pane">
        <div v-if="coreGates" class="sdp-pw__gates">
          <div class="sdp-pw__gate" :class="coreGateCls(coreGates.structure?.length === 0)">
            结构合法 {{ coreGates.structure?.length === 0 ? '✓' : `✗ ${coreGates.structure?.length}` }}
          </div>
          <div class="sdp-pw__gate" :class="coreGateCls(coreGates.fieldFreeze?.length === 0)">
            字段冻结 {{ coreGates.fieldFreeze?.length === 0 ? '✓' : `✗ ${coreGates.fieldFreeze?.length}` }}
          </div>
          <div v-if="coreGates.semantic" class="sdp-pw__gate" :class="coreGateCls(coreGates.semanticDecision === 'pass')">
            含义冻结 {{ coreGates.semantic.verdict }}（{{ coreGates.semanticDecision }}）
          </div>
          <div
            v-if="Array.isArray(coreGates.inputHandoff)"
            class="sdp-pw__gate"
            :class="coreGateCls(coreGates.inputHandoff.length === 0)"
          >
            输入对账 {{ coreGates.inputHandoff.length === 0 ? '✓' : `⚠ ${coreGates.inputHandoff.length} 条 advisory` }}
          </div>
          <div v-for="(issue, i) in coreGates.inputHandoff || []" :key="`ih-${i}`" class="sdp-pw__gate-issue">
            [{{ issue.code }}] {{ issue.message }}
          </div>
          <div v-for="(issue, i) in [...(coreGates.structure || []), ...(coreGates.fieldFreeze || [])]" :key="i" class="sdp-pw__gate-issue">
            [{{ issue.code }}] {{ issue.message }}
          </div>
        </div>
        <div v-if="coreCompiledMeta" class="sdp-pw__meta mono">
          coreHash <span :title="coreCompiledMeta.coreHash">{{ coreShortHash(coreCompiledMeta.coreHash) }}</span> · coreVersion {{ coreCompiledMeta.coreVersion }}
        </div>
        <pre class="sdp-pw__pre">{{ coreCompiledPrompt || '点击「保存并编译」查看五块产物（dry run，不写入）。' }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 协议 tab：core YAML（SSOT）编辑 / 编译 / 发布（3 步发布链：保存并编译 → 发布 → 语义不确定强制发布）
 * 版本历史已并入顶层「版本」tab，字段血缘已并入「字段路由」tab（双层 tab 压平）。
 */
import { computed, ref, watch } from 'vue'
import hljs from 'highlight.js/lib/core'
import yaml from 'highlight.js/lib/languages/yaml'
import 'highlight.js/styles/github-dark.css'
import { adminPromptWorkbenchApi } from '@/api/adminApi'
import { askConfirm } from '../useConfirm'
import { toast } from '@/utils/toast'
import { coreEditorState, coreShortHash, errText } from './sdp-shared'

hljs.registerLanguage('yaml', yaml)

const props = defineProps<{ skillId: string; reloadTick: number }>()
const emit = defineEmits<{ (e: 'published'): void }>()

const CORE_CHANNELS = ['dialogue', 'state', 'task', 'evidence', 'learner', 'path'] as const
const CORE_FIELD_TYPES = ['string', 'number', 'boolean', 'enum', 'object', 'object[]', 'string[]'] as const
const CORE_FAILURE_POLICIES = ['retry', 'fallback', 'propagate'] as const
const CORE_OUTPUT_MEDIA = ['json', 'markdown', 'text'] as const

interface CoreFormField {
  name: string
  baseType: string
  optional: boolean
  desc: string
  turn: boolean
}
interface CoreFormState {
  identity: string
  channels: string[]
  stateAdvance: boolean
  deltaOutput: boolean
  outputMedia: string
  inputs: { ref: string; note: string; name?: string; type?: string; desc?: string }[]
  rules: string[]
  constraints: string[]
  examples: string[]
  fields: CoreFormField[]
  params: { temperature: number; maxTokens: number; failurePolicy: string }
}

interface CoreDiagnostic { code: string; message: string }
interface CoreClassification { level: 'safe' | 'restricted' | 'blocked'; messages: string[] }

const coreText = ref('')
const coreLoaded = ref(false)
const coreMissing = ref(false)
const coreSaving = ref(false)
const coreCompiling = ref(false)
const corePublishing = ref(false)

/* 源码视图：YAML 语法高亮覆盖层（高亮层与 textarea 同步滚动） */
const coreTextareaRef = ref<HTMLTextAreaElement | null>(null)
const coreHighlighted = computed(() => {
  if (!coreText.value) return ''
  try {
    return hljs.highlight(coreText.value, { language: 'yaml', ignoreIllegals: true }).value
  } catch {
    return coreText.value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c)
  }
})
function syncHlScroll() {
  const ta = coreTextareaRef.value
  if (!ta) return
  const pre = ta.parentElement?.querySelector('.sdp-codehl__pre') as HTMLElement | null
  if (pre) {
    pre.scrollTop = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
  }
}

const coreDiagnostics = ref<CoreDiagnostic[]>([])
const coreInputWarnings = ref<CoreDiagnostic[]>([])
const coreClassification = ref<CoreClassification | null>(null)
const coreGates = ref<any>(null)
const coreCompiledPrompt = ref('')
const coreCompiledMeta = ref<{ coreHash: string; coreVersion: number } | null>(null)
const corePublishResult = ref<{ ok: boolean; message?: string; agentId?: string; version?: number; coreHash?: string } | null>(null)
const coreUncertain = ref<any>(null)
const corePublishIssues = ref<Array<Record<string, unknown>>>([])
const coreViewMode = ref<'form' | 'raw'>('form')
const coreForm = ref<CoreFormState | null>(null)
let coreRequested = false

function markDirty() {
  coreEditorState.dirty = true
}

/* 协议表单折叠：高频段（身份/输入/输出字段）默认展开，低频段默认收起 */
const openFormSections = ref<Set<string>>(new Set(['identity', 'inputs', 'fields']))
function toggleFormSection(key: string) {
  const next = new Set(openFormSections.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openFormSections.value = next
}

/**
 * 切换表单/源码视图：当前视图有未保存修改时先保存到磁盘，再重拉使两视图同步，
 * 避免「表单改动切到源码后保存覆盖」或反向丢失（保存失败阻止切换）。
 */
async function switchCoreView(mode: 'form' | 'raw') {
  if (mode === coreViewMode.value) return
  if (coreEditorState.dirty && coreLoaded.value) {
    const saved = await saveCore()
    if (!saved) return
  }
  coreViewMode.value = mode
  // raw 视图保存后 coreForm 未回读：统一重拉保持两视图一致
  if (mode === 'form' && coreLoaded.value) {
    coreRequested = false
    await ensureCoreLoaded()
  }
}

/* ---------- 表单视图：CoreFile JSON → 表单状态 ---------- */
function initCoreForm(core: Record<string, unknown> | null) {
  if (!core) {
    coreForm.value = null
    return
  }
  const fields = Array.isArray(core.fields) ? core.fields : []
  const params = (core.params || {}) as Record<string, unknown>
  coreForm.value = {
    identity: String(core.identity || ''),
    channels: Array.isArray(core.channels) ? core.channels.map((c) => String(c)) : [],
    stateAdvance: core.stateAdvance === true,
    deltaOutput: core.deltaOutput === true,
    outputMedia: String(core.outputMedia || 'json'),
    inputs: Array.isArray(core.inputs)
      ? (core.inputs as Array<Record<string, unknown>>).map((item) => ({
          ref: String(item.ref || ''),
          note: String(item.note || ''),
          name: String(item.name || ''),
          type: String(item.type || ''),
          desc: String(item.desc || '')
        }))
      : [],
    rules: Array.isArray(core.rules) ? core.rules.map((r) => String(r)) : [],
    constraints: Array.isArray(core.constraints) ? core.constraints.map((c) => String(c)) : [],
    examples: Array.isArray(core.examples) ? (core.examples as unknown[]).map((e) => String(e)) : [],
    fields: fields.map((f) => {
      const item = f as Record<string, unknown>
      const rawType = String(item.type || 'string')
      return {
        name: String(item.name || ''),
        baseType: rawType.replace(/\?$/, ''),
        optional: rawType.endsWith('?'),
        desc: String(item.desc || ''),
        turn: item.turn === true
      }
    }),
    params: {
      temperature: Number(params.temperature ?? 0.5),
      maxTokens: Number(params.maxTokens ?? 8000),
      failurePolicy: String(params.failurePolicy || 'retry')
    }
  }
}

/** 表单状态 → PUT mode=form 的 core 载荷（type 合成 baseType + ? 后缀） */
function buildCorePayload() {
  const f = coreForm.value
  if (!f) return null
  return {
    identity: f.identity,
    channels: f.channels,
    stateAdvance: f.stateAdvance,
    deltaOutput: f.deltaOutput,
    outputMedia: f.outputMedia,
    inputs: f.inputs.filter((item) => item.ref.trim()).map((item) => ({
      ref: item.ref.trim(),
      ...(item.name?.trim() ? { name: item.name.trim() } : {}),
      ...(item.type?.trim() ? { type: item.type.trim() } : {}),
      ...(item.desc?.trim() ? { desc: item.desc.trim() } : {}),
      ...(item.note.trim() ? { note: item.note.trim() } : {})
    })),
    rules: f.rules,
    constraints: f.constraints,
    ...(f.examples.length ? { examples: f.examples } : {}),
    fields: f.fields.map((item) => ({
      name: item.name,
      type: `${item.baseType}${item.optional ? '?' : ''}`,
      desc: item.desc,
      turn: item.turn
    })),
    params: {
      temperature: f.params.temperature,
      maxTokens: f.params.maxTokens,
      failurePolicy: f.params.failurePolicy
    }
  }
}

function toggleChannel(c: string) {
  const f = coreForm.value
  if (!f) return
  const idx = f.channels.indexOf(c)
  if (idx >= 0) f.channels.splice(idx, 1)
  else f.channels.push(c)
  markDirty()
}

function moveItem(list: string[], i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(j, 0, item)
  markDirty()
}
function addItem(list: string[]) {
  list.push('')
  markDirty()
}
function removeItem(list: string[], i: number) {
  list.splice(i, 1)
  markDirty()
}
function addField() {
  coreForm.value?.fields.push({ name: '', baseType: 'string', optional: false, desc: '', turn: false })
  markDirty()
}
function removeField(i: number) {
  coreForm.value?.fields.splice(i, 1)
  markDirty()
}
function addInput() {
  coreForm.value?.inputs.push({ ref: '', note: '', name: '', type: '', desc: '' })
  markDirty()
}
function removeInput(i: number) {
  coreForm.value?.inputs.splice(i, 1)
  markDirty()
}

const coreGateCls = (ok: boolean) => (ok ? 'sdp-pw__gate--ok' : 'sdp-pw__gate--bad')
function coreLevelLabel(level: string) {
  if (level === 'safe') return '安全（可发布）'
  if (level === 'restricted') return '受限（需开发确认）'
  return '阻断（需开发同步）'
}

async function ensureCoreLoaded() {
  if (coreRequested) return
  coreRequested = true
  const id = props.skillId
  coreDiagnostics.value = []
  try {
    const res = await adminPromptWorkbenchApi.getCore(id)
    if (id !== props.skillId) return
    coreText.value = res.data?.raw || ''
    coreDiagnostics.value = res.data?.diagnostics || []
    initCoreForm((res.data?.core || null) as Record<string, unknown> | null)
    coreLoaded.value = true
    coreMissing.value = false
  } catch (e) {
    if (id !== props.skillId) return
    coreText.value = ''
    coreLoaded.value = false
    coreMissing.value = true
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status !== 404) {
      // 非 404 允许重试；404 视为该 skill 无核心文件，保持锁定
      coreRequested = false
      toast.error(`核心文件读取失败：${errText(e)}`)
    }
  }
}

async function saveCore() {
  if (!coreLoaded.value || coreSaving.value) return
  coreSaving.value = true
  coreClassification.value = null
  coreDiagnostics.value = []
  coreInputWarnings.value = []
  try {
    if (coreViewMode.value === 'form') {
      const payload = buildCorePayload()
      if (!payload) throw new Error('表单未加载')
      const res = await adminPromptWorkbenchApi.saveCoreForm(props.skillId, payload)
      coreClassification.value = res.data?.classification || null
      coreInputWarnings.value = res.data?.inputWarnings || []
      // 回读：raw 源码与表单状态同步到磁盘真值
      coreRequested = false
      await ensureCoreLoaded()
    } else {
      const res = await adminPromptWorkbenchApi.saveCore(props.skillId, coreText.value)
      coreClassification.value = res.data?.classification || null
      coreInputWarnings.value = res.data?.inputWarnings || []
    }
    coreEditorState.dirty = false
    toast.success(`已保存（${coreLevelLabel(coreClassification.value?.level || 'safe')}），状态：待编译发布`)
    return true
  } catch (e) {
    const data = (e as { response?: { data?: { diagnostics?: CoreDiagnostic[]; error?: string } } })?.response?.data
    coreDiagnostics.value = data?.diagnostics || []
    toast.error(data?.error || `保存失败：${errText(e)}`)
    return false
  } finally {
    coreSaving.value = false
  }
}

async function previewCore() {
  if (!coreLoaded.value || coreCompiling.value) return
  coreCompiling.value = true
  coreGates.value = null
  coreCompiledPrompt.value = ''
  coreDiagnostics.value = []
  try {
    // 预览是 dry run：不触发语义 judge（避免误置「含义冻结」不确定态）
    const res = await adminPromptWorkbenchApi.compileCore({ skillId: props.skillId, semanticJudge: false })
    coreGates.value = res.data?.gates || null
    coreCompiledPrompt.value = res.data?.prompt || ''
    coreCompiledMeta.value = { coreHash: res.data?.coreHash, coreVersion: res.data?.coreVersion }
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string; diagnostics?: CoreDiagnostic[] } } })?.response?.data
    // 编译错误落入行内诊断区（可停留查看），toast 仅作补充
    const message = data?.error || errText(e)
    coreDiagnostics.value = data?.diagnostics?.length ? data.diagnostics : [{ code: 'COMPILE_FAILED', message }]
    toast.error(`编译失败：${message}`)
  } finally {
    coreCompiling.value = false
  }
}

/** 发布链第 1 步：保存并编译（合并原「保存并校验」+「编译预览」两个动作，去除中间确认步） */
async function saveAndCompile() {
  if (!coreLoaded.value || coreSaving.value || coreCompiling.value) return
  const saved = await saveCore()
  if (!saved) return
  await previewCore()
}

/** 发布链第 2 步：发布（保留 developerApproval 门禁 + 语义门 409） */
async function publishCore(confirmUncertain: boolean) {
  if (!coreLoaded.value || corePublishing.value) return
  let developerApproval: { reference: string } | undefined
  if (coreClassification.value && coreClassification.value.level !== 'safe') {
    const reference = await askConfirm({
      title: coreClassification.value.level === 'blocked' ? '发布被阻止：需开发确认' : '发布需开发确认',
      message:
        coreClassification.value.level === 'blocked'
          ? '字段删除或类型变更须先完成消费者同步。\n请输入对应开发提交、PR 或变更单引用：'
          : '新增字段须经开发确认消费者接入。\n请输入对应开发提交、PR 或变更单引用：',
      confirmText: '提交并发布',
      danger: coreClassification.value.level === 'blocked',
      input: { label: '开发提交 / PR / 变更单引用', placeholder: '例如 pr#123 或 提交哈希' }
    })
    if (!reference || typeof reference !== 'string') {
      toast.error('未提供开发确认引用，已取消发布')
      return
    }
    developerApproval = { reference }
  }
  corePublishing.value = true
  corePublishResult.value = null
  coreUncertain.value = null
  corePublishIssues.value = []
  try {
    const res = await adminPromptWorkbenchApi.publishCore({
      skillId: props.skillId,
      confirmUncertain: confirmUncertain || undefined,
      developerApproval
    })
    corePublishResult.value = {
      ok: true,
      agentId: res.data?.agentId,
      version: res.data?.version,
      coreHash: res.data?.coreHash
    }
    toast.success(`发布成功：v${res.data?.version}（运行时已生效）`)
    // 发布改 ACTIVE：通知主页面刷新 overview / 版本 / 试跑参照
    emit('published')
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    const data = (e as { response?: { data?: any } })?.response?.data || {}
    if (status === 409 && data?.code === 'SEMANTIC_UNCERTAIN') {
      // 发布链第 3 步：仅语义 judge 不确定（409）提供「强制发布」兜底
      coreUncertain.value = data?.judgement || {}
      toast.warning('含义冻结不确定，需人工确认')
    } else {
      if (data?.classification) coreClassification.value = data.classification
      corePublishResult.value = { ok: false, message: data?.error || `发布失败：${errText(e)}` }
      // 422 issues 只展示问题列表，不提供强制发布入口
      if (data?.issues?.length) {
        corePublishIssues.value = data.issues
      }
      toast.error(data?.error || '发布被阻断')
    }
  } finally {
    corePublishing.value = false
  }
}

/* 切换 skill / 回滚后：复位编辑器并从磁盘重拉 */
watch(
  [() => props.skillId, () => props.reloadTick],
  () => {
    coreRequested = false
    coreLoaded.value = false
    coreMissing.value = false
    coreText.value = ''
    coreEditorState.dirty = false
    coreDiagnostics.value = []
    coreInputWarnings.value = []
    coreClassification.value = null
    coreGates.value = null
    coreCompiledPrompt.value = ''
    coreCompiledMeta.value = null
    corePublishResult.value = null
    coreUncertain.value = null
    corePublishIssues.value = []
    coreViewMode.value = 'form'
    openFormSections.value = new Set(['identity', 'inputs', 'fields'])
    void ensureCoreLoaded()
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- 协议（core 编辑与发布） ---------- */
.sdp-pw {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 18px;
  align-items: start;
}
@media (max-width: 1100px) {
  .sdp-pw { grid-template-columns: 1fr; }
}
.sdp-block {
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: #fff;
  padding: 12px 14px;
  display: grid;
  gap: 10px;
  align-content: start;
}
.sdp-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sdp-block__head h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.sdp-block__meta { display: inline-flex; align-items: center; gap: 10px; font-size: 11px; color: var(--mk-faint); }
.sdp-none { margin: 0; font-size: 12px; color: var(--mk-faint); }
.sdp-pw__hint {
  margin: 0 18px 12px;
  font-size: 12px;
  color: var(--mk-faint);
  line-height: 1.7;
}
.sdp-pw__hint code { font-size: 10.5px; }
.sdp-pw__textarea {
  width: 100%;
  min-height: 46vh;
  resize: vertical;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  background: #fff;
  color: var(--mk-ink);
  outline: none;
  margin: 0 0 12px;
  box-sizing: border-box;
}
.sdp-pw__textarea:focus { border-color: var(--mk-blue); }

/* 源码视图：高亮覆盖层（深色编辑器） */
.sdp-codehl {
  position: relative;
  margin: 0 0 12px;
  min-height: min(46vh, 620px);
  max-height: min(74vh, 620px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mk-code-border, #1c2a40);
  border-radius: 10px;
  background: var(--mk-code-bg, #0d1420);
  overflow: hidden;
}
.sdp-codehl__pre {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 12px;
  overflow: auto;
  scrollbar-width: none;
  background: var(--mk-code-bg, #0d1420);
  color: var(--mk-code-fg, #c9d4e3);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
  pointer-events: none;
}
.sdp-codehl__pre::-webkit-scrollbar { display: none; }
.sdp-codehl__ta {
  position: relative;
  z-index: 1;
  margin: 0;
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: #e8eef5;
  white-space: pre;
  overflow: auto;
  border-color: transparent;
}
.sdp-codehl__ta::placeholder { color: rgba(201, 212, 227, 0.4); }
.sdp-codehl__ta:focus { border-color: transparent; }
.sdp-pw__textarea:disabled { background: #f6f8fc; color: var(--mk-faint); }
.sdp-pw__classify {
  margin: 0 16px 10px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
}
.sdp-pw__classify ul { margin: 6px 0 0; padding-left: 18px; }
.sdp-pw__classify--safe { background: var(--mk-green-bg); }
.sdp-pw__classify--restricted { background: var(--mk-amber-bg); }
.sdp-pw__classify--blocked { background: var(--mk-red-bg); }
.sdp-pw__diag { margin: 0 16px 10px; display: grid; gap: 4px; }
.sdp-pw__diag--warn .sdp-pw__diag-item { color: var(--mk-amber); }
.sdp-pw__diag-item { display: flex; gap: 8px; font-size: 12px; color: var(--mk-red); }
.sdp-pw__diag-item .mono { flex-shrink: 0; }
.sdp-pw__publish {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
}
.sdp-pw__publish--ok { background: var(--mk-green-bg); }
.sdp-pw__publish--bad { background: var(--mk-red-bg); }
.sdp-pw__uncertain {
  margin: 0 16px 12px;
  padding: 12px;
  border-radius: 10px;
  background: var(--mk-amber-bg);
  font-size: 12px;
}
.sdp-pw__uncertain ul { margin: 6px 0 10px; padding-left: 18px; }
.sdp-pw__pane { display: grid; gap: 12px; align-content: start; padding: 0 18px 16px; max-height: 74vh; overflow-y: auto; }
.sdp-pw__gates { display: grid; gap: 6px; }
.sdp-pw__gate { font-size: 12px; padding: 6px 10px; border-radius: 8px; }
.sdp-pw__gate--ok { background: var(--mk-green-bg); }
.sdp-pw__gate--bad { background: var(--mk-red-bg); }
.sdp-pw__gate-issue { font-size: 11px; color: var(--mk-faint); padding-left: 10px; }
.sdp-pw__meta { font-size: 11px; color: var(--mk-faint); }
.sdp-pw__pre {
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: var(--mk-mono);
}

/* ---------- 协议·表单视图 ---------- */
.sdp-pw__viewswitch {
  display: inline-flex;
  gap: 4px;
  background: #eef2fa;
  border-radius: 9px;
  padding: 3px;
  margin: 0 18px 12px;
  width: fit-content;
}
.sdp-pw__viewbtn {
  border: 0;
  background: transparent;
  padding: 5px 14px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.sdp-pw__viewbtn--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1); }
.sdp-pwform {
  display: grid;
  gap: 16px;
  padding: 0 18px 18px;
}
.sdp-pwform__card {
  border: 1px solid var(--mk-line);
  border-radius: 14px;
  padding: 14px 18px;
  display: grid;
  gap: 12px;
  background: #fff;
}
.sdp-pwform__cardhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 2px 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  color: var(--mk-ink);
  text-align: left;
  cursor: pointer;
}
.sdp-pwform__cardhead:hover { color: var(--mk-blue); }
.sdp-pwform__cardhead b { color: var(--mk-faint); font-weight: 600; }
.sdp-pwform__caret {
  font-style: normal;
  color: var(--mk-faint);
  transition: transform 0.15s ease;
}
.sdp-pwform__caret.is-open { transform: rotate(180deg); }
.sdp-pwform__cardbody {
  display: grid;
  gap: 12px;
  padding-top: 2px;
}
.sdp-pwform__card h5 {
  margin: 0;
  font-size: 13px;
  color: var(--mk-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
.sdp-pwform__card h5 b { color: var(--mk-faint); font-weight: 600; }
.sdp-pwform__card--danger { border-color: rgba(180, 83, 9, 0.35); }
.sdp-pwform__warn {
  margin: 0;
  font-size: 12px;
  color: var(--mk-amber);
  line-height: 1.6;
}
.sdp-pwform__note {
  margin: 0;
  font-size: 12px;
  color: var(--mk-faint);
  line-height: 1.6;
}
.sdp-pwform__inputrow {
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) minmax(160px, 1fr) 28px;
  gap: 10px;
  align-items: center;
}
@media (max-width: 860px) {
  .sdp-pwform__inputrow { grid-template-columns: 1fr 28px; }
}
.sdp-pwform__field { display: grid; gap: 6px; }
.sdp-pwform__field > span { font-size: 12px; color: var(--mk-muted); font-weight: 600; }
.sdp-pwform__checks { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.sdp-pwform__check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--mk-ink);
  cursor: pointer;
}
.sdp-pwform__check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.sdp-pwform__row3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  align-items: end;
}
@media (max-width: 860px) {
  .sdp-pwform__row3 { grid-template-columns: 1fr; }
}
.sdp-pwform__listitem {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}
.sdp-pwform__listitem textarea { min-height: 58px; }
.sdp-pwform__idx { color: var(--mk-faint); font-size: 11px; padding-top: 10px; text-align: right; }
.sdp-pwform__itemops { display: flex; gap: 6px; padding-top: 8px; }
.sdp-pwform__fields { display: grid; gap: 8px; }
.sdp-pwform__fieldrow {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 116px 34px minmax(150px, 1.6fr) 34px 52px;
  gap: 10px;
  align-items: center;
  padding: 4px 0;
}
.sdp-pwform__fieldrow--head {
  font-size: 11px;
  color: var(--mk-faint);
  font-weight: 700;
  padding-bottom: 0;
}
.sdp-pwform__fieldrow input[type='checkbox'] { width: 15px; height: 15px; accent-color: var(--mk-blue); justify-self: center; }
.sdp-pwform .mk-input { min-height: 36px; padding: 8px 12px; font-size: 13px; }
.sdp-pwform textarea.mk-input { line-height: 1.65; }
@media (max-width: 860px) {
  .sdp-pwform__fieldrow { grid-template-columns: 1fr 96px 52px; }
  .sdp-pwform__fieldrow--head { display: none; }
}

/* 4K：设计页放宽 + 编辑器字号跟随壳层放大 */
@media (min-width: 2000px) {
  .sdp-pw__textarea,
  .sdp-codehl__pre { font-size: 13.5px; }
  .sdp-pwform .mk-input { font-size: 14px; }
  .sdp-pw__pre { font-size: 13px; }
}
@media (min-width: 2800px) {
  .sdp-pw__textarea,
  .sdp-codehl__pre { font-size: 16px; }
  .sdp-pwform .mk-input { font-size: 16.5px; }
  .sdp-pw__pre { font-size: 15.5px; }
}
@media (min-width: 3600px) {
  .sdp-block { padding: 16px 18px; gap: 12px; }
  .sdp-block__head h4 { font-size: 17.5px; }
  .sdp-block__meta { font-size: 17.5px; }
  .sdp .mk-input { font-size: 19px; padding: 12px 15px; }
  .sdp-pw { grid-template-columns: minmax(0, 1fr) 520px; }
  .sdp-pw__hint { font-size: 18px; }
  .sdp-pw__hint code { font-size: 16.5px; }
  .sdp-pw__textarea,
  .sdp-codehl__pre { font-size: 19px; }
  .sdp-pwform .mk-input { font-size: 19.5px; min-height: 46px; }
  .sdp-pw__pre { font-size: 18px; }
  .sdp-pw__classify { font-size: 18px; }
  .sdp-pw__diag-item { font-size: 18px; }
  .sdp-pw__publish { font-size: 18px; }
  .sdp-pw__uncertain { font-size: 18px; }
  .sdp-pw__gate { font-size: 18px; }
  .sdp-pw__gate-issue { font-size: 17.5px; }
  .sdp-pw__meta { font-size: 17.5px; }
  .sdp-pw__viewbtn { font-size: 18px; padding: 8px 20px; }
  .sdp-pwform__cardhead { font-size: 19px; }
  .sdp-pwform__card h5 { font-size: 19px; }
  .sdp-pwform__warn { font-size: 18px; }
  .sdp-pwform__note { font-size: 18px; }
  .sdp-pwform__field > span { font-size: 18px; }
  .sdp-pwform__check { font-size: 18.5px; }
  .sdp-pwform__fieldrow--head { font-size: 17.5px; }
  .sdp-pwform__idx { font-size: 17px; }
}
</style>
