<template>
  <!-- 试跑：输入 + 执行链路 + 输出。
       2026-11-06 整合：「当前生效 Prompt」搬进协议页签的查看态（那边已有全文与查看弹层），
       「最近调用」并入运行时页签（同批日志的列表与 KPI 同窗口，不再两处各取一份）——
       本页只负责「跑一次、看这次的结果」。 -->
  <div class="sdp-pane">
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">试跑</h3>
        <div class="mk-card__head-right">
          <!-- 「填入示例输入」（2026-11-08 用户「让管理员手写冷冰冰的 JSON 太难用了」）：
               骨架值全是类型占位（""/0/false），直接点上跑必然失败。这里按输入契约给一组
               能跑通的示例值，点一下即填好，随后可直接「开始试跑」。 -->
          <button type="button" class="mk-link" :disabled="trialRunning" title="按输入契约填入一组可直接试跑的示例值" @click="fillSampleInput">填入示例输入</button>
          <button type="button" class="mk-link" :disabled="!trialInput.trim() || trialRunning" @click="formatTrialJson">格式化</button>
          <!-- 按钮文案只由「是否真的在跑」决定（2026-11-08 用户截图里的「运行中…」是旧版把
               disabled 误当 isRunning 的写法，本处已按 trialRunning 单一判据）。 -->
          <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="trialRunning" @click="runTrial">
            {{ trialRunning ? '运行中…' : '▶ 开始试跑' }}
          </button>
        </div>
      </div>
      <div class="sdp-trial__body">
        <!-- 试跑输入（JSON 语法高亮覆盖层） -->
        <div class="sdp-codehl sdp-codehl--json">
          <pre class="sdp-codehl__pre mono" aria-hidden="true"><code v-html="trialHighlighted"></code></pre>
          <textarea
            ref="trialTextareaRef"
            v-model="trialInput"
            class="sdp-json mono sdp-codehl__ta"
            rows="7"
            wrap="off"
            spellcheck="false"
            placeholder='{}'
            @input="syncTrialHlScroll()"
            @scroll="syncTrialHlScroll"
          ></textarea>
        </div>
        <!-- 默认载荷是按输入契约生成的骨架（值为类型示例），此前只有空白 JSON，读者不知道该填什么
             （2026-11-02 评审）。这里把契约里的输入字段列出来，并说明骨架各值的来处。 -->
        <p v-if="inputDecls.length" class="sdp-trial__decl">
          输入字段（{{ inputDecls.length }} 项，按输入契约生成骨架，值为类型示例）：
          <code v-for="d in inputDecls" :key="d.name" class="mono">{{ d.name }}{{ d.type ? `: ${d.type}` : '' }}</code>
        </p>
        <p v-else class="sdp-trial__decl">该 Skill 的输入契约没有声明必填输入，可直接在编辑器里写任意 JSON。</p>
        <div v-if="trialResult" class="sdp-trial__meta">
          <span class="mk-badge" :class="trialResult.success ? 'mk-badge--ok' : 'mk-badge--bad'">
            {{ trialResult.success ? '成功' : '失败' }}
          </span>
          <span class="mk-badge mk-badge--muted">耗时 <b class="mono">{{ trialResult.duration ?? '—' }}ms</b></span>
          <span class="mk-badge mk-badge--muted">{{ trialResult.cached ? '缓存' : '实时' }}</span>
          <button type="button" class="mk-link" title="保留已填输入，仅清除本次运行结果" @click="clearTrial">清除结果</button>
        </div>
        <div v-if="trialError" class="mk-alert mk-alert--row" role="alert">
          <span class="mk-alert__msg">{{ trialError }}</span>
        </div>
        <pre v-if="trialOutputText" class="sdp-output mono">{{ trialOutputText }}</pre>
        <!-- 执行链路（原型 renderSkillDetail 2332-2335：OK/ERR pill + 步骤名 + ms）。
             真实试跑只回最终输出，无逐步链路 → 跑过显「仅返回最终输出」，未跑显占位 -->
        <div class="sdp-steps">
          <div class="mk-section__head">
            <h4>执行链路</h4>
            <span class="mk-card__meta">{{ trialSteps.length ? `${trialSteps.length} 步` : '—' }}</span>
          </div>
          <div v-for="(s, i) in trialSteps" :key="`${s.label}-${i}`" class="sdp-step">
            <span class="mk-badge" :class="s.ok ? 'mk-badge--ok' : 'mk-badge--bad'">{{ s.ok ? 'OK' : 'ERR' }}</span>
            <span class="sdp-step__label" :title="s.label">{{ s.label }}</span>
            <span class="mono sdp-step__ms">{{ s.ms != null ? `${s.ms} ms` : '—' }}</span>
          </div>
          <p v-if="!trialSteps.length" class="mk-empty--line" :title="trialResult ? '本次试跑仅返回最终输出' : '尚未试跑'">
            <!-- 2026-11-04 文案口径修复：原句「点「运行预览」后这里显示每一步的耗时。」是教用法式句式，
                 按既定口径只报状态（未运行过、无逐步明细），不教操作。 -->
            {{ trialResult ? '本次试跑仅返回最终输出，暂无逐步明细。' : '尚未运行过，暂无逐步明细。' }}
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 试跑 tab：输入 + 执行链路 + 输出（只负责「跑一次」）。
 * 生效 Prompt 在协议页签的查看态，调用历史在运行时页签（2026-11-06 整合）。
 */
import { computed, ref, watch } from 'vue'
import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark.css'
import { adminPromptWorkbenchApi, adminSkillsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { errText, buildTrialInputFromContract, type TrialInputDecl } from './sdp-shared'

hljs.registerLanguage('json', json)

const props = defineProps<{ skillId: string; refreshTick: number }>()
const emit = defineEmits<{ (e: 'dirty', p: { dirty: boolean; label: string }): void }>()

/* ---------- 试跑 ---------- */
/* 默认载荷由该 Skill 的输入契约（core.yaml inputs）生成，见 loadTrialDefault（#15）：
   此前硬编码 {"input": "用一句话介绍你自己"}，与契约不符的 Skill 点「运行预览」必然失败。 */
const EMPTY_TRIAL_INPUT = '{}'
const trialInput = ref(EMPTY_TRIAL_INPUT)
const trialRunning = ref(false)
const trialResult = ref<{ success?: boolean; duration?: number; cached?: boolean; output?: unknown; data?: unknown } | null>(null)
const trialError = ref('')

const trialOutputText = computed(() => {
  if (!trialResult.value) return ''
  const payload = trialResult.value.output ?? trialResult.value.data ?? trialResult.value
  return typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
})

function formatTrialJson() {
  try {
    trialInput.value = JSON.stringify(JSON.parse(trialInput.value), null, 2)
  } catch (e) {
    toast.error(`JSON 不合法：${errText(e)}`)
  }
}

function clearTrial() {
  trialResult.value = null
  trialError.value = ''
}

/** 填入示例输入（2026-11-08）：优先用该 Skill 最近一次成功真实调用的载荷——
    生产里真吃过的形状，粘进去就能跑；一条都没有时才回落契约骨架（并说明来历）。 */
async function fillSampleInput() {
  const id = props.skillId
  if (!id || trialRunning.value) return
  try {
    const res = await adminSkillsApi.getSampleInput(id)
    if (id !== props.skillId) return
    const sample = (res.data?.data ?? null) as { json?: string; origin?: string; calledAt?: string } | null
    if (sample?.json) {
      trialInput.value = sample.json
      toast.success('已填入最近一次真实调用用过的输入')
      return
    }
    // 无真实调用：回落契约骨架（loadTrialDefault 同一份）
    await loadTrialDefault(id)
    toast.info('该 Skill 暂无成功调用记录，已按输入契约填入骨架，请按其提示补全')
  } catch (e) {
    toast.error(`填入示例输入失败：${errText(e)}`)
  }
}

/** 执行链路（原型 vrow：OK/ERR pill + 步骤名 + ms）：testSkill 只回最终输出 → 多为空态，
    按原型口径防御式读 steps，后端补齐逐步链路后无需改渲染 */
interface TrialStep { label: string; ms?: number; ok: boolean }
const trialSteps = computed<TrialStep[]>(() => {
  const raw = (trialResult.value as Record<string, unknown> | null)?.steps
  if (!Array.isArray(raw)) return []
  return raw
    .map((s): TrialStep => {
      const o = (s || {}) as Record<string, unknown>
      const msRaw = o.ms ?? o.durationMs
      return {
        label: String(o.name ?? o.t ?? o.step ?? o.title ?? ''),
        ms: msRaw == null ? undefined : Number(msRaw),
        ok: o.ok !== false && o.success !== false && o.status !== 'error' && o.error == null
      }
    })
    .filter((s) => !!s.label)
})

async function runTrial() {
  const id = props.skillId
  let payload: unknown
  try {
    payload = JSON.parse(trialInput.value || '{}')
  } catch (e) {
    toast.error(`输入 JSON 不合法：${errText(e)}`)
    return
  }
  if (trialRunning.value) return
  trialRunning.value = true
  trialError.value = ''
  try {
    const res = await adminSkillsApi.testSkill(id, payload)
    if (id !== props.skillId) return
    trialResult.value = res.data?.data ?? res.data ?? null
    // 已运行 → 输入被消费，不算未保存改动（#118）
    trialBase = trialInput.value
    emit('dirty', { dirty: false, label: '试跑输入' })
  } catch (e) {
    if (id !== props.skillId) return
    trialResult.value = null
    trialError.value = `试跑失败：${errText(e)}`
  } finally {
    trialRunning.value = false
  }
}

/* 试跑输入 JSON 高亮覆盖层 */
const trialTextareaRef = ref<HTMLTextAreaElement | null>(null)
function syncTrialHlScroll() {
  const ta = trialTextareaRef.value
  if (!ta) return
  const pre = ta.parentElement?.querySelector('.sdp-codehl__pre') as HTMLElement | null
  if (pre) {
    pre.scrollTop = ta.scrollTop
    pre.scrollLeft = ta.scrollLeft
  }
}
const trialHighlighted = computed(() => {
  if (!trialInput.value) return ''
  try {
    return hljs.highlight(trialInput.value, { language: 'json', ignoreIllegals: true }).value
  } catch {
    return trialInput.value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c)
  }
})

/* 切换 skill / 发布后复位本次结果 */
watch(
  [() => props.skillId, () => props.refreshTick],
  () => {
    trialResult.value = null
    trialError.value = ''
  },
  { immediate: true }
)

/** 该 Skill 输入契约里的必填输入（展示用）：默认载荷就是按它生成的骨架。
 *  2026-11-02 评审「只给一个每字段都是空对象的 JSON，没有字段说明或示例」——
 *  把字段名与类型列在编辑器下方，读者才知道该往哪儿填。 */
const inputDecls = ref<TrialInputDecl[]>([])

/** 按该 Skill 输入契约生成默认载荷（#15）：契约不可读时回落空对象 `{}`，绝不再塞无关的 input 键 */
async function loadTrialDefault(id: string) {
  const res = await adminPromptWorkbenchApi.getCore(id).catch(() => null)
  if (id !== props.skillId) return
  const inputs = (res?.data?.core?.inputs ?? []) as TrialInputDecl[]
  const next = buildTrialInputFromContract(inputs)
  trialInput.value = next
  trialBase = next
  // 骨架里的键就是这些必填输入（buildTrialInputFromContract 只收必填项，可选的不注入）
  inputDecls.value = inputs.filter((i) => i?.name && !String(i.type || '').trim().endsWith('?'))
  emit('dirty', { dirty: false, label: '试跑输入' })
}

/* #118：试跑输入改动上报宿主脏态（此前切 Skill/离开页面会静默丢弃）。
   基线 = 该 Skill 的契约默认载荷；切换 skill 时重新生成并复位。 */
let trialBase = EMPTY_TRIAL_INPUT
function reportTrialDirty() {
  emit('dirty', { dirty: trialInput.value !== trialBase, label: '试跑输入' })
}
watch(trialInput, reportTrialDirty)
watch(() => props.skillId, (id) => { void loadTrialDefault(id) }, { immediate: true })
</script>

<style scoped>
.sdp-pane { display: grid; gap: 14px; align-content: start; }
/* 卡身：与协议 / 工程页签同一档内边距 */
.sdp-trial__body { display: grid; gap: 10px; align-content: start; padding: 12px 16px; }
/* 输入契约字段清单（编辑器下方）：一行小字 + 等宽字段名，避免再开一块表格占版面 */
.sdp-trial__decl { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.9; }
.sdp-trial__decl code { margin-right: 8px; padding: 1px 6px; border-radius: var(--mk-radius-sm); background: var(--mk-surface-2); color: var(--mk-muted); }
.sdp-trial__meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sdp-trial__meta b { color: var(--mk-ink); font-weight: 600; }

.sdp-json {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  resize: vertical;
  background: var(--mk-surface-2);
}
.sdp-json:focus { outline: none; border-color: var(--mk-blue); }

/* 试跑 JSON 覆盖层：高度受控（rows=7 等效），浅色容器与深色高亮层分离 */
.sdp-codehl--json,
.sdp-codehl--json .sdp-codehl__pre,
.sdp-codehl--json .sdp-codehl__ta { min-height: 0; }
.sdp-codehl--json { height: 180px; position: relative; display: flex; flex-direction: column; border-radius: var(--mk-radius-xl); overflow: hidden; }
.sdp-codehl--json .sdp-codehl__pre,
.sdp-codehl--json .sdp-codehl__ta { height: 100%; padding: 10px 12px; font-size: var(--mk-fs-micro); }
.sdp-codehl--json .sdp-codehl__pre {
  position: absolute;
  inset: 0;
  margin: 0;
  overflow: auto;
  scrollbar-width: none;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  white-space: pre;
  pointer-events: none;
}
.sdp-codehl--json .sdp-codehl__pre::-webkit-scrollbar { display: none; }
.sdp-codehl--json .sdp-codehl__ta {
  position: relative;
  z-index: 1;
  background: transparent;
  border: 0;
  border-radius: 0;
  resize: none;
  color: transparent;
  caret-color: var(--mk-code-fg);
}
.sdp-codehl--json .sdp-codehl__ta::placeholder { color: var(--mk-muted); }
.sdp-output {
  margin: 0;
  padding: 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-code-bg, #101826);
  border: 1px solid var(--mk-code-border, #1c2a40);
  color: var(--mk-code-fg, #9db8dc);
  font-size: var(--mk-fs-micro);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}
/* 执行链路（试跑卡内的子区块：分隔线 + 步骤行） */
.sdp-steps { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid var(--mk-line); }
.sdp-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  font-size: var(--mk-fs-micro);
}
.sdp-step__label { color: var(--mk-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sdp-step__ms { color: var(--mk-faint); text-align: right; }

/* 4K：字号跟随壳层放大 */
@media (min-width: 3600px) {
  .sdp-json { font-size: var(--mk-fs-emphasis); padding: 14px 16px; }
  .sdp-codehl--json { height: 240px; }
  .sdp-codehl--json .sdp-codehl__pre,
  .sdp-codehl--json .sdp-codehl__ta { padding: 14px 16px; font-size: var(--mk-fs-emphasis); }
  .sdp-output { font-size: var(--mk-fs-emphasis); padding: 16px; max-height: 420px; }
  .sdp-step { font-size: var(--mk-fs-body); }
}
</style>
