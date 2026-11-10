<template>
  <!-- 导入卡二级页（2026-10-06 抽屉退役：导入从 mk-drawer 迁标准二级页 ?view=card-import）。
       表单/拖拽/校验/导入报告逻辑自卡库页原样随迁；导入成功后卡墙在返回时重挂载自动刷新。 -->
  <div class="mk-page">
    <MkDetailHero avatar="＋" title="导入卡文档" sub="YAML / JSON 的 { cards: [...] }">
      <template #actions>
        <!-- 页面名统一叫「学习者卡库」（2026-11-02 评审 R20）：此前这里写「卡墙」，
             与面包屑、列表页的称呼对不上 -->
        <button type="button" class="mk-btn" @click="closeSubPage()">返回学习者卡库</button>
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
          <!-- 常态副文「也可以直接粘贴到文本框」已撤（2026-11-02 文案清理）：对同屏文本框的隔空指路，
               且正下方文本框的 placeholder（「在此粘贴卡文档，也可以把 .yaml / .json 文件拖进来」）已说同一件事。
               悬停那句是「松手不会直接导入、只读进文本框」的预期限定，留。 -->
          <span v-if="isDragOver" class="ci-drop__hint">松开后将读取并填入文本框</span>
        </div>
        <!-- 格式说明与示例（2026-11-02 评审 R21/R22）：识别格式跟着它描述的输入框，
             不再漂在按钮行末尾；示例单独折起，进框的是真空，不会和已载入内容混淆 -->
        <div class="ci-text-head">
          <span class="mk-field__label">卡文档内容</span>
          <span class="ci-format">识别格式：{{ formatHint.toUpperCase() }}</span>
        </div>
        <textarea
          v-model="rawText"
          class="mk-field__textarea ci-text"
          rows="12"
          spellcheck="false"
          placeholder="在此粘贴卡文档，也可以把 .yaml / .json 文件拖进来"
          @input="resetReports"
        ></textarea>
        <details class="ci-sample">
          <summary>看一份 YAML 示例</summary>
          <pre class="ci-sample__code">cards:
  - cardKey: gaozhong-math-01
    nickname: 想补函数的高一学生
    persona:
      nameHint: 高一学生
      background: 县城高中高一在读，函数基础薄弱
    story:
      visibleOpening: 这次月考函数只考了 58 分。
      followUps:
        - 平时函数作业完成得怎么样？
        - 上课跟得上老师的节奏吗？
    source:
      kind: web
      ref: https://example.com/note</pre>
        </details>
        <div class="ci-opts">
          <label class="ci-check">
            <input v-model="enrich" type="checkbox" />
            <span>导入时 AI 补全人设（调用 persona-designer 逐卡生成完整认知人设，较慢）</span>
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
          <button v-if="imported" type="button" class="mk-link ci-back" @click="closeSubPage()">导入完成 · 返回学习者卡库 →</button>
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
            <tr><th scope="col">卡号</th><th scope="col">状态</th><th scope="col">问题</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in report.reports" :key="(r.cardKey || 'row') + i">
              <td><span class="ci-key">{{ r.cardKey || '（无卡号）' }}</span></td>
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
            <tr><th scope="col">卡号</th><th scope="col">动作</th><th scope="col">备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in importResult.results" :key="(r.cardKey || 'row') + i">
              <td><span class="ci-key">{{ r.cardKey || '（无卡号）' }}</span></td>
              <td><span class="mk-badge" :class="actionBadge(r.action)">{{ actionText(r.action) }}</span></td>
              <td>
                <span v-if="r.reason" class="ci-reason" :title="r.reason">{{ r.reason }}</span>
                <span v-else class="mk-na">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import { closeSubPage, setSubPageLabel } from './store'
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

/* 面包屑显示本页的名字而不是路由占位 id「new」（2026-11-02 评审 R19）：
   从卡库打开时入口已带 label，但刷新/深链只剩 ?view=card-import&id=new，
   这里补齐，两条进入路径的面包屑才一致。 */
onMounted(() => setSubPageLabel('导入卡'))

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
  /* G7a（2026-10-10）导入闸门：未校验先校验，且必须看校验结论——此前 `await doValidate()`
     后不看结果，0 张可导入（全部错误）也照发导入请求。可导入数 = ok + exists（同 canImport
     口径）；校验请求本身失败时 report 仍为 null（doValidate 已 toast 失败原因），同样中止。 */
  if (!report.value) await doValidate()
  const vs = report.value?.summary
  if (!vs) return
  if (vs.ok + vs.exists <= 0) {
    toast.error('没有可导入的卡：全部卡片校验未通过，请先修正文档再导入')
    return
  }
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
    /* G7b（2026-10-10）：覆盖也算导入成功——此前仅覆盖不新建（created=0, updated>0）时
       imported=false，「导入完成 · 返回卡墙」完成引导不出现，用户导入成功却找不到出口 */
    imported.value = s.created + s.updated > 0
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
/* 占位提示走弱化色令牌：浏览器默认灰在深底上只有约 3.5:1，读起来像禁用态
   （2026-11-02 评审 R22） */
.ci-text::placeholder { color: var(--mk-faint); opacity: 1; }
.ci-text-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.ci-format { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
/* 示例：折起来，一眼能看出是「参考资料」而不是已填进框里的内容 */
.ci-sample > summary { cursor: pointer; font-size: var(--mk-fs-micro); color: var(--mk-blue-text); list-style: none; width: fit-content; }
.ci-sample > summary::-webkit-details-marker { display: none; }
.ci-sample > summary::before { content: '▸'; margin-right: 6px; }
.ci-sample[open] > summary::before { content: '▾'; }
.ci-sample__code {
  margin: 6px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  color: var(--mk-ink);
  overflow-x: auto;
}
.ci-opts { display: flex; flex-wrap: wrap; gap: 8px 20px; }
.ci-check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted); cursor: pointer; }
.ci-actions { display: flex; align-items: center; gap: 10px; }
/* 空文本框时两个按钮都禁用，全局禁用态把实心主按钮也刷成中性灰，于是「导入」和
   「校验」读成两个平级操作（2026-11-02 评审 R21）。这里让主操作在禁用态保留主色
   的浅底 + 蓝字：仍读得出「先填内容才能导入」，又不会和次要按钮糊成一片。 */
.ci-actions .mk-btn--primary:disabled:not(.mk-btn--danger-ghost) {
  background: var(--mk-blue-bg);
  border-color: color-mix(in srgb, var(--mk-blue) 40%, transparent);
  color: var(--mk-blue-text);
}
.ci-back { margin-left: auto; font-size: var(--mk-fs-micro); }
.ci-key { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.ci-issues { display: flex; flex-direction: column; gap: 2px; white-space: normal; }
.ci-issue { font-size: var(--mk-fs-micro); line-height: 1.45; }
.ci-issue--err { color: var(--mk-red); }
.ci-issue--warn { color: var(--mk-amber); }
.ci-issue--ok { color: var(--mk-faint); }
.ci-reason { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ci-bad { color: var(--mk-red); font-weight: 700; }
</style>
