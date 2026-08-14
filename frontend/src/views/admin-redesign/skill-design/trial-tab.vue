<template>
  <!-- 试跑：试跑 + ACTIVE 参照 + 最近调用（验证闭环） -->
  <div class="sdp-workbench">
    <!-- 左：试跑 -->
    <section class="sdp-block">
      <header class="sdp-block__head">
        <h4>试跑</h4>
        <span class="sdp-block__meta">
          <button type="button" class="mk-link" :disabled="!trialInput.trim()" @click="formatTrialJson">格式化</button>
          <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="trialRunning" @click="runTrial">
            {{ trialRunning ? '运行中…' : '运行预览' }}
          </button>
        </span>
      </header>
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
          placeholder='{"input": "…"}'
          @input="syncTrialHlScroll()"
          @scroll="syncTrialHlScroll"
        ></textarea>
      </div>
      <div v-if="trialResult" class="sdp-trial__meta">
        <span class="mk-badge" :class="trialResult.success ? 'mk-badge--ok' : 'mk-badge--bad'">
          {{ trialResult.success ? '成功' : '失败' }}
        </span>
        <span class="sdp-chip">耗时 <b class="mono">{{ trialResult.duration ?? '—' }}ms</b></span>
        <span class="sdp-chip">{{ trialResult.cached ? '缓存' : '实时' }}</span>
        <button type="button" class="mk-link" @click="clearTrial">清空</button>
      </div>
      <div v-if="trialError" class="sdp-error">{{ trialError }}</div>
      <pre v-if="trialOutputText" class="sdp-output mono">{{ trialOutputText }}</pre>
    </section>

    <!-- 右：ACTIVE Prompt 只读参照 -->
    <section class="sdp-prompt">
      <header class="sdp-block__head">
        <div class="mk-pills">
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': promptView === 'source' }"
            @click="promptView = 'source'"
          >
            源内容
          </button>
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': promptView === 'compiled' }"
            @click="promptView = 'compiled'"
          >
            编译产物
          </button>
        </div>
        <button type="button" class="mk-link" @click="copy(promptView === 'source' ? compileInfo?.source || '' : compileInfo?.compiled || '')">
          复制
        </button>
      </header>
      <div class="sdp-prompt__facts">
        <span>DB ACTIVE <b class="mono">v{{ compileInfo?.promptVersion ?? '—' }}</b></span>
        <span>Hash <code class="mono">{{ shortHash(compileInfo?.sourceHash) }}</code></span>
        <span>{{ compileInfo?.status || '—' }}</span>
        <span class="sdp-prompt__used">{{ effectivePrompt?.prompt?._usedCompiled ? '运行时使用编译产物' : '运行时使用源内容' }}</span>
      </div>
      <p v-if="inspectError" class="sdp-none sdp-bad-text">Prompt 检视加载失败。<button type="button" class="mk-link" @click="loadInspect">重试</button></p>
      <pre class="sdp-prompt__code">{{ (promptView === 'source' ? compileInfo?.source : compileInfo?.compiled) || (inspectError ? '加载失败，请重试' : '暂无内容') }}</pre>
      <p class="sdp-prompt__hint">
        File-as-Truth：正式内容只能修改 <code class="mono">{{ filePath || 'prompts/skill.*.md' }}</code>，经部署同步生效。
      </p>
    </section>
  </div>

  <!-- 最近调用（全宽） -->
  <section class="sdp-block">
    <header class="sdp-block__head">
      <h4>最近调用</h4>
      <span class="sdp-block__meta">重跑：用真实输入复现</span>
    </header>
    <div v-if="recentLogs.length" class="sdp-logs">
      <div
        v-for="log in recentLogs"
        :key="log.id"
        class="sdp-log"
        :class="{ 'is-open': openLogId === log.id }"
      >
        <button type="button" class="sdp-log__main" @click="toggleLogDetail(log)">
          <span class="sdp-log__dot" :class="`is-${log.status}`"></span>
          <span class="sdp-log__time mono">{{ log.time }}</span>
          <span class="sdp-log__dur mono">{{ fmtMs(log.durationMs) }}</span>
          <span class="sdp-log__summary">{{ log.summary }}</span>
        </button>
        <button
          type="button"
          class="sdp-log__rerun"
          :disabled="log.loading || trialRunning"
          @click="rerun(log)"
        >
          {{ log.loading ? '…' : '重跑' }}
        </button>
        <div v-if="openLogId === log.id && log.detail" class="sdp-log__detail">
          <div v-if="log.detail.input" class="sdp-log__io">
            <span>输入</span>
            <pre class="mono">{{ displayCap(log.detail.input) }}</pre>
          </div>
          <div v-if="log.detail.output" class="sdp-log__io">
            <span>输出</span>
            <pre class="mono">{{ log.detail.output }}</pre>
          </div>
          <div v-if="log.detail.error" class="sdp-log__io sdp-log__io--err">
            <span>错误</span>
            <pre class="mono">{{ log.detail.error }}</pre>
          </div>
        </div>
      </div>
    </div>
    <p v-if="recentLogsLoading" class="sdp-none">日志加载中…</p>
    <p v-else-if="recentLogsError" class="sdp-none sdp-bad-text">近 8 条日志加载失败。<button type="button" class="mk-link" @click="loadRecentLogs">重试</button></p>
    <p v-else class="sdp-none">近 8 条日志窗口内无调用。</p>
  </section>
</template>

<script setup lang="ts">
/**
 * 试跑 tab：试跑输入 + ACTIVE Prompt 参照 + 最近调用（真实输入一键重跑）
 */
import { computed, ref, watch } from 'vue'
import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark.css'
import {
  adminAgentsApi,
  adminPromptOpsApi,
  adminSkillsApi
} from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { fmtMs, shortHash, errText } from './sdp-shared'
import { humanizeHttpError } from '../terms'

hljs.registerLanguage('json', json)

const props = defineProps<{ skillId: string; filePath?: string; refreshTick: number }>()
const emit = defineEmits<{ (e: 'failures', n: number): void }>()

/* ---------- Prompt 内容 ---------- */
interface CompileInfo {
  promptVersion?: number | string
  sourceHash?: string
  status?: string
  source?: string
  compiled?: string
}
interface EffectivePrompt {
  prompt?: { _usedCompiled?: boolean; version?: number | string; systemPrompt?: string }
}
const compileInfo = ref<CompileInfo | null>(null)
const effectivePrompt = ref<EffectivePrompt | null>(null)
const promptView = ref<'source' | 'compiled'>('source')
const inspectError = ref(false)

async function loadInspect() {
  const id = props.skillId
  inspectError.value = false
  let ciOk = true
  let epOk = true
  const ci = await adminPromptOpsApi
    .getPromptCompileInfo(`skill:${id}`)
    .catch(() => { ciOk = false; return null })
  const ep = await adminSkillsApi
    .getEffectiveSkillPrompt(id)
    .catch(() => { epOk = false; return null })
  if (id !== props.skillId) return
  inspectError.value = !ciOk || !epOk
  compileInfo.value = ci?.data?.data ?? null
  effectivePrompt.value = ep?.data?.data ?? null
}

/* ---------- 试跑 ---------- */
const trialInput = ref('{\n  "input": "用一句话介绍你自己"\n}')
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
  } catch (e) {
    if (id !== props.skillId) return
    trialResult.value = null
    trialError.value = `试运行失败：${errText(e)}`
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

/* ---------- 最近调用（真实输入一键重跑） ---------- */
interface LogRow {
  id: string
  status: 'ok' | 'err' | 'timeout'
  time: string
  durationMs: number
  summary: string
  loading: boolean
  detail: { input?: string; output?: string; error?: string } | null
}
const recentLogs = ref<LogRow[]>([])
const recentLogsError = ref(false)
const recentLogsLoading = ref(false)
const openLogId = ref('')

function mapLogStatus(s: unknown): LogRow['status'] {
  return s === 'error' ? 'err' : s === 'timeout' ? 'timeout' : 'ok'
}

async function loadRecentLogs() {
  const id = props.skillId
  recentLogsError.value = false
  recentLogsLoading.value = true
  try {
    const res = await adminAgentsApi.getLogs({ agentName: `skill:${id}`, limit: 8, timeRange: 'week' }).catch(() => null)
    if (id !== props.skillId) return
    if (!res) {
      recentLogsError.value = true
      recentLogs.value = []
      return
    }
    const body = res?.data?.data ?? res?.data ?? {}
    const items: Record<string, unknown>[] = Array.isArray(body) ? body : body.items || body.logs || []
    recentLogs.value = items.map((l) => {
      const status = mapLogStatus(l.status)
      const rawErr = String(l.errorMessage || l.error || '')
      // 网关黑话人话（terms.ts 单源）：失败摘要与展开详情同步人话化
      const err = humanizeHttpError(rawErr) || rawErr
      return {
        id: String(l.id),
        status,
        time: timeAgo(String(l.createdAt || '')),
        durationMs: Number(l.durationMs || 0),
        summary: status === 'ok' ? '成功' : err.slice(0, 60) || (status === 'timeout' ? '超时' : '失败'),
        loading: false,
        detail: null
      }
    })
  } finally {
    if (id === props.skillId) recentLogsLoading.value = false
  }
}

/** 拉详情（输入/输出），供展开与重跑共用；input 保留完整原文供重跑，展示时再截断 */
async function ensureLogDetail(log: LogRow): Promise<void> {
  if (log.detail || log.loading) return
  log.loading = true
  try {
    const res = await adminAgentsApi.getLogDetail(log.id)
    const body = res.data?.data ?? res.data ?? {}
    const d = (body.log || body) as Record<string, unknown>
    const raw = (v: unknown): string | undefined => {
      if (v == null) return undefined
      return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    }
    const cap = (v: unknown): string | undefined => {
      if (v == null) return undefined
      const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
      return s.length > 3000 ? `${s.slice(0, 3000)}\n…（截断）` : s
    }
    log.detail = {
      input: raw(d.input ?? d.userPayload ?? d.requestPayload),
      output: cap(d.output ?? d.modelOutput ?? d.responsePayload),
      error: cap(d.errorMessage ?? d.error)
    }
  } catch {
    log.detail = { error: '详情加载失败' }
  } finally {
    log.loading = false
  }
}

async function toggleLogDetail(log: LogRow) {
  if (openLogId.value === log.id) {
    openLogId.value = ''
    return
  }
  openLogId.value = log.id
  await ensureLogDetail(log)
}

/** 一键重跑：真实输入填入试跑并立即运行 */
async function rerun(log: LogRow) {
  await ensureLogDetail(log)
  if (!log.detail?.input) {
    toast.error('该调用没有可用输入')
    return
  }
  trialInput.value = log.detail.input
  toast.info('已填入真实输入，正在重跑…')
  await runTrial()
}

/** 展开详情展示截断（detail 保留完整原文供重跑） */
function displayCap(v?: string) {
  return v && v.length > 3000 ? `${v.slice(0, 3000)}\n…（截断）` : v || ''
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!t || Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d} 天前` : new Date(t).toLocaleDateString('zh-CN')
}

async function copy(content: string) {
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    toast.success('已复制')
  } catch {
    toast.error('复制失败：剪贴板不可用')
  }
}

/* 头部失败计数上报 + 切换 skill / 发布后刷新 */
watch(
  recentLogs,
  (logs) => emit('failures', logs.filter((l) => l.status !== 'ok').length),
  { immediate: true }
)
watch(
  [() => props.skillId, () => props.refreshTick],
  () => {
    trialResult.value = null
    trialError.value = ''
    void Promise.all([loadInspect(), loadRecentLogs()])
  },
  { immediate: true }
)
</script>

<style scoped>
/* ---------- 工作台：左右双栏 ---------- */
.sdp-workbench {
  display: grid;
  grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 1020px) {
  .sdp-workbench { grid-template-columns: 1fr; }
}
.sdp-block, .sdp-prompt {
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
.sdp-bad-text { color: var(--mk-red); font-weight: 700; }

/* Prompt 面板（视图切换已收敛为全局 mk-pills） */
.sdp-prompt__facts {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--mk-faint);
}
.sdp-prompt__facts b { color: var(--mk-ink); }
.sdp-prompt__facts code { font-size: 10.5px; }
.sdp-prompt__used { color: var(--mk-muted); }
.sdp-prompt__code {
  margin: 0;
  height: min(58vh, 620px);
  overflow: auto;
  padding: 12px;
  border-radius: 10px;
  background: #fbfcfe;
  border: 1px solid #eef2f8;
  white-space: pre-wrap;
  word-break: break-word;
  font: 11.5px/1.65 var(--mk-mono);
  color: #263950;
}
.sdp-prompt__hint { margin: 0; font-size: 11px; color: var(--mk-faint); line-height: 1.6; }
.sdp-prompt__hint code { font-size: 10.5px; }

/* 试跑 */
.sdp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-size: 10.5px;
  font-weight: 600;
}
.sdp-chip b { color: var(--mk-ink); font-weight: 600; }
.sdp-json {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #dbe3ef;
  border-radius: 9px;
  font-size: 11px;
  line-height: 1.6;
  resize: vertical;
  background: #fbfcfe;
}
.sdp-json:focus { outline: none; border-color: var(--mk-blue); }

/* 试跑 JSON 覆盖层：高度受控（rows=7 等效），浅色容器与深色高亮层分离 */
.sdp-codehl--json,
.sdp-codehl--json .sdp-codehl__pre,
.sdp-codehl--json .sdp-codehl__ta { min-height: 0; }
.sdp-codehl--json { height: 180px; margin-bottom: 12px; position: relative; display: flex; flex-direction: column; border-radius: 9px; overflow: hidden; }
.sdp-codehl--json .sdp-codehl__pre,
.sdp-codehl--json .sdp-codehl__ta { height: 100%; padding: 10px 12px; font-size: 11px; }
.sdp-codehl--json .sdp-codehl__pre {
  position: absolute;
  inset: 0;
  margin: 0;
  overflow: auto;
  scrollbar-width: none;
  background: #fbfcfe;
  color: #263950;
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
  caret-color: var(--mk-ink);
}
.sdp-trial__meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sdp-output {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--mk-code-bg, #101826);
  border: 1px solid var(--mk-code-border, #1c2a40);
  color: var(--mk-code-fg, #9db8dc);
  font-size: 11px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}
.sdp-error {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mk-red-bg);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: var(--mk-red);
  font-size: 12px;
}

/* 最近调用 */
.sdp-logs { display: grid; gap: 4px; }
.sdp-log {
  display: grid;
  grid-template-columns: 1fr auto;
  border: 1px solid #e6ecf6;
  border-radius: 9px;
  background: #fff;
  overflow: hidden;
}
.sdp-log.is-open { border-color: rgba(44, 99, 208, 0.35); }
.sdp-log__main {
  display: grid;
  grid-template-columns: 8px 64px 46px 1fr;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.sdp-log__main:hover { background: #f8fbff; }
.sdp-log__dot { width: 7px; height: 7px; border-radius: 50%; }
.sdp-log__dot.is-ok { background: var(--mk-green); }
.sdp-log__dot.is-err, .sdp-log__dot.is-timeout { background: var(--mk-red); }
.sdp-log__time { color: var(--mk-faint); font-size: 10px; }
.sdp-log__dur { color: var(--mk-muted); font-size: 10.5px; text-align: right; font-variant-numeric: tabular-nums; }
.sdp-log__summary {
  color: var(--mk-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdp-log__rerun {
  border: 0;
  border-left: 1px solid #eef2f8;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 0 10px;
  cursor: pointer;
}
.sdp-log__rerun:hover { background: #eff6ff; }
.sdp-log__rerun:disabled { color: var(--mk-faint); cursor: not-allowed; }
.sdp-log__detail {
  grid-column: 1 / -1;
  border-top: 1px solid #eef2f8;
  padding: 8px 10px;
  display: grid;
  gap: 8px;
  background: #fbfcfe;
}
.sdp-log__io { display: grid; gap: 3px; }
.sdp-log__io span { font-size: 10px; font-weight: 700; color: var(--mk-faint); letter-spacing: 0.04em; }
.sdp-log__io pre {
  margin: 0;
  padding: 8px 10px;
  border-radius: 7px;
  background: #fff;
  border: 1px solid #eef2f8;
  font-size: 10.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  color: #41516e;
}
.sdp-log__io--err pre { background: #fef5f5; border-color: rgba(220, 38, 38, 0.25); color: var(--mk-red-strong); }

/* 4K：字号跟随壳层放大 */
@media (min-width: 2000px) {
  .sdp-json,
  .sdp-output,
  .sdp-prompt__code { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .sdp-json,
  .sdp-output,
  .sdp-prompt__code { font-size: 16px; }
}
@media (min-width: 3600px) {
  .sdp-block, .sdp-prompt { padding: 16px 18px; gap: 12px; }
  .sdp-block__head h4 { font-size: 17.5px; }
  .sdp-block__meta { font-size: 17.5px; }
  .sdp-chip { font-size: 16.5px; padding: 4px 12px; }
  .sdp-prompt__facts { font-size: 17.5px; gap: 18px; }
  .sdp-prompt__facts code { font-size: 16.5px; }
  .sdp-prompt__code { font-size: 19px; padding: 18px; }
  .sdp-prompt__hint { font-size: 17.5px; }
  .sdp-prompt__hint code { font-size: 16.5px; }
  .sdp-json { font-size: 19px; padding: 14px 16px; }
  .sdp-codehl--json { height: 240px; }
  .sdp-codehl--json .sdp-codehl__pre,
  .sdp-codehl--json .sdp-codehl__ta { padding: 14px 16px; font-size: 19px; }
  .sdp-output { font-size: 19px; padding: 16px; max-height: 420px; }
  .sdp-error { font-size: 18px; padding: 14px 16px; }
  .sdp-log__main { font-size: 18px; padding: 12px 14px; }
  .sdp-log__time { font-size: 16px; }
  .sdp-log__dur { font-size: 16.5px; }
  .sdp-log__rerun { font-size: 17.5px; padding: 0 14px; }
  .sdp-log__io span { font-size: 16px; }
  .sdp-log__io pre { font-size: 16.5px; padding: 12px 14px; }
}
</style>
