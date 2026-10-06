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
        <!-- 整组统一口径开关（2026-10-04 用户拍板：撤页头刷新钮，学习组六页同一位、同一状态） -->
        <DataScopeToggle v-model="includeTest" />
      </template>
    </MkPageHead>

    <!-- 会话总量 KPI（2026-10-05 用户令对齐学习路径家族：MkKpi 卡带置于分布卡上方，OpsContent 同款）。
         10-02 撤双带退役的是「状态数字 KPI」（四桶与构成带同数字复读）——本卡带只放总量/参与用户/
         近 7 日新增三个与分布带零重叠的指标，状态构成仍以分布带为唯一来源（计数全页只出现一次：
         总数升 KPI 卡后分布带副文不再复读「共 N 条」）。
         hint = 一短句可见口径（全站家法，TokenCost 判例）；长解释收 title 悬停 -->
    <section class="mk-kpi-grid" aria-label="目标对话总量">
      <MkKpi
        label="会话总数"
        :value="stats?.total ?? '—'"
        :hint="includeTest ? '含虚拟学习者与测试账号' : '仅真实用户口径'"
        :title="includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户（不含测试账号）；切换页头「含测试」后显示全量并灰标模拟行'"
      />
      <MkKpi
        label="参与用户"
        :value="stats?.distinctUsers ?? '—'"
        hint="发起过目标对话的去重用户"
        title="至少发起过一次目标对话的去重用户数（口径随页头「含测试」开关）"
      />
      <MkKpi
        label="近 7 日新增"
        :value="recentCreated7d ?? '—'"
        hint="按创建日归集"
        title="最近 7 天创建的目标对话数（服务端按创建日 UTC 日历日归集；完成数按完成日归集，不影响本口径）"
      />
    </section>
    <!-- stats 三态（P1#6）：失败显错误条 + 重试（原错误桶随构成带退役，2026-10-04 晚贴表分布条） -->
    <div v-if="statsError" class="mk-status mk-status--bad">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta">统计暂不可用（KPI 面板与状态分布同源）</span>
      <button type="button" class="mk-status__meta mk-status__meta-link" @click="load(true)">重试</button>
    </div>

    <!-- ===== 目标对话列表 ===== -->
    <MkEmptyState
      v-if="!rows.length && !loading && !loadError"
      title="暂无 Goal 会话数据"
      description="学习者发起目标对话后自动呈现。"
    />

    <template v-else>
      <!-- 目标对话状态分布（教学组标准件 MkDistBand；2026-10-05 用户拍板「分段条在上」：回到卡上方
           页面级，与旧构成带同位）：分段/图例点击 = 状态筛选（与原 pills 同一 statusFilter，
           「已取消」= 取补集聚合段）；口径 = stats 服务端全量状态计数（非本页 LIST_LIMIT 窗口），
           完成率随副标；停滞信号随「进行中」段悬停披露（原桶 foot 迁移）；stats 失败/空数据整带隐藏 -->
      <MkDistBand
        v-if="!statsError && stats && stats.total > 0"
      card
      class="gc-distband"
        title="目标对话状态分布"
        :sub="`点击分段只看该状态 · 服务端按状态 group-by 全平台计数（非本页窗口，口径：${includeTest ? '含测试全量' : '仅真实用户'}） · 完结率 ${stats.completionRate ?? 0}%`"
        unit="条"
        aria-label="按目标对话状态筛选"
        :bins="gcBandBins"
        :active-key="statusFilter || null"
        @select="toggleStatusBand"
      />

      <!-- 列表 -->
      <div class="mk-card mk-card--fill">
        <div class="mk-card__head">
          <div class="mk-filter">
            <!-- 状态筛选唯一入口 = 上方分布条（2026-10-04 晚：pills 与构成带同驱一个
                 statusFilter，同屏两处筛选面收敛一处；「已取消」段与原 pill 同口径取补集） -->
            <MkFilterSearch v-model="keyword" placeholder="搜索用户 / 邮箱 / 目标摘要" />
            <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
            <!-- 排序复位入口（2026-10-06 审核 #51）：默认序是服务端 createdAt 倒序，
                 排序态持久化后此前无路可回；创建时间已接排序，另给一键回默认序 -->
            <button v-if="gcSortKey" type="button" class="mk-link" @click="gcResetSort()">恢复默认排序</button>
          </div>
          <div class="mk-card__head-right">
            <MkCols
              :col-defs="gcColDefsFiltered"
              storage-key="wf_goal_hidden_cols"
              :default-hidden="['constraints']"
              v-model:hidden="gcHiddenCols"
            />
            <span class="mk-card__meta" :title="`${includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户'}${truncated ? `；排序与搜索仅覆盖已加载的最近 ${LIST_LIMIT} 条` : ''}`">（{{ includeTest ? '含测试' : '仅真实' }}口径）<template v-if="truncated"> · 后端共 {{ listTotal }} 条，仅显示最近 {{ rows.length }} 条（排序/搜索仅覆盖该窗口）</template></span>
          </div>
        </div>

        <MockSkeletonTable v-if="loading && !rows.length" :cols="9" />
        <!-- P0 修复：加载失败行内错误 + 重试（此前失败伪装成「暂无会话」）。
             形态收敛共享 MkEmptyState tone="error"（2026-10-06 审核 #48）：私有 .gc-error
             与同页 stats 失败条两套错误形态并存的局面收敛，role=alert + 重试由原语承担 -->
        <MkEmptyState
          v-else-if="loadError"
          tone="error"
          title="目标对话列表加载失败"
          :description="loadError"
          action-text="重试"
          @action="load(true)"
        />
        <div v-else-if="filtered.length" class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap、
             列按内容自然分宽；长摘要/长邮箱由 .mk-cell-text / .mk-cell-main 的 max-width 截断兜底 -->
        <table class="mk-table mk-table--click mk-table--nowrap">
          <thead>
            <tr>
              <th v-if="showCol('summary')">目标摘要</th>
              <th
                scope="col"
                class="mk-th--sortable"
                :title="sortWindowTitle"
                :aria-sort="gcSortState('user')"
                @click="toggleGcSort('user')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('status')"
                scope="col"
                class="mk-th--sortable"
                :title="sortWindowTitle"
                :aria-sort="gcSortState('status')"
                @click="toggleGcSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('stage')"
                scope="col"
                class="mk-th--sortable"
                :title="sortWindowTitle"
                :aria-sort="gcSortState('stage')"
                @click="toggleGcSort('stage')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('stage')">阶段<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="showCol('turns')"
                scope="col"
                class="mk-th--sortable mk-th--right"
                :title="sortWindowTitle"
                :aria-sort="gcSortState('turns')"
                @click="toggleGcSort('turns')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('turns')">澄清进度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="showCol('constraints')">约束条件</th>
              <th v-if="showCol('path')">路径</th>
              <th
                v-if="showCol('created')"
                scope="col"
                class="mk-th--sortable"
                :title="sortWindowTitle"
                :aria-sort="gcSortState('created')"
                @click="toggleGcSort('created')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('created')">创建时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paged" :key="r.id" tabindex="0" @click="goConsole(r)" @keydown.enter.self.prevent="goConsole(r)">
              <td v-if="showCol('summary')">
                <!-- 原型目标摘要格 = wrap 两行：strong 摘要 + sub mono 会话 ID。
                     列序统一（2026-10-03）：主体列恒在首（同 TS 会话/OC 路径/MR 学习者），用户列随后。
                     摘要改两行档 .mk-cell-text--wrap（2026-10-03 用户反馈「截断到看不清含义」）：
                     单行 320px 只露出 ~24 字，两行档保留语义骨架（同虚拟学习者倾向列判例） -->
                <div class="mk-cell-main">
                  <strong class="mk-cell-text--wrap" :title="r.summary">{{ r.summary }}</strong>
                  <span class="mk-cell-sub mono" :title="`会话 ID ${r.id}`">{{ r.id }}</span>
                </div>
              </td>
              <td>
                <div class="gc-user">
                  <MkCellAvatar :name="r.userName" :tone="avatarTone(r)" />
                  <div class="mk-cell-main">
                    <!-- 全表唯一截断后无 title 的文本格（2026-10-06 审核 #46）：该格有
                         200px（≤1599 收 176px）强制最小宽，长名字/长邮箱被省略号截断后
                         看不到全值——同表其余格均有 title -->
                    <strong :title="r.userName">{{ r.userName }}</strong>
                    <span class="mk-cell-sub" :title="r.userEmail">{{ r.userEmail }}</span>
                  </div>
                  <div class="gc-tags">
                    <MkVariantBadge v-if="r.isVirtualLearner" kind="virtual" />
                    <MkVariantBadge v-else-if="r.isTestAccount" kind="test" />
                  </div>
                </div>
              </td>
              <td v-if="showCol('status')"><span class="mk-badge" :class="statusBadge(r.status)" :title="statusHint(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td v-if="showCol('stage')">
                <div class="gc-stage-cell">
                  <div class="gc-stage-cell__head">
                    <!-- P3（2026-10-04 全站评审）：阶段词与状态词相同（完成态「已完成」/失败态「失败」）
                         时徽章不重复出词——状态列已承载该词，本列只留进度点 + 日期 -->
                    <span v-if="statusLabel(r.status) !== stageText(r.stage)" class="mk-badge" :class="stageBadgeCls(r.stage)" :title="`阶段：${stageText(r.stage) || '—'}`">{{ stageText(r.stage) || '—' }}</span>
                    <span v-if="r.timeline" class="gc-stage-cell__dots" :title="stageDotsTitle(r)" aria-label="阶段进度">
                      <i v-for="d in GOAL_STAGE_TOTAL" :key="d" class="gc-stage-cell__dot" :class="{ 'is-on': d <= r.stageIndex + 1 }"></i>
                    </span>
                  </div>
                  <!-- 副行只留日期：阶段词由徽章单源承载（时间线末条恒复读徽章词，2026-10-03 去重）；
                       完整时间线进 title 悬停 -->
                  <span v-if="r.timelineDate" class="mk-cell-sub" :title="`阶段时间线 ${r.timeline}`">{{ r.timelineDate }}</span>
                  <span v-else class="mk-na">—</span>
                </div>
              </td>
              <td v-if="showCol('turns')" class="mk-num">
                <!-- 原型「澄清进度」列 = meter turns/targetTurns；本系统无目标轮次分母，
                     只呈现「N 轮」诚实读数（学习者发言条数），不造 meter -->
                <span v-if="r.turns != null" class="mk-num" :title="`学习者发言 ${r.turns} 轮`">{{ r.turns }} 轮</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="showCol('constraints')">
                <!-- 原型「约束条件」列 = pill--mute 多枚 wrap；真实数据为澄清收集的
                     可用时间/期限文案（稀疏属真实分布），空时 — -->
                <div v-if="r.constraints.length" class="gc-constraints">
                  <span v-for="cst in r.constraints" :key="cst" class="mk-badge mk-badge--muted" :title="`约束：${cst}`">{{ cst }}</span>
                </div>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="showCol('path')">
                <!-- 原型 open-path 习惯：生成过的路径成跳转（路径详情二级页）；后端未回 pathId 时回落徽章 -->
                <button v-if="r.pathId" type="button" class="mk-btn mk-btn--sm" title="查看该目标生成的路径详情" @click.stop="openPathPage(r)">查看路径</button>
                <span v-else-if="r.hasPath" class="mk-badge mk-badge--info">已生成</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="showCol('created')"><span class="mk-cell-sub mono" :title="r.createdAtAbs">{{ r.createdAt }}</span></td>
              <td>
                <!-- 操作列文字钮（原型 .tbl 操作列 btn--sm「详情/下线」形态，不用纯图标钮）。
                     行内只留高频项（链路/详情）；重建路径与删除同属低频矫正操作，收 ⋯ 菜单——
                     四钮并排自然宽 238px 会把整表推出容器 66px，1440 下操作列被裁（走查 2026-10-03 实测）。
                     右对齐与 mk-th--right 表头对齐（同 Users.vue 判例） -->
                <div class="mk-actions">
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="goTrace(r)">链路</button>
                  <button type="button" class="mk-btn mk-btn--sm" title="打开会话座舱（只读监控）" @click.stop="goConsole(r)">详情</button>
                  <div class="mk-menu">
                    <!-- aria-expanded 按行判定（2026-10-06 审核 #50）：此前绑全局 menuOpen，
                         菜单一开 15 个按钮同时报 expanded=true；role=menu/menuitem 兑现
                         aria-haspopup="menu" 的语义承诺 -->
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === r.id" @click.stop="toggleMenu(r.id)">⋯</button>
                    <div v-if="openMenu === r.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" role="menuitem" :disabled="r.regenerating" :title="r.regenerating ? '生成中…' : '对该会话重新生成学习路径'" @click="regenerate(r)">{{ r.regenerating ? '生成中…' : '重建路径' }}</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" role="menuitem" @click="menuRemove(r)">删除会话</button>
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
          :description="keyword || statusFilter ? '放宽筛选条件试试。' : (includeTest ? '全量口径下暂无目标对话。' : '默认仅展示真实用户；切换「含测试」可查看全部。')"
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
import { errMsg, timeAgo, isPageCacheFresh, markPageFetched, liveIncludeVirtual, liveSetIncludeVirtual } from './live'
import { stageText, stageBadgeCls, stageProgressIndex, stageTimelineText, stageTimeline, GOAL_STAGE_TOTAL, GOAL_STAGE_STEP_LABELS, statusText } from './statusText'
import { useRowMenu } from './useRowMenu'
import { useIsNarrow } from './useIsNarrow'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkDistBand from '@/components/mk/MkDistBand.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
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
  /** 时间线末条日期（副行只显日期，阶段词由徽章单源；全串进 title） */
  timelineDate: string
  regenerating?: boolean
}

const loading = ref(false)
const rows = ref<Row[]>([])
const loadError = ref('')
const stats = ref<{
  total: number; active: number; completed: number; completionRate: string;
  distinctUsers: number | null; dailyStats: { date: string; total: number }[]
} | null>(null)
/* stats 三态（P1#6）：失败置 statsError，桶位显示「统计获取失败 · 重试」而非整组静默消失 */
const statsError = ref(false)
/* 「已取消」桶（P1#5）= 总数 − 进行中 − 已完成：把用户取消（cancelled）、失败中断（failed）、
   无心跳回收（abandoned）合计在内——stats 无独立字段，推导并钳非负；foot 文案与下方 pill 同口径披露 */
const gcCancelledCount = computed(() => {
  const s = stats.value
  if (!s) return 0
  return Math.max(s.total - s.active - s.completed, 0)
})
/* 近 7 日新增（KPI 卡）：dailyStats 按创建日（UTC 日历日）归集；「7 天内完成但更早创建」
   的对话会按创建日额外成桶且桶日期在窗口外——按日期过滤后求和才是纯「新增」口径 */
const recentCreated7d = computed<number | null>(() => {
  const ds = stats.value?.dailyStats
  if (!ds || !ds.length) return null
  const cutoff = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
  let sum = 0
  for (const d of ds) if (d.date >= cutoff) sum += Number(d.total) || 0
  return sum
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
/* ===== 目标对话状态分布（2026-10-04 晚贴表分布条 MkDistBand，构成带换装）=====
   三段口径披露原样随段迁移（停滞口径 / 已取消口径），完成率用后端单一来源（避免同屏两算）。
   「已取消」段与原 pill/桶同口径：cancelled + failed + abandoned（非 active 且非 completed 取补集）。 */
const gcBandBins = computed(() => [
  {
    key: 'active',
    label: '进行中',
    tone: 'var(--mk-blue)',
    n: stats.value?.active ?? 0,
    hint: rows.value.length
      ? `澄清中或待确认 · 其中 ${staleActiveCount.value} 条超 ${STALLED_DAYS} 天未更新（停滞口径：状态「进行中」且最近 ${STALLED_DAYS} 天无更新，按加载窗口估算，非全量）`
      : '澄清中或待确认'
  },
  { key: 'completed', label: '已完成', tone: 'var(--mk-green)', n: stats.value?.completed ?? 0, hint: '已生成学习路径' },
  {
    key: 'cancelled',
    label: '已取消',
    tone: 'var(--mk-red)',
    n: gcCancelledCount.value,
    hint: '取消 / 中断 / 回收合计 = 总数 − 进行中 − 已完成：含用户取消（cancelled）、失败中断（failed）与无心跳回收（abandoned）'
  }
])
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

/* 窄档列降级（UI 方案 §1 LAYOUT-3）：9 列 nowrap 表 1440 容器级横滚 151px（操作列被挤出）。
   ≤1599 收「约束条件」（真实数据稀疏、自然宽仅 ~83px）；≤1320 再收「创建时间」
   （相对时间由阶段副行日期承载）。强制收起的列同时从 MkCols 菜单过滤，避免死开关。 */
const isMid = useIsNarrow(1600)
const isCompact = useIsNarrow(1320)
const GC_MID_HIDDEN = new Set(['constraints'])
const GC_COMPACT_HIDDEN = new Set(['constraints', 'created'])
const showCol = (key: string) =>
  !gcHiddenCols.value.has(key) &&
  !(isMid.value && GC_MID_HIDDEN.has(key)) &&
  !(isCompact.value && GC_COMPACT_HIDDEN.has(key))
const gcColDefsFiltered = computed(() =>
  gcColDefs.filter((c) => !(isCompact.value && GC_COMPACT_HIDDEN.has(c.key)) && !(isMid.value && GC_MID_HIDDEN.has(c.key)))
)

/* 截断提示口径：改用列表 pagination.total 与已加载行数比较。
   旧实现拿「仅真实口径的 stats.total」比「含测试的 rows.length」，开关打开时
   必然 stats.total(403) < rows.length(1000) → 截断提示被错误抑制。 */
const listTotal = ref(0)
const truncated = computed(() => listTotal.value > rows.value.length)

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

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；口径整组统一（2026-10-04 用户拍板）——
   get/set 走 live.ts 共享态（页头开关同源），本页 watch 只负责重拉 */
const includeTest = computed({
  get: () => liveIncludeVirtual.value,
  set: (v) => liveSetIncludeVirtual(v)
})

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

/** 菜单项执行：先关菜单再执行（避免菜单残留与整行点击冒泡） */
function menuRemove(r: Row) {
  closeMenu()
  void remove(r)
}

/** 状态筛选唯一入口 = 贴表分布条（2026-10-04 晚 pills 退役）：再点取消；
    「已取消」段走 isCancelledBucketRow 取补集（与段计数同口径，点进去对得上） */
function toggleStatusBand(key: string) {
  statusFilter.value = statusFilter.value === key ? '' : key
}

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
    }),
    timelineDate: stageTimeline({
      stage,
      status: String(c.status || ''),
      createdAt: String(c.createdAt || ''),
      updatedAt: String(c.updatedAt || ''),
      completedAt: String(c.completedAt || '')
    }).at(-1)?.date || '',
  }
}

/* 客户端排序：默认保持服务端顺序。窗口截断时（含测试口径触 LIST_LIMIT）排序与关键词
   只覆盖已加载窗口，属「窗口内排序」而非全量排序 —— 由 sortWindowTitle 在表头与卡头披露
   （2026-10-06 审核 #35：原注释「全量拉取 → 排序诚实」在截断口径下不成立） */
const { toggle: toggleGcSort, sortState: gcSortState, sortRows: sortGcRows, sortKey: gcSortKey, reset: gcResetSort } = useTableSort<Row>({
  accessors: {
    user: (r) => r.userName,
    status: (r) => r.status,
    stage: (r) => r.stageIndex,
    turns: (r) => r.turns ?? -1,
    created: (r) => r.createdAtAbs
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

/* 截断口径披露（2026-10-06 审核 #35）：触 LIST_LIMIT 时表头排序与关键词搜索只覆盖已加载窗口，
   可排序表头 title 与卡头 meta 都须如实说明，不能读起来像全量 */
const sortWindowTitle = computed(() =>
  truncated.value ? `排序与搜索仅覆盖已加载的最近 ${LIST_LIMIT} 条（后端共 ${listTotal.value} 条），非全量` : ''
)

/* force = true 绕过页面级 TTL 缓存（显式刷新/口径切换用），保证用户操作必然重拉 */
/* stats 请求代际号：stats 改为后台回填后，用代际比对丢弃迟到的旧口径响应（includeTest 切换/重拉场景） */
let statsReqSeq = 0
/* 加载期间被守卫挡下的强制刷新（口径切换/重试）：本轮结束后补跑一次，避免新旧口径混排 */
let pendingForce = false

async function load(force = false) {
  if (!isLive.value) return
  /* 加载中的强制刷新不得静默丢弃：记账，本轮结束后补跑一次（否则加载期间点「含测试/仅真实」
     或「重试」时，文案/KPI hint 已改口新口径而表格仍是旧口径行，2026-10-06 审核 #34） */
  if (loading.value) {
    pendingForce = pendingForce || force
    return
  }
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
    listTotal.value = Number(body.pagination?.total ?? rows.value.length)
  } catch (e) {
    // P0 修复：失败置行内错误标记（此前只有 toast，列表显示「暂无会话」伪装空态）
    rows.value = []
    listTotal.value = 0
    stats.value = null
    loadError.value = `加载失败：${errMsg(e)}`
    toast.error(loadError.value)
  } finally {
    loading.value = false
    markPageFetched('goal-conversations')
    /* 补跑加载期间被挡下的强制刷新（本轮已完成，递归一次即可清账） */
    if (pendingForce) {
      pendingForce = false
      void load(true)
    }
  }
  /* stats 非阻塞后台拉取：到达后回填 KPI 面板（总量/参与用户/近 7 日新增）与状态分布带。
     三态（P1#6）：失败时置 statsError（错误条 + 重试，KPI 卡显「—」），
     绝不回滚列表、不阻塞首屏；代际不符（已发起新一轮 load）的迟到响应直接丢弃 */
  void adminGoalConversationsApi.getStats(includeTest.value)
    .then((statsRes) => {
      if (seq !== statsReqSeq) return
      const s = statsRes?.data?.data ?? statsRes?.data
      stats.value = s
        ? {
            total: Number(s.total || 0),
            active: Number(s.active || 0),
            completed: Number(s.completed || 0),
            completionRate: String(s.completionRate || '0'),
            distinctUsers: s.distinctUsers == null ? null : Number(s.distinctUsers),
            dailyStats: Array.isArray(s.dailyStats) ? s.dailyStats : []
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

/** 页头副题随 includeTest 切换如实（评审 §口径）：默认仅真实，切「含测试」后不得再声称仅真实用户口径 */
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
    /* 用响应里的 learningPathId 回写路径格（服务端契约：由调用方把新 pathId 写回）：
       否则行从「—」变不可点的「已生成」徽章、刷新后又回「—」，新路径无法下钻（2026-10-06 审核 #33） */
    if (d.learningPathId) r.pathId = String(d.learningPathId)
    r.hasPath = !!r.pathId
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
.gc-user { display: flex; align-items: center; gap: 9px; min-width: 200px; }
/* 分布条在卡上方页面级（2026-10-05 用户拍板「分段条在上」）：贴条 padding/下边框随撤，
   页面级间距由 .mk-page 的 --mk-stack-gap 统一供。gc-distband 类保留作测试与定位钩子 */
.gc-user .mk-cell-main { min-width: 0; flex: 1; }.gc-tags { display: flex; gap: 5px; margin-left: auto; flex: none; }/* 阶段列：徽章 + 四步过程点条 + 轻量时间线（创建→澄清→方案→完成，statusText 单源） */
.gc-stage-cell { display: grid; gap: 4px; min-width: 148px; }.gc-stage-cell__head { display: flex; align-items: center; gap: 8px; }.gc-stage-cell__dots { display: inline-flex; gap: 3px; }.gc-stage-cell__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--mk-radius-pill);
  /* 未点亮色走 --mk-line（2026-10-06 审核 #47）：原私持字面量 #e2e8f2 是全仓唯一，
     与 --mk-line 同一用途成对令牌（亮 #e6ebf4 / 暗 #36373c 由 tokens 切换） */
  background: var(--mk-line);
}.gc-stage-cell__dot.is-on { background: var(--mk-blue); }.gc-stage-cell__dot.is-on:last-child { background: var(--mk-green); }/* gc-stage-cell__tl→.mk-cell-sub、gc-summary→.mk-cell-text（2026-10-03 方言收敛，截断/灰阶由原语承担） *//* 约束条件列：mute 徽章多枚 wrap（原型 .wrap 格内 pill--mute 判例） */
.gc-constraints { display: flex; flex-wrap: wrap; gap: 5px; max-width: 220px; }/* 原型 .tbl td：nowrap（表格已改自动布局，列宽随内容；
   长摘要 .mk-cell-text 与 .mk-cell-main/.mk-cell-sub 的 max-width 截断兜底）。
   2026-10-05 CM6：裸 `.mk-table td { white-space: nowrap }` 收敛为全局修饰类
   .mk-table--nowrap（表元素已挂该 class），本页不再私持拷贝。 */
/* 按钮规格对齐 .mk-btn（8x16 / 12.5px）；危险操作实心红（与 .mk-btn--danger 一致） */

/* 中宽档（≤1599）：9 列 nowrap 表在 1440 容器级横滚 151px、1280 达 282px（UI 方案 §1）。
   单元格 padding 16→12 + 三处 min-width 各收一档；「约束条件」列默认不进表（showCol 同源）。
   阶段四步点条（4×6px + gap ≈ 45px）保留：该列 min-width 120px 已容得下点条，
   收起后完成态行（徽章因与状态列同词隐藏）只剩日期、阶段格无标注（2026-10-06 审核 #32） */
@media (max-width: 1599px) {
  .mk-table th, .mk-table td { padding-inline: 12px; }
  .gc-user { min-width: 176px; }
  .gc-stage-cell { min-width: 120px; }
  .mk-cell-main .mk-cell-text--wrap { min-width: 180px; }
}

/* 4K：抽屉加宽 + 字号跟随壳层放大 */
@media (min-width: 2000px) {

  .mk-btn--sm { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {.mk-btn--sm { font-size: var(--mk-fs-body); }
}/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {

  .mk-btn--sm { font-size: var(--mk-fs-emphasis); }
}/* ================= 暗色模式（D1 补完）：目标对话 =================
   2026-10-06 审核 #47/#48：阶段点未点亮色改走 --mk-line（随主题切换）、私有 .gc-error
   收敛 MkEmptyState tone="error"——本页原有两处暗色覆写随之整体退役（无剩余项）。 */
</style>
