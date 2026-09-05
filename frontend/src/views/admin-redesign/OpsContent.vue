<template>
  <div :class="embedded ? 'mk-page--fill oc-embedded' : 'mk-page mk-page--fill'">
    <!-- 学习路径页头（单行状态条：页面名 + 四态可点计数 + 里程碑/任务总量 + 刷新）
         embedded（学习会话合并宿主）时由宿主状态条承载域计数，本组件不再渲染状态条 -->
    <div v-if="!embedded" class="mk-status" :class="`mk-status--${dashTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">学习路径</strong>
      <span class="mk-status__sep"></span>
      <button
        type="button"
        class="oc-count-link"
        :class="{ 'oc-count-link--on': statusFilter === 'active' }"
        title="点击筛选「学习中」路径"
        @click="statusFilter = statusFilter === 'active' ? '' : 'active'"
      >学习中 {{ byStatus('active') }}</button>
      <button
        type="button"
        class="oc-count-link"
        :class="{ 'oc-count-link--on': statusFilter === 'completed' }"
        title="点击筛选「已完成」路径"
        @click="statusFilter = statusFilter === 'completed' ? '' : 'completed'"
      >已完成 {{ byStatus('completed') }}</button>
      <span v-if="byStatus('failed') > 0" class="mk-status__meta mk-status__meta--warn" title="目标对话产出路径失败，需排查">生成失败 {{ byStatus('failed') }}</span>
      <span v-if="byStatus('archived') > 0" class="mk-status__meta">已下线 {{ byStatus('archived') }}</span>
      <span class="mk-status__meta" title="仅真实用户（不含模拟账号）；切换「含模拟」后显示全量并灰标模拟行">共 {{ stats?.total ?? '—' }} 条 · 里程碑 {{ stats?.totalMilestones ?? '—' }} · 任务 {{ stats?.totalTasks ?? '—' }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="reload">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </div>

    <!-- 筛选 + 列表（单行头部与教学会话/目标对话 tab 一致：pill 组 + 搜索 + 数据口径 + 列显隐） -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in statusPills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': statusFilter === p.id }"
              @click="statusFilter = statusFilter === p.id ? '' : p.id"
            >
              {{ p.label }}
            </button>
          </div>
          <input
            v-model="keyword"
            class="mk-filter__input"
            placeholder="搜索标题 / 用户 / ID"
          />
        </div>
        <div class="mk-card__head-right">
          <DataScopeToggle v-model="includeTest" />
          <MkCols
            :col-defs="colDefs"
            storage-key="wf_paths_hidden_cols"
            v-model:hidden="hiddenCols"
          />
          <span class="mk-card__meta" :title="includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户'">
            {{ rows.length }} / {{ total }} 条（{{ includeTest ? '含模拟' : '仅真实' }}）
          </span>
        </div>
      </div>

      <MockSkeletonTable v-if="loading && !rows.length" :cols="7" />
      <div v-else-if="failed" class="oc-error" role="alert">
        <span>路径列表加载失败</span>
        <button type="button" class="mk-link" @click="reload">重试</button>
      </div>
      <div v-else-if="filtered.length" class="mk-table-scroll oc-list">
        <table class="mk-table mk-table--fixed">
          <thead>
            <tr>
              <th>路径</th>
              <th v-if="!hiddenCols.has('subject')" style="width:32%">主题</th>
              <th v-if="!hiddenCols.has('user')" style="width:150px">用户</th>
              <th v-if="!hiddenCols.has('status')" class="mk-col--badge">状态</th>
              <th v-if="!hiddenCols.has('progress')" style="width:130px">进度</th>
              <th v-if="!hiddenCols.has('updated')" class="mk-col--time-full">更新</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in paged" :key="p.id">
              <td>
                <div class="mk-cell-main">
                  <strong class="mk-cell-text">{{ p.title }}</strong>
                  <span class="mk-cell-sub" :title="p.id">{{ shortId(p.id, 10, 4) }} · {{ difficultyText(p.difficulty) }}{{ p.estimatedHours ? ' · ~' + p.estimatedHours + 'h' : '' }}</span>
                </div>
              </td>
              <td v-if="!hiddenCols.has('subject')"><span class="oc-subject" :title="p.subject || ''">{{ p.subject || '—' }}</span></td>
              <td v-if="!hiddenCols.has('user')">
                <div class="mk-cell-main">
                  <strong>{{ p.user?.name || '—' }}</strong>
                  <span class="mk-cell-sub">{{ p.user?.email || '' }}</span>
                </div>
                <div class="oc-tags">
                  <span v-if="p.user?.isVirtualLearner" class="mk-badge mk-badge--sm mk-badge--virtual" title="虚拟学习者（仿真数据，可再生成）">虚拟</span>
                  <span v-else-if="p.isTestAccount" class="mk-badge mk-badge--sm mk-badge--warn" title="测试/审计账号">测试</span>
                </div>
              </td>
              <td v-if="!hiddenCols.has('status')"><span class="mk-badge" :class="statusBadge(p.status)">{{ statusText(p.status) }}</span></td>
              <td v-if="!hiddenCols.has('progress')">
                <div class="oc-progress" :title="`${p.completedMilestones}/${p.totalMilestones} 里程碑`">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(p)" :style="{ width: progressPct(p) + '%' }"></span></span>
                  <span class="oc-progress__num">{{ progressPct(p) }}%</span>
                </div>
              </td>
              <td v-if="!hiddenCols.has('updated')" :title="fmtDate(p.updatedAt)">{{ timeAgo(p.updatedAt) }}</td>
              <td>
                <div class="mk-actions mk-actions--left">
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
      <div v-else class="mk-empty">
        <span v-if="!loading" class="mk-empty__icon" aria-hidden="true">◌</span>
        <strong>{{ loading ? '加载中…' : (keyword || statusFilter ? '当前筛选无匹配' : '没有学习路径') }}</strong>
        <span v-if="!loading">{{ keyword || statusFilter ? '放宽筛选条件试试。' : '用户的目标对话生成路径后，会出现在这里。' }}</span>
        <button v-if="isFiltered && !loading" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
      </div>

      <Pagination
        v-if="filtered.length > pageSize"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
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
import { computed, onMounted, ref, watch } from 'vue'
import { timeAgo, errMsg, shortId } from './live'
import { intent } from './store'
import { adminLearningContentApi, type LearningContentStats, type LearningPathRow } from '@/api/adminApi'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkCols from './MkCols.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import { statusText, statusBadge } from './opsShared'

/** 嵌入模式：作为「目标对话」页内「学习路径」tab 渲染（隐藏页面壳与状态条，筛选/表格/抽屉保留）；
    initialStatus：宿主深链预筛（如工作台「生成失败路径」→ 'failed'），挂载时应用。
    count 事件：stats 加载完成后上报路径总数（宿主「路径 N」徽章） */
const props = withDefaults(defineProps<{ embedded?: boolean; initialStatus?: string }>(), { embedded: false, initialStatus: '' })
const emit = defineEmits<{ (e: 'count', total: number): void }>()

type PathRow = LearningPathRow & { busy?: boolean; isTestAccount?: boolean }

const rows = ref<PathRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(15)
const loading = ref(false)
const failed = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const includeTest = ref(false)
const stats = ref<LearningContentStats | null>(null)

/* 状态 pill 组（与教学会话/目标对话头部同形态；点击可取消，取色全站语义） */
const statusPills = [
  { id: 'active', label: '学习中' },
  { id: 'completed', label: '已完成' },
  { id: 'failed', label: '生成失败' },
  { id: 'archived', label: '已下线' }
]

/* 列显隐（与同页其他列表一致）：目标摘要/用户/状态/进度/更新 可隐藏，路径/操作固定 */
const colDefs = [
  { key: 'subject', label: '主题', title: '路径主题（学科或目标）' },
  { key: 'user', label: '用户', title: '所属用户' },
  { key: 'status', label: '状态', title: '路径状态' },
  { key: 'progress', label: '进度', title: '里程碑完成进度' },
  { key: 'updated', label: '更新时间', title: '最近更新' }
] as const
const hiddenCols = ref<Set<string>>(new Set())

/* 状态条四态计数 + 基调（与目标对话/教学会话同形态：失败>0 警示琥珀，空库静默） */
const byStatus = (s: string) => stats.value?.byStatus?.[s] || 0
const dashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() => {
  if (!stats.value || stats.value.total === 0) return 'muted'
  if ((stats.value.byStatus?.failed || 0) > 0) return 'warn'
  return 'ok'
})

/* 客户端过滤（与教学会话/目标对话 tab 一致：全量拉最近 100 条后本地即时过滤，无「查询」按钮） */
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return rows.value.filter((p) => {
    if (statusFilter.value && p.status !== statusFilter.value) return false
    if (!k) return true
    return `${p.title} ${p.user?.name || ''} ${p.user?.email || ''} ${p.subject || ''}`.toLowerCase().includes(k)
  })
})
const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
}
watch(filtered, () => {
  page.value = 1
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

const progressPct = (p: PathRow) => {
  if (!p.totalMilestones) return 0
  return Math.min(100, Math.round((p.completedMilestones / p.totalMilestones) * 100))
}
const progressTone = (p: PathRow) => {
  const pct = progressPct(p)
  return pct >= 100 ? 'ok' : p.status === 'failed' ? 'bad' : 'warn'
}
const difficultyText = (d: string) =>
  ({ beginner: '入门', intermediate: '进阶', advanced: '高阶' }[d] || d || '—')

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
    /* 全量拉最近 100 条后客户端过滤（与教学会话/目标对话一致；筛选即时响应，无服务端往返） */
    const res = await adminLearningContentApi.listPaths({
      page: 1,
      limit: 100,
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
    /* 宿主域计数徽章（embedded 才消费） */
    emit('count', Number(stats.value?.total || 0))
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
/* 数据隔离切换：仅真实 ↔ 含虚拟/测试（切换后立即按新口径重拉） */
watch(includeTest, () => {
  void reload()
})

/* 宿主刷新联动（学习会话合并宿主「刷新」按钮 → reload） */
defineExpose({ reload })
</script>

<style scoped>
/* 页头计数锚点（与教学会话 ts-count-link / 目标对话 gc-count-link 同形态）：学习中/已完成可点击筛选 */
.oc-count-link {
  border: 0; background: transparent; padding: 2px 6px;
  font: inherit; font-size: var(--mk-fs-12_5); font-weight: 700;
  color: var(--mk-muted); cursor: pointer; border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.oc-count-link:hover { color: var(--mk-blue); background: rgba(44, 99, 208, 0.08); }
.oc-count-link--on { color: var(--mk-blue); background: rgba(44, 99, 208, 0.12); }
/* 嵌入模式（目标对话页「学习路径」tab）：fill 容器内占满，主卡片弹性 */
.oc-embedded { flex: 1; min-height: 0; overflow: hidden; }
.oc-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--mk-red-bg, #fef2f2);
  border: 1px solid rgba(220, 38, 38, 0.3);
  color: var(--mk-red, #dc2626);
  font-size: var(--mk-fs-13);
  font-weight: 600;
  margin: 10px 14px;
}
.oc-progress { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.oc-progress .mk-minibar { flex: 1; }
.oc-progress__num { font-family: var(--mk-mono); font-size: var(--mk-fs-12); color: var(--mk-muted); }
/* 虚拟/测试行内标记（对齐同页 conversations/teaching 行样式） */
.oc-tags { display: flex; gap: 4px; margin-top: 2px; }
/* 主题列：subject 字段或为学科或为生成路径时写入的目标文本（可能很长），单行省略 + hover 全文 */
.oc-subject {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
}

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

/* 暗色模式：补齐暗色覆写（原缺失，与全站 Token 红覆盖对齐） */
html[data-theme='dark'] .oc-error { border-color: rgba(248, 113, 113, 0.35); }
</style>
