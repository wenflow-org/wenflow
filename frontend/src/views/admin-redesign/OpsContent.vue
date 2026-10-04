<template>
  <div :class="embedded ? 'mk-page--fill oc-embedded' : 'mk-page mk-page--fill'">
    <!-- 学习路径页头（单行状态条：页面名 + 口径副文 + 四态可点计数 + 里程碑/任务总量 + 刷新）
         embedded（学习会话合并宿主）时由宿主状态条承载域计数，本组件不再渲染状态条
         副文 = 原型 renderPaths pageTitle 的 sub：「由目标澄清生成的阶段式路径与推进状态」 -->
    <!-- 页头（mk-pagehead 标准形态，2026-10-03 用户拍板全站统一）：标题+口径副文+刷新。
         原状态条顶替页头的「页面名/副文」上收，状态条只留 点色 + 可点计数 + 总量口径 -->
    <MkPageHead v-if="!embedded" title="学习路径" sub="由目标澄清生成的阶段式路径与推进状态">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="reload(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>
    <div v-if="!embedded" class="mk-status" :class="`mk-status--${dashTone}`">
      <span class="mk-status__dot"></span>
      <!-- P2（2026-10-04 全站评审）：四态计数撤除——与下方 pills（窗口口径）/分布卡比例条（全量）
           同屏三层复读；筛选唯一入口=pills，状态条回归纯口径句 + 「生成失败」红链（需关注结论位） -->
      <button
        v-if="byStatus('failed') > 0"
        type="button"
        class="mk-status__meta mk-status__meta-link mk-status__meta--bad"
        title="点击只看生成失败的路径；失败可在路径详情页重规划（该计数为服务端全量口径）"
        @click="statusFilter = statusFilter === 'failed' ? '' : 'failed'"
      >生成失败 {{ byStatus('failed') }}（可重规划）</button>
      <span class="mk-status__meta" title="仅真实用户（不含模拟账号）；切换「含模拟」后显示全量并灰标模拟行">共 {{ stats?.total ?? '—' }} 条 · 里程碑 {{ stats?.totalMilestones ?? '—' }} · 任务 {{ stats?.totalTasks ?? '—' }}</span>
    </div>

    <!-- 路径状态分布（newui 原型 renderPaths「路径状态分布」移植）。数据源 = loadStats 已拉的
         adminLearningContentApi.getStats() 的 byStatus（服务端按状态 group-by 的全平台计数，
         服务端 60s 缓存）——响应自带逐状态计数，无需 dashboard 兜底推导，零新增请求。
         本页唯一统计带 = 顶部状态条（2026-10-02 用户拍板「也是kpi问题」撤 KPI 栅格：
         原型 renderPaths 无 KPI 板块，总数/里程碑/任务/已下线已单源住在状态条 meta）。
         embedded 时整卡隐藏（宿主状态条已承载四态计数）；stats 拉取失败或全零时
         整卡 v-if 静默隐藏，不留空卡 -->
    <section v-if="!embedded && pathBandReady" class="mk-card">
      <div class="mk-card__head">
        <span class="mk-card__title">路径状态分布</span>
        <!-- P2（2026-10-04 全站评审）：卡头「共 N 条」与「N 条已完成」badge 撤——总数住状态条、
             分态数字住比例条悬停（title），本卡只做形态呈现不做第二处计数 -->
        <span class="mk-card__meta">按状态聚合 · 悬停分段看各状态条数</span>
      </div>
      <div class="oc-bandcard__body">
        <div class="stageband">
          <span
            v-for="seg in pathBandSegments"
            :key="seg.key"
            :style="{ width: seg.pct, background: seg.tone }"
            :title="`${seg.name} · ${seg.n}`"
          ></span>
        </div>
        <div class="stageband__legend">
          <div v-for="seg in pathBand" :key="seg.key" class="sbl">
            <span class="sbl__sw" :style="{ background: seg.tone }"></span>
            <span class="sbl__name">{{ seg.name }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 筛选 + 列表（单行头部与教学会话/目标对话 tab 一致：pill 组 + 搜索 + 数据口径 + 列显隐） -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- P1#9 口径标注 / P2（2026-10-04 全站评审）：pills 是全页唯一筛选面与分态计数位——
               pill 计数 = 当前列表窗口（最近 1000 条，随「含模拟」切换），与 stats 全量口径不同源
               （getStats 端点不接受 includeTest 参数，重拉拿回的还是同一份全量计数，同步是无效
               请求；pill 是本地筛选控件，计数本就该与所筛列表一致）。此前状态条/分布卡与 pills
               同屏三层复读同组数字，已收敛：状态条只留口径句+生成失败红链，分布卡只留比例条。 -->
          <div class="mk-pills" title="pill 计数 = 当前列表窗口内计数（最近 1000 条，随「含模拟」切换），非全量；全量分布见「路径状态分布」卡（悬停分段看条数）">
            <button
              v-for="p in statusPills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': statusFilter === p.id }"
              :aria-pressed="statusFilter === p.id"
              :title="p.id === 'failed' ? '生成失败的路径；行内「去详情」进详情页可重规划' : undefined"
              @click="statusFilter = statusFilter === p.id ? '' : p.id"
            >
              {{ p.label }}<span class="mk-pill__count">{{ p.count }}</span>
            </button>
          </div>
          <MkFilterSearch v-model="keyword" placeholder="搜索标题 / 用户 / ID" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
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
        <button type="button" class="mk-link" @click="reload(true)">重试</button>
      </div>
      <div v-else-if="filtered.length" class="mk-table-scroll oc-list">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap、
             列按内容自然分宽；长标题/长主题由 .mk-cell-main/.mk-cell-text 的 max-width 截断兜底
             （同 GoalConversations 判例）。此前 fixed+colgroup 是为压制超长主题列，截断类已兜住 -->
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ocSortState('path')"
                @click="toggleOcSort('path')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('path')">路径<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('subject')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ocSortState('subject')"
                @click="toggleOcSort('subject')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('subject')">主题<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('difficulty')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ocSortState('difficulty')"
                @click="toggleOcSort('difficulty')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('difficulty')">难度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('hours')"
                scope="col"
                class="mk-th--sortable mk-th--right"
                :aria-sort="ocSortState('hours')"
                @click="toggleOcSort('hours')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('hours')">时长<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="!hiddenCols.has('user')">用户</th>
              <th
                v-if="!hiddenCols.has('status')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ocSortState('status')"
                @click="toggleOcSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('progress')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ocSortState('progress')"
                @click="toggleOcSort('progress')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('progress')">进度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('updated')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ocSortState('updated')"
                @click="toggleOcSort('updated')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('updated')">更新<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 行点击进路径详情二级页（原型 tr data-action="open-path" 进 renderPathDetail，
                 不再开抽屉；键盘可达性同 gc-row/ts-row 判例：tabindex + Enter 触发） -->
            <tr
              v-for="p in paged"
              :key="p.id"
              tabindex="0"
              @click="openPath(p)"
              @keydown.enter.prevent="openPath(p)"
            >
              <td>
                <div class="mk-cell-main">
                  <strong class="mk-cell-text">{{ p.title }}</strong>
                  <span class="mk-cell-sub" :title="p.id">{{ shortId(p.id, 10, 4) }}</span>
                </div>
              </td>
              <td v-if="!hiddenCols.has('subject')"><span class="mk-cell-text" :title="p.subject || ''">{{ p.subject || '—' }}</span></td>
              <td v-if="!hiddenCols.has('difficulty')">
                <!-- 难度：只有三个枚举值可判；老数据里混着 unknown 与自述整句（~35%），
                     一律显示「未知」，原文进 title，不把半句话当难度展示 -->
                <span class="oc-diff" :title="difficultyTitle(p.difficulty)">{{ difficultyText(p.difficulty) }}</span>
              </td>
              <td v-if="!hiddenCols.has('hours')" class="mk-num">{{ p.estimatedHours ? `~${p.estimatedHours}h` : '—' }}</td>
              <td v-if="!hiddenCols.has('user')">
                <!-- 原型学习者格 .celluser = 首字母头像 + 姓名；tone 与行内虚拟/测试标记同语义
                     （MkCellAvatar 共享原语，同 GoalConversations 用户格） -->
                <div class="oc-user">
                  <MkCellAvatar
                    :name="p.user?.name"
                    :tone="p.user?.isVirtualLearner ? 'virtual' : p.isTestAccount ? 'test' : 'default'"
                  />
                  <div class="mk-cell-main">
                    <strong>{{ p.user?.name || '—' }}</strong>
                    <span class="mk-cell-sub">{{ p.user?.email || '' }}</span>
                  </div>
                </div>
                <div class="oc-tags">
                  <MkVariantBadge v-if="p.user?.isVirtualLearner" kind="virtual" />
                  <MkVariantBadge v-else-if="p.isTestAccount" kind="test" />
                </div>
              </td>
              <td v-if="!hiddenCols.has('status')"><span class="mk-badge" :class="statusBadge(p.status)">{{ statusText(p.status) }}</span></td>
              <td v-if="!hiddenCols.has('progress')">
                <div class="oc-progress" :title="`${p.completedMilestones}/${p.totalMilestones} 里程碑`">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(p)" :style="{ width: progressPct(p) + '%' }"></span></span>
                  <span class="oc-progress__num">{{ progressPct(p) }}%</span>
                </div>
              </td>
              <td v-if="!hiddenCols.has('updated')" :title="fmtDate(p.updatedAt)"><span class="mk-cell-sub mono">{{ timeAgo(p.updatedAt) }}</span></td>
              <td>
                <!-- 操作列文字钮（原型 renderPaths 操作列 btn--sm「详情/下线」+ ⋯ 菜单）；
                     右对齐与 mk-th--right 表头对齐（同 GoalConversations/Users 判例） -->
                <div class="mk-actions">
                  <!-- 失败行（P2 顺手）：「去详情」替代「详情」——重规划端点在后端不做（登记），
                       详情页已有重规划动作，按钮就地改名+title 指路，不再让失败行与普通行同貌 -->
                  <button
                    type="button"
                    class="mk-btn mk-btn--sm"
                    :title="p.status === 'failed' ? '该路径生成失败：详情页可重规划' : undefined"
                    @click.stop="openPath(p)"
                  >{{ p.status === 'failed' ? '去详情' : '详情' }}</button>
                  <button v-if="p.status !== 'archived'" type="button" class="mk-btn mk-btn--sm" :disabled="p.busy" @click.stop="archive(p)">下线</button>
                  <button v-else type="button" class="mk-btn mk-btn--sm" :disabled="p.busy" @click.stop="restore(p)">恢复</button>
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
      <MkLoading v-else-if="loading" />
      <MkEmptyState
        v-else
        icon="◌"
        :title="keyword || statusFilter ? '当前筛选无匹配' : '没有学习路径'"
        :description="keyword || statusFilter ? '放宽筛选条件试试。' : '用户的目标对话生成路径后，会出现在这里。'"
        :action-text="isFiltered ? '清除筛选' : ''"
        @action="clearFilters"
      />

      <Pagination
        v-if="filtered.length > pageSize"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { timeAgo, errMsg, shortId, isPageCacheFresh, markPageFetched } from './live'
import { intent, openSubPage } from './store'
import { adminLearningContentApi, type LearningContentStats, type LearningPathRow } from '@/api/adminApi'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import { useTableSort } from './useTableSort'
import { useRowMenu } from './useRowMenu'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import { statusText, statusBadge } from './opsShared'

/** 嵌入模式：作为「目标对话」页内「学习路径」tab 渲染（隐藏页面壳与状态条，筛选/表格/抽屉保留）；
    initialStatus：宿主深链预筛（如工作台「生成失败路径」→ 'failed'），挂载时应用。
    （原 count/stats 上报链随合并宿主退役，2026-10-02 撤页头 KPI 区时一并清除） */
const props = withDefaults(defineProps<{ embedded?: boolean; initialStatus?: string }>(), { embedded: false, initialStatus: '' })

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
const statusPills = computed(() => {
  const all = rows.value
  return [
    { id: 'active', label: '学习中', count: all.filter((p) => p.status === 'active').length },
    { id: 'completed', label: '已完成', count: all.filter((p) => p.status === 'completed').length },
    { id: 'failed', label: '生成失败', count: all.filter((p) => p.status === 'failed').length },
    { id: 'archived', label: '已下线', count: all.filter((p) => p.status === 'archived').length }
  ]
})

/* 列显隐（与同页其他列表一致）：路径/操作固定，其余可隐藏 */
const colDefs = [
  { key: 'subject', label: '主题', title: '路径主题（学科或目标）' },
  { key: 'difficulty', label: '难度', title: '路径难度：由目标对话里的水平自述归一（入门/进阶/高阶）；无法判断时为未知' },
  { key: 'hours', label: '时长', title: '预计学习时长（后端 estimatedHours 估算值，带 ~ 表示近似）' },
  { key: 'user', label: '用户', title: '所属用户' },
  { key: 'status', label: '状态', title: '路径状态' },
  { key: 'progress', label: '进度', title: '里程碑完成进度' },
  { key: 'updated', label: '更新时间', title: '最近更新' }
] as const
const hiddenCols = ref<Set<string>>(new Set())

/* 状态条四态计数 + 基调（与目标对话/教学会话同形态：失败>0 警示琥珀，空库静默） */
const byStatus = (s: string) => stats.value?.byStatus?.[s] || 0

/* 生成失败抬红（bad，P2）：与 OpsHub 待办的 failed=红对齐（此前本页只 warn 琥珀，
   同一「生成失败」跨页两级着色）；空库静默 */
const dashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() => {
  if (!stats.value || stats.value.total === 0) return 'muted'
  if ((stats.value.byStatus?.failed || 0) > 0) return 'bad'
  return 'ok'
})

/* ===== 路径状态分布（newui 原型 renderPaths「路径状态分布」移植）=====
   数据源 = adminLearningContentApi.getStats() 的 byStatus（loadStats 已拉取；服务端按状态
   group-by 的全平台计数，非本页 1000 条窗口推导）。文案复用 opsShared 的 statusText
   （与「状态」列同一套）。tone：学习中蓝 / 已完成绿 / 生成失败红 / 已下线灰；
   byStatus 里四枚举之外的取值归「其它」档（仅实际出现时追加）。 */
const PATH_BAND_TONE: Record<string, string> = {
  active: 'var(--mk-blue)',
  completed: 'var(--mk-green)',
  failed: 'var(--mk-red)',
  archived: 'var(--mk-faint)'
}
interface PathBandEntry { key: string; name: string; n: number; tone: string }
const pathBand = computed<PathBandEntry[]>(() => {
  const entries: PathBandEntry[] = Object.entries(PATH_BAND_TONE).map(([key, tone]) => ({
    key,
    name: statusText(key),
    n: byStatus(key),
    tone
  }))
  let other = 0
  for (const [k, n] of Object.entries(stats.value?.byStatus || {})) {
    if (!(k in PATH_BAND_TONE)) other += Number(n) || 0
  }
  if (other > 0) entries.push({ key: 'other', name: '其它', n: other, tone: 'var(--mk-faint)' })
  return entries
})
const pathBandTotal = computed(() => pathBand.value.reduce((a, e) => a + e.n, 0))
/* 段宽 = n / 合计（原型 distBand 口径，合计为 0 时按 1 兜底）；零值段不渲染 */
const pathBandSegments = computed(() => {
  const total = pathBandTotal.value || 1
  return pathBand.value
    .filter((e) => e.n > 0)
    .map((e) => ({ ...e, pct: `${(e.n / total) * 100}%` }))
})
/* stats 拉取失败（null）或状态合计为 0 → 整卡隐藏（v-if），不留空卡 */
const pathBandReady = computed(() => !!stats.value && pathBandTotal.value > 0)

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const { toggle: toggleOcSort, sortState: ocSortState, sortRows: sortOcRows } = useTableSort<PathRow>({
  accessors: {
    path: (p) => p.title,
    subject: (p) => p.subject || '',
    /* 难度按语义序排（入门→进阶→高阶→未知），不按字符串字典序 */
    difficulty: (p) => DIFF_ORDINAL[difficultyEnum(p.difficulty)],
    hours: (p) => (typeof p.estimatedHours === 'number' && p.estimatedHours > 0 ? p.estimatedHours : null),
    status: (p) => p.status,
    progress: (p) => progressPct(p),
    updated: (p) => (p.updatedAt ? new Date(p.updatedAt).getTime() : null)
  },
  storageKey: 'wf_ops_content_sort'
})

/* 客户端过滤（与教学会话/目标对话 tab 一致：全量拉最近 1000 条后本地即时过滤，无「查询」按钮） */
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return sortOcRows(rows.value.filter((p) => {
    if (statusFilter.value && p.status !== statusFilter.value) return false
    if (!k) return true
    return `${p.title} ${p.user?.name || ''} ${p.user?.email || ''} ${p.subject || ''}`.toLowerCase().includes(k)
  }))
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
/* 进度条三态（P2）：100% = 绿（ok）/ 失败 = 红（bad）/ 其余（含进行中）= 默认中性蓝——
   此前进行中一律琥珀（warn），满屏琥珀稀释真异常，也读不出「快好了」。 */
const progressTone = (p: PathRow) => {
  if (p.status === 'failed') return 'bad'
  return progressPct(p) >= 100 ? 'ok' : ''
}
/* 难度口径：后端 normalizePathDifficulty 产出 beginner/intermediate/advanced/unknown 四值，
   但存量里还混着 normalize 之前写进去的短词（零基础/入门级…）与自述整句，共约 35%。
   前端只认三个语义值 + 少量短词别名，其余一律「未知」（原文进 title）；
   绝不把半句自述或英文 unknown 当难度展示——这正是旧副行直出的老毛病。 */
type DiffEnum = 'beginner' | 'intermediate' | 'advanced' | 'unknown'
const DIFF_ENUM_BY_ALIAS: Record<string, Exclude<DiffEnum, 'unknown'>> = {
  beginner: 'beginner', 零基础: 'beginner', 零编程: 'beginner', 入门级: 'beginner', 初级: 'beginner', 新手: 'beginner',
  intermediate: 'intermediate', 中级: 'intermediate', 进阶: 'intermediate',
  advanced: 'advanced', 高级: 'advanced', 资深: 'advanced',
}
const DIFF_TEXT: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高阶' }
const DIFF_ORDINAL: Record<DiffEnum, number> = { beginner: 0, intermediate: 1, advanced: 2, unknown: 3 }

function difficultyEnum(d?: string | null): DiffEnum {
  return DIFF_ENUM_BY_ALIAS[String(d || '').trim().toLowerCase()] || 'unknown'
}
const difficultyText = (d?: string | null): string => DIFF_TEXT[difficultyEnum(d)] || '未知'
/** 悬停说明：枚举值给官方口径，非枚举值把原文摊开（老数据里的自述整句） */
const difficultyTitle = (d?: string | null): string => {
  const e = difficultyEnum(d)
  if (e !== 'unknown') return `路径难度：${DIFF_TEXT[e]}（来源：目标对话中的水平自述）`
  const raw = String(d || '').trim()
  return raw && raw !== 'unknown'
    ? `无法归一到难度枚举，原始记录：${raw}`
    : '目标对话里没有可判断水平的自述，未归入任何难度档'
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function reload(force = false) {
  // 页面级 TTL 缓存（与另两 tab 同款模式）：显式刷新/口径切换传 force 绕过；
  // 切走再切回（embedded 下重新挂载触发 onMounted）时 TTL 内且已有数据则跳过重拉
  if (!force && isPageCacheFresh('learning-paths') && rows.value.length) return
  loading.value = true
  failed.value = false
  try {
    /* 全量拉最近 1000 条后客户端过滤（与教学会话/目标对话一致；筛选即时响应，无服务端往返） */
    const res = await adminLearningContentApi.listPaths({
      page: 1,
      limit: 1000,
      includeTest: includeTest.value || undefined,
    })
    const body = res.data?.data ?? res.data ?? {}
    rows.value = (body.paths || []).map((p: PathRow) => ({ ...p, busy: false }))
    total.value = body.pagination?.total ?? rows.value.length
    // 仅成功后标记缓存：失败不缓存，下次进入自动重拉
    markPageFetched('learning-paths')
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
    busy: true,
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.archivePath(p.id)
    p.status = 'archived'
    toast.success('路径已下线')
    void loadStats()
    doneConfirm()
  } catch (e) {
    toast.error(`下线失败：${errMsg(e)}`)
    failConfirm()
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
    danger: false,
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
    busy: true,
  })
  if (!ok) return
  p.busy = true
  try {
    await adminLearningContentApi.deletePath(p.id)
    rows.value = rows.value.filter((x) => x.id !== p.id)
    toast.success('路径已删除')
    void loadStats()
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    p.busy = false
  }
}

/* 行点击进路径详情二级页（原型 renderPaths 行 data-action="open-path" → renderPathDetail；
   2026-10-01 结构详情抽屉随行点击改造整体退役，与教学会话行点击进座舱同一交互习惯） */
function openPath(p: PathRow) {
  closeMenu()
  openSubPage('path', p.id)
}

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()
function menuDetail(p: PathRow) { closeMenu(); openPath(p) }
function menuDelete(p: PathRow) { closeMenu(); void remove(p) }

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
/* 数据隔离切换：仅真实 ↔ 含虚拟/测试（口径变化需绕过 TTL 缓存强制重拉） */
watch(includeTest, () => {
  void reload(true)
})

/* 宿主刷新联动（学习会话合并宿主「刷新」按钮 → 强制重拉：包装 force，TTL 内点击仍生效） */
defineExpose({ reload: () => void reload(true) })
</script>

<style scoped>
/* 页头计数锚点改用全局 .mk-status__meta-link（见 shared.css:136） */
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
  font-size: var(--mk-fs-body);
  font-weight: 600;
  margin: 10px 14px;
}
/* 原型 .tbl td：nowrap（表格已改自动布局，列宽随内容；长内容由截断类兜底） */
.oc-list td { white-space: nowrap; }
.oc-progress { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.oc-progress .mk-minibar { flex: 1; }
.oc-progress__num { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 虚拟/测试行内标记（对齐同页 conversations/teaching 行样式） */
.oc-tags { display: flex; gap: 4px; margin-top: 2px; }
/* 用户格（原型 .celluser = 头像 + 姓名；同 GoalConversations .gc-user 组合） */
.oc-user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.oc-user .mk-cell-main { min-width: 0; flex: 1; }
/* 行点击已升共享契约（table.mk-table--click + tr:focus-visible 原语，2026-10-03） */
/* 主题列：subject 字段或为学科或为生成路径时写入的目标文本（可能很长），单行省略 + hover 全文。
   自动布局下列宽随内容，必须给显式截断上限（截断上限由共享 .mk-cell-text 承担） */
/* 主题列截断走共享 .mk-cell-text（oc-subject 私有复制退役，2026-10-03） */

/* 难度：三个语义值 + 未知；未知降一档灰，不抢视觉 */
.oc-diff { font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: nowrap; }
/* 时长：右对齐等宽数字（与表头 mk-th--right 对齐） */
/* 时长格直出 .mk-num（oc-hours 双层叠写退役，2026-10-03）；右对齐由 .mk-num 承担 */

/* 结构详情抽屉已退役（2026-10-01 行点击改走 PathDetail 二级页）；本页只保留列表自身样式 */

/* 状态分布条已升全局原语（mk-primitives .stageband/.sbl）；.oc-bandcard__body 保留页私有卡体 padding */
.oc-bandcard__body { padding: 12px 16px 16px; }

/* 4K：进度数字跟随全站节奏 */
@media (min-width: 2000px) {
  .oc-progress__num { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .oc-progress__num { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .oc-progress__num { font-size: var(--mk-fs-body); }
}

/* 暗色模式：补齐暗色覆写（原缺失，与全站 Token 红覆盖对齐） */
html[data-theme='dark'] .oc-error { border-color: rgba(248, 113, 113, 0.35); }
</style>
