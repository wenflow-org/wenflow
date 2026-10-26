<template>
  <div :class="embedded ? 'mk-page--fill oc-embedded' : 'mk-page mk-page--fill'">
    <!-- 页头（mk-pagehead 标准形态，2026-10-03 用户拍板全站统一）：页名 + 读数卡带 -->
    <MkPageHead v-if="!embedded" title="学习路径" />
    <!-- 路径读数带（2026-10-26 用户走查「kpi 就一个，不太好看」）：
         原带只留「路径总数」一张，flex 栅格把独卡拉满整行 1600px，读数 20 孤零零挂左上。
         现按同组列表页（学习状态 / 复习积压）的密度补回四张真实读数：
         · 学习中 / 生成失败 —— 两个最常被点开的状态，卡本身即筛选入口（与下方胶囊共用
           同一个 statusFilter；生成失败非零时走 bad 着色，是这页唯一要动手的读数）；
         · 累计里程碑 / 累计子任务 —— stats 里已有的内容体量，不另发请求。
         计数一律取 stats（全平台 byStatus），与胶囊徽章同源；stats 未落定显「—」而不是 0。 -->
    <section v-if="!embedded" class="mk-kpi-grid" aria-label="路径读数">
      <template v-if="statsFailed">
        <div class="oc-stats-error" role="alert">
          <span class="oc-stats-error__msg">统计加载失败</span>
          <button type="button" class="mk-btn mk-btn--sm" @click="loadStats()">重试</button>
        </div>
      </template>
      <template v-else>
        <MkKpi label="路径总数" :value="stats?.total ?? '—'" />
        <MkKpi
          label="学习中"
          :value="stats ? byStatus('active') : '—'"
          clickable
          :class="{ 'oc-kpi--on': statusFilter === 'active' }"
          :aria-pressed="statusFilter === 'active'"
          @click="selectStatus('active')"
        />
        <MkKpi
          label="生成失败"
          :value="stats ? byStatus('failed') : '—'"
          :tone="stats && byStatus('failed') ? 'bad' : ''"
          clickable
          :class="{ 'oc-kpi--on': statusFilter === 'failed' }"
          :aria-pressed="statusFilter === 'failed'"
          @click="selectStatus('failed')"
        />
        <MkKpi label="累计里程碑" :value="stats?.totalMilestones ?? '—'" />
        <MkKpi label="累计子任务" :value="stats?.totalTasks ?? '—'" />
      </template>
    </section>

    <!-- 路径状态分布带已退役（2026-10-17 用户走查「这个也不太好，毕竟上面又 KPI」）：
         页头已有 KPI 卡带，再压一条整宽分布条等于同屏两段读数；四状态里当前三档为 0，
         条上只剩一段。状态筛选回卡头 pills（计数仍取 stats 的全平台 byStatus），
         分档形状交给表格「状态」列与 KPI。 -->

    <!-- 筛选 + 列表（单行头部与教学会话/目标对话 tab 一致：pill 组 + 搜索 + 数据口径 + 列显隐） -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 状态筛选（2026-10-17 从退役分布带迁回）：四枚举 + 枚举外的「其它」档；
               计数取 stats 全平台 byStatus，stats 未落定时不渲染计数徽章（不把未知读成 0）。
               2026-10-22 用户「停滞有必要放在这吗」后退役：停滞判据是「active 且 24h 无写入」，
               真实用户数日不学即命中，且其救援动作只对虚拟会话可用；最近活动列本就按时间排序，
               同题不再用一枚会承诺错动作的标签表达。 -->
          <div class="mk-pills" role="group" aria-label="状态筛选">
            <button
              v-for="p in ocStatusPills"
              :key="p.key"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': statusFilter === p.key }"
              :aria-pressed="statusFilter === p.key"
              @click="selectStatus(p.key)"
            >{{ p.name }}<span v-if="p.n != null" class="mk-pill__count">{{ p.n }}</span></button>
          </div>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
          <!-- 排序复位（2026-10-26 动线收口）：排序态写 localStorage，点过表头后无法回默认序 -->
          <button v-if="!ocSortIsDefault" type="button" class="mk-link" @click="resetOcSort">恢复默认序</button>
        </div>
        <div class="mk-card__head-right">
          <MkFilterSearch v-model="keyword" placeholder="搜索标题或用户" />
          <MkLoading v-if="loading" inline text="加载中…" />
          <MkCols
            :col-defs="colDefs"
            storage-key="wf_paths_hidden_cols_v2"
            :default-hidden="PATH_DEFAULT_HIDDEN"
            v-model:hidden="hiddenCols"
          />
        </div>
      </div>

      <MockSkeletonTable v-if="loading && !rows.length" :cols="7" />
      <MkEmptyState
        v-else-if="failed"
        min
        tone="error"
        title="路径列表加载失败"
        :description="loadError"
        action-text="重试"
        :action-busy="loading"
        action-busy-text="重试中…"
        @action="reload(true)"
      />
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <!-- 固定列宽（2026-10-22 与教学会话/目标对话同判例）：自动布局下路径/用户两列按当页
             最长文本分宽，翻页整表跳动；改 fixed + 逐列表头宽度，余量按权重摊开。
             单元格 nowrap 仍走全局 .mk-table--nowrap，长标题/主题由 .mk-cell-main/.mk-cell-text 截断 -->
        <table class="mk-table mk-table--click mk-table--nowrap mk-table--fixed oc-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable oc-c-path"
                :aria-sort="ocSortState('path')"
                @click="toggleOcSort('path')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('path')">路径<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="!hiddenCols.has('user')" scope="col" class="oc-c-user">用户</th>
              <th
                v-if="!hiddenCols.has('status')"
                scope="col"
                class="mk-th--sortable oc-c-status"
                :aria-sort="ocSortState('status')"
                @click="toggleOcSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('difficulty')"
                scope="col"
                class="mk-th--sortable oc-c-difficulty"
                :aria-sort="ocSortState('difficulty')"
                @click="toggleOcSort('difficulty')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('difficulty')">难度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('hours')"
                scope="col"
                class="mk-th--sortable mk-th--right oc-c-hours"
                :aria-sort="ocSortState('hours')"
                @click="toggleOcSort('hours')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('hours')">预计时长<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('progress')"
                scope="col"
                class="mk-th--sortable oc-c-progress"
                :aria-sort="ocSortState('progress')"
                @click="toggleOcSort('progress')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('progress')">进度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!hiddenCols.has('updated')"
                scope="col"
                class="mk-th--sortable oc-c-updated"
                :aria-sort="ocSortState('updated')"
                @click="toggleOcSort('updated')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleOcSort('updated')">最近活动<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--right oc-c-act">操作</th>
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
                  <!-- 2026-10-23 走查：内部路径 ID（lp_1792…）副行撤除——截断后既不可复制也不可读，
                       本页搜索虽支持 ID，但 ID 的真实来源是日志，不在列表里认。 -->
                </div>
              </td>
              <td v-if="!hiddenCols.has('user')">
                <!-- 原型学习者格 .celluser = 首字母头像 + 姓名；tone 与行内虚拟/测试标记同语义
                     （MkCellAvatar 共享原语，同 GoalConversations 用户格） -->
                <div class="oc-user">
                  <MkCellAvatar
                    :name="p.user?.name"
                    :tone="p.user?.isVirtualLearner ? 'virtual' : p.isTestAccount ? 'test' : 'default'"
                  />
                  <div class="mk-cell-main">
                    <!-- 2026-10-18：姓名即学习者详情入口（行点击仍进路径座舱，stop 冒泡）；
                         没有 user.id 时退回纯文本（不拿路径 id 冒充） -->
                    <button
                      v-if="p.user?.id"
                      type="button"
                      class="mk-user-link"
                      @click.stop="openLearnerOf(p)"
                      @keydown.enter.stop.prevent="openLearnerOf(p)"
                    >{{ p.user?.name || '—' }}</button>
                    <strong v-else>{{ p.user?.name || '—' }}</strong>
                    <!-- 备注在副行：姓名行保持全额宽度（2026-10-24 压字回归） -->
                    <!-- 副行去重（2026-10-24）：邮箱 local part 与姓名同值时不再复读 -->
                    <span v-if="emailSubline(p.user?.email, p.user?.name) || p.isTestAccount" class="mk-cell-subline">
                      <span v-if="emailSubline(p.user?.email, p.user?.name)" class="mk-cell-sub" :title="p.user?.email || ''">{{ p.user?.email || '' }}</span>
                      <span v-if="p.isTestAccount" class="mk-badge mk-badge--sm mk-badge--test">测试</span>
                    </span>
                  </div>
                </div>
              </td>
              <td v-if="!hiddenCols.has('status')"><span class="mk-badge" :class="statusBadge(p.status)">{{ statusText(p.status) }}</span></td>
              <td v-if="!hiddenCols.has('difficulty')">
                <!-- 难度：只有三个枚举值可判；老数据里混着 unknown 与自述整句（~35%），
                     一律显示「未知」，原文进 title，不把半句话当难度展示 -->
                <span class="oc-diff">{{ difficultyText(p.difficulty) }}</span>
              </td>
              <td v-if="!hiddenCols.has('hours')" class="mk-num">{{ p.estimatedHours ? `~${p.estimatedHours}h` : '—' }}</td>
              <td v-if="!hiddenCols.has('progress')">
                <div class="oc-progress">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(p)" :style="{ width: progressPct(p) + '%' }"></span></span>
                  <span class="oc-progress__num">{{ progressPct(p) }}%</span>
                  <span class="oc-progress__count mk-cell-sub">{{ p.completedMilestones }}/{{ p.totalMilestones }}</span>
                </div>
              </td>
              <td v-if="!hiddenCols.has('updated')" :title="fmtDate(activityAt(p))">
                <span class="mk-cell-sub">{{ timeAgo(activityAt(p)) }}</span>
              </td>
              <td>
                <!-- 操作列：失败行的「重试生成」提到一级（这页唯一要动手的动作，不再藏在两跳后）；
                     其余低频项（下线恢复 / 删除）收进 ⋯ 菜单。行点击已是详情，不再摆重复钮。 -->
                <div class="mk-actions">
                  <button
                    v-if="p.status === 'failed'"
                    type="button"
                    class="mk-btn mk-btn--sm"
                    :disabled="p.busy"
                    @click.stop="retryGeneration(p)"
                  >重试生成</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === p.id" @click.stop="toggleMenu(p.id)">⋯</button>
                    <div v-if="openMenu === p.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                      <button v-if="p.status !== 'archived'" type="button" class="mk-menu__item" role="menuitem" :disabled="p.busy" @click="menuArchive(p)">下线</button>
                      <button v-else type="button" class="mk-menu__item" role="menuitem" :disabled="p.busy" @click="menuRestore(p)">恢复</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" role="menuitem" @click="menuDelete(p)">删除路径</button>
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
        min
        icon="◌"
        :title="isFiltered ? '当前筛选无匹配' : '没有学习路径'"
        :action-text="isFiltered ? '清除筛选' : '去目标对话'"
        @action="isFiltered ? clearFilters() : goGoalConversations()"
      />

      <!-- 翻页器常驻（判例 GoalConversations/TeachingSessions）：0 行时也保留页码与条数，
           否则整页像数据没了。Pagination 自带越界收敛 watcher。 -->
      <Pagination
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
        :note="total > rows.length ? '仅载入最近 1000 条' : ''"
      />
    </div>

  </div>
</template>

<script lang="ts">
</script>

<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, ref, watch } from 'vue'
import { timeAgo, errMsg, isPageCacheFresh, liveRefreshSeq, markPageFetched } from './live'
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
import { emailSubline } from '@/components/mk/avatarName'
import MkKpi from '@/components/mk/MkKpi.vue'
import { statusText, statusBadge, pathRetryTypeText } from './opsShared'
import { isTestAccountUser, useListQueryState } from './learner-profile'

/** 嵌入模式：作为「目标对话」页内「学习路径」tab 渲染（隐藏页面壳与状态条，筛选/表格/抽屉保留）；
    initialStatus：宿主深链预筛（如工作台「生成失败路径」→ 'failed'），挂载时应用。
    （原 count/stats 上报链随合并宿主退役，2026-10-02 撤页头 KPI 区时一并清除） */
const props = withDefaults(defineProps<{ embedded?: boolean; initialStatus?: string }>(), { embedded: false, initialStatus: '' })

/* 无 Router 上下文（单测直挂 / 嵌入宿主）时不注入，避免 useRouter 打警告 */
const router = getCurrentInstance()?.appContext.config.globalProperties.$router as
  | { push: (to: string) => Promise<unknown> }
  | undefined

type PathRow = LearningPathRow & { busy?: boolean; isTestAccount?: boolean }

const rows = ref<PathRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(15)
const loading = ref(false)
const failed = ref(false)
/** 失败原因（R2：错误态要显示失败原因，不能只进 toast） */
const loadError = ref('')
const keyword = ref('')
/** 状态筛选（'' 退役，哨兵 'all' 与 useListQueryState 的 pill 约定一致） */
const statusFilter = ref('all')
const stats = ref<LearningContentStats | null>(null)
/* 统计拉取失败（2026-10-26）：KPI 带换成错误格 + 重试，不把「—」画成正常读数 */
const statsFailed = ref(false)

/* 列显隐（与同页其他列表一致）：路径/操作固定，其余可隐藏 */
/* 列序（2026-10-16 教学组统一）：主体列（路径）→ 用户 → 状态 → 属性/过程（难度、时长、进度）→ 时间（更新）→ 操作。
   原先把难度/时长排在用户与状态之前，与同组其它页（目标对话 / 教学会话）的「主体 → 用户 → 状态 → 过程」
   不一致，也违背 2026-10-03 定下的「主体列恒在首、用户列随后」。MkCols 菜单按本数组顺序渲染。 */
const colDefs = [
  { key: 'user', label: '用户' },
  { key: 'status', label: '状态' },
  { key: 'difficulty', label: '难度' },
  { key: 'hours', label: '预计时长' },
  { key: 'progress', label: '进度' },
  { key: 'updated', label: '最近活动' }
] as const
/* 2026-10-22 默认收起「难度」：它由目标对话的水平自述归一而来，真实数据里多为「未知」，
   且不改变运营动作（路径是否生成成功、进度如何才是要看的）。仍在「列」菜单可开；
   2026-10-26 同理收起「预计时长」——约数不改变处理动作。
   存储键升 v2，旧本地配置不覆盖新默认。 */
const PATH_DEFAULT_HIDDEN = ['difficulty', 'hours'] as const
const hiddenCols = ref<Set<string>>(new Set<string>(PATH_DEFAULT_HIDDEN))

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
/* stats 拉取失败（null）或状态合计为 0 → 计数不可用；此时 pills 仍可筛，但不渲染计数徽章 */
const pathBandReady = computed(() => !!stats.value && pathBandTotal.value > 0)

/** 卡头状态 pills（2026-10-17 从退役的分布带迁回）：与分布带同源（byStatus 全平台计数）；
    stats 未落定 → n=null，不把未知读成 0；「其它」档只在枚举外取值实际出现时追加 */
const ocStatusPills = computed<Array<{ key: string; name: string; n: number | null }>>(() => {
  const ready = pathBandReady.value
  return [
    { key: 'all', name: '全部', n: null },
    ...pathBand.value.map((e) => ({ key: e.key, name: e.name, n: ready ? e.n : null }))
  ]
})
/** 点状态 pill = 单状态筛选；再点已选中的取消回「全部」（'all'） */
function selectStatus(key: string) {
  statusFilter.value = statusFilter.value === key ? 'all' : key
}
/** 「其它」段 = 四枚举之外取值的聚合，不能按单状态等值比较（点了要真能筛出那些行） */
function pathStatusMatch(status: string, key: string): boolean {
  if (key === 'other') return !(status in PATH_BAND_TONE)
  return status === key
}

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const {
  toggle: toggleOcSort, sortState: ocSortState, sortRows: sortOcRows,
  sortKey: ocSortKey, sortDir: ocSortDir, reset: resetOcSort, isDefault: ocSortIsDefault
} = useTableSort<PathRow>({
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
    /* 「更新」列按真墙钟「最近活动」排序（lastActivityAt；缺失回落 updatedAt）——虚拟路径的
       updatedAt 是模拟钟写的未来日期，直接排会霸榜（2026-10-14 用户纠偏） */
    updated: (p) => {
      const v = activityAt(p)
      return v ? new Date(v).getTime() : null
    }
  },
  storageKey: 'wf_ops_content_sort'
})

/* 客户端过滤（与教学会话/目标对话 tab 一致：全量拉最近 1000 条后本地即时过滤，无「查询」按钮） */
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return sortOcRows(rows.value.filter((p) => {
    if (statusFilter.value !== 'all' && !pathStatusMatch(p.status, statusFilter.value)) return false
    if (!k) return true
    return `${p.title} ${p.user?.name || ''} ${p.user?.email || ''} ${p.subject || ''}`.toLowerCase().includes(k)
  }))
})
const isFiltered = computed(() => !!keyword.value.trim() || statusFilter.value !== 'all')
function clearFilters() {
  keyword.value = ''
  statusFilter.value = 'all'
}
/* 筛选 / 页码 ↔ URL query（2026-10-13 运营走查 O2）：本页原为「只读 URL 不回写」（写入权在
   发起方）——手动筛选在刷新 / 分享 / 收藏里全部丢失。改为双向同步（缺省值不写 URL，所以
   「手动清掉的筛选被 URL 顶回来」不会发生）；URL 参数名沿用既有的 ?status=（OpsHub 待办卡
   深链已经在用），关键词/页码复用 q/page/size。组合式单点在 learner-profile.ts。
   必须在下方「筛选变化回第 1 页」的 watch 之前调用：URL 落位要发生在监听建立之前，
   否则挂载时还原出来的筛选会被当成用户改筛选、把还原的页码打回 1（Users.vue 判例）。 */
useListQueryState(
  {
    pill: statusFilter, keyword, page, pageSize,
    allowedPills: ['all', 'active', 'completed', 'failed', 'archived', 'other']
  },
  { pill: 'status' }
)
/* 回第 1 页只监听筛选输入与排序（TeachingSessions 判例）：监听 filtered 会让数据回填
   （重挂载恢复列表态后的装载）也把页码打回第 1 页。越界收敛由 Pagination 自带 watcher 兜底。 */
watch([keyword, statusFilter, ocSortKey, ocSortDir], () => {
  page.value = 1
})
/* 出站下钻不再存快照：筛选/页码已住进 URL（上方 useListQueryState），
   详情 URL 由 AdminConsole 以 {...route.query, view, id} 拼出、返回时去掉 view/id，
   列表态自然随之还原，无需第二套机制。 */

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

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* 真墙钟「最近活动」：后端派生 lastActivityAt（路径 createdAt / 真墙钟 updatedAt / 名下会话 createdAt 三者最大值）。
   updatedAt 会被虚拟学习者的日期模拟写成未来日期（模拟日），直接展示会让 timeAgo 渲染成「刚刚」并霸榜；
   缺 lastActivityAt 时（旧响应/单测 fixture）回落 updatedAt。2026-10-14 用户纠偏「列表排序改用真实钟列」。 */
function activityAt(p: PathRow): string | null {
  return p.lastActivityAt || p.updatedAt || null
}

/* 请求代际号（2026-10-06 审核 F2-3，判例 GoalConversations.statsReqSeq）：
   口径切换会同时发起列表与 stats 两笔重拉，且本页 /paths 实测可滞后数秒；
   代际比对确保只有最新一笔写回，迟到的旧口径响应不得覆盖新口径读数。 */
let listReqSeq = 0
let statsReqSeq = 0

async function reload(force = false) {
  /* 页面级 TTL 缓存（与另两 tab 同款模式）：显式刷新/口径切换传 force 绕过。
     注意（2026-10-06 审核 #39）：本组件被 AdminConsole 互斥卸载/重挂载（无 KeepAlive），
     重挂载后 rows 必为 []，此短路条件恒不成立——所以本页每次进入都会重拉一次。 */
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
    const res = await adminLearningContentApi.getStats()
    if (seq !== statsReqSeq) return
    stats.value = res.data?.data ?? res.data
    statsFailed.value = false
  } catch {
    if (seq !== statsReqSeq) return
    stats.value = null
    statsFailed.value = true
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
    message: `确认删除「${p.title}」？\n将同时删除其全部里程碑与子任务，不可撤销。`,
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

/* 重试路径生成（只服务失败行）：后端按 learningPathId 找最新虚拟会话
   代发 retry-path-generation，守卫自动判 core=重建主结构 / stageDesign=补齐阶段任务；
   拒绝时 HTTP 200 + success:false，原因透传 toast（家法：修复类确认显式 danger:false） */
async function retryGeneration(p: PathRow) {
  const ok = await askConfirm({
    title: '重试路径生成',
    message: `确认对「${p.title}」重新发起生成？`,
    confirmText: '重试',
    danger: false,
    busy: true,
  })
  if (!ok) return
  p.busy = true
  try {
    const res = await adminLearningContentApi.retryGeneration(p.id)
    const body = res.data
    if (body?.success && body.data?.success) {
      toast.success(`已提交重试（${pathRetryTypeText(body.data.retryType)}）`)
      doneConfirm()
      /* G6（2026-10-10）：必须 force——reload() 非 force 时 60s TTL 内直接短路 return，
         重试提交后列表纹丝不动（行还挂在「生成失败」上，用户以为点了没生效） */
      void reload(true)
      void loadStats()
    } else {
      toast.error(`无法重试：${body?.data?.error || body?.error || '原因未知'}`)
      failConfirm()
    }
  } catch (e) {
    toast.error(`重试失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    p.busy = false
  }
}

/* 行点击 → 会话座舱 Path 阶段页签（2026-10-12 拍板：路径不再有独立详情页）。
   本页只有路径 id：openSubPage('path') 落到深链适配层（PathDetail.vue），由它反查
   目标对话后带 stage=path 换开座舱。列表态由 URL 承载，返回时自动还原。 */
/** 用户格 → 学习者详情（2026-10-18 用户走查：三处列表都没有这个入口） */
function openLearnerOf(p: PathRow) {
  const id = String(p.user?.id || '')
  if (id) openSubPage('learner', id)
}
function openPath(p: PathRow) {
  closeMenu()
  openSubPage('path', p.id)
}

/** 空态出口：路径由学习者确认目标后生成，运营只能去目标对话看链路起点 */
function goGoalConversations() {
  if (router) void router.push('/admin/goal-conversations')
  else intent.scene = 'goal-conversations'
}

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()
/* 菜单项执行：先关菜单再执行（避免菜单残留与整行点击冒泡） */
function menuDelete(p: PathRow) { closeMenu(); void remove(p) }
function menuArchive(p: PathRow) { closeMenu(); void archive(p) }
function menuRestore(p: PathRow) { closeMenu(); void restore(p) }

/* 深链：独立场景形态（嵌入时由宿主 GoalConversations 消费 intent 并传 initialStatus 预筛）：
   工作台「生成失败路径」→ 预筛 failed（消费后清空，避免菜单直达被残留筛选污染）。
   URL 的读与写统一在 useListQueryState（上方）：?status= 既是 OpsHub 待办卡的入口，
   也是本页筛选的出口——刷新/复制/后退都能复原。 */
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
/* 顶栏刷新（全站唯一刷新钮）：列表与统计一起重拉 */
watch(liveRefreshSeq, () => {
  void reload(true)
  void loadStats()
})
/* 宿主刷新联动（学习会话合并宿主「刷新」按钮 → 强制重拉：包装 force，TTL 内点击仍生效） */
defineExpose({ reload: () => void reload(true) })
</script>

<style scoped>
/* 嵌入模式（目标对话页「学习路径」tab）：fill 容器内占满，主卡片弹性 */
.oc-embedded { flex: 1; min-height: 0; overflow: hidden; }
/* 统计加载失败格：与 MkKpi 同高同圆角，不把「—」画成正常读数（spec：失败不得静默降级） */
.oc-stats-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--mk-radius-xl);
  border: 1px solid color-mix(in srgb, var(--mk-red) 35%, var(--mk-line));
  background: var(--mk-surface);
}
.oc-stats-error__msg { font-size: var(--mk-fs-micro); color: var(--mk-red); }
/* 可点 KPI 的选中态（2026-10-26）：蓝只给可交互与选中，与 .lc-kpi--on / .mr-kpi--on 同一判例 */
.oc-kpi--on { border-color: var(--mk-blue); }
/* 分布条已退役（2026-10-17）：原页面级 .oc-distband 与类名一并下线，状态筛选在卡头 pills；
   页面级间距仍由 .mk-page 的 --mk-stack-gap 统一供 */
/* 加载失败错误态已收敛共享 MkEmptyState tone="error"（role=alert + 失败原因 + 重试/busy），
   私有 .oc-error 与暗色描边覆写随撤（2026-10-06 审核 #38） */
/* 原型 .tbl td nowrap 已收敛全局修饰类 .mk-table--nowrap（2026-10-06 审核 #56），
   本页私有 .oc-list td 拷贝随撤 */
.oc-progress { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.oc-progress .mk-minibar { flex: 1; }
.oc-progress__num { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 里程碑计数直出（#54）：百分比旁的达成量，等宽数字、不抢主值 */
.oc-progress__count { font-variant-numeric: tabular-nums; }
/* 固定列宽（2026-10-22 与教学会话/目标对话同判例）：auto 布局下路径/用户两列按当页最长
   文本分宽，翻页整表跳动；fixed 后列宽由表头定死，余量按权重摊到各列。 */
/* 2026-10-24 视觉修复：状态/最近活动这类短列此前吃掉 90/104px，路径主列只剩 170px
   被省略号截断；把富余宽度让回路径列，总宽不变（fixed 表不新增横滚）。 */
/* 2026-10-26：操作列放宽到 140px 以容纳一级「重试生成」，宽度从预计时长（78px，默认收起）让出 */
.oc-table .oc-c-path { width: 260px; }
.oc-table .oc-c-user { width: 150px; }
.oc-table .oc-c-status { width: 72px; }
.oc-table .oc-c-difficulty { width: 60px; }
.oc-table .oc-c-hours { width: 78px; }
.oc-table .oc-c-progress { width: 130px; }
.oc-table .oc-c-updated { width: 84px; }
.oc-table .oc-c-act { width: 140px; }
/* fixed 档里列宽即契约：进度条的 120px 最小宽会把内容顶出单元格，归零后由 flex 吸收 */
.oc-table .oc-progress { min-width: 0; }
/* 用户格（原型 .celluser = 头像 + 姓名；同 GoalConversations .gc-user 组合） */
.oc-user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.oc-user .mk-cell-main { min-width: 0; flex: 1; }
/* 行点击已升共享契约（table.mk-table--click + tr:focus-visible 原语，2026-10-03） */
/* 主题列：subject 字段或为学科或为生成路径时写入的目标文本（可能很长），单行省略 + hover 全文。
   fixed 布局下列宽由表头定死，文本仍必须有显式截断上限（由共享 .mk-cell-text 承担） */
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
