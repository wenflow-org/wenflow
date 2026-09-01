<template>
  <div :class="embedded ? 'be-embedded' : 'mk-page'">
    <div v-if="!embedded" class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">批量实验</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ experiments.length }} 个实验 · 运行中 {{ runningCount }} · 学习者 {{ learnerTotal }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建实验</button>
      </span>
    </div>

    <div v-if="embedded" class="mk-card__head be-embedded__head">
      <span class="mk-card__meta">批量实验：一次创建多个虚拟学习者，系统级队列实验（目标 → 路径 → 学习 → 跨日衰减）</span>
      <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="openCreate">新建实验</button>
    </div>

    <div class="mk-card">
      <MockSkeletonTable v-if="loading && !experiments.length" :cols="6" />
      <div v-else-if="experiments.length" class="mk-table-scroll be-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>实验</th>
              <th>状态</th>
              <th>学习者</th>
              <th>进度</th>
              <th class="mk-col--time-full">创建时间</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in experiments" :key="e.id">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ e.name }}</strong>
                  <span class="mk-cell-sub" :title="e.description || ''">{{ e.description || '无描述' }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="statusBadge(e.status)">{{ statusText(e.status) }}</span></td>
              <td>
                <div class="mk-cell-main">
                  <strong>{{ (e.runs || []).length }} 名</strong>
                  <span class="mk-cell-sub" :class="{ 'be-cell--fail': failedRuns(e).length > 0 }" :title="`完成 ${doneRuns(e).length} · 失败 ${failedRuns(e).length} · 进行中 ${(e.runs || []).filter((r) => r.status === 'active').length}`">
                    完成 {{ doneRuns(e).length }}<template v-if="failedRuns(e).length"> · <b class="be-fail-num">失败 {{ failedRuns(e).length }}</b></template>
                  </span>
                </div>
              </td>
              <td>
                <div class="be-progress" :title="progressTitle(e)">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(e)" :style="{ width: progressPct(e) + '%' }"></span></span>
                  <span class="be-progress__num">{{ progressPct(e) }}%</span>
                </div>
              </td>
              <td :title="fmtDate(e.createdAt)">{{ timeAgo(e.createdAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click="openDetail(e)">详情</button>
                  <button v-if="e.status === 'running'" type="button" class="mk-link mk-link--danger" :disabled="e.busy" @click="stop(e)">停止</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === e.id" @click.stop="toggleMenu(e.id)">⋯</button>
                    <div v-if="openMenu === e.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" @click="menuDetail(e)">查看详情</button>
                      <button v-if="e.status === 'running'" type="button" class="mk-menu__item mk-menu__item--danger" @click="menuStop(e)">停止实验</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="failed" class="mk-empty">
        <span class="mk-empty__icon" aria-hidden="true">!</span>
        <strong>批量实验加载失败</strong>
        <span>无法从服务读取实验列表。</span>
        <button type="button" class="mk-empty__action" :disabled="loading" @click="load">{{ loading ? '重试中…' : '重试' }}</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>还没有批量实验</strong>
        <span>一次创建多个虚拟学习者，系统级队列实验：目标 → 路径 → 学习 → 跨日衰减。</span>
        <button type="button" class="mk-empty__action" @click="openCreate">新建实验</button>
      </div>
    </div>

    <!-- 创建实验弹窗 -->
    <Teleport to="body">
      <div v-if="createOpen" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="新建批量实验">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">新建批量实验</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
          </div>
          <div class="mk-modal__body">
            <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
              <span class="mk-field__label">实验名称 <em class="mk-field__req">*</em></span>
              <input v-model="form.name" class="mk-field__input" placeholder="例如：记忆衰减基线实验" />
              <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">描述（可选）</span>
              <textarea v-model="form.description" class="mk-field__textarea" rows="2" placeholder="实验目的、变量、对照组…" />
            </label>
            <div class="mk-field">
              <span class="mk-field__label">学习者配置 <em class="mk-field__req">*</em>（最多 20 名）</span>
              <div class="be-rows">
                <div class="be-row be-row--head">
                  <span>名称</span><span>学习目标</span><span>摩擦预算</span><span></span>
                </div>
                <div v-for="(r, i) in form.learners" :key="i" class="be-row">
                  <input v-model="r.name" class="mk-input" placeholder="学习者名称" />
                  <input v-model="r.learningGoal" class="mk-input" placeholder="学习目标（可选）" />
                  <select v-model="r.frictionBudget" class="mk-input be-budget">
                    <option v-for="b in budgets" :key="b.id" :value="b.id">{{ b.label }}</option>
                  </select>
                  <button type="button" class="mk-link mk-link--danger" :disabled="form.learners.length <= 1" @click="form.learners.splice(i, 1)">✕</button>
                </div>
              </div>
              <button type="button" class="mk-link" :disabled="form.learners.length >= 20" @click="addLearner">+ 添加学习者</button>
            </div>
            <div v-if="errorMsg" class="mk-alert">{{ errorMsg }}</div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="create">
              {{ creating ? '创建中…' : '创建实验' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 实验详情抽屉 -->
    <Teleport to="body">
      <div v-if="detailOpen" class="mk-drawer">
        <div class="mk-drawer__mask" @click="detailOpen = false"></div>
        <div class="mk-drawer__panel mk-drawer__panel--wide" role="dialog" aria-label="实验详情">
          <div class="mk-drawer__head">
            <div>
              <h3 class="mk-drawer__title">{{ detail?.name }}</h3>
              <span class="mk-drawer__sub">{{ detail?.description || '无描述' }} · {{ (detail?.runs || []).length }} 名学习者</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="detailOpen = false">✕</button>
          </div>
          <div class="mk-drawer__body">
            <div v-if="detailLoading" class="be-detail-loading"><span class="mk-spinner"></span> 加载中…</div>
            <template v-else-if="detailRuns.length">
              <div v-for="r in detailRuns" :key="r.id" class="mk-card be-run">
                <div class="be-run__head">
                  <strong>{{ r.learnerName }}</strong>
                  <span class="mk-badge" :class="runStatusBadge(r.status)">{{ runStatusText(r.status) }}</span>
                  <span class="mk-badge mk-badge--muted">{{ budgetLabel(r.frictionBudget) }}</span>
                  <span class="be-run__phase mono">{{ r.phase }}</span>
                </div>
                <div class="be-run__body">
                  <span class="be-run__meta">任务 {{ r.completedTasks }}<template v-if="r.totalTasks"> / {{ r.totalTasks }}</template></span>
                  <span v-if="r.currentTask" class="be-run__meta be-run__task" :title="r.currentTask">当前：{{ r.currentTask }}</span>
                  <span v-if="r.stallCount > 0" class="be-run__meta be-run__stall">卡死 {{ r.stallCount }} 次</span>
                  <span v-if="r.lastError" class="be-run__meta be-run__error" :title="r.lastError">{{ r.lastError }}</span>
                  <span class="be-run__meta be-run__time">{{ timeAgo(r.updatedAt) }}</span>
                </div>
                <div class="be-run__actions">
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="runBusy || !detail" @click="advance(detail!.id, r.id)">推进</button>
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="runBusy || !detail" @click="decay(detail!.id, r.id)">衰减</button>
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="runBusy || !detail" @click="snapshot(detail!.id, r.id)">快照</button>
                </div>
              </div>
            </template>
            <div v-else class="mk-empty mk-empty--compact">
              <strong>暂无运行记录</strong>
              <span>实验创建后由调度器自动推进。</span>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { timeAgo, errMsg } from './live'
import { askConfirm } from './useConfirm'
import { adminBatchExperimentsApi, type BatchExperiment, type BatchExperimentRun } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'

/** 嵌入模式：作为虚拟学习者「批量实验」tab 渲染（隐藏页面外壳/状态条） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

interface ExpRow extends BatchExperiment {
  busy?: boolean
}

const experiments = ref<ExpRow[]>([])
const loading = ref(false)
const failed = ref(false)
const runBusy = ref(false)

const statusTone = computed(() => (runningCount.value > 0 ? 'mk-status--ok' : 'mk-status--muted'))
const runningCount = computed(() => experiments.value.filter((e) => e.status === 'running').length)
const learnerTotal = computed(() => experiments.value.reduce((s, e) => s + (e.runs?.length || 0), 0))

const statusText = (s: string) => ({ running: '运行中', paused: '已暂停', stopped: '已停止', done: '已完成' }[s] || s)
const statusBadge = (s: string) =>
  s === 'running' ? 'mk-badge--ok' : s === 'paused' ? 'mk-badge--warn' : s === 'done' ? 'mk-badge--info' : 'mk-badge--muted'

const doneRuns = (e: ExpRow) => (e.runs || []).filter((r) => r.status === 'done')
const failedRuns = (e: ExpRow) => (e.runs || []).filter((r) => r.status === 'failed')
const progressPct = (e: ExpRow) => {
  const runs = e.runs || []
  if (!runs.length) return 0
  return Math.round((doneRuns(e).length / runs.length) * 100)
}
const progressTone = (e: ExpRow) => {
  const pct = progressPct(e)
  if (failedRuns(e).length > 0) return 'bad'
  return pct >= 100 ? 'ok' : pct > 0 ? 'warn' : 'warn'
}
const progressTitle = (e: ExpRow) =>
  `完成 ${doneRuns(e).length}/${e.runs?.length || 0} · 失败 ${failedRuns(e).length} · 进行中 ${(e.runs || []).filter((r) => r.status === 'active').length}`

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  failed.value = false
  try {
    const res = await adminBatchExperimentsApi.list()
    const items = (res.data?.data ?? res.data) || []
    experiments.value = items.map((e: Record<string, unknown>) => ({
      id: String(e.id),
      name: String(e.name || ''),
      description: (e.description as string) || null,
      status: String(e.status || ''),
      createdBy: String(e.createdBy || ''),
      learnersConfig: String(e.learnersConfig || ''),
      createdAt: String(e.createdAt || ''),
      updatedAt: String(e.updatedAt || ''),
      runs: Array.isArray(e.runs) ? e.runs : [],
    })) as unknown as ExpRow[]
  } catch (e) {
    failed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

/* 创建弹窗 */
const budgets = [
  { id: 'none', label: '无摩擦' },
  { id: 'low', label: '低' },
  { id: 'normal', label: '正常' },
  { id: 'high', label: '高' },
  { id: 'stress_test', label: '压力测试' },
]
const budgetLabel = (b: string) => budgets.find((x) => x.id === b)?.label || b

const createOpen = ref(false)
useEscape(() => createOpen.value, () => { createOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, () => { createOpen.value = false })

const form = ref({
  name: '',
  description: '',
  learners: [{ name: '', learningGoal: '', frictionBudget: 'normal' as string }],
})
const errors = ref<{ name?: string }>({})
const creating = ref(false)
const errorMsg = ref('')

function openCreate() {
  form.value = { name: '', description: '', learners: [{ name: '', learningGoal: '', frictionBudget: 'normal' }] }
  errors.value = {}
  errorMsg.value = ''
  createOpen.value = true
}

function addLearner() {
  if (form.value.learners.length >= 20) return
  form.value.learners.push({ name: '', learningGoal: '', frictionBudget: 'normal' })
}

async function create() {
  errors.value = {}
  errorMsg.value = ''
  if (!form.value.name.trim()) { errors.value.name = '请输入实验名称'; return }
  const learners = form.value.learners.filter((l) => l.name.trim())
  if (!learners.length) { errorMsg.value = '至少需要一个学习者配置'; return }
  creating.value = true
  try {
    await adminBatchExperimentsApi.create({
      name: form.value.name.trim(),
      description: form.value.description.trim() || undefined,
      learners: learners.map((l) => ({
        name: l.name.trim(),
        learningGoal: l.learningGoal.trim() || undefined,
        frictionBudget: l.frictionBudget as 'none' | 'low' | 'normal' | 'high' | 'stress_test',
      })),
    })
    createOpen.value = false
    toast.success('实验已创建，调度器将自动推进')
    void load()
  } catch (e) {
    errorMsg.value = errMsg(e)
  } finally {
    creating.value = false
  }
}

/* 操作 */
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

function menuDetail(e: ExpRow) { closeMenu(); openDetail(e) }
function menuStop(e: ExpRow) { closeMenu(); void stop(e) }

async function stop(e: ExpRow) {
  // 停止会中断正在运行的实验（不可恢复）：执行前确认
  const ok = await askConfirm({
    title: '停止实验',
    message: `确认停止实验「${e.name}」？进行中的运行将中断，实验不会继续执行。`,
    confirmText: '停止实验',
  })
  if (!ok) return
  e.busy = true
  try {
    await adminBatchExperimentsApi.stop(e.id)
    e.status = 'stopped'
    toast.success(`实验「${e.name}」已停止`)
    void load()
  } catch (err) {
    toast.error(`停止失败：${errMsg(err)}`)
  } finally {
    e.busy = false
  }
}

/* 详情抽屉 */
const detailOpen = ref(false)
const detail = ref<BatchExperiment | null>(null)
const detailRuns = ref<BatchExperimentRun[]>([])
const detailLoading = ref(false)

async function openDetail(e: ExpRow) {
  detail.value = e
  detailOpen.value = true
  detailLoading.value = true
  detailRuns.value = []
  try {
    const res = await adminBatchExperimentsApi.detail(e.id)
    const d = res.data?.data ?? res.data
    detail.value = d
    detailRuns.value = (d?.runs || []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      experimentId: String(r.experimentId || ''),
      learnerName: String(r.learnerName || ''),
      frictionBudget: String(r.frictionBudget || ''),
      phase: String(r.phase || ''),
      status: String(r.status || ''),
      completedTasks: Number(r.completedTasks || 0),
      totalTasks: r.totalTasks != null ? Number(r.totalTasks) : null,
      currentTask: (r.currentTask as string) || null,
      stallCount: Number(r.stallCount || 0),
      lastError: (r.lastError as string) || null,
      updatedAt: String(r.updatedAt || ''),
      createdAt: String(r.createdAt || ''),
    }))
  } catch (err) {
    toast.error(`加载详情失败：${errMsg(err)}`)
  } finally {
    detailLoading.value = false
  }
}

const runStatusText = (s: string) => ({ active: '进行中', stalled: '卡死', done: '完成', failed: '失败' }[s] || s)
const runStatusBadge = (s: string) =>
  s === 'done' ? 'mk-badge--ok' : s === 'failed' ? 'mk-badge--bad' : s === 'stalled' ? 'mk-badge--warn' : 'mk-badge--info'

async function advance(experimentId: string, runId: string) {
  runBusy.value = true
  try {
    await adminBatchExperimentsApi.advanceRun(experimentId, runId)
    toast.success('已推进一个阶段')
    await openDetail({ id: experimentId } as ExpRow)
  } catch (e) {
    toast.error(`推进失败：${errMsg(e)}`)
  } finally {
    runBusy.value = false
  }
}

async function decay(experimentId: string, runId: string) {
  runBusy.value = true
  try {
    await adminBatchExperimentsApi.decayRun(experimentId, runId)
    toast.success('已模拟跨日衰减')
    await openDetail({ id: experimentId } as ExpRow)
  } catch (e) {
    toast.error(`衰减失败：${errMsg(e)}`)
  } finally {
    runBusy.value = false
  }
}

async function snapshot(experimentId: string, runId: string) {
  runBusy.value = true
  try {
    await adminBatchExperimentsApi.snapshotRun(experimentId, runId)
    toast.success('快照已生成')
    await openDetail({ id: experimentId } as ExpRow)
  } catch (e) {
    toast.error(`快照失败：${errMsg(e)}`)
  } finally {
    runBusy.value = false
  }
}

load()
</script>

<style scoped>
.be-list { min-height: var(--mk-empty-min-h, calc(100dvh - 230px)); }
.be-progress { display: flex; align-items: center; gap: 8px; min-width: 140px; }
/* 学习者列：失败数红色强调（失败有值时突出，无失败保持副行灰） */
.be-fail-num { color: var(--mk-red); font-weight: 700; }
.be-cell--fail { color: var(--mk-red); }.be-progress .mk-minibar { flex: 1; }
.be-progress__num { font-family: var(--mk-mono); font-size: 11.5px; color: var(--mk-muted); white-space: nowrap; }

.be-rows { display: grid; gap: 6px; }
.be-row { display: grid; grid-template-columns: 1.2fr 1.6fr 0.9fr 28px; gap: 8px; align-items: center; }
.be-row--head { font-size: 11px; font-weight: 700; color: var(--mk-faint); letter-spacing: 0.04em; }
.be-row--head span:last-child { visibility: hidden; }
.be-budget { height: 34px; }

.be-detail-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 40px 0; color: var(--mk-muted); font-size: 13px; }
/* 详情 run 卡：mk-card 形态（边框/圆角/背景由全局类提供，此处只留内部布局） */
.be-run { padding: 12px 14px; display: grid; gap: 8px; margin-bottom: 10px; }
.be-run__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.be-run__head strong { font-size: 13px; }
.be-run__phase { margin-left: auto; font-size: 11.5px; color: var(--mk-muted); }
.be-run__body { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--mk-muted); }
.be-run__task { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.be-run__stall { color: var(--mk-amber); }
.be-run__error { color: var(--mk-red); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.be-run__time { margin-left: auto; }
.be-run__actions { display: flex; gap: 6px; }

.mk-drawer__panel--wide { width: min(680px, 100%); }

@media (min-width: 2000px) {
  .be-run { padding: 14px 16px; }
  .be-run__head strong { font-size: 14.5px; }
  .be-run__body { font-size: 13.5px; }
  .be-progress__num { font-size: 13px; }
}
@media (min-width: 2800px) {
  .be-run { padding: 16px 19px; }
  .be-run__head strong { font-size: 17px; }
  .be-run__body { font-size: 16px; }
  .be-progress__num { font-size: 15.5px; }
}
@media (min-width: 3600px) {
  .be-run { padding: 19px 22px; }
  .be-run__head strong { font-size: 20px; }
  .be-run__body { font-size: 18.5px; }
  .be-progress__num { font-size: 18px; }
}
</style>
