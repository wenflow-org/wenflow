<template>
  <div :class="embedded ? 'mk-page--fill oc-embedded' : 'mk-page'">
    <!-- 独立场景形态：状态条（嵌入时由宿主页头承担，不重复渲染） -->
    <div v-if="!embedded" class="mk-status">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">内容管理</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">路径 {{ stats?.total ?? '—' }}</span>
      <span class="mk-status__meta">里程碑 {{ stats?.totalMilestones ?? '—' }}</span>
      <span class="mk-status__meta">任务 {{ stats?.totalTasks ?? '—' }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </div>

    <!-- 状态统计（MkKpi 统一形态；失败>0 红色警示） -->
    <div class="oc-cards">
      <MkKpi
        v-for="c in statusCards"
        :key="c.label"
        :label="c.label"
        :value="c.value"
        :tone="c.tone"
        :hint="c.hint"
      />
    </div>

    <!-- 筛选 + 列表 -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="oc-filter">
          <input v-model="keyword" class="mk-filter__input" placeholder="搜索标题 / 描述 / 用户…" @keydown.enter="reload" />
          <select v-model="statusFilter" class="mk-filter__select" @change="reload">
            <option value="">全部状态</option>
            <option value="active">学习中</option>
            <option value="completed">已完成</option>
            <option value="failed">生成失败</option>
            <option value="archived">已下线</option>
          </select>
          <select v-model="subjectFilter" class="mk-filter__select" @change="reload">
            <option value="">全部学科</option>
            <option v-for="s in subjectOptions" :key="s" :value="s">{{ s }}</option>
          </select>
          <button type="button" class="mk-btn mk-btn--sm" @click="reload">查询</button>
        </div>
        <label class="mk-field--switch oc-test">
          <input v-model="includeTest" type="checkbox" @change="reload" />
          <span class="mk-field__label" style="margin:0">含虚拟/测试</span>
        </label>
      </div>

      <MockSkeletonTable v-if="loading && !rows.length" :cols="7" />
      <div v-else-if="rows.length" class="mk-table-scroll oc-list">
        <table class="mk-table">
          <thead>
            <tr>
              <th>路径</th>
              <th>用户</th>
              <th>学科</th>
              <th>状态</th>
              <th>进度</th>
              <th class="mk-col--time-full">更新</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in rows" :key="p.id">
              <td>
                <div class="mk-cell-main">
                  <strong class="mk-cell-text">{{ p.title }}</strong>
                  <span class="mk-cell-sub" :title="p.id">{{ shortId(p.id, 10, 4) }} · {{ p.difficulty }} · {{ p.estimatedHours ? '~' + p.estimatedHours + 'h' : '—' }}</span>
                </div>
              </td>
              <td>
                <div class="mk-cell-main">
                  <strong>{{ p.user?.name || '—' }}</strong>
                  <span class="mk-cell-sub">{{ p.user?.email || '' }}</span>
                </div>
              </td>
              <td><span class="mk-badge mk-badge--muted">{{ p.subject || '—' }}</span></td>
              <td><span class="mk-badge" :class="statusBadge(p.status)">{{ statusText(p.status) }}</span></td>
              <td>
                <div class="oc-progress" :title="`${p.completedMilestones}/${p.totalMilestones} 里程碑`">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(p)" :style="{ width: progressPct(p) + '%' }"></span></span>
                  <span class="oc-progress__num">{{ progressPct(p) }}%</span>
                </div>
              </td>
              <td :title="fmtDate(p.updatedAt)">{{ timeAgo(p.updatedAt) }}</td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click="openDetail(p)">详情</button>
                  <button v-if="p.status !== 'archived'" type="button" class="mk-link mk-link--danger" :disabled="p.busy" @click="archive(p)">下线</button>
                  <button v-else type="button" class="mk-link" :disabled="p.busy" @click="restore(p)">恢复</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === p.id" @click.stop="toggleMenu(p.id)">⋯</button>
                    <div v-if="openMenu === p.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" @click="menuDetail(p)">查看结构</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuDelete(p)">删除路径</button>
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
        <strong>内容加载失败</strong>
        <button type="button" class="mk-empty__action" @click="reload">重试</button>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>没有学习路径</strong>
        <span>用户的目标对话生成路径后，会出现在这里。</span>
      </div>

      <Pagination
        v-if="total > pageSize"
        v-model:page="page"
        :total="total"
        :page-size="pageSize"
        :loading="loading"
        show-total
        @update:page="reload"
      />
    </div>

    <!-- 路径结构详情抽屉 -->
    <Teleport to="body">
      <div v-if="detailOpen" class="mk-drawer">
        <div class="mk-drawer__mask" @click="detailOpen = false"></div>
        <div class="mk-drawer__panel mk-drawer__panel--wide" role="dialog" aria-label="路径结构">
          <div class="mk-drawer__head">
            <div>
              <h3 class="mk-drawer__title">{{ detail?.title }}</h3>
              <span class="mk-drawer__sub">{{ detail?.subject }} · {{ detail?.user?.name || '—' }} · {{ detail?.milestones?.length || 0 }} 个里程碑</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="detailOpen = false">✕</button>
          </div>
          <div class="mk-drawer__body">
            <div v-if="detailLoading" class="oc-loading"><span class="mk-spinner"></span> 加载中…</div>
            <template v-else-if="detail">
              <p v-if="detail.description" class="oc-desc">{{ detail.description }}</p>
              <div v-for="m in detail.milestones" :key="m.id" class="oc-milestone">
                <div class="oc-milestone__head">
                  <strong>{{ m.stageNumber }}. {{ m.title }}</strong>
                  <span class="mk-badge" :class="msBadge(m.status)">{{ msText(m.status) }}</span>
                  <span class="oc-milestone__meta mono">~{{ m.estimatedHours ?? '—' }}h</span>
                </div>
                <div v-if="m.subtasks.length" class="oc-subtasks">
                  <div v-for="t in m.subtasks" :key="t.id" class="oc-subtask">
                    <span class="oc-subtask__dot" :class="`oc-subtask__dot--${t.status}`"></span>
                    <span class="oc-subtask__title">{{ t.title }}</span>
                    <span class="mk-badge mk-badge--sm mk-badge--muted">{{ taskTypeText(t.taskType) }}</span>
                    <span class="oc-subtask__meta mono">{{ t.estimatedMinutes }}min</span>
                  </div>
                </div>
                <p v-else class="mk-na oc-milestone__empty">无子任务</p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { intent } from './store'
import { adminLearningContentApi, type LearningContentStats, type LearningPathRow } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkKpi from './MkKpi.vue'
import { statusText, statusBadge } from './opsShared'

/** 嵌入模式：作为「目标对话」页内「学习路径」tab 渲染（隐藏页面壳与状态条，KPI/筛选/表格/抽屉保留）；
    initialStatus：宿主深链预筛（如工作台「生成失败路径」→ 'failed'），挂载时应用。 */
const props = withDefaults(defineProps<{ embedded?: boolean; initialStatus?: string }>(), { embedded: false, initialStatus: '' })

type PathRow = LearningPathRow & { busy?: boolean }

const rows = ref<PathRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const failed = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const subjectFilter = ref('')
const includeTest = ref(false)
const stats = ref<LearningContentStats | null>(null)

const statusCards = computed(() => {
  const s = stats.value?.byStatus || {}
  const failedN = s.failed || 0
  const items: Array<{ label: string; value: string; tone: '' | 'ok' | 'warn' | 'bad'; hint: string }> = [
    { label: '学习中', value: String(s.active || 0), tone: (s.active || 0) > 0 ? 'ok' : '', hint: (s.active || 0) > 0 ? '进行中' : '' },
    { label: '已完成', value: String(s.completed || 0), tone: '', hint: '' },
    { label: '生成失败', value: String(failedN), tone: failedN > 0 ? 'bad' : '', hint: failedN > 0 ? '需关注' : '' },
    { label: '已下线', value: String(s.archived || 0), tone: '', hint: '' },
  ]
  return items
})
const subjectOptions = computed(() => (stats.value?.bySubject || []).map((s) => s.subject))

const progressPct = (p: PathRow) => {
  if (!p.totalMilestones) return 0
  return Math.min(100, Math.round((p.completedMilestones / p.totalMilestones) * 100))
}
const progressTone = (p: PathRow) => {
  const pct = progressPct(p)
  return pct >= 100 ? 'ok' : p.status === 'failed' ? 'bad' : 'warn'
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function reload() {
  loading.value = true
  failed.value = false
  try {
    const res = await adminLearningContentApi.listPaths({
      page: page.value,
      limit: pageSize.value,
      status: statusFilter.value || undefined,
      subject: subjectFilter.value || undefined,
      keyword: keyword.value.trim() || undefined,
      includeTest: includeTest.value || undefined,
    })
    const body = res.data?.data ?? res.data ?? {}
    rows.value = (body.paths || []).map((p: PathRow) => ({ ...p, busy: false }))
    total.value = body.pagination?.total ?? rows.value.length
  } catch (e) {
    failed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const res = await adminLearningContentApi.getStats()
    stats.value = res.data?.data ?? res.data
  } catch {
    stats.value = null
  }
}

async function archive(p: PathRow) {
  const ok = await askConfirm({
    title: '下线路径',
    message: `确认下线「${p.title}」？\n用户端将无法继续学习该路径。`,
    confirmText: '下线',
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.archivePath(p.id)
    p.status = 'archived'
    toast.success('路径已下线')
    void loadStats()
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
  } finally {
    p.busy = false
  }
}

async function restore(p: PathRow) {
  // 恢复会让路径立即回到用户端可见/可学，与下线对称需要确认
  const ok = await askConfirm({
    title: '恢复路径',
    message: `确认恢复「${p.title}」？恢复后用户端立即可见并继续学习该路径。`,
    confirmText: '恢复',
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.restorePath(p.id)
    p.status = 'active'
    toast.success('路径已恢复')
    void loadStats()
  } catch (e) {
    toast.error(`恢复失败：${errMsg(e)}`)
  } finally {
    p.busy = false
  }
}

async function remove(p: PathRow) {
  const ok = await askConfirm({
    title: '删除路径',
    message: `确认删除「${p.title}」？\n将级联删除其全部里程碑与子任务，不可撤销。`,
    confirmText: '删除',
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.deletePath(p.id)
    rows.value = rows.value.filter((x) => x.id !== p.id)
    toast.success('路径已删除')
    void loadStats()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  } finally {
    p.busy = false
  }
}

/* 详情 */
interface PathSubtask { id: string; title: string; taskType: string; status: string; estimatedMinutes: number }
interface PathMilestone { id: string; stageNumber: number; title: string; status: string; estimatedHours?: number | null; description?: string; subtasks: PathSubtask[] }
interface PathDetail { title: string; subject: string; user?: { name?: string } | null; description?: string; milestones: PathMilestone[] }
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<PathDetail | null>(null)

async function openDetail(p: PathRow) {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const res = await adminLearningContentApi.getPathDetail(p.id)
    detail.value = res.data?.data ?? res.data
  } catch (e) {
    toast.error(`加载详情失败：${errMsg(e)}`)
  } finally {
    detailLoading.value = false
  }
}

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()
function menuDetail(p: PathRow) { closeMenu(); openDetail(p) }
function menuDelete(p: PathRow) { closeMenu(); void remove(p) }

const msText = (s: string) => ({ locked: '未解锁', in_progress: '进行中', completed: '已完成' }[s] || s)
const msBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'in_progress' ? 'mk-badge--info' : 'mk-badge--muted'
const taskTypeText = (t: string) => ({ practice: '练习', acquire: '习得', reflection: '反思', assessment: '评估' }[t] || t)

/* 深链：独立场景形态（嵌入时由宿主 GoalConversations 消费 intent 并传 initialStatus 预筛）：
   工作台「生成失败路径」→ 预筛 failed（消费后清空，避免菜单直达被残留筛选污染） */
onMounted(() => {
  if (!props.embedded && ['active', 'completed', 'failed', 'archived'].includes(intent.statusFilter)) {
    statusFilter.value = intent.statusFilter
    intent.statusFilter = ''
  }
  if (props.embedded && ['active', 'completed', 'failed', 'archived'].includes(props.initialStatus)) {
    statusFilter.value = props.initialStatus
  }
  void reload()
  void loadStats()
})
</script>

<style scoped>
.oc-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
/* 嵌入模式（目标对话页「学习路径」tab）：fill 容器内占满，KPI 卡行 + 主卡片弹性 */
.oc-embedded { flex: 1; min-height: 0; overflow: hidden; }
.oc-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.oc-filter .mk-filter__input { min-width: 220px; }
.oc-test { margin-left: auto; }
.oc-list { flex: 1; min-height: 0; overflow-y: auto; }
.oc-progress { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.oc-progress .mk-minibar { flex: 1; }
.oc-progress__num { font-family: var(--mk-mono); font-size: var(--mk-fs-12); color: var(--mk-muted); }

.oc-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 40px 0; color: var(--mk-muted); font-size: var(--mk-fs-13); }
.oc-desc { color: var(--mk-muted); font-size: var(--mk-fs-12_5); margin: 0 0 12px; }
.oc-milestone {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.oc-milestone__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.oc-milestone__head strong { font-size: var(--mk-fs-13); }
.oc-milestone__meta { margin-left: auto; color: var(--mk-faint); font-size: var(--mk-fs-11); }
.oc-milestone__empty { font-size: var(--mk-fs-12); margin: 8px 0 0; }
.oc-subtasks { display: grid; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--mk-line); }
.oc-subtask { display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs-12); }
.oc-subtask__dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.oc-subtask__dot--completed { background: var(--mk-green); }
.oc-subtask__dot--in_progress { background: var(--mk-blue); }
.oc-subtask__dot--todo { background: var(--mk-faint); }
.oc-subtask__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-subtask__meta { color: var(--mk-faint); font-size: var(--mk-fs-11); }

.mk-drawer__panel--wide { width: min(720px, 100%); }

/* 4K：抽屉内容跟随全站节奏 */
@media (min-width: 2000px) {
  .oc-progress__num { font-size: 13px; }
  .oc-milestone__head strong { font-size: 14.5px; }
  .oc-milestone__meta { font-size: 12.5px; }
  .oc-subtask { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .oc-progress__num { font-size: 15.5px; }
  .oc-milestone__head strong { font-size: 17px; }
  .oc-milestone__meta { font-size: 14.5px; }
  .oc-subtask { font-size: 16px; }
}
@media (min-width: 3600px) {
  .oc-progress__num { font-size: 18px; }
  .oc-milestone__head strong { font-size: 20px; }
  .oc-milestone__meta { font-size: 17px; }
  .oc-subtask { font-size: 18.5px; }
}
</style>
