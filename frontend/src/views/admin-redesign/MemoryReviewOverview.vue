<template>
  <!-- 记忆与复习 · 跨用户总览（2026-10-12 用户拍板恢复：独立页退役时跨用户积压视图跟着没了，
       本页从 git 历史原样找回列表态——按待复习量排序的用户列表 + 到期时间轴下钻）。
       单用户明细不在这里：点行进学习者详情「记忆与复习 / 记忆调度」页签；
       旧深链 /admin/memory-review?userId=… 转发 learner 详情（见 onMounted）。 -->
  <div class="mr mk-page mk-page--fill">
    <!-- 页头（newui/admin pagehead）：页名（悬停带口径长注）+ 作用域开关/刷新上移；
         原状态条整体退役 -->
    <MkPageHead
      title="记忆与复习观测"
      sub="遗忘曲线调度 · 到期积压、课内温故与概念归并审计"
      hint="到期积压 · 课内温故 · 概念归并审计。归并默认只记录建议，不改动数据"
    >
      <template #actions>
        <!-- 口径开关收在页头（2026-10-04 整组统一为 DataScopeToggle：学习组六页同一位、同一状态）。
             它切换的是整页口径：含虚拟学习者时，用户 / 痕迹 / 到期与归并队列一并纳入仿真账号 -->
        <DataScopeToggle v-model="includeVirtual" />
      </template>
    </MkPageHead>
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
        :aria-busy="kpiPending || undefined"
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
          <div class="mk-pills" role="group" aria-label="复习状态筛选">
            <button
              v-for="p in mrPills"
              :key="p.key"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': mrPill === p.key }"
              :aria-pressed="mrPill === p.key"
              :title="p.title"
              @click="mrPill = p.key"
            >{{ p.label }}<span v-if="p.n != null" class="mk-pill__count">{{ p.n }}</span></button>
          </div>
        </div>
        <div class="mk-card__head-right">
          <span class="mk-card__meta" :title="`按「${userSortText}」排序（在全部用户里排好再分页，不是只排当前页），每页显示的行数可调。快速筛选只作用于当前页${mrPill === 'all' ? '' : '，已筛 ' + visibleRows.length + ' 位'}`">第 {{ userPage }} 页 · 每页 {{ userPageSize }} 位 · {{ userSortText }}<template v-if="mrPill !== 'all'"> · 已筛 {{ visibleRows.length }} 位</template></span>
        </div>
      </div>
      <!-- 取数失败不得渲染成「暂无数据」（R2）：有旧行时保留旧行并给带重试的 .mk-alert -->
      <div v-if="error && rows.length" class="mk-alert mk-alert--row" role="alert">
        <span class="mk-alert__msg">{{ error }}</span>
        <button type="button" class="mk-alert__btn" :disabled="loading" @click="refreshAll">{{ loading ? '重试中…' : '重试' }}</button>
      </div>
      <MkEmptyState
        v-if="error && !rows.length"
        tone="error"
        :title="error"
        description="统计数据加载失败，页面数字可能不完整。"
        action-text="重试"
        :action-busy="loading"
        action-busy-text="重试中…"
        @action="refreshAll"
      />
      <MockSkeletonTable v-else-if="loading && !rows.length" :cols="7" :rows="8" />
      <MkEmptyState v-else-if="!loading && !rows.length" title="暂无记忆痕迹数据" description="还没有用户产生记忆记录。学习者开始学习并完成概念提取后，这里会按待复习量从多到少列出用户。" />
      <!-- 用户列表（行点击跳学习者详情，EG1：回车不劫持行内按钮） -->
      <div v-else class="mk-table-scroll">
        <!-- 快筛筛空：筛选作用于当前页，空 ≠ 全库没有 -->
        <MkEmptyState
          v-if="!visibleRows.length"
          title="当前页没有符合条件的学习者"
          description="快速筛选只作用于当前页。"
          action-text="显示全部"
          @action="mrPill = 'all'"
        />
        <table v-else class="mk-table mk-table--click">
          <!-- 列集（2026-10-17 二次调整）：相邻列各画一条比例条会读成一排「重叠的条」，
               重要读数一律给独立列——待复习只留数字（颜色表达压力），记忆强度单独一列带条，
               最近复习与需关注也各自成列，不再把两项塞进同一格上下叠放。 -->
          <thead>
            <tr>
              <th scope="col" class="mk-th--sortable" :aria-sort="userSortState('name')"
                title="点列头排序：按学习者名称（中文拼音序）"
                @click="toggleUserSort('name')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('name')">学习者<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable" :aria-sort="userSortState('traces')"
                title="该用户全部记忆记录数（跨学习路径）。点列头排序：降序 = 痕迹最多的在前"
                @click="toggleUserSort('traces')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('traces')">记忆痕迹<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable" :aria-sort="userSortState('due')"
                title="点列头排序：降序 = 待复习最多的在前（默认）"
                @click="toggleUserSort('due')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('due')">待复习<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--sortable" :aria-sort="userSortState('weak')"
                title="强度跌破 40% 的痕迹数，以及待人工确认的归并候选。点列头排序：降序 = 薄弱痕迹最多的在前"
                @click="toggleUserSort('weak')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('weak')">需关注<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-num mk-th--sortable" :aria-sort="userSortState('strength')"
                title="有复习记录的痕迹的平均记忆强度，从未复习的用户没有读数（恒排末尾）。点列头排序：升序 = 平均强度最弱的在前"
                @click="toggleUserSort('strength')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('strength')">记忆强度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="mk-th--sortable" :aria-sort="userSortState('lastReviewed')"
                title="点列头排序：升序 = 最久没复习的在前（从未复习的恒排末尾）"
                @click="toggleUserSort('lastReviewed')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleUserSort('lastReviewed')">最近复习<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th class="mk-th--right">操作</th>
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
                    <span class="mk-cell-sub">{{ shortId(row.userId) }}</span>
                  </div>
                  <MkVariantBadge v-if="row.isVirtualLearner" kind="virtual" />
                </div>
              </td>
              <td class="mk-num" :title="`该用户共 ${row.traces} 条记忆记录，跨学习路径`">{{ row.traces }}</td>
              <td class="mk-num">
                <!-- 只留数字：比例条移到「记忆强度」列，避免与相邻列的另一条并排读成一条 -->
                <b class="mr__due-num" :class="`mr__due-num--${dueTone(row)}`" :title="dueTitle(row)">{{ row.due }}</b>
              </td>
              <td>
                <div v-if="row.weak > 0 || row.audit?.ambiguous" class="mr__focus">
                  <span v-if="row.weak > 0" class="mk-badge mk-badge--sm mk-badge--warn" :title="`${row.weak} 条痕迹强度已跌破 40%，临近遗忘`">薄弱 {{ row.weak }}</span>
                  <span v-if="row.audit?.ambiguous" class="mk-badge mk-badge--sm mk-badge--warn" :title="`${row.audit.ambiguous} 条归并候选需人工确认，不会自动执行`">人工看 {{ row.audit.ambiguous }}</span>
                </div>
                <span v-else class="mr__none" title="没有强度跌破 40% 的痕迹，也没有待人工确认的归并候选">无</span>
              </td>
              <td class="mk-num">
                <span v-if="row.avgStrength != null" class="mr__strength" title="有强度痕迹的平均记忆强度">
                  <span class="mk-minibar mr__bar" aria-hidden="true"><i class="mk-minibar__fill" :style="{ width: strengthPct(row) + '%' }"></i></span>
                  <b class="mr__strength-pct">{{ strengthPct(row) }}%</b>
                </span>
                <span v-else class="mk-na" title="该用户的痕迹都还没有记忆强度数据">—</span>
              </td>
              <td :title="row.lastReviewedAt ? fullTime(row.lastReviewedAt) : '有记忆痕迹，但还没有复习过'">
                <span v-if="row.lastReviewedAt" class="mk-cell-sub mono">{{ timeAgo(row.lastReviewedAt) }}</span>
                <span v-else class="mr__none">未复习</span>
              </td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="recomputingId === row.userId" title="重新跑一次该用户的记忆复盘，结果实时刷新" @click.stop="recompute(row.userId, row.name)">{{ recomputingId === row.userId ? '观察中…' : '重新观察' }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- 服务端分页（审核 #41）：total=后端全量有痕迹用户数（totals.users）；v-model:pageSize 接住条数变更 -->
      <Pagination
        v-model:page="userPage"
        v-model:pageSize="userPageSize"
        :total="totals.users"
        :loading="loading"
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
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import { useTableSort } from './useTableSort'
import DataScopeToggle from './DataScopeToggle.vue'
import { askConfirm } from './useConfirm'
import { openSubPage, LEARNER_DETAIL_LANDING } from './store'
import { toast } from '@/utils/toast'
import { errMsg, shortId, timeAgo, liveIncludeVirtual, liveSetIncludeVirtual } from './live'

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
  traces: number
  due: number
  audit: AuditUserSummary | null
  /** 按次留档的归并凭据计数（权威；审计滚动窗口之外的历史归并也计入） */
  merges?: { rollbackable: number; rolledBack: number }
  /* 原型 renderMemory 三列：薄弱 = FSRS 强度<40% 的痕迹数；平均强度 0-1，null = 无带 FSRS 强度的痕迹 */
  weak: number
  avgStrength: number | null
  lastReviewedAt: string | null
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
  keys: ['name', 'traces', 'due', 'weak', 'strength', 'lastReviewed'],
  defaultKey: 'due',
  defaultDir: 'desc',
  // 姓名/强度/最近复习首击升序（名字正序、最弱的在前、最久没复习的在前——「最该关注的在前」
  // 在时间列上的写法就是最久没复习的排头），其余首击降序（最多的在前）
  defaultDirOf: { name: 'asc', strength: 'asc', lastReviewed: 'asc' }
})
const USER_SORT_LABEL: Record<string, string> = {
  name: '学习者名称',
  traces: '记忆痕迹',
  due: '待复习',
  weak: '需关注',
  strength: '记忆强度',
  lastReviewed: '最近复习'
}
/** 实际生效的排序以响应回显为准（参数非法时后端回落默认，界面不得把默认序说成用户选的） */
const appliedUserSort = ref<{ key: string; order: 'asc' | 'desc' }>({ key: 'due', order: 'desc' })
const userSortText = computed(() => {
  const { key, order } = appliedUserSort.value
  const label = USER_SORT_LABEL[key] ?? key
  const dirText = key === 'name'
    ? (order === 'asc' ? '正序' : '倒序')
    : key === 'due' || key === 'traces' || key === 'weak'
      ? (order === 'asc' ? '从少到多' : '从多到少')
      : key === 'strength'
        ? (order === 'asc' ? '从弱到强' : '从强到弱')
        : (order === 'asc' ? '从久到近' : '从近到久')
  return `${label}${dirText}`
})
watch([userSortKey, userSortDir], () => {
  // 排序变了从第 1 页看（否则停在旧页会读作「排序没生效」）
  if (userPage.value !== 1) userPage.value = 1
  else void loadOverview()
})

const includeVirtual = computed({
  get: () => liveIncludeVirtual.value,
  set: (v) => liveSetIncludeVirtual(v)
})
watch(includeVirtual, () => {
  userPage.value = 1
  void refreshAll()
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
   分布带退役后卡头左组是空的。三枚条件都直接来自行数据，计数按当前页计算
   ——服务端分页只回 limit 条，用全库数字当 pill 计数会与本页行对不上。
   切筛选回第 1 页：否则在第 2 页勾选后看到的只是第 2 页命中的行。 */
type MrPill = 'all' | 'due' | 'unreviewed' | 'attention'
const mrPill = ref<MrPill>('all')
watch(mrPill, () => {
  if (userPage.value !== 1) userPage.value = 1
})
const mrPills = computed<Array<{ key: MrPill; label: string; n: number | null; title: string }>>(() => {
  const due = rows.value.filter((r) => r.due > 0).length
  const unreviewed = rows.value.filter((r) => !r.lastReviewedAt).length
  const attention = rows.value.filter((r) => r.weak > 0 || !!r.audit?.ambiguous).length
  return [
    { key: 'all', label: '全部', n: null, title: '不限复习状态' },
    { key: 'due', label: '有待复习', n: due, title: `当前页有到期未复习项的用户 ${due} 位` },
    { key: 'unreviewed', label: '未复习', n: unreviewed, title: `当前页有记忆痕迹但从未复习的用户 ${unreviewed} 位` },
    { key: 'attention', label: '需关注', n: attention, title: `当前页有薄弱痕迹或待人工确认归并候选的用户 ${attention} 位` }
  ]
})
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
  return `到该复习而未复习 ${t.due} 条，占全部记录 ${duePct.value}%。达到 ${DUE_WARN_PCT}% 或人均 ${DUE_WARN_PER_USER} 条以上时标为需关注`
})

/* 到期时间轴窗口与下钻计算已随分布带退役（2026-10-17）：页面不再额外拉最近 200 条痕迹，
   到期口径由 KPI「当前到期」与「待复习」列承担。 */

interface OverviewCard {
  label: string
  value: string | number
  hint: string
  title: string
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | ''
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
  return [
    { label: '用户', value: val(t.users), hint: numHint('有记忆痕迹'), tone: numTone(''), title: '全部有记忆记录的用户数。是否含虚拟学习者随页头开关' },
    { label: '记忆痕迹', value: val(t.traces), hint: numHint('跨全部学习路径'), tone: numTone(''), title: '记忆记录总数（用户级、跨全部学习路径）' },
    { label: '当前到期', value: val(t.due), hint: numHint(t.traces ? `占痕迹 ${duePct.value}%` : '暂无痕迹'), tone: numTone(dueWarn.value ? 'warn' : ''), title: dueCardTitle.value },
    { label: '需人工看', value: val(t.ambiguous), hint: numHint('归并候选 · 不自动执行'), tone: numTone(t.ambiguous > 0 ? 'warn' : ''), title: '像但不确定的归并候选，需人工确认，不会自动执行' },
    { label: '待归并建议', value: val(t.proposed), hint: numHint(`其中 ${t.autoApplicable} 条可自动执行`), tone: numTone(''), title: `模型给出的同义概念候选。「可自动」指系统有把握且名称足够相似。执行后保留备份，可回滚。已执行 ${t.applied} 条，已删除 ${t.deleted} 条` }
  ];
});

/* 碎片率 KPI 行（R7 outlet 域契约 D）：后端未部署（字段整体缺失）→ '—' +「指标未取到」 */
const fragmentationCards = computed<OverviewCard[]>(() => {
  const frag = totals.value.fragmentation
  const failed = !!error.value
  const pending = kpiPending.value
  const na = failed || pending
  const metricMissing = !frag
  const numTone = (tone: OverviewCard['tone']): OverviewCard['tone'] => (failed ? 'bad' : pending ? 'muted' : tone)
  const numHint = (text: string) => (failed ? '取数失败' : pending ? '取数中…' : metricMissing ? '指标未取到' : text)
  const ratio = frag?.duplicateLabelRatio
  const unattached = frag?.unattachedKeys
  const pendingReview = frag?.pendingReview
  /* 「需人工看」这一项（totals.ambiguous）既是同带上的独立一卡，又是 pendingReview 求和公式里的加数
     （后端 memory-review.ts:64-68：review 档归并建议 + ambiguous + 散键清理建议）——
     它非 0 而另两项为 0 时，两卡必然同数。 */
  const ambiguous = totals.value.ambiguous
  return [
    {
      label: '措辞重复率',
      value: na || ratio == null ? '—' : `${Math.round(ratio * 100)}%`,
      hint: numHint('措辞重复的痕迹占比'),
      tone: numTone(!na && ratio != null && ratio >= 0.2 ? 'warn' : ''),
      title: '含义相同、措辞重复的记忆记录占比，越高说明概念越碎，达到 20% 时标为需关注。虚拟学习者是否计入随所处视角变化'
    },
    {
      label: '未挂靠散键',
      value: na || unattached == null ? '—' : unattached,
      hint: numHint('未关联到标准概念的键'),
      tone: numTone(!na && unattached != null && unattached > 0 ? 'warn' : ''),
      title: '自由填写的、未关联到标准概念的概念标识数量——无法自动收拢，只能通过归并 / 清理建议逐条治理'
    },
    {
      label: '待审队列',
      value: na || pendingReview == null ? '—' : pendingReview,
      /* hint 明写包含关系（2026-10-14 走查）：旧 hint「人审队列中的建议数」不给任何线索，
         而本卡是「人审档归并建议 + **需人工看** + 散键清理建议」之和 —— 带上那枚独立卡
         「需人工看」就在和里，另两项为 0 时两卡同数，7 与 7 并排读作矛盾数字。 */
      hint: numHint(pendingReview != null && ambiguous > 0 ? `含需人工看 ${ambiguous}` : '人审队列中的建议数'),
      tone: numTone(!na && pendingReview != null && pendingReview > 0 ? 'warn' : ''),
      title: '待审队列深度：归并建议、需人工看与散键清理建议之和（「需人工看」已含在此数内）。不会自动执行'
    }
  ];
});

/** 页头 KPI 单带（2026-10-12 用户走查「怎么双 kpi」）：量值五卡 + 治理碎片三卡合成一条，
    不再两段栅格——1920 下两段卡宽不一致（5 卡 ~310px vs 3 卡 ~530px），读作两套 KPI。
    两域取数语义各自保留：fragmentation 缺失仍由 fragmentationCards 出 '—' +「指标未取到」 */
const headKpiCards = computed<OverviewCard[]>(() => [...overviewCards.value, ...fragmentationCards.value])

/** 到期压力档：0=安静；占痕迹 ≥50% 或绝对数 ≥12 = 重压（红）；其余 = 提醒（琥珀） */
function dueTone(row: OverviewRow): 'none' | 'warn' | 'high' {
  if (!row.due) return 'none';
  const pct = row.traces ? (row.due / row.traces) * 100 : 100;
  return pct >= 50 || row.due >= 12 ? 'high' : 'warn';
}
function duePctOf(row: OverviewRow): number {
  return row.traces ? Math.min(Math.round((row.due / row.traces) * 100), 100) : row.due ? 100 : 0;
}
/** 0 到期不提「占 0%」这种无信息量的话，直接给出分母（共 N 条痕迹） */
function dueTitle(row: OverviewRow): string {
  return row.due
    ? `到该复习而未复习 ${row.due} 条，占该用户痕迹 ${duePctOf(row)}%`
    : `没有到期未复习的记录，该用户共 ${row.traces} 条痕迹`;
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
      includeVirtual: includeVirtual.value,
      testOnly: includeVirtual.value || undefined,
      sort: userSortKey.value,
      order: userSortDir.value
    })
    if (seq !== overviewSeq) return
    const body = res.data?.data ?? res.data ?? {}
    rows.value = Array.isArray(body.users) ? body.users : []
    if (!rows.value.length && userPage.value > 1) {
      userPage.value = 1
      return
    }
    totals.value = { ...totals.value, ...(body.totals || {}) }
    if (body.sort && typeof body.sort.key === 'string') {
      appliedUserSort.value = { key: body.sort.key, order: body.sort.order === 'asc' ? 'asc' : 'desc' }
    }
    overviewReady.value = true
  } catch (e) {
    if (seq !== overviewSeq) return
    error.value = errMsg(e)
  } finally {
    if (seq === overviewSeq) loading.value = false
  }
}

/** 页头刷新：概览（分布带退役后只剩这一路取数） */
async function refreshAll() {
  await loadOverview()
}

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
 *  记忆强度），与详情同名页签同源同口径，不该落「概览」（2026-10-18 用户走查）。
 *  落点常量单点在 store 的 LEARNER_DETAIL_LANDING；「记忆调度」页签是治理动作面，
 *  仍只由旧深链 ?userId= 与详情内切换进入。 */
function openLearner(userId: string) {
  openSubPage('learner', userId, { tab: LEARNER_DETAIL_LANDING.memoryReview, ...(includeVirtual.value ? { includeTest: true } : {}) })
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
.mr { display: flex; flex-direction: column; }

/* ===== 用户列表（2026-09-28：表头回归——行列表没有表头，右侧裸数字无从解读）===== */
.mr__user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mr__user .mk-cell-main { min-width: 0; flex: 1; }

/* 待复习：只出数字，颜色表达压力（0=弱化 / 琥珀=提醒 / 红=重压）；占比口径进 title */
.mr__due-num { font-variant-numeric: tabular-nums; font-weight: 700; }
.mr__due-num--none { color: var(--mk-faint); font-weight: 400; }
.mr__due-num--warn { color: var(--mk-amber); }
.mr__due-num--high { color: var(--mk-red-strong); }

/* 需关注：薄弱 / 待人工确认两枚琥珀徽章；无事项出一行「无」，不留空列 */
.mr__focus { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mr__none { color: var(--mk-faint); font-size: var(--mk-fs-micro); }

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
