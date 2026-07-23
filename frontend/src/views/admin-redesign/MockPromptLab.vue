<template>
  <div class="mk-page">
    <!-- 编译器状态条 -->
    <div class="mk-status" :class="compileStatusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ headline }}</strong>
      <span class="mk-status__sep"></span>
      <select v-if="isLive" class="pl-skill mono" v-model="activeSkill" @change="loadSkill">
        <option v-for="s in livePromptSources" :key="s.id" :value="s.id">{{ s.id }}</option>
      </select>
      <span v-else class="mk-status__meta">goal-conversation</span>
      <span class="mk-status__meta mono">ACTIVE v{{ compileInfo.version }}</span>
      <span class="mk-status__meta mono">hash {{ compileInfo.hash }}</span>
      <span class="mk-status__meta">编译 {{ compileInfo.status }}</span>
      <span class="mk-status__meta" :class="{ 'pl-runtime--compiled': compileInfo.usedCompiled }">
        运行时：{{ compileInfo.usedCompiled ? '编译产物' : '源内容' }}
      </span>
      <div class="pl-actions">
        <span v-if="isLive" class="mk-badge mk-badge--muted pl-truth">File-as-Truth 只读 · 修改走 prompts/*.md + Git</span>
        <button type="button" class="mk-status__action mk-status__action--primary" :disabled="compiling || (isLive && !sourceText)" @click="compile">
          <span v-if="compiling"><span class="mk-spinner"></span> 编译中…</span>
          <span v-else>Dry Run（候选编译）</span>
        </button>
      </div>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="pl-grid">
      <!-- Source（DB ACTIVE 源） -->
      <section class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">Source · DB ACTIVE 源</h3>
          <div style="display:flex; gap:10px; align-items:center">
            <span class="mk-card__meta">{{ sourceText.length }} 字符 · 只读</span>
            <button type="button" class="mk-link" @click="copy(sourceText, 'Source')">复制</button>
          </div>
        </div>
        <pre class="pl-pre">{{ sourceText || (isLive ? '该 Skill 还没有 prompt source 文件' : '') }}</pre>
      </section>

      <!-- 产物区：当前编译产物 / Dry Run 候选 / 差异 -->
      <section class="mk-card">
        <div class="mk-card__head">
          <div class="mk-pills">
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': viewMode === 'compiled' }" @click="viewMode = 'compiled'">
              编译产物<span v-if="compileInfo.usedCompiled" class="pl-live-dot" title="运行时使用中"></span>
            </button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': viewMode === 'candidate' }" @click="viewMode = 'candidate'">
              Dry Run 候选
            </button>
            <button type="button" class="mk-pill" :class="{ 'mk-pill--active': viewMode === 'diff' }" @click="viewMode = 'diff'">差异</button>
          </div>
          <button v-if="currentPaneText" type="button" class="mk-link" @click="copy(currentPaneText, '内容')">复制</button>
        </div>

        <pre v-if="viewMode === 'compiled'" class="pl-pre">{{ compileInfo.compiled || '暂无编译产物，执行重编译生成。' }}</pre>
        <pre v-else-if="viewMode === 'candidate'" class="pl-pre">{{ compiledText || '执行 Dry Run 后在此查看候选内容（不写入）。' }}</pre>
        <div v-else class="pl-diff">
          <div
            v-for="(l, i) in diffLines"
            :key="i"
            class="pl-line"
            :class="`pl-line--${l.type}`"
          >
            <span class="pl-line__sign">{{ l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' ' }}</span>
            <span class="pl-line__text">{{ l.text }}</span>
          </div>
          <p v-if="!diffLines.length" class="pl-empty">执行 Dry Run 后在此对比 Source 与候选。</p>
        </div>
      </section>
    </div>

    <!-- 字段契约：可视化编辑（编辑 → 自动编译） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">字段契约 · 可视化编辑</h3>
        <span class="mk-card__meta">
          输入 {{ fields.input.length }} · 输出 {{ fields.output.length }}{{ fieldsDirty ? ' · 草稿（未提交）' : '' }}
          <template v-if="isLive"> · File-as-Truth 只读，编辑仅作起草</template>
        </span>
      </div>
      <div class="pf-grid">
        <div class="pf-table-wrap">
          <div class="pf-table-head">
            <span class="pf-table-title">输入字段</span>
            <button type="button" class="mk-link" @click="addField('input')">+ 添加</button>
          </div>
          <table class="pf-table">
            <thead>
              <tr><th>路径</th><th>类型</th><th>必填</th><th>说明</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(f, i) in fields.input" :key="`in-${i}`">
                <td><input v-model="f.path" class="pf-input mono" placeholder="fieldPath" @input="fieldsDirty = true" /></td>
                <td>
                  <select v-model="f.valueType" class="pf-select" @change="fieldsDirty = true">
                    <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td class="pf-center"><input v-model="f.required" type="checkbox" @change="fieldsDirty = true" /></td>
                <td><input v-model="f.note" class="pf-input" placeholder="字段说明" @input="fieldsDirty = true" /></td>
                <td class="pf-center"><button type="button" class="pf-del" @click="removeField('input', i)">×</button></td>
              </tr>
              <tr v-if="!fields.input.length"><td colspan="5" class="pf-empty">暂无输入字段</td></tr>
            </tbody>
          </table>
        </div>
        <div class="pf-table-wrap">
          <div class="pf-table-head">
            <span class="pf-table-title">输出字段</span>
            <button type="button" class="mk-link" @click="addField('output')">+ 添加</button>
          </div>
          <table class="pf-table">
            <thead>
              <tr><th>路径</th><th>类型</th><th>必填</th><th>说明</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(f, i) in fields.output" :key="`out-${i}`">
                <td><input v-model="f.path" class="pf-input mono" placeholder="fieldPath" @input="fieldsDirty = true" /></td>
                <td>
                  <select v-model="f.valueType" class="pf-select" @change="fieldsDirty = true">
                    <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td class="pf-center"><input v-model="f.required" type="checkbox" @change="fieldsDirty = true" /></td>
                <td><input v-model="f.note" class="pf-input" placeholder="字段说明" @input="fieldsDirty = true" /></td>
                <td class="pf-center"><button type="button" class="pf-del" @click="removeField('output', i)">×</button></td>
              </tr>
              <tr v-if="!fields.output.length"><td colspan="5" class="pf-empty">暂无输出字段</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="fieldsDirty" class="pf-save">
        <span class="pf-save__dot"></span>
        <span>{{ isLive ? '契约有未提交草稿（只读环境下无法写入）' : '字段契约有未保存修改' }}</span>
        <button type="button" class="mk-link" @click="copyFieldsJson">复制契约 JSON</button>
        <button type="button" class="mk-link" :disabled="fieldsSaving" @click="discardFields">放弃</button>
        <button type="button" class="pf-save__primary" :disabled="fieldsSaving" @click="saveFields">
          {{ fieldsSaving ? '提交中…' : isLive ? '尝试保存并编译' : '保存' }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dataSource } from './mockStore'
import { livePromptSources, liveGetPromptSource, liveCompileSource, errMsg } from './mockLive'
import { adminPromptOpsApi, adminSkillsApi } from '@/api/adminApi'

defineProps<{ state: 'normal' }>()

const isLive = computed(() => dataSource.value === 'live')

/* ---------- demo 数据 ---------- */
const DEMO_SOURCE = `## 角色
你是「目标对话」Skill，负责和用户聊清真实场景。

## 输入
{{user_message}}
{{learner_profile}}

## 要求
1. 先共情，再追问一个具体问题
2. 不评判、不催促
3. 每轮最多提 3 个概念`

const DEMO_COMPILED = `## 角色
你是「目标对话」Skill，负责和用户聊清真实场景。

## 输入
用户：周报要花 3 小时，最烦的是汇总销售表
画像：运营岗 / Excel 中级 / 畏难脚本
偏好：先看模板再理解原理

## 要求
1. 先共情，再追问一个具体问题
2. 不评判、不催促、不甩术语
3. 每轮最多提 3 个概念，置信度低于 0.6 要复述
4. 涉及具体表格结构时，主动给出示例列名`

/* ---------- 状态 ---------- */
const sourceText = ref('')
const compiledText = ref('')
const compiling = ref(false)
const viewMode = ref<'compiled' | 'candidate' | 'diff'>('compiled')
const activeSkill = ref('')
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

/* 编译器元信息（对齐生产 PromptReadOnlyPane） */
interface CompileMeta {
  version: string
  hash: string
  status: string
  compiled: string
  usedCompiled: boolean
}
const compileInfo = ref<CompileMeta>({
  version: '3',
  hash: 'a94f2c1e',
  status: '已编译',
  compiled: DEMO_COMPILED,
  usedCompiled: true
})

const headline = computed(() => {
  if (!isLive.value) return '编译器 · 演示'
  if (!compileInfo.value.compiled) return '尚无编译产物'
  return compileInfo.value.usedCompiled ? '编译产物生效中' : '编译产物未启用'
})
const compileStatusTone = computed(() =>
  !isLive.value ? 'mk-status--muted' : compileInfo.value.usedCompiled ? 'mk-status--ok' : 'mk-status--warn'
)

/* 行级 diff */
const diffLines = computed(() => {
  if (!compiledText.value) return [] as { type: string; text: string }[]
  const a = sourceText.value.split('\n')
  const b = compiledText.value.split('\n')
  const out: { type: string; text: string }[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) out.push({ type: 'same', text: x ?? '' })
    else {
      if (x !== undefined) out.push({ type: 'del', text: x })
      if (y !== undefined) out.push({ type: 'add', text: y })
    }
  }
  return out
})

const currentPaneText = computed(() =>
  viewMode.value === 'compiled' ? compileInfo.value.compiled : viewMode.value === 'candidate' ? compiledText.value : ''
)

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${what}已复制到剪贴板`)
  } catch {
    showToast('复制失败，请手动选择文本', 'mk-toast--bad')
  }
}

/* demo 模式 */
function applyDemo() {
  sourceText.value = DEMO_SOURCE
  compiledText.value = DEMO_COMPILED
  compileInfo.value = { version: '3', hash: 'a94f2c1e', status: '已编译', compiled: DEMO_COMPILED, usedCompiled: true }
}

/* live 模式：加载 source + 编译器元信息 */
async function loadSkill() {
  if (!activeSkill.value) return
  sourceText.value = ''
  compiledText.value = ''
  compileInfo.value = { version: '—', hash: '—', status: '加载中…', compiled: '', usedCompiled: false }
  try {
    const agentId = `skill:${activeSkill.value}`
    const [source, compileRes, effectiveRes] = await Promise.all([
      liveGetPromptSource(activeSkill.value).catch(() => ''),
      adminPromptOpsApi.getPromptCompileInfo(agentId).catch(() => null),
      adminSkillsApi.getEffectiveSkillPrompt(activeSkill.value).catch(() => null)
    ])
    sourceText.value = source
    const ci = compileRes?.data?.data ?? compileRes?.data ?? {}
    const ep = effectiveRes?.data?.data ?? effectiveRes?.data ?? {}
    compileInfo.value = {
      version: ci.promptVersion != null ? String(ci.promptVersion) : '—',
      hash: ci.sourceHash ? String(ci.sourceHash).slice(0, 12) : '—',
      status: ci.status || (ci.compiled ? '已编译' : '未编译'),
      compiled: String(ci.compiled || ''),
      usedCompiled: !!ep.prompt?._usedCompiled
    }
    void loadFields()
  } catch (e) {
    showToast(`加载失败：${errMsg(e)}`, 'mk-toast--bad')
  }
}

watch(
  () => [dataSource.value, livePromptSources.value.length] as const,
  () => {
    if (isLive.value) {
      if (!activeSkill.value && livePromptSources.value.length) {
        const preferred = livePromptSources.value.find((s) => s.hasManifest) || livePromptSources.value[0]
        activeSkill.value = preferred.id
      }
      if (activeSkill.value) void loadSkill()
    } else {
      applyDemo()
    }
  },
  { immediate: true }
)

/* ---------- 字段契约可视化编辑（对齐 updatePromptFields + autoCompile） ---------- */
interface FieldRow {
  path: string
  valueType: string
  note: string
  required: boolean
}

const FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array']

const DEMO_FIELDS: { input: FieldRow[]; output: FieldRow[] } = {
  input: [
    { path: 'userInput', valueType: 'string', note: '当前用户输入原文', required: true },
    { path: 'state', valueType: 'object', note: '综合会话状态，含置信度', required: true },
    { path: 'conversationContext', valueType: 'object', note: '对话摘要上下文', required: false },
    { path: 'goal', valueType: 'string', note: '学习目标', required: true },
    { path: 'history', valueType: 'array', note: '历史对话', required: false }
  ],
  output: [
    { path: 'concepts', valueType: 'array', note: '候选学习概念', required: true },
    { path: 'confidence', valueType: 'number', note: '抽取置信度 0-1', required: true }
  ]
}

const fields = ref<{ input: FieldRow[]; output: FieldRow[] }>({
  input: DEMO_FIELDS.input.map((f) => ({ ...f })),
  output: DEMO_FIELDS.output.map((f) => ({ ...f }))
})
const fieldsDirty = ref(false)
const fieldsSaving = ref(false)

function mapField(f: Record<string, unknown>): FieldRow {
  return {
    path: String(f.path || ''),
    valueType: String(f.valueType || 'string'),
    note: String(f.note || ''),
    required: !!f.required
  }
}

async function loadFields() {
  if (!isLive.value || !activeSkill.value) return
  try {
    const res = await adminPromptOpsApi.getPromptFields(`skill:${activeSkill.value}`)
    const d = res.data?.data ?? res.data ?? {}
    fields.value = {
      input: ((d.inputFields as Record<string, unknown>[]) || []).map(mapField),
      output: ((d.outputFields as Record<string, unknown>[]) || []).map(mapField)
    }
    fieldsDirty.value = false
  } catch {
    fields.value = { input: [], output: [] }
  }
}

function addField(kind: 'input' | 'output') {
  fields.value[kind].push({ path: '', valueType: 'string', note: '', required: false })
  fieldsDirty.value = true
}

function removeField(kind: 'input' | 'output', i: number) {
  fields.value[kind].splice(i, 1)
  fieldsDirty.value = true
}

function discardFields() {
  if (isLive.value) void loadFields()
  else fields.value = { input: DEMO_FIELDS.input.map((f) => ({ ...f })), output: DEMO_FIELDS.output.map((f) => ({ ...f })) }
  fieldsDirty.value = false
  showToast('已放弃未保存的修改', 'mk-toast--info')
}

async function saveFields() {
  if (fieldsSaving.value) return
  // 基础校验：路径必填且不重复
  const all = [...fields.value.input, ...fields.value.output]
  const paths = all.map((f) => f.path.trim()).filter(Boolean)
  if (paths.length !== new Set(paths).size) {
    showToast('字段路径有重复，请检查', 'mk-toast--bad')
    return
  }
  if (all.some((f) => !f.path.trim())) {
    showToast('存在空路径的字段，请补全或删除', 'mk-toast--bad')
    return
  }
  fieldsSaving.value = true
  try {
    if (isLive.value) {
      await adminPromptOpsApi.updatePromptFields(`skill:${activeSkill.value}`, {
        inputFields: fields.value.input.map((f) => ({ ...f })),
        outputFields: fields.value.output.map((f) => ({ ...f })),
        autoCompile: true
      })
      await loadSkill()
      fieldsDirty.value = false
      showToast('字段契约已保存并自动编译')
    } else {
      await new Promise((r) => setTimeout(r, 500))
      fieldsDirty.value = false
      showToast('字段契约已保存（演示）')
    }
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { code?: string } } }
    if (err?.response?.status === 409 || err?.response?.data?.code === 'PROMPT_FILE_AS_TRUTH_READ_ONLY') {
      // File-as-Truth：草稿保留，引导走 Git 流程
      showToast('只读环境：Prompt 只能走 prompts/*.md + Git 流程。草稿已保留，可复制 JSON 带走。', 'mk-toast--bad')
    } else {
      showToast(`保存失败：${errMsg(e)}`, 'mk-toast--bad')
    }
  } finally {
    fieldsSaving.value = false
  }
}

function copyFieldsJson() {
  const payload = JSON.stringify({ inputFields: fields.value.input, outputFields: fields.value.output }, null, 2)
  void navigator.clipboard.writeText(payload).then(
    () => showToast('契约 JSON 已复制，可粘贴进 prompts/*.md 走 Git 流程'),
    () => showToast('复制失败', 'mk-toast--bad')
  )
}
/* Dry Run：候选编译（不写） */
async function compile() {
  if (compiling.value) return
  compiling.value = true
  try {
    if (isLive.value) {
      compiledText.value = await liveCompileSource(activeSkill.value)
      showToast('Dry Run 完成（真实编译，未写入）')
    } else {
      await new Promise((r) => setTimeout(r, 900))
      compiledText.value = DEMO_COMPILED
      showToast('Dry Run 完成，未写入文件或数据库')
    }
    viewMode.value = 'candidate'
  } catch (e) {
    showToast(`编译失败：${errMsg(e)}`, 'mk-toast--bad')
  } finally {
    compiling.value = false
  }
}
</script>

<style scoped>
.pl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
.pl-pre {
  margin: 0;
  padding: 14px 16px;
  font: 12px/1.7 'JetBrains Mono', Consolas, monospace;
  color: #263950;
  white-space: pre-wrap;
  max-height: 520px;
  overflow: auto;
}
.pl-diff {
  padding: 8px 0 12px;
  font: 12px/1.7 'JetBrains Mono', Consolas, monospace;
  max-height: 520px;
  overflow: auto;
}
.pl-line {
  display: flex;
  gap: 10px;
  padding: 0 14px 0 8px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #263950;
}
.pl-line__sign { width: 14px; text-align: center; color: var(--mk-faint); user-select: none; flex-shrink: 0; }
.pl-line--add { background: var(--mk-green-bg); }
.pl-line--add .pl-line__sign,
.pl-line--add .pl-line__text { color: var(--mk-green); }
.pl-line--del { background: var(--mk-red-bg); }
.pl-line--del .pl-line__sign,
.pl-line--del .pl-line__text { color: var(--mk-red); }
.pl-empty { padding: 14px 16px; margin: 0; color: var(--mk-faint); font-size: 12px; }
.pl-skill {
  padding: 5px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  font-size: 11.5px;
  color: var(--mk-ink);
}
.pl-actions { margin-left: auto; display: flex; gap: 8px; }
.pl-live-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mk-green);
  margin-left: 5px;
}
.pl-truth { font-size: 10.5px; }
.pl-runtime--compiled { color: var(--mk-green); font-weight: 700; }

/* 字段契约编辑器 */
.pf-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 14px 16px;
}
.pf-table-wrap { display: grid; gap: 8px; align-content: start; }
.pf-table-head { display: flex; align-items: center; justify-content: space-between; }
.pf-table-title { font-size: 12px; font-weight: 700; color: var(--mk-muted); }
.pf-table { width: 100%; border-collapse: collapse; }
.pf-table th {
  text-align: left;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--mk-faint);
  padding: 4px 6px;
  border-bottom: 1px solid var(--mk-line);
}
.pf-table td { padding: 4px 3px; border-bottom: 1px solid #f0f2f5; }
.pf-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  color: var(--mk-ink);
  background: transparent;
}
.pf-input:hover { border-color: var(--mk-line); }
.pf-input:focus { outline: none; border-color: var(--mk-blue); background: #fff; }
.pf-select {
  padding: 5px 6px;
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  background: #fff;
}
.pf-center { text-align: center; }
.pf-del {
  border: 0;
  background: transparent;
  color: var(--mk-faint);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 5px;
}
.pf-del:hover { color: var(--mk-red); background: var(--mk-red-bg); }
.pf-empty { text-align: center; color: var(--mk-faint); font-size: 12px; padding: 12px 0; }
.pf-save {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 14px;
  padding: 9px 12px 9px 14px;
  border-radius: 10px;
  border: 1px solid rgba(52, 120, 246, 0.24);
  background: #f6f9ff;
  font-size: 12.5px;
  font-weight: 600;
}
.pf-save__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-amber); }
.pf-save__primary {
  margin-left: auto;
  padding: 6px 14px;
  border-radius: 999px;
  border: 0;
  background: var(--mk-blue);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.pf-save__primary:disabled { opacity: 0.6; }
.mono { font-family: var(--mk-mono); }
.mk-toast--bad { background: var(--mk-red-bg, #fef2f2); color: var(--mk-red, #dc2626); }

@media (max-width: 900px) {
  .pl-grid { grid-template-columns: 1fr; }
  .pf-grid { grid-template-columns: 1fr; }
}
</style>
