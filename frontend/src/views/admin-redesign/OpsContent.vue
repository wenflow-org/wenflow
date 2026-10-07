<template>
  <div :class="embedded ? 'mk-page--fill oc-embedded' : 'mk-page mk-page--fill'">
    <!-- 页头（mk-pagehead 标准形态，2026-10-03 用户拍板全站统一）：标题+口径副文+口径开关。
         2026-10-04 页头状态条退役：总量读数迁 MkKpi 卡带，失败抬红归贴表分布条红段 -->
    <MkPageHead v-if="!embedded" title="学习路径" sub="由目标澄清生成的阶段式路径与推进状态">
      <template #actions>
        <!-- 整组统一口径开关（2026-10-04 用户拍板：撤页头刷新钮，学习组六页同一位、同一状态） -->
        <DataScopeToggle v-model="includeTest" />
      </template>
    </MkPageHead>
    <!-- 路径总量 KPI（2026-10-04 状态条退役：原状态条「共 N 条 · 里程碑 · 任务」读数迁入 MkKpi 卡带；
         生成失败抬红由卡内贴表分布条红段单源承载，不再重复着色） -->
    <section v-if="!embedded" class="mk-kpi-grid" aria-label="路径总量">
      <!-- hint = 一短句可见口径（全站家法，TokenCost 判例）；长解释收 title 悬停 -->
      <MkKpi
        label="路径总数"
        :value="stats?.total ?? '—'"
        :hint="includeTest ? '含虚拟学习者与测试账号' : '仅真实用户口径'"
        :title="includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户（不含测试账号）；切换页头「含测试」后显示全量并灰标模拟行'"
      />
      <MkKpi label="里程碑" :value="stats?.totalMilestones ?? '—'" hint="跨全部已生成路径" title="已生成路径的里程碑总数（口径随页头「含测试」开关）" />
      <MkKpi label="任务" :value="stats?.totalTasks ?? '—'" hint="挂在里程碑下" title="已生成路径的任务总数（口径随页头「含测试」开关）" />
    </section>

    <!-- 路径状态分布：教学组标准件 MkDistBand；2026-10-05 用户拍板「分段条在上」——回到卡上方
         页面级（与旧构成带同位）。分段/图例均可点下钻，是本页唯一状态筛选面。数据源与口径不变：
         getStats().byStatus 服务端按状态 group-by 全平台计数（60s 缓存），非本页 1000 条窗口推导；
         embedded 时隐藏（宿主承载域计数）；stats 拉取失败或全零时静默隐藏，不留空带 -->
    <MkDistBand
      v-if="!embedded && pathBandReady"
      card
      class="oc-distband"
      title="路径状态分布"
      :sub="`点击分段只看该状态 · 服务端按状态 group-by 全平台计数（非本页窗口，口径：${includeTest ? '含测试全量' : '仅真实用户'}）`"
      unit="条"
      aria-label="按路径状态筛选"
      :bins="pathBandBins"
      :active-key="statusFilter || null"
      @select="toggleStatusBand"
    />

    <!-- 筛选 + 列表（单行头部与教学会话/目标对话 tab 一致：pill 组 + 搜索 + 数据口径 + 列显隐） -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 状态筛选唯一入口 = 上方「路径状态分布」分布条（2026-10-04 晚：原 pills 与分布条
               同驱一个 statusFilter，同屏两处筛选面退役一处）；pill 计数（窗口口径）随 pills 退役，
               全量计数由分布条图例恒显。此处只留搜索与筛选清理 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索标题 / 用户 / ID" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <!-- 口径切换加载反馈（2026-10-06 审核 F2-3）：切换后列表与统计同时重拉，列表接口实测
               可滞后数秒；期间表格走骨架、KPI 显「—」，此处再给一处文字化「正在加载」，
               让「已切口径但读数未到」有明确反馈（MkLoading 共享原语，含 role=status）。
               常驻卡头不新增布局跳变。 -->
          <MkLoading v-if="loading" inline text="加载中…" />
          <MkCols
            :col-defs="colDefs"
            storage-key="wf_paths_hidden_cols"
            v-model:hidden="hiddenCols"
          />
          <span class="mk-card__meta" :title="includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户'">
            （{{ includeTest ? '含测试' : '仅真实' }}口径）<template v-if="total > rows.length"> · 后端共 {{ total }} 条，仅显示最近 {{ rows.length }} 条</template>
          </span>
        </div>
      </div>

      <MockSkeletonTable v-if="loading && !rows.length" :cols="7" />
      <MkEmptyState
        v-else-if="failed"
        tone="error"
        title="路径列表加载失败"
        :description="loadError"
        action-text="重试"
        :action-busy="loading"
        action-busy-text="重试中…"
        @action="reload(true)"
      />
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap、
             列按内容自然分宽；长标题/长主题由 .mk-cell-main/.mk-cell-text 的 max-width 截断兜底
             （同 GoalConversations 判例）。此前 fixed+colgroup 是为压制超长主题列，截断类已兜住。
             2026-10-06 审核 #56：td nowrap 收敛全局修饰类 .mk-table--nowrap（同批 5 页已挂），
             本页私有 .oc-list td 拷贝与容器钩子 oc-list 随撤 -->
        <table class="mk-table mk-table--click mk-table--nowrap">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="ocSortState('path')"
                @click="toggleOcSort('path')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('path')">路径<span class="mk-th__caret" aria-hidden="true"></span></button></th>
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
              @keydown.enter.self.prevent="openPath(p)"
            >
              <td>
                <div class="mk-cell-main">
                  <!-- 主标识列截断上限 260px（--mk-cell-main-max）：长标题被省略号截断，补 title 全值
                       （同格更次要的 subject/id 副行都有 title，2026-10-06 审核 #37） -->
                  <strong class="mk-cell-text" :title="p.title">{{ p.title }}</strong>
                  <!-- P2-6（2026-10-04 全站评审）：独立「主题」列退役——91% 行与路径列同文
                       （库内 885/951），改作路径副行且仅当 subject≠title 渲染（28/312 行有真增量） -->
                  <span v-if="p.subject && p.subject !== p.title" class="mk-cell-sub" :title="p.subject">{{ p.subject }}</span>
                  <span class="mk-cell-sub" :title="p.id">{{ shortId(p.id, 10, 4) }}</span>
                </div>
              </td>
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
                <!-- 进度列直出里程碑计数（2026-10-06 审核 #54）：此前「已完成/总数」只挂 title，
                     扫读看不到达成量（判断卡在 2/5 还是 4/5 必须逐行悬停） -->
                <div class="oc-progress" :title="`${p.completedMilestones}/${p.totalMilestones} 里程碑`">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(p)" :style="{ width: progressPct(p) + '%' }"></span></span>
                  <span class="oc-progress__num">{{ progressPct(p) }}%</span>
                  <span class="oc-progress__count mk-cell-sub">{{ p.completedMilestones }}/{{ p.totalMilestones }}</span>
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

      <!-- 翻页器常驻（判例 GoalConversations/TeachingSessions）：此前 v-if="filtered.length > pageSize"，
           结果 ≤100 行时把「每页条数」调大会卸载翻页器，页码一起消失，表格只剩表头 0 行、
           既无空态也无回路，整页像数据没了。Pagination 自带越界收敛 watcher。 -->
      <Pagination
        v-if="filtered.length"
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
import { timeAgo, errMsg, shortId, isPageCacheFresh, markPageFetched, liveIncludeVirtual, liveSetIncludeVirtual } from './live'
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
import MkDistBand from '@/components/mk/MkDistBand.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import { statusText, statusBadge } from './opsShared'
import { isTestAccountUser } from './learner-profile'

/** 嵌入模式：作为「目标对话」页内「学习路径」tab 渲染（隐藏页面壳与状态条，筛选/表格/抽屉保留）；
    initialStatus：宿主深链预筛（如工作台「生成失败路径」→ 'failed'），挂载时应用。
    （原 count/stats 上报链随合并宿主退役，2026-10-02 撤页头 KPI 区时一并清除） */
const props = withDefaults(defineProps<{ embedded?: boolean; initialStatus?: string }>(), { embedded: false, initialStatus: '' })

type PathRow = LearningPathRow & { busy?: boolean; isTestAccount?: boolean }

const rows = ref<PathRow[]>([])
const total = ref(0)
/* 列表态快照（2026-10-06 审核 #39）：行点击进 PathDetail 二级页会互斥卸载本组件
   （AdminConsole <component :is> 无 KeepAlive），返回后筛选/关键字/页码此前全部回初值。
   在「行内下钻」出站时把当前状态存进模块级快照，挂载时一次性读回（consume-once：
   只服务「进详情再返回」这一个场景，不用 localStorage，避免跨会话残留旧筛选）。 */
let savedListState: { page: number; keyword: string; statusFilter: string } | null = null
function takeSavedListState() {
  const s = savedListState
  savedListState = null
  return s
}
const restoredListState = takeSavedListState()
const page = ref(restoredListState?.page || 1)
const pageSize = ref(15)
const loading = ref(false)
const failed = ref(false)
/** 失败原因（R2：错误态要显示失败原因，不能只进 toast） */
const loadError = ref('')
const keyword = ref(restoredListState?.keyword || '')
const statusFilter = ref(restoredListState?.statusFilter || '')
/* 口径整组统一（2026-10-04 用户拍板）：get/set 走 live.ts 共享态（页头开关同源），本页 watch 只负责重拉 */
const includeTest = computed({
  get: () => liveIncludeVirtual.value,
  set: (v) => liveSetIncludeVirtual(v)
})
const stats = ref<LearningContentStats | null>(null)

/* 列显隐（与同页其他列表一致）：路径/操作固定，其余可隐藏 */
const colDefs = [
  { key: 'difficulty', label: '难度', title: '路径难度：由目标对话里的水平自述归一（入门/进阶/高阶）；无法判断时为未知' },
  { key: 'hours', label: '时长', title: '预计学习时长（后端 estimatedHours 估算值，带 ~ 表示近似）' },
  { key: 'user', label: '用户', title: '所属用户' },
  { key: 'status', label: '状态', title: '路径状态' },
  { key: 'progress', label: '进度', title: '里程碑完成进度' },
  { key: 'updated', label: '更新时间', title: '最近更新' }
] as const
const hiddenCols = ref<Set<string>>(new Set())

/* 状态条四态计数遗留口径：byStatus 仍供贴表分布条分段/图例（2026-10-04 状态条退役后
   dashTone 随条删除——失败抬红由分布条红段单源承载） */
const byStatus = (s: string) => stats.value?.byStatus?.[s] || 0

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
/* stats 拉取失败（null）或状态合计为 0 → 整带隐藏（v-if），不留空带 */
const pathBandReady = computed(() => !!stats.value && pathBandTotal.value > 0)

/** 贴表分布条数据（与构成带同源：byStatus 全平台计数）；hint 只给失败段（重规划去向） */
const pathBandBins = computed(() =>
  pathBand.value.map((e) => ({
    key: e.key,
    label: e.name,
    n: e.n,
    tone: e.tone,
    hint: e.key === 'failed' ? '行内「去详情」进详情页可重规划' : undefined
  }))
)
/** 分布条点击 = 单状态筛选（与原 pills 同一 statusFilter）；再点取消 */
function toggleStatusBand(key: string) {
  statusFilter.value = statusFilter.value === key ? '' : key
}
/** 「其它」段 = 四枚举之外取值的聚合，不能按单状态等值比较（点了要真能筛出那些行） */
function pathStatusMatch(status: string, key: string): boolean {
  if (key === 'other') return !(status in PATH_BAND_TONE)
  return status === key
}

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const { toggle: toggleOcSort, sortState: ocSortState, sortRows: sortOcRows, sortKey: ocSortKey, sortDir: ocSortDir } = useTableSort<PathRow>({
  accessors: {
    path: (p) => p.title,
    /* P2-6（2026-10-04 全站评审）：「主题」独立列退役（91% 行与路径列同文），随列撤排序 */
    /* 难度按语义序排（入门→进阶→高阶），不按字符串字典序。
       「未知」不编码成序数（2026-10-06 审核 #53）：否则换列默认降序时成片未知被排到最前，
       与同表时长列「空值恒末尾」方向相反——返回 null 交给 useTableSort 的空值恒末尾 */
    difficulty: (p) => {
      const e = difficultyEnum(p.difficulty)
      return e === 'unknown' ? null : DIFF_ORDINAL[e]
    },
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
    if (statusFilter.value && !pathStatusMatch(p.status, statusFilter.value)) return false
    if (!k) return true
    return `${p.title} ${p.user?.name || ''} ${p.user?.email || ''} ${p.subject || ''}`.toLowerCase().includes(k)
  }))
})
const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
}
/* 回第 1 页只监听筛选输入与排序（TeachingSessions 判例）：监听 filtered 会让数据回填
   （重挂载恢复列表态后的装载）也把页码打回第 1 页，快照里的 page 就永远无效。
   越界收敛由 Pagination 自带 watcher 兜底。 */
watch([keyword, statusFilter, ocSortKey, ocSortDir], () => {
  page.value = 1
})
/* 出站下钻时把当前列表态存进快照（#39）：只在下钻路径调用，不在每次筛选变化时写，
   避免污染其它场景；返回时由 takeSavedListState 一次性读回 */
function saveListState() {
  savedListState = { page: page.value, keyword: keyword.value, statusFilter: statusFilter.value }
}

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
const DIFF_ORDINAL: Record<Exclude<DiffEnum, 'unknown'>, number> = { beginner: 0, intermediate: 1, advanced: 2 }

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

/* 请求代际号（2026-10-06 审核 F2-3，判例 GoalConversations.statsReqSeq）：
   口径切换会同时发起列表与 stats 两笔重拉，且本页 /paths 实测可滞后数秒；
   代际比对确保只有最新一笔写回，迟到的旧口径响应不得覆盖新口径读数。 */
let listReqSeq = 0
let statsReqSeq = 0

async function reload(force = false) {
  /* 页面级 TTL 缓存（与另两 tab 同款模式）：显式刷新/口径切换传 force 绕过。
     注意（2026-10-06 审核 #39）：本组件被 AdminConsole 互斥卸载/重挂载（无 KeepAlive），
     重挂载后 rows 必为 []，此短路条件恒不成立——所以本页每次进入都会重拉一次，
     这也是列表态必须走快照恢复（saveListState/takeSavedListState）的原因。 */
  if (!force && isPageCacheFresh('learning-paths') && rows.value.length) return
  const seq = ++listReqSeq
  loading.value = true
  failed.value = false
  loadError.value = ''
  try {
    /* 全量拉最近 1000 条后客户端过滤（与教学会话/目标对话一致；筛选即时响应，无服务端往返） */
    const res = await adminLearningContentApi.listPaths({
      page: 1,
      limit: 1000,
      includeTest: includeTest.value || undefined,
    })
    // 已有更新的一笔在途/已回写 → 丢弃本笔（防旧口径覆盖新口径）
    if (seq !== listReqSeq) return
    const body = res.data?.data ?? res.data ?? {}
    /* 行内测试账号标记（A3 承诺「含测试口径下行内带标记」）：后端 learning-content 列表未产出
       isTestAccount，按 Users.vue:317 同源单点从 user 派生（2026-10-06 审核 #36） */
    rows.value = (body.paths || []).map((p: PathRow) => ({
      ...p,
      busy: false,
      isTestAccount: isTestAccountUser(p.user || {})
    }))
    total.value = body.pagination?.total ?? rows.value.length
    // 仅成功后标记缓存：失败不缓存，下次进入自动重拉
    markPageFetched('learning-paths')
  } catch (e) {
    if (seq !== listReqSeq) return
    failed.value = true
    loadError.value = `加载失败：${errMsg(e)}`
    toast.error(loadError.value)
  } finally {
    // 只由最新一笔复位：过期响应收尾时不得把在途新请求的 loading 关掉
    if (seq === listReqSeq) loading.value = false
  }
}

async function loadStats() {
  const seq = ++statsReqSeq
  try {
    // 口径与列表同一判据：/stats 已收 includeTest（否则 KPI/里程碑/分布条恒仅真实，
    // 与同屏卡头「含测试」总数相差约 3 倍）
    const res = await adminLearningContentApi.getStats(includeTest.value)
    if (seq !== statsReqSeq) return
    stats.value = res.data?.data ?? res.data
  } catch {
    if (seq === statsReqSeq) stats.value = null
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
   2026-10-01 结构详情抽屉随行点击改造整体退役，与教学会话行点击进座舱同一交互习惯）。
   出站前存列表态（#39）：返回时组件重挂载可恢复筛选/关键字/页码，不再回初值 */
function openPath(p: PathRow) {
  closeMenu()
  saveListState()
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
/* 数据隔离切换：仅真实 ↔ 含虚拟/测试。
   2026-10-06 审核 F2-3：此前切换只发起重拉、不动旧数据 —— 实测 /paths 响应可滞后 3.5-10s，
   滞后期间「含测试」已选中、KPI/分布条已按新口径刷新，而表格仍是旧口径的行与分页读数
   （「路径总数 1021」对「共 341 条」），三处读数互相打架且全程无任何加载提示。
   改为切换即清列表与统计读数（清后 rows 为空 → 走骨架，两处读数不会同屏打架），再按新口径
   重拉；页码回第 1 页（新口径是新结果集，避免停在旧口径才有的页码上）。 */
watch(includeTest, () => {
  rows.value = []
  total.value = 0
  stats.value = null
  page.value = 1
  void reload(true)
  void loadStats()
})

/* 宿主刷新联动（学习会话合并宿主「刷新」按钮 → 强制重拉：包装 force，TTL 内点击仍生效） */
defineExpose({ reload: () => void reload(true) })
</script>

<style scoped>
/* 嵌入模式（目标对话页「学习路径」tab）：fill 容器内占满，主卡片弹性 */
.oc-embedded { flex: 1; min-height: 0; overflow: hidden; }
/* 分布条在卡上方页面级（2026-10-05 用户拍板「分段条在上」）：贴条 padding/下边框随撤，
   页面级间距由 .mk-page 的 --mk-stack-gap 统一供。oc-distband 类保留作测试与定位钩子 */
/* 加载失败错误态已收敛共享 MkEmptyState tone="error"（role=alert + 失败原因 + 重试/busy），
   私有 .oc-error 与暗色描边覆写随撤（2026-10-06 审核 #38） */
/* 原型 .tbl td nowrap 已收敛全局修饰类 .mk-table--nowrap（2026-10-06 审核 #56），
   本页私有 .oc-list td 拷贝随撤 */
.oc-progress { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.oc-progress .mk-minibar { flex: 1; }
.oc-progress__num { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 里程碑计数直出（#54）：百分比旁的达成量，等宽数字、不抢主值 */
.oc-progress__count { font-variant-numeric: tabular-nums; }
/* 虚拟/测试行内标记（对齐同页 conversations/teaching 行样式） */
.oc-tags { display: flex; gap: 4px; margin-top: 2px; }
/* 用户格（原型 .celluser = 头像 + 姓名；同 GoalConversations .gc-user 组合） */
.oc-user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.oc-user .mk-cell-main { min-width: 0; flex: 1; }
/* 行点击已升共享契约（table.mk-table--click + tr:focus-visible 原语，2026-10-03） */
/* 主题列：subject 字段或为学科或为生成路径时写入的目标文本（可能很长），单行省略 + hover 全文。
   自动布局下列宽随内容，必须给显式截断上限（截断上限由共享 .mk-cell-text 承担） */
/* 主题列已退役（P2-6 2026-10-04：91% 行与路径列同文）——subject≠title 时作路径列副行，
   截断走共享 .mk-cell-sub（oc-subject 私有复制此前已退役） */

/* 难度：三个语义值 + 未知；未知降一档灰，不抢视觉 */
.oc-diff { font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: nowrap; }
/* 时长：右对齐等宽数字（与表头 mk-th--right 对齐） */
/* 时长格直出 .mk-num（oc-hours 双层叠写退役，2026-10-03）；右对齐由 .mk-num 承担 */

/* 结构详情抽屉已退役（2026-10-01 行点击改走 PathDetail 二级页）；本页只保留列表自身样式 */

/* 状态分布卡已退役改 buckets 构成带（2026-10-04，共享原语 MkBuckets；stageband 原语留仍用页） */

/* 4K：进度数字跟随全站节奏。
   2026-10-06 审核 #57：≥2000 / ≥2800 两档原先把 .oc-progress__num 覆写成与基准相同的
   var(--mk-fs-micro)（token 本身已随档位变化），属零效果空转，随撤；仅保留 ≥3600 真升档 */
@media (min-width: 3600px) {
  .oc-progress__num { font-size: var(--mk-fs-body); }
}
</style>
