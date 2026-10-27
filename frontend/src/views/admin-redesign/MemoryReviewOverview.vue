<template>
  <!-- 记忆与复习 · 跨用户总览（2026-10-12 用户拍板恢复：独立页退役时跨用户积压视图跟着没了，
       本页从 git 历史原样找回列表态——按待复习量排序的用户列表 + 到期时间轴下钻）。
       单用户明细不在这里：点行进学习者详情「记忆与复习 / 记忆调度」页签；
       旧深链 /admin/memory-review?userId=… 转发 learner 详情（见 onMounted）。 -->
  <div class="mr mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名与侧栏条目一致（2026-10-26 走查：侧栏已改
         「复习积压」——本页回答的是积压量，不是复习机制；页头却还叫「记忆与复习观测」）。
         原状态条与作用域开关整体退役 -->
    <MkPageHead title="复习积压" />
    <!-- 页头 KPI 带（2026-09-28）：页级绝对值只在这里出现一次；口径说明进各卡 title。
         B5-F3-2：取数未落定前显「—」+「取数中…」（不渲染裸 0），栅格挂 aria-busy。
         2026-10-12 用户走查「怎么双 kpi」：原为两段栅格（量值五卡 + 碎片率三卡），1920 下
         两段卡宽不一致（5 卡 ~310px vs 3 卡 ~530px），读作两套 KPI——并为一条单带。
         两域取数语义各自保留：碎片域（fragmentation）缺失仍显 '—' +「指标未取到」，不当 0。 -->
    <section class="mk-kpi-grid" :aria-busy="kpiPending || undefined">
      <MkKpi
        v-for="card in headKpiCards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :title="card.title"
        :clickable="card.clickable"
        :class="{ 'mr-kpi--on': card.clickable && mrPill === 'attention' }"
        :aria-pressed="card.clickable ? mrPill === 'attention' : undefined"
        :aria-busy="kpiPending || undefined"
        @click="card.clickable ? (mrPill = mrPill === 'attention' ? 'all' : 'attention') : undefined"
      />
    </section>

    <!-- 到期时间轴分布带已退役（2026-10-17 用户走查「记忆与复习也不要了」）：
         该带是教学组最后一条 MkDistBand。它的两个作用分别有更直接的承载——
         到期总量在 KPI「当前到期」，逐用户到期量在「待复习」列且列表本就按到期倒序；
         200 条痕迹窗口的六档分桶只够说明「哪几天有几个点」，不值得占一整行。
         附带收益：页面不再额外拉一次最近 200 条痕迹（原来只为这条带）。 -->

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <!-- 无卡题（2026-10-16 用户走查「其他地方表格都是没有表名称，用户列表几个字去掉」）：
             全站列表卡头一律「工具栏头」形态——筛选/搜索在左、窗口口径与列设置在右，
             不写「XX 列表」这种可由表头自明的标题。口径 meta 归右组贴右缘
             （首个子元素若为 meta 会被 .mk-card__head > :first-child 拉满行、文字贴左）。
             2026-10-17 用户「参考学习组做一些 pill」：分布带退役后左组是空的，
             补三枚复习状态快筛（有待复习 / 未复习 / 需关注），计数按当前页计算。 -->
        <div class="mk-filter">
          <MkPillSelect
            v-model="mrPillSelect"
            label="状态"
            aria-label="按复习状态筛选"
            :options="mrPillOptions"
            :active="mrPill !== 'all'"
          />
          <!-- 2026-10-26 用户走查「我非常讨厌这种文案」：原「仅当前页 · 共 N 位」口径行撤除。
               它复述的是分页机制本身，不是读数也不是可操作信息；「共 N 位」还与本页底部分页器
               的「共 N 位学习者」逐字复读（同一事实两处出现）。 -->
        </div>
        <!-- 2026-10-23 用户「这种文案，不要」：卡头 meta 原样复述分页/排序/筛选的作用机制
             （「在全部用户里排好再分页，不是只排当前页」「快速筛选只作用于当前页」），
             既不是读数也不是可操作信息。页码与每页条数由底部 Pagination 自明，排序由列头
             caret 表达——这里整块撤掉，不再另写一行说明。 -->
      </div>
      <!-- 取数失败不得渲染成「暂无数据」（R2）：有旧行时保留旧行并给带重试的 .mk-alert -->
      <div v-if="error && rows.length" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">{{ error }}</span>
        <button type="button" class="mk-alert__btn" :disabled="loading" @click="refreshAll">{{ loading ? '重试中…' : '重试' }}</button>
      </div>
      <MkEmptyState
        v-if="error && !rows.length"
        min
        tone="error"
        :title="error"
        action-text="重试"
        :action-busy="loading"
        action-busy-text="重试中…"
        @action="refreshAll"
      />
      <MockSkeletonTable v-else-if="loading && !rows.length" :cols="9" :rows="userPageSize" />
      <!-- 整页无数据（2026-10-24 用户「空数据的时候，页面很奇怪，没有统一设计」）：
          min → 空态吃掉卡内剩余高度并在其中居中（.mk-card--fill > .mk-empty--min 共享口径），
          不再「文案贴顶 + 下方六百像素空白」 -->
      <MkEmptyState
        v-else-if="!loading && !rows.length"
        min
        title="暂无记忆痕迹数据"
        action-text="查看教学会话"
        @action="goTeachingSessions"
      />
      <!-- 用户列表（行点击跳学习者详情，EG1：回车不劫持行内按钮）。
           0 行不渲染滚动容器（2026-10-24 全站空态收齐）：它带 flex:1 会吃满卡高，
           空态在容器内只能贴顶；改挂卡级 + min，与上面「整页无数据」同一形态。 -->
      <div v-else-if="visibleRows.length" class="mk-table-scroll">
        <table class="mk-table mk-table--click mk-table--fixed mr-table">
          <!-- 列集（2026-10-17 二次调整）：相邻列各画一条比例条会读成一排「重叠的条」，
               重要读数一律给独立列——待复习只留数字（颜色表达压力），记忆强度单独一列带条，
               最近复习与需关注也各自成列，不再把两项塞进同一格上下叠放。 -->
          <thead>
            <tr>
              <th scope="col" class="mk-th--sortable mr-c-user" :aria-sort="userSortState('name')"
                @click="toggleUserSort('name')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('name')">学习者<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable mr-c-traces" :aria-sort="userSortState('traces')"
                @click="toggleUserSort('traces')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('traces')">记忆痕迹<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable mr-c-due" :aria-sort="userSortState('due')"
                @click="toggleUserSort('due')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('due')">待复习<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--right mk-th--sortable mr-c-weak" :aria-sort="userSortState('weak')"
                @click="toggleUserSort('weak')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('weak')">需关注<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable mr-c-prop" :aria-sort="userSortState('proposed')"
                @click="toggleUserSort('proposed')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('proposed')">归并候选<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable mr-c-scatter" :aria-sort="userSortState('scatter')"
                @click="toggleUserSort('scatter')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('scatter')">散键<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable mr-c-strength" :aria-sort="userSortState('strength')"
                @click="toggleUserSort('strength')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('strength')">记忆强度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--sortable mr-c-last" :aria-sort="userSortState('lastReviewed')"
                @click="toggleUserSort('lastReviewed')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('lastReviewed')">最近复习<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--right mk-c-act">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in visibleRows"
              :key="row.userId"
              :data-mr-row="row.userId"
              tabindex="0"
              @click="openLearner(row.userId)"
              @keydown.enter.self.prevent="openLearner(row.userId)"
            >
              <td>
                <div class="mr__user">
                  <MkCellAvatar :name="row.name" :tone="row.isVirtualLearner ? 'virtual' : 'default'" />
                  <div class="mk-cell-main">
                    <strong>{{ row.name || '未命名' }}</strong>
                    <!-- 2026-10-23 走查：副行原为截断的内部 userId（user_9f559a6…abf073），
                         既不可读也不能检索；改与其它列表同口径显示邮箱，无邮箱才退回短 id -->
                    <!-- 备注在副行：姓名行保持全额宽度（2026-10-24 压字回归） -->
                    <!-- 副行去重（2026-10-24）：邮箱 local part 与姓名同值时跳过；无邮箱才退回短 id -->
                    <span v-if="emailSubline(row.email, row.name) || !row.email || row.isTestAccount" class="mk-cell-subline">
                      <span v-if="emailSubline(row.email, row.name)" class="mk-cell-sub" :title="row.email || undefined">{{ row.email }}</span>
                      <span v-else-if="!row.email" class="mk-cell-sub mono" :title="row.userId">{{ shortId(row.userId) }}</span>
                      <span v-if="row.isTestAccount" class="mk-badge mk-badge--sm mk-badge--test">测试</span>
                    </span>
                  </div>
                </div>
              </td>
              <td class="mk-num">{{ row.traces }}</td>
              <td class="mk-num">
                <!-- 只留数字：比例条移到「记忆强度」列，避免与相邻列的另一条并排读成一条 -->
                <b class="mr__due-num" :class="`mr__due-num--${dueTone(row)}`">{{ row.due }}</b>
              </td>
              <td class="mk-num">
                <div v-if="row.weak > 0 || row.audit?.ambiguous" class="mr__focus">
                  <span v-if="row.weak > 0" class="mk-badge mk-badge--sm mk-badge--warn">薄弱 {{ row.weak }}</span>
                  <!-- 待人工确认的归并候选：确认 / 驳回在「记忆调度」页签，点数字直达 -->
                  <button
                    v-if="row.audit?.ambiguous"
                    type="button"
                    class="mk-link mr__act"
                    title="待人工确认的归并候选：点击到「记忆调度」确认或驳回"
                    @click.stop="openOps(row.userId)"
                  >待确认 {{ row.audit.ambiguous }}</button>
                </div>
                <span v-else class="mr__none">无</span>
              </td>
              <td class="mk-num">
                <!-- 0 与「没观察」必须分开：审计投影是按用户跑观察才有的 -->
                <span v-if="row.audit === null" class="mr__none">未观察</span>
                <button
                  v-else-if="row.proposed"
                  type="button"
                  class="mk-link mr__act"
                  @click.stop="openOps(row.userId)"
                >{{ row.proposed }}</button>
                <span v-else class="mr__none">0</span>
              </td>
              <td class="mk-num">
                <button
                  v-if="row.scatter"
                  type="button"
                  class="mk-link mr__act"
                  @click.stop="openOps(row.userId)"
                >{{ row.scatter }}</button>
                <span v-else class="mr__none">0</span>
              </td>
              <td class="mk-num">
                <span v-if="row.avgStrength != null" class="mr__strength">
                  <span class="mk-minibar mr__bar" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: strengthPct(row) + '%' }"></i></span>
                  <b class="mr__strength-pct">{{ strengthPct(row) }}%</b>
                </span>
                <span v-else class="mk-na">—</span>
              </td>
              <td :title="row.lastReviewedAt ? fullTime(row.lastReviewedAt) : undefined">
                <span v-if="row.lastReviewedAt" class="mk-cell-sub">{{ timeAgo(row.lastReviewedAt) }}</span>
                <span v-else class="mr__none">未复习</span>
              </td>
              <td>
                <!-- 行可点（整行进详情），但只靠整行可点新人看不出这里有二级页：
                     补一颗明面上的「详情」（2026-10-19 用户建议），落点与整行点击同一个
                     openLearner（学习者的「记忆与复习」页签）。@click.stop 防与整行点击重复触发。 -->
                <div class="mk-actions">
                  <button
                    type="button"
                    class="mk-link"
                    @click.stop="openLearner(row.userId)"
                  >详情</button>
                  <button type="button" class="mk-link" :disabled="recomputingId === row.userId" @click.stop="recompute(row.userId, row.name)">{{ recomputingId === row.userId ? '观察中…' : '重新观察' }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 快筛筛空：给一个回「全部」的出口即可 -->
      <MkEmptyState
        v-else
        min
        title="没有符合条件的学习者"
        action-text="显示全部"
        @action="mrPill = 'all'"
      />
      <!-- 服务端分页（审核 #41）：total=后端全量有痕迹用户数（totals.users）；v-model:pageSize 接住条数变更。
           0 行不渲染（2026-10-24 用户「空数据的时候页面很奇怪」）：此前空数据页挂着
           「共 0 条 · 第 1 / 1 页」+ 每页条数下拉，指着一个没有任何行的列表翻页。
           快筛只作用于当前页 → note 常驻写明范围，总数与计数才不会被读成同一件事。 -->
      <Pagination
        v-if="totals.users > 0"
        v-model:page="userPage"
        v-model:pageSize="userPageSize"
        :total="totals.users"
        :loading="loading"
        unit="位学习者"
        :note="mrPill !== 'all' ? '筛选范围：当前页' : ''"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminMemoryReviewApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import { emailSubline } from '@/components/mk/avatarName'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import { useTableSort } from './useTableSort'
import { askConfirm } from './useConfirm'
import { openSubPage, LEARNER_DETAIL_LANDING } from './store'
import { useListQueryState } from './learner-profile'
import { toast } from '@/utils/toast'
import { errMsg, shortId, timeAgo, liveRefreshSeq } from './live'

interface AuditUserSummary {
  mode: string
  generatedAt: string
  candidates: number
  proposed: number
  autoApplicable: number
  ambiguous: number
  drops: number
  applied: number
  deleted: number
}

interface OverviewRow {
  userId: string
  name: string | null
  email: string | null
  isVirtualLearner: boolean
  /** 行内「测试」备注（2026-10-21 拍板：测试账号照常计入，只加备注） */
  isTestAccount?: boolean
  traces: number
  due: number
  audit: AuditUserSummary | null
  /** 按次留档的归并凭据计数（权威；审计滚动窗口之外的历史归并也计入） */
  merges?: { rollbackable: number; rolledBack: number }
  /* 原型 renderMemory 三列：薄弱 = FSRS 强度<40% 的痕迹数；平均强度 0-1，null = 无带 FSRS 强度的痕迹 */
  weak: number
  avgStrength: number | null
  lastReviewedAt: string | null
  /** 模型给出的同义归并候选数（audit.proposed；没跑过归并观察的用户为 0） */
  proposed: number
  /** 未挂靠到标准概念的记忆标识数（散键） */
  scatter: number
}

/** 碎片率指标（R7 outlet 域契约 D）。字段缺失 → KPI 显 '—'（不把缺失当 0）。 */
interface FragmentationMetrics {
  duplicateLabelRatio?: number
  unattachedKeys?: number
  pendingReview?: number
}

const loading = ref(false)
const busy = ref(false)
const error = ref('')
/* 口径整组统一（2026-10-04 用户拍板）：get/set 走 live.ts 共享态，本页 watch 负责整页重新统计 */
/* 跨用户总览排序（2026-10-18 用户走查「5 列缺排序」）：服务端分页，排序键必须下发后端、
   在切片之前生效（useTableSort 头注的服务端模式）；这里只用它的状态/语义（caret + aria-sort）。 */
const {
  toggle: toggleUserSort,
  sortState: userSortState,
  sortKey: userSortKey,
  sortDir: userSortDir
} = useTableSort({
  keys: ['name', 'traces', 'due', 'weak', 'proposed', 'scatter', 'strength', 'lastReviewed'],
  defaultKey: 'due',
  defaultDir: 'desc',
  // 姓名/强度/最近复习首击升序（名字正序、最弱的在前、最久没复习的在前——「最该关注的在前」
  // 在时间列上的写法就是最久没复习的排头），其余首击降序（最多的在前）
  defaultDirOf: { name: 'asc', strength: 'asc', lastReviewed: 'asc' }
})
watch([userSortKey, userSortDir], () => {
  // 排序变了从第 1 页看（否则停在旧页会读作「排序没生效」）
  if (userPage.value !== 1) userPage.value = 1
  else void loadOverview()
})

const rows = ref<OverviewRow[]>([])
/* 用户列表服务端分页（审核 #41）：页码驱动 offset，totals.users 作分页 total */
const userPage = ref(1)
const userPageSize = ref(50)
watch(userPage, () => {
  void loadOverview()
})
watch(userPageSize, () => {
  if (userPage.value !== 1) {
    userPage.value = 1
  } else {
    void loadOverview()
  }
})

/* ===== 复习状态快筛（2026-10-17 用户「参考学习组做一些 pill」）=====
   三枚条件都直接来自行数据，计数按当前页计算——服务端分页只回 limit 条，
   用全库数字当 pill 计数会与本页行对不上。范围由卡头「仅当前页 · 共 N 位」与分页器 note 常驻写明。
   切筛选回第 1 页：否则在第 2 页勾选后看到的只是第 2 页命中的行。 */
type MrPill = 'all' | 'due' | 'unreviewed' | 'attention'
const mrPill = ref<MrPill>('all')
/* 返回态 URL 化（2026-10-24）：此前页码/筛选只在内存，从详情返回必回第 1 页。
   每页条数初值 50 必须与 defaultPageSize 同值，否则首次进入会被改写成 15 并多打一次请求。 */
useListQueryState(
  {
    pill: mrPill,
    page: userPage,
    pageSize: userPageSize,
    allowedPills: ['all', 'due', 'unreviewed', 'attention'],
    defaultPageSize: 50
  },
  { pill: 'mr' }
)
watch(mrPill, () => {
  if (userPage.value !== 1) userPage.value = 1
})
const mrPills = computed<Array<{ key: MrPill; label: string; n: number | null }>>(() => {
  const due = rows.value.filter((r) => r.due > 0).length
  const unreviewed = rows.value.filter((r) => !r.lastReviewedAt).length
  const attention = rows.value.filter((r) => r.weak > 0 || !!r.audit?.ambiguous).length
  return [
    { key: 'all', label: '全部', n: null },
    { key: 'due', label: '有待复习', n: due },
    { key: 'unreviewed', label: '未复习', n: unreviewed },
    { key: 'attention', label: '需关注', n: attention }
  ]
})
/** 卡头「状态」下拉的字符串代理（mrPill 是字面量联合） */
const mrPillSelect = computed({
  get: () => mrPill.value,
  set: (v: string) => { mrPill.value = (v as MrPill) }
})
const mrPillOptions = computed(() => [
  { value: 'all', label: '全部' },
  ...mrPills.value
    .filter((p) => p.key !== 'all')
    .map((p) => ({ value: p.key, label: p.n != null ? `${p.label}（${p.n}）` : p.label }))
])

const visibleRows = computed(() => {
  if (mrPill.value === 'due') return rows.value.filter((r) => r.due > 0)
  if (mrPill.value === 'unreviewed') return rows.value.filter((r) => !r.lastReviewedAt)
  if (mrPill.value === 'attention') return rows.value.filter((r) => r.weak > 0 || !!r.audit?.ambiguous)
  return rows.value
})
const totals = ref({
  users: 0,
  traces: 0,
  due: 0,
  usersWithAudit: 0,
  proposed: 0,
  autoApplicable: 0,
  ambiguous: 0,
  applied: 0,
  deleted: 0,
  fragmentation: null as FragmentationMetrics | null
})
const overviewReady = ref(false)
const kpiPending = computed(() => !overviewReady.value && !error.value)

const duePct = computed(() => (totals.value.traces ? Math.round((totals.value.due / totals.value.traces) * 100) : 0));

/* 到期示警阈值（P1#13）：占全部痕迹 ≥20% 或人均 ≥5 条才抬警示；阈值写入 KPI title 披露 */
const DUE_WARN_PCT = 20
const DUE_WARN_PER_USER = 5
const dueWarn = computed(() => {
  const t = totals.value
  if (!t.due) return false
  const pct = t.traces ? (t.due / t.traces) * 100 : 100
  const perUser = t.users ? t.due / t.users : t.due
  return pct >= DUE_WARN_PCT || perUser >= DUE_WARN_PER_USER
})
const dueCardTitle = computed(() => {
  const t = totals.value
  return `到该复习而未复习 ${t.due} 条，占全部记录 ${duePct.value}%`
})

/* 到期时间轴窗口与下钻计算已随分布带退役（2026-10-17）：页面不再额外拉最近 200 条痕迹，
   到期口径由 KPI「当前到期」与「待复习」列承担。 */

interface OverviewCard {
  label: string
  value: string | number
  /** 副行可缺省：只放取数三态，不写口径自述 */
  hint?: string
  /** 悬停只留读数本身（如「到该复习而未复习 N 条，占全部记录 X%」），不写机制与阈值说明 */
  title?: string
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | ''
  /** 可点：点中落到对应快筛（「需人工确认」→ 需关注） */
  clickable?: boolean
}

/** 页级绝对值单一来源；失败/未落定一律 '—'（R2 + B5-F3-2），不静默归零 */
const overviewCards = computed<OverviewCard[]>(() => {
  const t = totals.value;
  const failed = !!error.value
  const pending = kpiPending.value
  const na = failed || pending
  const val = (v: number) => (na ? '—' : v)
  const numTone = (tone: OverviewCard['tone']): OverviewCard['tone'] => (failed ? 'bad' : pending ? 'muted' : tone)
  const numHint = (text: string) => (failed ? '取数失败' : pending ? '取数中…' : text)
  /* 待审队列已并入此卡（2026-10-22 用户「合并了」）：需人工确认的不是只有 ambiguous，
     同义概念待确认 + 模糊候选 + 散键清理建议才是完整的「人审待办」。口径取
     fragmentation.pendingReview；后端旧版没这个字段时退回 ambiguous，不静默归零。 */
  const reviewQueue = totals.value.fragmentation?.pendingReview
  /* 归并审计是「按用户跑观察」才有的投影：一条都没有时，需人工确认/归并候选的 0 不是
     「观察过、很干净」，而是「还没观察」。两者必须分开显示（2026-10-23 用户
     「为什么包括测试的也是很多0」——26 位测试用户、55 条痕迹，审计读数全是 0）。 */
  const noAudit = (t.usersWithAudit ?? 0) === 0
  return [
    { label: '有记忆痕迹的用户', value: val(t.users), hint: numHint(''), tone: numTone('') },
    { label: '记忆痕迹', value: val(t.traces), tone: numTone('') },
    { label: '当前到期', value: val(t.due), hint: numHint(''), tone: numTone(dueWarn.value ? 'warn' : ''), title: dueCardTitle.value },
    {
      label: '需人工确认',
      value: noAudit ? '—' : val(reviewQueue ?? t.ambiguous),
      hint: numHint(''),
      tone: numTone(!noAudit && (reviewQueue ?? t.ambiguous) > 0 ? 'warn' : ''),
      /* 确认 / 驳回 / 回滚在「记忆调度」页签：卡可点，落到需关注快筛（同一批人） */
      clickable: !noAudit
    },
    /* 2026-10-23：待归并建议 / 未挂靠散键不再占 KPI 卡——两项都能落到「哪位学习者」，
       改由列表的「归并候选」「散键」两列承载，页头只留列表无法表达的读数 */
  ];
});

/* 碎片率 KPI 行（R7 outlet 域契约 D）：后端未部署（字段整体缺失）→ '—' +「指标未取到」。
   2026-10-22 起只留两卡：「待审队列」并入「需人工确认」，不再同维度说两遍。 */
const fragmentationCards = computed<OverviewCard[]>(() => {
  const frag = totals.value.fragmentation
  const failed = !!error.value
  const pending = kpiPending.value
  const na = failed || pending
  const numTone = (tone: OverviewCard['tone']): OverviewCard['tone'] => (failed ? 'bad' : pending ? 'muted' : tone)
  /* 副行只留取数状态（2026-10-21）：口径与包含关系全部进 title */
  const stateHint = (missing: boolean) =>
    failed ? '取数失败' : pending ? '取数中…' : missing ? '指标未取到' : ''
  const ratio = frag?.duplicateLabelRatio
  return [
    {
      label: '措辞重复率',
      value: na || ratio == null ? '—' : `${Math.round(ratio * 100)}%`,
      hint: stateHint(!frag || ratio == null),
      tone: numTone(!na && ratio != null && ratio >= 0.2 ? 'warn' : '')
    },
  ];
});

/** 页头 KPI 单带（2026-10-12 用户走查「怎么双 kpi」）：量值五卡 + 治理碎片两卡合成一条，
    不再两段栅格——1920 下两段卡宽不一致（5 卡 ~310px vs 3 卡 ~530px），读作两套 KPI。
    两域取数语义各自保留：fragmentation 缺失仍由 fragmentationCards 出 '—' +「指标未取到」 */
const headKpiCards = computed<OverviewCard[]>(() => [...overviewCards.value, ...fragmentationCards.value])

/** 到期压力档：0=安静；占痕迹 ≥50% 或绝对数 ≥12 = 重压（红）；其余 = 提醒（琥珀） */
function dueTone(row: OverviewRow): 'none' | 'warn' | 'high' {
  if (!row.due) return 'none';
  const pct = row.traces ? (row.due / row.traces) * 100 : 100;
  return pct >= 50 || row.due >= 12 ? 'high' : 'warn';
}
function strengthPct(row: OverviewRow): number {
  return row.avgStrength == null ? 0 : Math.round(row.avgStrength * 100);
}
function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

/* last-wins 代际号（P2）：切口径/翻页时旧响应不得覆盖新状态 */
let overviewSeq = 0

async function loadOverview() {
  const seq = ++overviewSeq
  loading.value = true
  error.value = ''
  try {
    const res = await adminMemoryReviewApi.overview({
      limit: userPageSize.value,
      offset: (userPage.value - 1) * userPageSize.value,
      // 默认口径 = 全部非虚拟账号（后端单点）；虚拟学习者的记忆在虚拟学习者详情里看
      sort: userSortKey.value,
      order: userSortDir.value
    })
    if (seq !== overviewSeq) return
    const body = res.data?.data ?? res.data ?? {}
    /* 2026-10-23 用户「列的信息就很少，但是 kpi 信息很多」：把原来只住在 KPI 的两项
       （待归并建议 / 未挂靠散键）搬到行上——它们本来就有逐用户读数，只是没接出来。 */
    rows.value = (Array.isArray(body.users) ? body.users : []).map((u: Record<string, any>) => ({
      ...u,
      proposed: Number(u.audit?.proposed ?? 0),
      scatter: Number(u.unattachedScatterKeys ?? 0)
    }))
    if (!rows.value.length && userPage.value > 1) {
      userPage.value = 1
      return
    }
    totals.value = { ...totals.value, ...(body.totals || {}) }
    overviewReady.value = true
  } catch (e) {
    if (seq !== overviewSeq) return
    error.value = errMsg(e)
  } finally {
    if (seq === overviewSeq) loading.value = false
  }
}

/** 概览（分布带退役后只剩这一路取数） */
async function refreshAll() {
  await loadOverview()
}

/* 顶栏刷新广播：本页数据（概览 + 碎片率）不在 live 域里，靠这条把顶栏那颗接过来 */
watch(liveRefreshSeq, () => { void refreshAll() })

/** 行内「重新观察」进行中标记：只转该行按钮文案，不锁整页 */
const recomputingId = ref('')

async function recompute(userId: string, name?: string | null) {
  if (recomputingId.value) return
  /* B5-F3-5：行级写动作补确认（observe 语义，仍写审计投影行） */
  const ok = await askConfirm({
    title: '重新观察',
    message: `确认对「${name || shortId(userId)}」重新跑一次记忆复盘？将重新观察其记忆痕迹与归并建议（只记录建议，不改动记忆痕迹），结果实时刷新。`,
    confirmText: '重新观察',
    danger: false
  })
  if (!ok) return
  busy.value = true
  recomputingId.value = userId
  error.value = ''
  try {
    await adminMemoryReviewApi.recompute(userId)
    await loadOverview()
    toast.success('已完成一次记忆复盘')
  } catch (e) {
    error.value = errMsg(e)
    toast.error(`重新观察失败：${errMsg(e)}`)
  } finally {
    busy.value = false
    recomputingId.value = ''
  }
}

const route = useRoute()
const router = useRouter()

/** 行 → 学习者详情并落在「记忆与复习」页签：本列表读的就是 FSRS 普查读数（记忆痕迹 / 待复习 /
 *  记忆强度），与详情同名页签同源同口径。落点常量单点在 store 的 LEARNER_DETAIL_LANDING。 */
function openLearner(userId: string) {
  openSubPage('learner', userId, { tab: LEARNER_DETAIL_LANDING.memoryReview })
}

/** 行内待办数字（待确认 / 归并候选 / 散键）→ 「记忆调度」页签：确认、驳回、回滚都在那里 */
function openOps(userId: string) {
  openSubPage('learner', userId, { tab: 'memory-ops' })
}

/** 整页无数据时的下一步：没有记忆痕迹通常意味着课堂 / 抽取没在跑 */
function goTeachingSessions() {
  void router.push('/admin/teaching-sessions')
}

onMounted(async () => {
  // 旧深链 /admin/memory-review?userId=… → 学习者详情「记忆调度」页签（单用户明细单家，
  // 2026-10-12 拍板）；总览页自己只服务无 userId 的跨用户视图
  const queryUserId = typeof route.query.userId === 'string' ? route.query.userId : ''
  if (queryUserId) {
    const { userId: _drop, ...rest } = route.query
    router.replace({ path: '/admin/learner-state', query: { ...rest, view: 'learner', id: queryUserId, tab: 'memory-ops' } })
    return
  }
  await loadOverview()
})
</script>

<style scoped>
/* 固定列宽（2026-10-22 与教学组三表同判例）：学习者列在 auto 布局下按当页最长姓名分宽，
   翻页整表跳动；fixed 后按表头定死，余量按权重摊开。宽度按 1280 现值校准，1200 档无横滚。 */
.mr-c-user { width: 230px; }
.mr-c-traces { width: 96px; }
.mr-c-due { width: 84px; }
.mr-c-weak { width: 84px; }
.mr-c-prop { width: 92px; }
.mr-c-scatter { width: 76px; }
.mr-c-strength { width: 150px; }
.mr-c-last { width: 100px; }
/* 操作列宽度由全局 .mk-c-act 统一（2026-10-27） */

.mr { display: flex; flex-direction: column; }

/* ===== 用户列表（2026-09-28：表头回归——行列表没有表头，右侧裸数字无从解读）===== */
.mr__user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mr__user .mk-cell-main { min-width: 0; flex: 1; }

/* 待复习：只出数字，颜色表达压力（0=弱化 / 琥珀=提醒 / 红=重压）；占比口径进 title */
.mr__due-num { font-variant-numeric: tabular-nums; font-weight: 700; }
.mr__due-num--none { color: var(--mk-faint); font-weight: 400; }
.mr__due-num--warn { color: var(--mk-amber); }
.mr__due-num--high { color: var(--mk-red-strong); }

/* 需关注：薄弱徽章 + 待确认入口（后者可点直达「记忆调度」）；无事项出一行「无」，不留空列 */
.mr__focus { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mr__none { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
/* 行内数字按钮：读数是可点的入口，样式仍按数字（tabular-nums），只借 .mk-link 的交互语义 */
.mr__act { padding: 0; font-size: var(--mk-fs-micro); font-variant-numeric: tabular-nums; }
/* 可点 KPI 的选中态：蓝只给可交互与选中 */
.mr-kpi--on { border-color: var(--mk-blue); }

/* 记忆强度：全表唯一一条比例条。% 盒定宽（2026-10-15 判例）：数值宽窄不同会让条起点
   逐行横跳，定为 38px 后条起点对齐，数值右缘仍与右对齐表头同侧。 */
.mr__strength { display: inline-flex; align-items: center; gap: 8px; }
.mr__strength-pct { font-variant-numeric: tabular-nums; font-weight: 700; width: 38px; text-align: right; }
.mr__bar { width: 64px; }

/* 窄屏（2026-10-17 实测）：八张 KPI 卡竖排后高于视口，fill 布局把列表卡压成 1px 高，
   表格整块不可达（页面滚到底也看不到）。窄屏让卡片按内容高度展开，改由页面容器滚动。
   媒体查询必须留在文件末尾：桌面 fill 规则在上面，插在前面会被盖回死代码。 */
@media (max-width: 900px) {
  .mr .mk-card--fill { flex: none; }
  /* 窄屏表格宽度不够分时，学习者格的 flex:1 + min-width:0 会把姓名压成 0 宽（只剩头像）。
     给身份格一个下限，表格横向滚动由 .mk-table-scroll 承担。 */
  .mr__user { min-width: 156px; }
}
</style>
