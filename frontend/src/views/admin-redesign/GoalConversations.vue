<template>
  <div class="mk-page mk-page--fill gc-host">
    <!-- 页头（newui/admin pagehead）：页名 + 口径副文 + 刷新上移；
         2026-09-29 拆回独立页：本组件从「学习会话」合并宿主还原为「目标对话」单页。
         原页面级状态条整体退役（dot 的加载/有数状态由 KPI 卡与列表自明）。 -->
    <MkPageHead
      title="目标对话"
      :sub="gcScopeSub"
    >
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="loading" @click="load(true)">{{ loading ? '刷新中…' : '刷新' }}</button>
      </template>
    </MkPageHead>

    <!-- 状态桶组（newui renderGoals 原型移植）：本页唯一统计带 = 页头 KPI，
         四桶「进行中 / 已完成 / 已取消 / 完成率」直接落页面（原型 buckets 无卡壳）。
         此前 kpi 栅格与构成卡两带并存、已取消/已完成数字复读（2026-10-02 用户拍板撤双带）；
         卡头 pills 因此不带计数。
         三态（P1#6）：stats 拉取失败时桶位显示「统计获取失败 · 重试」，不再整组静默消失；
         「进行中」桶 foot 携停滞信号（窗口内 active 且超 7 天未更新）；
         「已取消」桶 foot 写明「取消 / 中断 / 回收合计」口径（= 总数 − 进行中 − 已完成，
         含 abandoned / failed，不再是纯「用户取消」）。 -->
    <section v-if="statsError" class="buckets" aria-label="目标对话状态构成">
      <div class="bucket">
        <span class="bucket__l">统计获取失败</span>
        <span class="bucket__l bucket__foot">状态构成（进行中 / 已完成 / 已取消 / 完成率）暂不可用 · <button type="button" class="mk-link" @click="load(true)">重试</button></span>
      </div>
    </section>
    <section v-else-if="stats && stats.total > 0" class="buckets" aria-label="目标对话状态构成">
      <div class="bucket">
        <span class="bucket__v">{{ stats.active }}</span>
        <span class="bucket__l">进行中</span>
        <span class="bucket__bar" aria-hidden="true"><i :style="{ width: gcActivePct + '%', background: 'var(--mk-blue)' }"></i></span>
        <span class="bucket__l bucket__foot">澄清中或待确认</span>
        <span v-if="rows.length" class="bucket__l bucket__foot" :title="`停滞口径：状态「进行中」且最近 ${STALLED_DAYS} 天无更新（updatedAt）；按最近 ${LIST_LIMIT} 条加载窗口估算，非全量`">其中 {{ staleActiveCount }} 条超 {{ STALLED_DAYS }} 天未更新</span>
      </div>
      <div class="bucket">
        <span class="bucket__v">{{ stats.completed }}</span>
        <span class="bucket__l">已完成</span>
        <span class="bucket__bar" aria-hidden="true"><i :style="{ width: gcCompletedPct + '%', background: 'var(--mk-green)' }"></i></span>
        <span class="bucket__l bucket__foot">已生成学习路径</span>
      </div>
      <div class="bucket">
        <span class="bucket__v">{{ gcCancelledCount }}</span>
        <span class="bucket__l">已取消</span>
        <span class="bucket__bar" aria-hidden="true"><i :style="{ width: gcCancelledPct + '%', background: 'var(--mk-red)' }"></i></span>
        <span class="bucket__l bucket__foot" title="已取消 = 总数 − 进行中 − 已完成：含用户主动取消（cancelled）、失败中断（failed）与无心跳自动回收（abandoned），非全部用户主动取消">取消 / 中断 / 回收合计</span>
      </div>
      <div class="bucket">
        <span class="bucket__v">{{ stats.completionRate }}%</span>
        <span class="bucket__l">完成率</span>
        <span class="bucket__bar" aria-hidden="true"><i :style="{ width: gcCompletedPct + '%', background: 'var(--mk-blue)' }"></i></span>
        <span class="bucket__l bucket__foot">已完成 {{ stats.completed }} / 总数 {{ stats.total }}</span>
      </div>
    </section>

    <!-- ===== 目标对话列表 ===== -->
    <MkEmptyState
      v-if="!rows.length && !loading && !loadError"
      title="暂无 Goal 会话数据"
      description="学习者发起目标对话后自动呈现。"
    />

    <template v-else>
      <!-- 列表 -->
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
                :aria-pressed="statusFilter === p.id"
                :title="p.title || undefined"
                @click="statusFilter = statusFilter === p.id ? '' : p.id"
              >
                {{ p.label }}
              </button>
            </div>
            <MkFilterSearch v-model="keyword" placeholder="搜索用户 / 邮箱 / 目标摘要" />
            <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
          </div>
          <div class="mk-card__head-right">
            <DataScopeToggle v-model="includeTest" />
            <MkCols
              :col-defs="gcColDefs"
              storage-key="wf_goal_hidden_cols"
              v-model:hidden="gcHiddenCols"
            />
            <span class="mk-card__meta" :title="includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户'">{{ filtered.length }} / {{ rows.length }} 条（{{ includeTest ? '含模拟' : '仅真实' }}）<template v-if="stats && stats.total > rows.length"> · 仅显示最近 {{ rows.length }} 条</template></span>
          </div>
        </div>

        <MockSkeletonTable v-if="loading && !rows.length" :cols="9" />
        <!-- P0 修复：加载失败行内错误 + 重试（此前失败伪装成「暂无会话」） -->
        <div v-else-if="loadError" class="gc-error" role="alert">
          <span>{{ loadError }}</span>
          <button type="button" class="mk-link" @click="load(true)">重试</button>
        </div>
        <div v-else-if="filtered.length" class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap、
             列按内容自然分宽；长摘要/长邮箱由 .mk-cell-text / .mk-cell-main 的 max-width 截断兜底 -->
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th v-if="!gcHiddenCols.has('summary')">目标摘要</th>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="gcSortState('user')"
                @click="toggleGcSort('user')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!gcHiddenCols.has('status')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="gcSortState('status')"
                @click="toggleGcSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!gcHiddenCols.has('stage')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="gcSortState('stage')"
                @click="toggleGcSort('stage')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('stage')">阶段<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!gcHiddenCols.has('turns')"
                scope="col"
                class="mk-th--sortable mk-th--right"
                :aria-sort="gcSortState('turns')"
                @click="toggleGcSort('turns')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('turns')">澄清进度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="!gcHiddenCols.has('constraints')">约束条件</th>
              <th v-if="!gcHiddenCols.has('path')">路径</th>
              <th v-if="!gcHiddenCols.has('created')">创建时间</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paged" :key="r.id" tabindex="0" @click="goConsole(r)" @keydown.enter.prevent="goConsole(r)">
              <td v-if="!gcHiddenCols.has('summary')">
                <!-- 原型目标摘要格 = wrap 两行：strong 摘要 + sub mono 会话 ID。
                     列序统一（2026-10-03）：主体列恒在首（同 TS 会话/OC 路径/MR 学习者），用户列随后 -->
                <div class="mk-cell-main">
                  <strong class="mk-cell-text" :title="r.summary">{{ r.summary }}</strong>
                  <span class="mk-cell-sub mono" :title="`会话 ID ${r.id}`">{{ r.id }}</span>
                </div>
              </td>
              <td>
                <div class="gc-user">
                  <MkCellAvatar :name="r.userName" :tone="avatarTone(r)" />
                  <div class="mk-cell-main">
                    <strong>{{ r.userName }}</strong>
                    <span class="mk-cell-sub">{{ r.userEmail }}</span>
                  </div>
                  <div class="gc-tags">
                    <MkVariantBadge v-if="r.isVirtualLearner" kind="virtual" />
                    <MkVariantBadge v-else-if="r.isTestAccount" kind="test" />
                  </div>
                </div>
              </td>
              <td v-if="!gcHiddenCols.has('status')"><span class="mk-badge" :class="statusBadge(r.status)" :title="statusHint(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td v-if="!gcHiddenCols.has('stage')">
                <div class="gc-stage-cell">
                  <div class="gc-stage-cell__head">
                    <span class="mk-badge" :class="stageBadgeCls(r.stage)" :title="`阶段：${stageText(r.stage) || '—'}`">{{ stageText(r.stage) || '—' }}</span>
                    <span v-if="r.timeline" class="gc-stage-cell__dots" :title="stageDotsTitle(r)" aria-label="阶段进度">
                      <i v-for="d in GOAL_STAGE_TOTAL" :key="d" class="gc-stage-cell__dot" :class="{ 'is-on': d <= r.stageIndex + 1 }"></i>
                    </span>
                  </div>
                  <span v-if="r.timeline" class="mk-cell-sub" :title="r.timeline">{{ r.timeline }}</span>
                  <span v-else class="mk-na">—</span>
                </div>
              </td>
              <td v-if="!gcHiddenCols.has('turns')">
                <!-- 原型「澄清进度」列 = meter turns/targetTurns；本系统无目标轮次分母，
                     只呈现「N 轮」诚实读数（学习者发言条数），不造 meter -->
                <span v-if="r.turns != null" class="mk-num" :title="`学习者发言 ${r.turns} 轮`">{{ r.turns }} 轮</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="!gcHiddenCols.has('constraints')">
                <!-- 原型「约束条件」列 = pill--mute 多枚 wrap；真实数据为澄清收集的
                     可用时间/期限文案（稀疏属真实分布），空时 — -->
                <div v-if="r.constraints.length" class="gc-constraints">
                  <span v-for="cst in r.constraints" :key="cst" class="mk-badge mk-badge--muted" :title="`约束：${cst}`">{{ cst }}</span>
                </div>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="!gcHiddenCols.has('path')">
                <!-- 原型 open-path 习惯：生成过的路径成跳转（路径详情二级页）；后端未回 pathId 时回落徽章 -->
                <button v-if="r.pathId" type="button" class="mk-btn mk-btn--sm" title="查看该目标生成的路径详情" @click.stop="openPathPage(r)">查看路径</button>
                <span v-else-if="r.hasPath" class="mk-badge mk-badge--info">已生成</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="!gcHiddenCols.has('created')"><span class="mk-cell-sub mono" :title="r.createdAtAbs">{{ r.createdAt }}</span></td>
              <td>
                <!-- 操作列文字钮（原型 .tbl 操作列 btn--sm「详情/下线」形态，不用纯图标钮）。
                     行内只留高频项（链路/详情）；重建路径与删除同属低频矫正操作，收 ⋯ 菜单——
                     四钮并排自然宽 238px 会把整表推出容器 66px，1440 下操作列被裁（走查 2026-10-03 实测）。
                     右对齐与 mk-th--right 表头对齐（同 Users.vue 判例） -->
                <div class="mk-actions">
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="goTrace(r)">链路</button>
                  <button type="button" class="mk-btn mk-btn--sm" title="打开会话座舱（只读监控）" @click.stop="goConsole(r)">详情</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu(r.id)">⋯</button>
                    <div v-if="openMenu === r.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" :disabled="r.regenerating" :title="r.regenerating ? '生成中…' : '对该会话重新生成学习路径'" @click="regenerate(r)">{{ r.regenerating ? '生成中…' : '重建路径' }}</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuRemove(r)">删除会话</button>
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
          :title="keyword || statusFilter ? '当前筛选无匹配' : '暂无目标对话'"
          :description="keyword || statusFilter ? '放宽筛选条件试试。' : (includeTest ? '全量口径下暂无目标对话。' : '默认仅展示真实用户；切换「含模拟」可查看全部。')"
          :action-text="isFiltered ? '清除筛选' : ''"
          @action="clearFilters"
        />
        <!-- 客户端分页（P2：76 行单页直排 → mk-pagination 统一分页器，15-30-50-100 条/页） -->
        <Pagination
          v-if="filtered.length"
          v-model:page="page"
          v-model:pageSize="pageSize"
          :total="filtered.length"
          :showTotal="true"
        />
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isLive, openSubPage } from './store'
import { useSessionDrill } from './useSessionDrill'
import { errMsg, timeAgo, isPageCacheFresh, markPageFetched } from './live'
import { stageText, stageBadgeCls, stageProgressIndex, stageTimelineText, GOAL_STAGE_TOTAL, GOAL_STAGE_STEP_LABELS, statusText } from './statusText'
import { useRowMenu } from './useRowMenu'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { useTableSort } from './useTableSort'
import DataScopeToggle from './DataScopeToggle.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import { adminGoalConversationsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

interface Row {
  id: string
  userId: string
  userName: string
  userEmail: string
  /** 数据隔离标记（includeTest=true 时后端带回，供灰标） */
  isVirtualLearner: boolean
  isTestAccount: boolean
  status: string
  stage: string
  summary: string
  /** 澄清轮次 = messages 里学习者发言条数（后端库内 json_each 计数，2026-10-01 对齐原型
   *  「澄清进度」列；原型 meter 的分母 targetTurns 本系统不存在，只呈现「N 轮」不造分母。
   *  旧响应无此字段为 null） */
  turns: number | null
  /** 约束条件（后端库内取 understanding 的可用时间/期限文案；真实数据稀疏，空数组显示 —） */
  constraints: string[]
  hasPath: boolean
  /** 生成的路径 id（原型路径格 open-path 的跳转目标；未生成/旧响应为 null） */
  pathId?: string | null
  createdAt: string
  /** 绝对时间（时间列 title 悬停；createdAt 已被 timeAgo 覆写为相对串） */
  createdAtAbs: string
  /** 最近更新时间（停滞信号推导用：active 且超 7 天未更新） */
  updatedAt: string
  /** 阶段过程步序号（0=创建 1=澄清 2=方案 3=完成，statusText 单源） */
  stageIndex: number
  /** 轻量阶段时间线文本（如「创建 08-12 → 澄清中 08-13」；无数据为空串） */
  timeline: string
  regenerating?: boolean
}

const loading = ref(false)
const rows = ref<Row[]>([])
const loadError = ref('')
const stats = ref<{ total: number; active: number; completed: number; completionRate: string } | null>(null)
/* stats 三态（P1#6）：失败置 statsError，桶位显示「统计获取失败 · 重试」而非整组静默消失 */
const statsError = ref(false)
/* 「已取消」桶（P1#5）= 总数 − 进行中 − 已完成：把用户取消（cancelled）、失败中断（failed）、
   无心跳回收（abandoned）合计在内——stats 无独立字段，推导并钳非负；foot 文案与下方 pill 同口径披露 */
const gcCancelledCount = computed(() => {
  const s = stats.value
  if (!s) return 0
  return Math.max(s.total - s.active - s.completed, 0)
})
/* 停滞信号（P1#6 前端可做部分）：列表窗口内 active 且 updatedAt 超 7 天未更新的行数；
   口径 title「按最近 1000 条窗口」随行披露（全量分位需后端 lastActivity，登记不做） */
const STALLED_DAYS = 7
const staleActiveCount = computed(() => {
  const cutoff = Date.now() - STALLED_DAYS * 86400000
  return rows.value.filter((r) => {
    if (r.status !== 'active' || !r.updatedAt) return false
    const t = new Date(r.updatedAt).getTime()
    return Number.isFinite(t) && t < cutoff
  }).length
})
function gcStatusSeg(n: number): number {
  const s = stats.value
  if (!s || !s.total) return 0
  return Math.round((n / s.total) * 100)
}
/* 桶组占比（newui bucketCard 的 pct 参数）：进行中/已取消 = 占总数比例（与 gcStatusSeg 同一算法）；
   已完成桶直接用后端 completionRate（口径单一来源，避免同屏两算），全部 clamp 0-100。 */
const gcActivePct = computed(() => gcStatusSeg(stats.value?.active ?? 0))
const gcCompletedPct = computed(() => Math.max(0, Math.min(100, Math.round(Number(stats.value?.completionRate ?? 0)))))
const gcCancelledPct = computed(() => gcStatusSeg(gcCancelledCount.value))
const keyword = ref('')
const statusFilter = ref('')

/* P1-3 列显隐（公共组件 MkCols）：目标摘要/状态/阶段/澄清进度/约束条件/路径/创建时间 可隐藏，用户/操作固定 */
const gcColDefs = [
  { key: 'summary', label: '目标摘要', title: '对话目标摘要' },
  { key: 'status', label: '状态', title: '对话状态' },
  { key: 'stage', label: '阶段', title: '澄清阶段 + 过程点' },
  { key: 'turns', label: '澄清进度', title: '学习者发言轮次（澄清深度）' },
  { key: 'constraints', label: '约束条件', title: '澄清中收集的可用时间 / 期限等约束' },
  { key: 'path', label: '路径', title: '路径是否已生成' },
  { key: 'created', label: '创建时间', title: '对话创建时间' },
] as const
const gcHiddenCols = ref<Set<string>>(new Set())

/* ?goal= 语义（2026-10-01 对齐原型习惯：目标行点击进二级详情页，不再开抽屉）：
   深链直达座舱（session-real 只读监控），随后清参避免与座舱返回冲突 */
const route = useRoute()
const router = useRouter()
watch(
  () => route.query.goal,
  async (goalId) => {
    const gid = typeof goalId === 'string' ? goalId : ''
    if (!gid) return
    // 等列表加载完成（带超时上限）：接口失败时不能无限死等泄漏定时器
    const waitForRows = () => new Promise<boolean>((resolve) => {
      let waited = 0
      const check = () => {
        if (rows.value.length) { resolve(true); return }
        if (waited >= 5000) { resolve(false); return }
        waited += 200
        setTimeout(check, 200)
      }
      check()
    })
    const ok = await waitForRows()
    const r = ok ? rows.value.find((x) => x.id === gid) : undefined
    if (r) {
      openSubPage('session-real', gid)
      const q = { ...route.query }; delete q.goal
      void router.replace({ query: q })
    } else {
      // 目标可能超出最近 LIST_LIMIT 条或已被删除：明示而非静默忽略
      toast.warning(`未能定位该会话：可能不在最近 ${LIST_LIMIT} 条内，或已被删除`)
    }
  },
  { immediate: true }
)

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；切换「含虚拟·测试」后重拉全量并灰标虚拟/测试行 */
const includeTest = ref(false)

const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()

/** 菜单项执行：先关菜单再执行（避免菜单残留与整行点击冒泡） */
function menuRemove(r: Row) {
  closeMenu()
  void remove(r)
}

const statusPills = computed(() => [
  // 原型 chips 首枚「全部」（原型 renderGoals filters）：显式复位入口，不再依赖再点一次取消。
  // 计数不进 pills：四态条数由页头桶组单源呈现（原型 chips 同样无计数，避免同屏两套口径）。
  // 「已取消」pill 与同名桶同口径（P1#5）：筛非 active 且非 completed 的全部行
  // （= cancelled + failed + abandoned），与桶「取消 / 中断 / 回收合计」算法一致，点进去对得上。
  { id: '', label: '全部', title: '' },
  { id: 'active', label: '进行中', title: '' },
  { id: 'completed', label: '已完成', title: '' },
  { id: 'cancelled', label: '已取消', title: '取消 / 中断 / 回收合计：cancelled + failed + abandoned（与上方「已取消」桶同口径）' }
])

/** 「已取消」筛选谓词：与桶同取补集（非进行中且非已完成），保证 pill 与桶数字/语义一致 */
const isCancelledBucketRow = (r: Row) => r.status !== 'active' && r.status !== 'completed'

/** 状态词一律走全局字典（单源）；空值给「—」。原私有字典与 statusText 逐条重合，故删除 */
const statusLabel = (s: string) => statusText(s) || '—'
const statusBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'active' ? 'mk-badge--info' : s === 'cancelled' ? 'mk-badge--bad' : 'mk-badge--muted'

/** 头像 tone（列表行与抽屉头共用；语义与 MkVariantBadge 一致：虚拟=紫 / 测试=琥珀 / 真实=默认蓝） */
function avatarTone(r: Pick<Row, 'isVirtualLearner' | 'isTestAccount'>): 'virtual' | 'test' | 'default' {
  return r.isVirtualLearner ? 'virtual' : r.isTestAccount ? 'test' : 'default'
}

/** 状态原因提示（UI 复查 #18）：回收机制会把约 30 分钟无心跳的会话标为 abandoned，
 *  列表里给一句解释，避免「会话莫名停下」；不新增后端字段，仅是文案。 */
const statusHint = (s: string | null | undefined) => {
  const k = String(s || '').toLowerCase()
  if (k === 'abandoned') return '会话已中止：通常因长时间无心跳被自动回收；可从故事行重新启动'
  if (k === 'failed') return '会话失败：可在会话座舱查看失败原因与日志'
  return ''
}

/** 阶段过程点条工具提示（人话）：当前第 n/total 步（创建→澄清→方案→完成） */
function stageDotsTitle(r: Row): string {
  return `${stageText(r.stage) || '—'} · 第 ${r.stageIndex + 1}/${GOAL_STAGE_TOTAL} 步（${GOAL_STAGE_STEP_LABELS.join('→')}）`
}

/** 目标摘要：description 优先，其次 collectedData 里的 goal 字段 */
function summaryOf(c: Record<string, unknown>): string {
  if (c.description) return String(c.description)
  try {
    const cd = JSON.parse(String(c.collectedData || '{}'))
    return String(cd.goal || cd.learningGoal || cd.objective || cd.target || '—')
  } catch {
    return '—'
  }
}

function mapRow(c: Record<string, unknown>): Row {
  const u = (c.users as Record<string, unknown>) || {}
  const stage = String(c.stage || '')
  return {
    id: String(c.id),
    userId: String(c.userId || ''),
    userName: String(u.name || c.userId || '—'),
    userEmail: String(u.email || ''),
    isVirtualLearner: !!c.isVirtualLearner,
    isTestAccount: !!c.isTestAccount,
    status: String(c.status || ''),
    stage,
    // 2026-10-01 列表列裁剪：服务端已按同口径解析 summary（description 优先，
    // 其次 collectedData.goal——该大列不再随列表出库）；summaryOf 仅作旧响应兜底
    summary: String(c.summary ?? '') || summaryOf(c),
    // 澄清轮次/约束条件（2026-10-01 对齐原型两列）：后端库内 JSON 取数带回；旧响应缺省
    turns: typeof c.turns === 'number' ? c.turns : null,
    constraints: Array.isArray(c.constraints) ? (c.constraints as unknown[]).map(String) : [],
    hasPath: !!c.learningPathId,
    pathId: c.learningPathId ? String(c.learningPathId) : null,
    // 格内相对时间 + createdAtAbs 绝对时间（title 悬停用；2026-10-03 修复 title=相对串自身的契约违约）
    createdAt: timeAgo(String(c.createdAt || '')),
    createdAtAbs: String(c.createdAt || ''),
    updatedAt: String(c.updatedAt || ''),
    stageIndex: stageProgressIndex(stage),
    timeline: stageTimelineText({
      stage,
      status: String(c.status || ''),
      createdAt: String(c.createdAt || ''),
      updatedAt: String(c.updatedAt || ''),
      completedAt: String(c.completedAt || '')
    })
  }
}

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const { toggle: toggleGcSort, sortState: gcSortState, sortRows: sortGcRows } = useTableSort<Row>({
  accessors: {
    user: (r) => r.userName,
    status: (r) => r.status,
    stage: (r) => r.stageIndex,
    turns: (r) => r.turns ?? -1
  },
  storageKey: 'wf_goal_conversations_sort'
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return sortGcRows(rows.value.filter((r) => {
    if (statusFilter.value === 'cancelled') {
      // 与「已取消」桶同口径（P1#5）：非 active 且非 completed 全收
      if (!isCancelledBucketRow(r)) return false
    } else if (statusFilter.value && r.status !== statusFilter.value) {
      return false
    }
    if (!k) return true
    return `${r.userName} ${r.userEmail} ${r.summary}`.toLowerCase().includes(k)
  }))
})

const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   列表为客户端全量数据（limit:LIST_LIMIT 拉取后本地筛选），按页切片；
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

/* 列表拉取上限：请求与深链提示文案共用同一常量，避免「文案 100 / 实现 1000」再次漂移（同 TeachingSessions.LIST_LIMIT） */
const LIST_LIMIT = 1000

/* force = true 绕过页面级 TTL 缓存（显式刷新/口径切换用），保证用户操作必然重拉 */
/* stats 请求代际号：stats 改为后台回填后，用代际比对丢弃迟到的旧口径响应（includeTest 切换/重拉场景） */
let statsReqSeq = 0

async function load(force = false) {
  if (!isLive.value || loading.value) return
  // 页面级 TTL 缓存
  if (!force && isPageCacheFresh('goal-conversations') && rows.value.length) return
  const seq = ++statsReqSeq
  loading.value = true
  loadError.value = ''
  try {
    // 首屏主体是会话列表：只 await 列表接口，页面就绪时间不再被 stats 拖住
    const listRes = await adminGoalConversationsApi.list({ limit: LIST_LIMIT, includeTest: includeTest.value })
    const body = listRes.data?.data ?? listRes.data ?? {}
    rows.value = ((body.conversations as Record<string, unknown>[]) || []).map(mapRow)
  } catch (e) {
    // P0 修复：失败置行内错误标记（此前只有 toast，列表显示「暂无会话」伪装空态）
    rows.value = []
    stats.value = null
    loadError.value = `加载失败：${errMsg(e)}`
    toast.error(loadError.value)
  } finally {
    loading.value = false
    markPageFetched('goal-conversations')
  }
  /* stats 非阻塞后台拉取：到达后回填四态比例条与域计数。
     三态（P1#6）：失败时置 statsError（桶位显示「统计获取失败 · 重试」），
     绝不回滚列表、不阻塞首屏；代际不符（已发起新一轮 load）的迟到响应直接丢弃 */
  void adminGoalConversationsApi.getStats()
    .then((statsRes) => {
      if (seq !== statsReqSeq) return
      const s = statsRes?.data?.data ?? statsRes?.data
      stats.value = s
        ? {
            total: Number(s.total || 0),
            active: Number(s.active || 0),
            completed: Number(s.completed || 0),
            completionRate: String(s.completionRate || '0')
          }
        : null
      statsError.value = false
    })
    .catch(() => {
      if (seq === statsReqSeq) {
        stats.value = null
        statsError.value = true
      }
    })
}

/** 座舱跳转族收尾：清理 URL 深链（?goal=）是唯一动作 */
function closeDetail() {
  const q = { ...route.query }
  delete q.goal
  void router.replace({ query: q })
}

/** 真实会话与控制台数据契约不兼容（座舱仅服务虚拟会话）：轻量深链 = 会话座舱（session-real）+ Trace 瀑布按 sessionId 归组。
    行点击与「详情」钮同走 goConsole（2026-10-02 与 TeachingSessions 行点击语义对齐：两页行点击都进座舱） */
const { goTrace, goConsole } = useSessionDrill(closeDetail)

/** 页头副题随 includeTest 切换如实（评审 §口径）：默认仅真实，切「含模拟」后不得再声称仅真实用户口径 */
const gcScopeSub = computed(() =>
  includeTest.value
    ? '与学习者澄清真实目标 · 约束条件与澄清轮次（含虚拟学习者与测试账号）'
    : '与学习者澄清真实目标 · 约束条件与澄清轮次（仅真实用户口径）'
)

/** 路径格 → 路径详情二级页（原型 open-path 习惯） */
function openPathPage(r: Row) {
  if (r.pathId) openSubPage('path', r.pathId)
}

async function regenerate(r: Row) {
  if (r.regenerating) return
  const ok = await askConfirm({
    title: '重建学习路径',
    message: `确认为「${r.userName}」重新生成学习路径？\n将基于该会话重新生成路径，覆盖当前路径。`,
    confirmText: '重建路径',
    danger: false
  })
  if (!ok) return
  r.regenerating = true
  try {
    const res = await adminGoalConversationsApi.regeneratePath(r.id)
    const d = res.data?.data ?? res.data ?? {}
    toast.success(`已生成路径「${d.learningPathName || '未命名'}」（v${d.version ?? '—'}）`)
    r.hasPath = true
  } catch (e) {
    toast.error(`重建失败：${errMsg(e)}`)
  } finally {
    r.regenerating = false
  }
}

async function remove(r: Row) {
  const ok = await askConfirm({
    title: '删除目标对话',
    message: `确认删除「${r.userName}」的这条 Goal 会话？\n该操作不可撤销。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  try {
    await adminGoalConversationsApi.remove(r.id)
    rows.value = rows.value.filter((x) => x.id !== r.id)
    toast.success('会话已删除')
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  }
}

watch(isLive, () => {
  void load()
})
/* 数据隔离切换：仅真实 ↔ 含虚拟/测试（切换后立即按新口径重拉，绕过 TTL 缓存） */
watch(includeTest, () => {
  void load(true)
})
onMounted(() => {
  if (isLive.value) void load()
})
</script>

<style scoped>/* 2026-09-29 拆回「目标对话」独立页：合并宿主的视图切换 pills（gc-tabs）随之退役。
   宿主容器沿用 .mk-page 的响应式内边距（对齐 pp-host / 虚拟学习者单页容器），
   避免 ≥1440px 档位状态条起始位置与其它页脱节。 */
/* 子组件根节点（.mk-page--fill）：占满剩余高度，表格区内滚（对齐 pp-host > .mk-page--fill 先例） */
.gc-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}/* 目标对话内联内容（状态条 + 卡片）：同为 fill 列的直接子级，卡片弹性填满 */
.gc-host > .mk-status { flex: none; }/* 概览卡样式由共享 mk-overview/mk-kpi 体系承载；此处仅保留堆叠条（pre slot 内）与行样式 */
/* 行点击/焦点态已升共享契约（table.mk-table--click + tr:focus-visible 原语，2026-10-03） *//* 虚拟/测试行灰标（数据隔离 A3：includeTest 切换后显式标记；徽章本体用 mk-badge--*） */
/* 用户格 min-width：本表为自动布局（无 colgroup），补「澄清进度/约束条件」两列后
   该列会被内容多的列挤到 ~90px（2026-10-02 视觉核对实测），名字/邮箱全截断——
   给内容格兜底宽度，压缩由可换行的摘要/约束列吸收 */
.gc-user { display: flex; align-items: center; gap: 9px; min-width: 200px; }/* 状态桶组（newui renderGoals/bucketCard 原型移植；token 映射：--sp-3→--mk-space-3、
   --line→--mk-line、--surface→--mk-surface、--r-lg→--mk-radius-lg、--surface-3→--mk-surface-3、
   --muted→--mk-muted、--fs-micro→--mk-fs-micro）。桶组直接落页面（原型形态），无内边距。 */
.buckets { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: var(--mk-space-3); }.bucket { display: grid; gap: 3px; padding: 13px 15px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-lg); background: var(--mk-surface); }.bucket__v { font-size: 26px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }.bucket__l { font-size: var(--mk-fs-micro); color: var(--mk-muted); }.bucket__bar { height: 4px; border-radius: 999px; background: var(--mk-surface-3); overflow: hidden; margin-top: 5px; }.bucket__bar > i { display: block; height: 100%; border-radius: 999px; }/* foot（原型 bucketCard 第 5 参 inline style 的类化）：弱化说明文字 */
.bucket__foot { color: var(--mk-faint); }.gc-user .mk-cell-main { min-width: 0; flex: 1; }.gc-tags { display: flex; gap: 5px; margin-left: auto; flex: none; }/* 阶段列：徽章 + 四步过程点条 + 轻量时间线（创建→澄清→方案→完成，statusText 单源） */
.gc-stage-cell { display: grid; gap: 4px; min-width: 148px; }.gc-stage-cell__head { display: flex; align-items: center; gap: 8px; }.gc-stage-cell__dots { display: inline-flex; gap: 3px; }.gc-stage-cell__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--mk-radius-pill);
  background: #e2e8f2;
}.gc-stage-cell__dot.is-on { background: var(--mk-blue); }.gc-stage-cell__dot.is-on:last-child { background: var(--mk-green); }/* gc-stage-cell__tl→.mk-cell-sub、gc-summary→.mk-cell-text（2026-10-03 方言收敛，截断/灰阶由原语承担） *//* 约束条件列：mute 徽章多枚 wrap（原型 .wrap 格内 pill--mute 判例） */
.gc-constraints { display: flex; flex-wrap: wrap; gap: 5px; max-width: 220px; }/* 原型 .tbl td：nowrap（表格已改自动布局，列宽随内容；
   长摘要 .mk-cell-text 与 .mk-cell-main/.mk-cell-sub 的 max-width 截断兜底） */
.mk-table td { white-space: nowrap; }.gc-error {
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
  margin-bottom: 14px;
}/* 按钮规格对齐 .mk-btn（8x16 / 12.5px）；危险操作实心红（与 .mk-btn--danger 一致） */

/* 4K：抽屉加宽 + 字号跟随壳层放大 */
@media (min-width: 2000px) {

  .mk-btn--sm { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {.mk-btn--sm { font-size: var(--mk-fs-body); }
}/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {

  .mk-btn--sm { font-size: var(--mk-fs-emphasis); }
}/* ================= 暗色模式（D1 补完）：目标对话 ================= */
html[data-theme='dark'] {
  /* 消息气泡：容器级旧覆写修正为气泡级（assistant 灰蓝 / user 深蓝） */
  .gc-stage-cell__dot { background: #313235; }
  .gc-error { border-color: rgba(248, 113, 113, 0.35); }
}
</style>
