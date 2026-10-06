<template>
  <!-- 导入卡二级页（2026-10-06 抽屉退役：导入从 mk-drawer 迁标准二级页 ?view=card-import）。
       表单/拖拽/校验/导入报告逻辑自卡库页原样随迁；导入成功后卡墙在返回时重挂载自动刷新。 -->
  <div class="mk-page">
    <MkDetailHero avatar="＋" title="导入卡文档" sub="YAML / JSON 的 { cards: [...] }；一张卡 = 一个虚拟学习者账号 + 档案 + 故事池">
      <template #actions>
        <button type="button" class="mk-btn" @click="closeSubPage()">返回卡墙</button>
      </template>
    </MkDetailHero>

    <section class="mk-card">
      <div class="ci-body">
        <input ref="fileRef" type="file" accept=".yaml,.yml,.json" class="ci-file" @change="onFileChange" />
        <div
          class="ci-drop"
          :class="{ 'is-drag': isDragOver }"
          role="button"
          tabindex="0"
          @click="triggerPick"
          @keydown.enter.prevent="triggerPick"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent="onDragOver"
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
        >
          <span class="ci-drop__title">{{ isDragOver ? '松开导入卡文档' : (fileName || '拖入或点击选择 .yaml / .json 卡文档') }}</span>
          <span class="ci-drop__hint">{{ isDragOver ? '松开后将读取并填入下方文本框' : '也可以直接粘贴到下方文本框' }}</span>
        </div>
        <textarea
          v-model="rawText"
          class="mk-field__textarea ci-text"
          rows="12"
          spellcheck="false"
          placeholder="cards:&#10;  - cardKey: gaozhong-math-01&#10;    nickname: 想补函数的高一学生&#10;    persona:&#10;      nameHint: 高一学生&#10;      background: …&#10;    story:&#10;      visibleOpening: …&#10;      followUps: [ … ]&#10;    source:&#10;      kind: web   # 或 synthetic&#10;      ref: https://…"
          @input="resetReports"
        ></textarea>
        <div class="ci-opts">
          <label class="ci-check">
            <input v-model="enrich" type="checkbox" />
            <span>导入时富化（调用 persona-designer 逐卡生成完整认知人设，较慢）</span>
          </label>
          <label class="ci-check">
            <input v-model="update" type="checkbox" />
            <span>覆盖已存在的同 cardKey 卡（默认跳过）</span>
          </label>
        </div>
        <div class="ci-actions">
          <button type="button" class="mk-btn" :disabled="!hasText || validating || importing" @click="doValidate">
            {{ validating ? '校验中…' : '校验' }}
          </button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="!canImport || importing || validating" @click="doImport">
            {{ importing ? '导入中…' : '导入' }}
          </button>
          <span class="ci-format">识别格式：{{ formatHint }}</span>
          <span v-if="imported" class="mk-link ci-back" role="button" tabindex="0" @click="closeSubPage()">导入完成 · 返回卡墙 →</span>
        </div>
      </div>
    </section>

    <section v-if="report" class="mk-card">
      <div class="mk-card__head">
        <div>
          <h3 class="mk-card__title">校验结果</h3>
          <span class="mk-card__meta">
            共 {{ report.summary.total }} · 可导入 {{ report.summary.ok }} · 已存在 {{ report.summary.exists }} ·
            <span :class="{ 'ci-bad': report.summary.error > 0 }">错误 {{ report.summary.error }}</span>
          </span>
        </div>
      </div>
      <div class="mk-table-scroll">
        <table class="mk-table">
          <thead>
            <tr><th>卡 Key</th><th>状态</th><th>问题</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in report.reports" :key="(r.cardKey || 'row') + i">
              <td><span class="ci-key">{{ r.cardKey || '（无 cardKey）' }}</span></td>
              <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusText(r.status) }}</span></td>
              <td>
                <div class="ci-issues">
                  <span v-for="(e, ei) in r.errors" :key="'e' + ei" class="ci-issue ci-issue--err">{{ e }}</span>
                  <span v-for="(w, wi) in r.warnings" :key="'w' + wi" class="ci-issue ci-issue--warn">{{ w }}</span>
                  <span v-if="!r.errors.length && !r.warnings.length" class="ci-issue ci-issue--ok">通过</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="importResult" class="mk-card">
      <div class="mk-card__head">
        <div>
          <h3 class="mk-card__title">导入结果</h3>
          <span class="mk-card__meta">
            新建 {{ importResult.summary.created }} · 覆盖 {{ importResult.summary.updated }} ·
            跳过 {{ importResult.summary.skipped }} ·
            <span :class="{ 'ci-bad': importResult.summary.failed > 0 }">失败 {{ importResult.summary.failed }}</span>
          </span>
        </div>
      </div>
      <div class="mk-table-scroll">
        <table class="mk-table">
          <thead>
            <tr><th>卡 Key</th><th>动作</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in importResult.results" :key="(r.cardKey || 'row') + i">
              <td><span class="ci-key">{{ r.cardKey || '（无 cardKey）' }}</span></td>
              <td><span class="mk-badge" :class="actionBadge(r.action)">{{ actionText(r.action) }}</span></td>
              <td><span class="ci-reason" :title="r.reason || ''">{{ r.reason || '—' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import { closeSubPage } from './store'
import { errMsg } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

type CardFormat = 'yaml' | 'json'
type CardStatus = 'ok' | 'error' | 'exists' | 'warn'
type CardAction = 'created' | 'updated' | 'skipped' | 'failed'

interface CardIssueReport {
  cardKey: string | null
  status: CardStatus
  errors: string[]
  warnings: string[]
  existingProfileId?: string
}

interface ValidatePayload {
  reports: CardIssueReport[]
  summary: { total: number; ok: number; exists: number; error: number }
}

interface ImportPayload {
  results: Array<{ cardKey: string | null; action: CardAction; reason?: string }>
  summary: { total: number; created: number; updated: number; skipped: number; failed: number }
}

const fileRef = ref<HTMLInputElement | null>(null)
const rawText = ref('')
const fileName = ref('')
const fileFormat = ref<CardFormat | null>(null)
const enrich = ref(false)
const update = ref(false)
const validating = ref(false)
const importing = ref(false)
const report = ref<ValidatePayload | null>(null)
const importResult = ref<ImportPayload | null>(null)
/** 已成功导入过（本次会话）：给「返回卡墙」一个显式引导 */
const imported = ref(false)

const hasText = computed(() => rawText.value.trim().length > 0)

/** 格式识别：文件名后缀优先，其次按内容形态（YAML 是 JSON 超集，默认 yaml 也能吃 JSON） */
const formatHint = computed<CardFormat>(() => {
  if (fileFormat.value) return fileFormat.value
  const t = rawText.value.trim()
  return t.startsWith('{') || t.startsWith('[') ? 'json' : 'yaml'
})

const canImport = computed(() => {
  if (!hasText.value) return false
  if (report.value) return report.value.summary.ok + report.value.summary.exists > 0
  return true
})

function statusText(s: CardStatus): string {
  return { ok: '可导入', warn: '可导入·有告警', exists: '已存在', error: '不可导入' }[s]
}
function statusBadge(s: CardStatus): string {
  return { ok: 'mk-badge--ok', warn: 'mk-badge--warn', exists: 'mk-badge--muted', error: 'mk-badge--bad' }[s]
}
function actionText(a: CardAction): string {
  return { created: '新建', updated: '覆盖', skipped: '跳过', failed: '失败' }[a]
}
function actionBadge(a: CardAction): string {
  return { created: 'mk-badge--ok', updated: 'mk-badge--info', skipped: 'mk-badge--muted', failed: 'mk-badge--bad' }[a]
}

function resetReports() {
  report.value = null
  importResult.value = null
}

function triggerPick() {
  fileRef.value?.click()
}

function readFile(file: File) {
  fileName.value = file.name
  fileFormat.value = /\.json$/i.test(file.name) ? 'json' : 'yaml'
  const reader = new FileReader()
  reader.onload = () => {
    rawText.value = String(reader.result || '')
    resetReports()
  }
  reader.onerror = () => toast.error('读取文件失败')
  reader.readAsText(file)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  input.value = ''
}

/* 拖拽文件悬停高亮（EG12 判例）：深度计数切状态类 */
const isDragOver = ref(false)
let dragDepth = 0
function onDragEnter() { dragDepth += 1; isDragOver.value = true }
function onDragOver(e: DragEvent) { e.preventDefault() }
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) isDragOver.value = false
}
function onDrop(e: DragEvent) {
  dragDepth = 0
  isDragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) readFile(file)
}

async function doValidate() {
  if (!hasText.value) return
  validating.value = true
  importResult.value = null
  try {
    const res = await adminVirtualLearnersApi.cardsValidate({ content: rawText.value, format: formatHint.value })
    report.value = (res.data?.data ?? res.data) as ValidatePayload
    const s = report.value.summary
    if (s.error > 0) toast.warning(`校验完成：${s.error} 张不可导入，请查看问题列`)
    else toast.success(`校验通过：可导入 ${s.ok} 张`)
  } catch (e) {
    toast.error(errMsg(e) || '校验失败')
  } finally {
    validating.value = false
  }
}

async function doImport() {
  if (!hasText.value) return
  if (!report.value) await doValidate()
  importing.value = true
  try {
    const res = await adminVirtualLearnersApi.cardsImport({
      content: rawText.value,
      format: formatHint.value,
      enrich: enrich.value,
      update: update.value
    })
    importResult.value = (res.data?.data ?? res.data) as ImportPayload
    const s = importResult.value.summary
    if (s.failed > 0) toast.warning(`导入完成：新建 ${s.created} · 失败 ${s.failed}`)
    else toast.success(`导入完成：新建 ${s.created} · 覆盖 ${s.updated} · 跳过 ${s.skipped}`)
    report.value = null
    imported.value = s.created > 0
  } catch (e) {
    toast.error(errMsg(e) || '导入失败')
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.ci-body { display: grid; gap: 12px; padding: 16px; }
.ci-file { display: none; }
.ci-drop {
  display: grid;
  gap: 4px;
  justify-items: center;
  padding: 24px 16px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface-2);
  cursor: pointer;
  text-align: center;
}
.ci-drop:hover { border-color: var(--mk-blue); }
.ci-drop.is-drag { border-color: var(--mk-blue); border-style: solid; background: var(--mk-blue-bg); }
.ci-drop__title { font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink); }
.ci-drop__hint { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ci-text { width: 100%; font-family: var(--mk-mono); font-size: var(--mk-fs-micro); line-height: 1.5; resize: vertical; }
.ci-opts { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.ci-check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted); cursor: pointer; }
.ci-actions { display: flex; align-items: center; gap: 10px; }
.ci-format { margin-left: auto; font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.ci-back { font-size: var(--mk-fs-micro); }
.ci-key { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.ci-issues { display: flex; flex-direction: column; gap: 2px; white-space: normal; }
.ci-issue { font-size: var(--mk-fs-micro); line-height: 1.45; }
.ci-issue--err { color: var(--mk-red); }
.ci-issue--warn { color: var(--mk-amber); }
.ci-issue--ok { color: var(--mk-faint); }
.ci-reason { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ci-bad { color: var(--mk-red); font-weight: 700; }
</style>
