<template>
  <div :class="embedded ? 'mk-page--fill fb-embedded' : 'mk-page mk-page--fill'">
    <!-- 状态条（embedded 时由运营中心宿主承载域计数，不再渲染） -->
    <div v-if="!embedded" class="mk-status" :class="pendingCount > 0 ? 'mk-status--warn' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">反馈中心</strong>
      <span class="mk-status__sep"></span>
      <template v-if="isLive">
        <span class="mk-status__meta">总数 {{ total }}</span>
        <span class="mk-status__meta">待处理 {{ pendingCount }}</span>
        <span v-if="recent30 != null" class="mk-status__meta">近 30 天 {{ recent30 }}</span>
      </template>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="() => load(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </div>

    <!-- 刷新失败但仍有旧数据：轻量错误横幅（区别于首载失败全屏态） -->
    <div v-if="loadFailed && rows.length" class="mk-alert" role="alert">
      刷新失败，当前显示上次加载的数据。
      <button type="button" class="mk-link" @click="() => load(true)">重试</button>
    </div>

    <!-- 加载失败（首载无数据时优先于空态展示，含重试） -->
    <MkEmptyState
      v-if="loadFailed && !rows.length"
      icon="◌"
      title="反馈数据加载失败"
      description="无法从后端拉取反馈列表。"
      action-text="重试"
      min
      @action="() => load(true)"
    />

    <template v-else>
      <!-- 列表 -->
      <div class="mk-card mk-card--fill">
        <div class="mk-card__head">
          <div class="mk-filter">
            <MkFilterSearch v-model="keyword" placeholder="搜索用户 / 评论 / 任务" />
            <div class="mk-pills">
              <button
                v-for="p in statusPills"
                :key="p.id"
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': statusFilter === p.id }"
                :aria-pressed="statusFilter === p.id"
                @click="statusFilter = statusFilter === p.id ? '' : p.id"
              >
                {{ p.label }}<span class="mk-pill__count">{{ p.count }}</span>
              </button>
            </div>
            <div class="mk-pills">
              <button
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': lowOnly }"
                :aria-pressed="lowOnly"
                @click="lowOnly = !lowOnly"
              >
                仅低分 ≤2<span class="mk-pill__count">{{ lowCount }}</span>
              </button>
            </div>
            <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
          </div>
          <span class="mk-card__head-right">
            <span class="mk-card__meta">{{ filtered.length }} / {{ rows.length }}</span>
          </span>
        </div>

        <div v-if="filtered.length" class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap；
             评论/节点/策略列由 fb- 局部 max-width 截断兜底（全文在 title） -->
        <table class="mk-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="fbSortState('user')"
                @click="toggleFbSort('user')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleFbSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--right mk-th--sortable"
                :aria-sort="fbSortState('rating')"
                @click="toggleFbSort('rating')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleFbSort('rating')">评分<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th>评论</th>
              <th>节点</th>
              <th>策略</th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="fbSortState('status')"
                @click="toggleFbSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleFbSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th>时间</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paged" :key="r.id" class="fb-row" tabindex="0" @click="openDetail(r)" @keydown.enter="($event.target === $event.currentTarget) && openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.userName }}</strong>
                  <span class="mk-cell-sub">{{ r.userEmail }}</span>
                </div>
              </td>
              <td class="mk-num">
                <span class="fb-rating" :class="{ 'fb-rating--low': r.rating <= 2 }">
                  <span class="mk-dots" :class="{ 'mk-dots--warn': r.rating <= 2 }" role="img" :aria-label="`评分 ${r.rating}/5`">
                    <i v-for="d in 5" :key="d" :class="{ 'is-on': d <= r.rating }"></i>
                  </span>
                  <b class="mono">{{ r.rating }}</b>
                </span>
              </td>
              <td><span class="fb-comment" :title="r.comment">{{ r.comment || '—' }}</span></td>
              <td><span class="mono fb-agent">{{ r.agentId || '—' }}</span></td>
              <td><span class="fb-strategy">{{ r.strategy || '—' }}</span></td>
              <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td><span class="mk-cell-sub">{{ r.createdAt }}</span></td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click.stop="openDetail(r)">处理</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <MkLoading v-else-if="loading" min text="正在从后端拉取反馈。" />
        <MkEmptyState
          v-else
          icon="◌"
          min
          :title="isFiltered ? '当前筛选无匹配' : '暂无反馈'"
          :description="isFiltered ? '放宽筛选条件试试。' : '学习者评分与评论出现后会在这里汇总，低分反馈会自动标记「待处理」。'"
          :action-text="isFiltered ? '清除筛选' : '刷新'"
          @action="isFiltered ? clearFilters() : load(true)"
        />
      </div>
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片 -->
      <Pagination
        v-if="filtered.length"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </template>

    <!-- 处理面板（mk-drawer 体系：暗色/4K 由全局接管） -->
    <Teleport to="body">
      <div v-if="detail" ref="maskRef" class="mk-drawer">
        <div class="mk-drawer__mask" @click="detail = null"></div>
        <aside ref="panelRef" class="mk-drawer__panel fb-panel" role="dialog" aria-label="反馈详情">
          <!-- 头部（原型 .ovl__head：标题 + grow + 关闭钮，下边框）：状态徽章下沉到正文首段徽章行 -->
          <header class="mk-drawer__head">
            <div class="mk-drawer__heading">
              <h3 class="mk-drawer__title">{{ detail.userName }} 的反馈</h3>
              <span class="mk-drawer__sub mono">{{ detail.id }}</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="detail = null">✕</button>
          </header>
          <div class="mk-drawer__body fb-body">
            <!-- 首段徽章行（原型 .ovl__body 首段 pills）：状态 / 难度适配 / UI 类型 / 轮次（均为行上已有字段） -->
            <div class="fb-pills">
              <span class="mk-badge" :class="statusBadge(detail.status)">{{ statusLabel(detail.status) }}</span>
              <span v-if="detail.difficultyFit" class="mk-badge mk-badge--muted">难度适配 {{ detail.difficultyFit }}</span>
              <span v-if="detail.uiType" class="mk-badge mk-badge--muted">{{ detail.uiType }}</span>
              <span v-if="detail.roundNumber != null" class="mk-badge mk-badge--muted">轮次 {{ detail.roundNumber }}</span>
            </div>
            <!-- 事实清单（原型 dl.kv → 共享 mk-facts 栅格）：三维评分带点阵；id 类格单行省略、全文在 title -->
            <div class="mk-facts">
              <div><span>评分</span><span class="mk-dots" :class="{ 'mk-dots--warn': detail.rating <= 2 }" role="img" :aria-label="`评分 ${detail.rating}/5`"><i v-for="d in 5" :key="d" :class="{ 'is-on': d <= detail.rating }"></i></span><strong class="mono">{{ detail.rating }}/5</strong></div>
              <div><span>有用度</span><span class="mk-dots" role="img" :aria-label="`有用度 ${detail.helpfulness ?? '—'}/5`"><i v-for="d in 5" :key="d" :class="{ 'is-on': detail.helpfulness != null && d <= detail.helpfulness }"></i></span><strong class="mono">{{ detail.helpfulness ?? '—' }}</strong></div>
              <div><span>清晰度</span><span class="mk-dots" role="img" :aria-label="`清晰度 ${detail.clarity ?? '—'}/5`"><i v-for="d in 5" :key="d" :class="{ 'is-on': detail.clarity != null && d <= detail.clarity }"></i></span><strong class="mono">{{ detail.clarity ?? '—' }}</strong></div>
              <div><span>难度</span><span class="mk-dots" role="img" :aria-label="`难度 ${detail.difficulty ?? '—'}/5`"><i v-for="d in 5" :key="d" :class="{ 'is-on': detail.difficulty != null && d <= detail.difficulty }"></i></span><strong class="mono">{{ detail.difficulty ?? '—' }}</strong></div>
              <div><span>节点</span><strong class="mono" :title="detail.agentId || ''">{{ detail.agentId || '—' }}</strong></div>
              <div><span>策略</span><strong :title="detail.strategy || ''">{{ detail.strategy || '—' }}</strong></div>
              <div><span>任务</span><strong class="mono" :title="detail.taskId || ''">{{ detail.taskId || '—' }}</strong></div>
              <div><span>会话</span><strong class="mono" :title="detail.sessionId || ''">{{ detail.sessionId || '—' }}</strong></div>
            </div>

            <section v-if="detail.comment" class="fb-section">
              <header class="mk-section__head"><h4>评论</h4></header>
              <p class="fb-text">{{ detail.comment }}</p>
            </section>
            <section v-if="detail.suggestions" class="fb-section">
              <header class="mk-section__head"><h4>建议</h4></header>
              <p class="fb-text">{{ detail.suggestions }}</p>
            </section>
            <section v-if="detail.confusionPoint" class="fb-section">
              <header class="mk-section__head"><h4>困惑点</h4></header>
              <p class="fb-text">{{ detail.confusionPoint }}</p>
            </section>
            <section v-if="detail.reasonCodes.length" class="fb-section">
              <header class="mk-section__head"><h4>原因标签</h4></header>
              <div class="fb-codes">
                <span v-for="c in detail.reasonCodes" :key="c" class="mk-badge mk-badge--muted mono">{{ c }}</span>
              </div>
            </section>

            <section class="fb-section">
              <header class="mk-section__head"><h4>内部备注</h4></header>
              <textarea v-model="noteDraft" class="fb-note" rows="3" placeholder="处理记录、归因、跟进结论…"></textarea>
            </section>
          </div>
          <!-- 底部动作（原型 .ovl__foot：取消/忽略在左、主钮最右、常驻滚动区外；同 gc-detail__foot 判例） -->
          <footer class="mk-drawer__foot">
            <button type="button" class="mk-btn mk-btn--ghost" :disabled="saving" @click="save('dismissed')">忽略</button>
            <button type="button" class="mk-btn mk-btn--ok" :disabled="saving" @click="save('resolved')">标记已解决</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="saving" @click="save('triaged')">
              {{ saving ? '保存中…' : '标记已分流' }}
            </button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { isLive, intent } from './store'
import { errMsg, timeAgo, isPageCacheFresh, markPageFetched } from './live'
import { adminFeedbackApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import { useTableSort } from './useTableSort'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'

/** 嵌入模式：作为运营中心「反馈」tab 渲染（仅去掉外层状态条；宿主承载域计数）。
    count 事件：反馈总数上报（宿主「反馈 N」徽章） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ (e: 'count', total: number): void }>()

type Status = 'new' | 'triaged' | 'resolved' | 'dismissed'

interface Row {
  id: string
  userName: string
  userEmail: string
  rating: number
  comment: string
  agentId: string
  strategy: string
  uiType: string
  taskId: string
  sessionId: string
  status: Status
  createdAt: string
}

interface Detail extends Row {
  helpfulness: number | null
  clarity: number | null
  difficulty: number | null
  difficultyFit: string
  roundNumber: number | null
  suggestions: string
  confusionPoint: string
  reasonCodes: string[]
  internalNote: string
}

const loading = ref(false)
/** live 拉取失败 → 行内错误态（区别于真正无数据的空态） */
const loadFailed = ref(false)
const saving = ref(false)
const rows = ref<Row[]>([])
const total = ref(0)
const pendingCount = ref(0)
const recent30 = ref<number | null>(null)

/** 宿主域计数徽章（embedded 才消费）：总数就绪/变化即上报 */
watch(total, (n) => {
  emit('count', n)
}, { immediate: true })
const keyword = ref('')
const statusFilter = ref('')
const lowOnly = ref(false)
const detail = ref<Detail | null>(null)
const noteDraft = ref('')
useEscape(() => !!detail.value, () => { detail.value = null })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!detail.value), panelRef)
useMaskClose(maskRef, () => { detail.value = null })

const statusPills = computed(() => {
  const all = rows.value
  return [
    { id: 'new', label: '待处理', count: all.filter((r) => r.status === 'new').length },
    { id: 'triaged', label: '已分流', count: all.filter((r) => r.status === 'triaged').length },
    { id: 'resolved', label: '已解决', count: all.filter((r) => r.status === 'resolved').length },
    { id: 'dismissed', label: '已忽略', count: all.filter((r) => r.status === 'dismissed').length }
  ]
})
/** 低分（≤2）条数：供「仅低分」pill 计数 */
const lowCount = computed(() => rows.value.filter((r) => r.rating <= 2).length)

const statusLabel = (s: string) =>
  ({ new: '待处理', triaged: '已分流', resolved: '已解决', dismissed: '已忽略' })[s] || s || '—'
const statusBadge = (s: string) =>
  s === 'resolved' ? 'mk-badge--ok' : s === 'new' ? 'mk-badge--warn' : s === 'triaged' ? 'mk-badge--info' : 'mk-badge--muted'

function mapRow(f: Record<string, unknown>): Row {
  const u = (f.user as Record<string, unknown>) || {}
  return {
    id: String(f.id),
    userName: String(u.name || f.userId || '—'),
    userEmail: String(u.email || ''),
    rating: Number(f.rating || 0),
    comment: String(f.comment || ''),
    agentId: String(f.agentId || ''),
    strategy: String(f.strategy || ''),
    uiType: String(f.uiType || ''),
    taskId: String(f.taskId || ''),
    sessionId: String(f.sessionId || ''),
    status: (f.status as Status) || 'new',
    createdAt: timeAgo(String(f.createdAt || ''))
  }
}

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const { toggle: toggleFbSort, sortState: fbSortState, sortRows: sortFbRows } = useTableSort<Row>({
  accessors: {
    user: (r) => r.userName,
    rating: (r) => r.rating,
    status: (r) => r.status
  },
  storageKey: 'wf_feedback_sort'
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return sortFbRows(rows.value.filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false
    if (lowOnly.value && r.rating > 2) return false
    if (!k) return true
    return `${r.userName} ${r.userEmail} ${r.comment} ${r.taskId}`.toLowerCase().includes(k)
  }))
})

const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value || lowOnly.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
  lowOnly.value = false
}

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   筛选/数据变化自动回第 1 页（watch filtered） */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch(filtered, () => {
  page.value = 1
})

async function load(force?: boolean) {
  if (loading.value) return
  if (!force && isPageCacheFresh('feedback') && rows.value.length) return
  loading.value = true
  loadFailed.value = false
  try {
    const [listRes, newRes, trendRes] = await Promise.all([
      adminFeedbackApi.list({ limit: 1000 }),
      adminFeedbackApi.list({ limit: 1, status: 'new' }).catch(() => null),
      adminFeedbackApi.getTrend(30).catch(() => null)
    ])
    const body = listRes.data?.data ?? listRes.data ?? []
    rows.value = (Array.isArray(body) ? body : body.items || []).map(mapRow)
    total.value = Number(listRes.data?.pagination?.total ?? rows.value.length)
    pendingCount.value = Number(newRes?.data?.pagination?.total ?? rows.value.filter((r) => r.status === 'new').length)
    const trend = trendRes?.data?.data ?? trendRes?.data
    recent30.value = Array.isArray(trend) ? trend.reduce((s: number, d: Record<string, unknown>) => s + Number(d.count || d.total || 0), 0) : null
  } catch (e) {
    loadFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
    markPageFetched('feedback')
  }
}

async function openDetail(r: Row) {
  detail.value = {
    ...r,
    helpfulness: null,
    clarity: null,
    difficulty: null,
    difficultyFit: '',
    roundNumber: null,
    suggestions: '',
    confusionPoint: '',
    reasonCodes: [],
    internalNote: ''
  }
  noteDraft.value = ''
  try {
    const res = await adminFeedbackApi.getDetail(r.id)
    const f = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    detail.value = {
      ...detail.value!,
      helpfulness: f.helpfulness != null ? Number(f.helpfulness) : null,
      clarity: f.clarity != null ? Number(f.clarity) : null,
      difficulty: f.difficulty != null ? Number(f.difficulty) : null,
      difficultyFit: String(f.difficultyFit || ''),
      roundNumber: f.roundNumber != null ? Number(f.roundNumber) : null,
      suggestions: String(f.suggestions || ''),
      confusionPoint: String(f.confusionPoint || ''),
      reasonCodes: Array.isArray(f.reasonCodes) ? (f.reasonCodes as string[]) : [],
      internalNote: String(f.internalNote || '')
    }
    noteDraft.value = detail.value.internalNote
  } catch (e) {
    toast.error(`详情加载失败：${errMsg(e)}`)
  }
}

async function save(status: Status) {
  const d = detail.value
  if (!d || saving.value) return
  saving.value = true
  try {
    await adminFeedbackApi.update(d.id, { status, internalNote: noteDraft.value.trim() || null })
    d.status = status
    d.internalNote = noteDraft.value.trim()
    const row = rows.value.find((x) => x.id === d.id)
    if (row) row.status = status
    if (status === 'resolved' || status === 'dismissed') detail.value = null
    pendingCount.value = rows.value.filter((x) => x.status === 'new').length
    toast.success(`已标记为${statusLabel(status)}`)
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

/** 宿主刷新联动（运营中心宿主「刷新」按钮 → 强制重拉） */
defineExpose({ refresh: () => { void load(true) } })

onMounted(() => {
  /* 深链：运营中心「待处理反馈」→ 预筛待处理（消费后清空，避免菜单直达被残留污染；
     与 GoalConversations 消费 intent.statusFilter==='failed' 同构） */
  if (intent.statusFilter === 'new') {
    statusFilter.value = 'new'
    intent.statusFilter = ''
  }
  void load()
})
</script>

<style scoped>
/* 嵌入模式（运营中心宿主 flex 列内）：占满剩余高度，表格区内滚（对齐 oc-embedded 先例） */
.fb-embedded { flex: 1; min-height: 0; overflow: hidden; }
.fb-row { cursor: pointer; }
.fb-rating { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.fb-rating b { font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.fb-rating--low, .fb-rating--low b { color: var(--mk-red); }
.fb-comment {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--mk-muted);
}
/* 原型 .tbl td：nowrap（长内容由下方 fb- 截断与 mk-cell-main 全局 max-width 兜底） */
.fb-row td { white-space: nowrap; }
.fb-agent {
  display: inline-block;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.fb-strategy {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}

/* 处理面板：mk-drawer 体系（遮罩/面板/头/体/关闭按钮由全局类提供；
   fb- 仅保留内容区布局与覆盖层内细节样式） */
/* 抽屉内容区：mk-drawer__body 提供滚动/内边距，此处补纵向排布（原型 .ovl__body grid gap16） */
.fb-body { display: grid; gap: 16px; align-content: start; }
/* 首段徽章行（原型 .ovl__body 首段 pills）：状态 / 难度适配 / UI 类型 / 轮次 */
.fb-pills { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }

/* 事实栅格走共享原语 .mk-facts（原 .fb-facts 私有三列栅格 + 4K 阶梯已并进原语层） */

.fb-section { display: grid; gap: 8px; }
.fb-text { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.7; white-space: pre-wrap; }
/* 原因标签：胶囊走共享 mk-badge--muted（原自搓 .fb-code 已并入原语） */
.fb-codes { display: flex; gap: 6px; flex-wrap: wrap; }
.fb-note {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  font: inherit;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  resize: vertical;
  line-height: 1.6;
}
.fb-note:focus { outline: none; border-color: var(--mk-blue); }

/* 4K：内容区字号跟随壳层放大（面板宽度/头/体由 mk-drawer 全局档接管） */
@media (min-width: 2000px) {
  .fb-text { font-size: var(--mk-fs-body); }
  .fb-note { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .fb-text { font-size: var(--mk-fs-body); }
  .fb-note { font-size: var(--mk-fs-body); }
}
/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
  .fb-text { font-size: var(--mk-fs-emphasis); }
  .fb-note { font-size: var(--mk-fs-emphasis); }
}

/* 暗色模式（D1 补完）：fb- 内容区细节（面板底色/头/体已由 mk-drawer 全局接管） */
html[data-theme='dark'] {
  .fb-note { background: #19191a; border-color: var(--wf-border-light); color: var(--mk-ink); }
  .fb-note:focus { border-color: var(--mk-blue); }
}
</style>
