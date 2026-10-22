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
         近 7 天新增三个与分布带零重叠的指标，状态构成仍以分布带为唯一来源（计数全页只出现一次：
         总数升 KPI 卡后分布带副文不再复读「共 N 条」）。
         hint 只留比例式分母（「已完成 / 会话总数」）；视角复述与取数算法（按用户去重 / 按创建日）
         于 2026-10-21 撤除，口径一律进 title -->
    <section class="mk-kpi-grid" aria-label="目标对话总量">
      <MkKpi
        label="目标对话数"
        :value="stats?.total ?? '—'"
        :title="includeTest ? '只统计虚拟学习者与测试账号' : '只统计真实用户'"
      />
      <MkKpi
        label="完结率"
        :value="completionRatePct"
      />
      <MkKpi
        label="参与用户"
        :value="stats?.distinctUsers ?? '—'"
        title="至少发起过一次目标对话的用户数"
      />
      <MkKpi
        label="近 7 天新增"
        :value="recentCreated7d ?? '—'"
        title="最近 7 天创建的目标对话数（按创建日期统计）"
      />
      <!-- P-49（#74）：停滞会话此前只活在分布带 hint 里；升为卡，0 是健康信号 -->
      <MkKpi
        label="停滞目标对话"
        :value="rows.length ? staleActiveCount : '—'"
        :tone="staleActiveCount ? 'warn' : ''"
        :title="`最近 ${LIST_LIMIT} 条窗口内，进行中且超过 ${STALLED_DAYS} 天未更新`"
      />
    </section>
    <!-- stats 三态（P1#6）：失败显错误条 + 重试（原错误桶随构成带退役，2026-10-04 晚贴表分布条） -->
    <div v-if="statsError" class="mk-status mk-status--bad">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta">统计暂不可用</span>
      <button type="button" class="mk-status__meta mk-status__meta-link" @click="load(true)">重试</button>
    </div>

    <!-- ===== 目标对话列表 ===== -->
    <MkEmptyState
      v-if="!rows.length && !loading && !loadError"
      title="暂无目标对话"
    />

    <template v-else>
      <!-- 目标对话状态分布带已退役（2026-10-17 用户走查「这个东西不好了」）：
           三状态里「已取消」常年为 0，图上只剩两段 = 一个比例，而同一个比例已在 KPI「完结率」；
           且它同时是唯一状态筛选入口，2026-10-14 又被要求默认折叠 → 筛选被藏进折叠区。
           状态筛选回到卡头 pills（计数仍取 stats 服务端全量口径），完结率升独立 KPI 卡。 -->

      <!-- 列表 -->
      <div class="mk-card mk-card--fill">
        <div class="mk-card__head">
          <div class="mk-filter">
            <!-- 状态筛选（2026-10-17 恢复为卡头 pills）：取消/失败/回收在「已取消」合一档。
                 计数取 stats 服务端全量口径（与旧分布带同源）；「未生成路径」是复合口径快筛
                 （进行中 ∧ 无路径，运营卡点），与状态筛选叠加为 AND -->
            <div class="mk-pills" role="group" aria-label="状态筛选">
              <button
                v-for="p in gcStatusPills"
                :key="p.key"
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': gcStatusKey === p.key }"
                :aria-pressed="gcStatusKey === p.key"
                :title="p.title"
                @click="selectStatus(p.key)"
              >{{ p.label }}<span v-if="p.n != null" class="mk-pill__count">{{ p.n }}</span></button>
            </div>
            <div class="mk-pills" role="group" aria-label="路径快筛">
              <button
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': noPathOnly }"
                :aria-pressed="noPathOnly"
                title="进行中 · 尚未生成路径"
                @click="noPathOnly = !noPathOnly"
              >未生成路径<span class="mk-pill__count">{{ pathPendingCount }}</span></button>
            </div>
            <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
            <!-- 排序复位入口（2026-10-06 审核 #51）：默认序是服务端 createdAt 倒序，
                 排序态持久化后此前无路可回；创建时间已接排序，另给一键回默认序 -->
            <button v-if="gcSortKey" type="button" class="mk-link" @click="gcResetSort()">恢复默认排序</button>
          </div>
          <div class="mk-card__head-right">
            <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位——
                 左组只留快筛/清除，右组 = 搜索 → 列 → 计数 meta，全站同一槽位序 -->
            <MkFilterSearch v-model="keyword" placeholder="搜索用户 / 邮箱 / 目标摘要" />
            <MkCols
              :col-defs="gcColDefsFiltered"
              storage-key="wf_goal_hidden_cols"
              :default-hidden="['constraints']"
              v-model:hidden="gcHiddenCols"
            />
            <!-- 卡头 meta 只放分页器没有的事实：口径（真实/测试）由页头那个开关自明，
                 这里再写一遍「（真实）」是同一状态复读（2026-10-19 用户走查「这个小文案不要」） -->
            <span v-if="truncated" class="mk-card__meta" :title="`排序与搜索仅覆盖最近 ${LIST_LIMIT} 条`">共 {{ listTotal }} 条 · 当前显示最近 {{ rows.length }} 条</span>
          </div>
        </div>

        <MockSkeletonTable v-if="loading && !rows.length" :cols="10" />
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
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('status')">状态 / 阶段<span class="mk-th__caret" aria-hidden="true"></span></button></th>
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
                v-if="showCol('stageDate')"
                scope="col"
                class="mk-th--sortable"
                :title="sortWindowTitle"
                :aria-sort="gcSortState('stageDate')"
                @click="toggleGcSort('stageDate')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('stageDate')">最近活动<span class="mk-th__caret" aria-hidden="true"></span></button></th>
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
                  <span class="mk-cell-sub mono" :title="`目标对话 ID ${r.id}`">{{ r.id }}</span>
                </div>
              </td>
              <td>
                <div class="gc-user">
                  <MkCellAvatar :name="r.userName" :tone="avatarTone(r)" />
                  <div class="mk-cell-main">
                    <!-- 全表唯一截断后无 title 的文本格（2026-10-06 审核 #46）：该格有
                         200px（≤1599 收 176px）强制最小宽，长名字/长邮箱被省略号截断后
                         看不到全值——同表其余格均有 title -->
                    <!-- 2026-10-18：姓名即学习者详情入口（行点击仍是进会话，这里 stop 冒泡） -->
                    <button
                      type="button"
                      class="mk-user-link"
                      :title="`查看学习者详情：${r.userName}`"
                      @click.stop="openLearner(r.userId)"
                      @keydown.enter.stop.prevent="openLearner(r.userId)"
                    >{{ r.userName }}</button>
                    <span class="mk-cell-sub" :title="r.userEmail">{{ r.userEmail }}</span>
                  </div>
                </div>
              </td>
              <td v-if="showCol('status')">
                <!-- 2026-10-15 用户拍板：状态与阶段合并为一列（两列编码同一件事——都源自
                     status/stage 两个字段且阶段序号已含终态折算；拆两列时 active 行状态恒「—」、
                     终态行词又与阶段重复，纯噪声）。合并后一列读完：
                       进行中 → 阶段词（澄清中/方案确认中…）+ 四点过程条
                       终态/异常 → 结果词（已完成/失败/已取消/已放弃）+ 过程条
                     即：状态列只在说得出阶段说不出的话（终止方式）时压过阶段词。 -->
                <div class="gc-stage-cell" :title="statusHint(r.status)">
                  <div class="gc-stage-cell__head">
                    <template v-if="showsStatusBadge(r.status)">
                      <span class="mk-badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span>
                    </template>
                    <template v-else>
                      <span class="mk-badge" :class="stageBadgeCls(r.stage)">{{ stageText(r.stage) || '—' }}</span>
                    </template>
                    <span v-if="r.timeline" class="gc-stage-cell__dots" :title="stageDotsTitle(r)" aria-label="阶段进度">
                      <i v-for="d in GOAL_STAGE_TOTAL" :key="d" class="gc-stage-cell__dot" :class="{ 'is-on': d <= r.stageIndex + 1 }"></i>
                    </span>
                  </div>
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
                <!-- 原型 open-path 习惯：生成过的路径成跳转（2026-10-12 起落会话座舱 Path 页签）；后端未回 pathId 时回落徽章 -->
                <button v-if="r.pathId" type="button" class="mk-btn mk-btn--sm" title="查看该目标的学习路径" @click.stop="openPathPage(r)">查看路径</button>
                <span v-else-if="r.hasPath" class="mk-badge mk-badge--info">已生成</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="showCol('stageDate')">
                <!-- 2026-10-15 用户拍板：原名「阶段日期」名实不符——进行中行取的是 updatedAt
                     （表无「进入当前阶段日」字段），改名「最近活动」如实表达「会话最后动过哪天」。
                     语义=时间线最后一站（已完成=完成日；进行中/失败/取消=最后活动日），完整链路悬停可见 -->
                <span v-if="r.timelineDate" :title="`阶段时间线 ${r.timeline}`">{{ r.timelineDate }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="showCol('created')"><span class="mk-cell-sub mono" :title="r.createdAtAbs">{{ r.createdAt }}</span></td>
              <td>
                <!-- 操作列文字钮（原型 .tbl 操作列 btn--sm「详情/下线」形态，不用纯图标钮）。
                     行内只留高频项「详情」；低频项（链路 / 重建路径 / 删除会话）一律收 ⋯ 菜单——
                     2026-10-15 用户拍板「链路做到折叠里面」，链路不再是高频，与另两项同为低频矫正操作。
                     右对齐与 mk-th--right 表头对齐（同 Users.vue 判例） -->
                <div class="mk-actions">
                  <button type="button" class="mk-btn mk-btn--sm" title="打开只读详情" @click.stop="goConsole(r)">详情</button>
                  <div class="mk-menu">
                    <!-- aria-expanded 按行判定（2026-10-06 审核 #50）：此前绑全局 menuOpen，
                         菜单一开 15 个按钮同时报 expanded=true；role=menu/menuitem 兑现
                         aria-haspopup="menu" 的语义承诺 -->
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === r.id" @click.stop="toggleMenu(r.id)">⋯</button>
                    <div v-if="openMenu === r.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" role="menuitem" title="查看该目标对话的执行链路（只读）" @click="goTrace(r)">链路</button>
                      <button type="button" class="mk-menu__item" role="menuitem" :disabled="r.regenerating" :title="r.regenerating ? '生成中…' : '对该目标对话重新生成学习路径'" @click="regenerate(r)">{{ r.regenerating ? '生成中…' : '重建路径' }}</button>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" role="menuitem" @click="menuRemove(r)">删除目标对话</button>
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
          :title="keyword || statusFilter || noPathOnly ? '当前筛选无匹配' : '暂无目标对话'"
          :description="keyword || statusFilter || noPathOnly ? '放宽筛选条件试试。' : (includeTest ? '当前范围（虚拟学习者与测试账号）暂无目标对话。' : '当前只显示真实用户，切「测试」可查看虚拟 / 测试账号的对话。')"
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

<script lang="ts">
/* G3a（2026-10-10）：列表态快照必须活过组件卸载——行点击「查看路径」进 PathDetail 二级页时
   AdminConsole 互斥卸载本组件（<component :is> 无 KeepAlive，OpsContent.vue #39 同款场景），
   <script setup> 作用域的变量随实例销毁，故快照放模块级（本 <script> 块每模块只执行一次），
   才能跨「下钻 → 返回」存活。
   为什么不走 openSubPage 的 from：from.view 必须是 SubPageView 二级页类型，目标对话是
   一级列表页没有合法值可填。consume-once：只服务「路径格下钻 → 返回列表」一个场景，
   不落 localStorage（防跨会话残留旧筛选）；下钻后经侧栏去别的场景再回来的窄边角
   会消费一次旧快照，与 OpsContent 先例同口径，可接受。 */
interface GcSavedListState {
  page: number
  keyword: string
  statusFilter: string
  noPathOnly: boolean
}
let gcSavedListState: GcSavedListState | null = null
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isLive, openSubPage } from './store'
import { useSessionDrill } from './useSessionDrill'
import { errMsg, timeAgo, isPageCacheFresh, markPageFetched, liveIncludeVirtual, liveSetIncludeVirtual } from './live'
import { stageText, stageBadgeCls, stageProgressIndex, stageTimelineText, stageTimeline, monthDayText, GOAL_STAGE_TOTAL, GOAL_STAGE_STEP_LABELS, statusText } from './statusText'
import { useRowMenu } from './useRowMenu'
import { useIsNarrow } from './useIsNarrow'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { useTableSort } from './useTableSort'
import DataScopeToggle from './DataScopeToggle.vue'
import MkCols from '@/components/mk/MkCols.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
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
  /** 时间线末条日期（阶段日期列显示值，阶段词由徽章单源；全串进 title） */
  timelineDate: string
  /** 时间线末站绝对时间（阶段日期列排序用；与 stageTimeline 末条同源） */
  stageDateAbs: string
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
  // 区分「窗口内无新增」与「取数失败」：stats 未取到（失败）→ null 显「—」；
  // dailyStats 为空数组是真实读数（窗口内没有新增）→ 归零显 0，不再伪装成不可用
  if (!ds) return null
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
/* ===== 状态快筛 pills（2026-10-17 从退役的分布带迁回）=====
   「已取消」= cancelled + failed + abandoned（非 active 且非 completed 取补集），与旧段同口径；
   计数取 stats 服务端全量；stats 未落定时不渲染计数徽章（不把未知读成 0）。 */
const gcStatusPills = computed<Array<{ key: string; label: string; n: number | null; title: string }>>(() => {
  const s = stats.value
  return [
    { key: 'all', label: '全部', n: null, title: '不限状态' },
    {
      key: 'active',
      label: '进行中',
      n: s ? s.active : null,
      title: rows.value.length
        ? `澄清中或待确认 · 其中 ${staleActiveCount.value} 条超过 ${STALLED_DAYS} 天未更新`
        : '澄清中或待确认'
    },
    { key: 'completed', label: '已完成', n: s ? s.completed : null, title: '已生成学习路径' },
    {
      key: 'cancelled',
      label: '已取消',
      n: s ? gcCancelledCount.value : null,
      title: '含用户取消、失败中断与长时间无操作自动回收的目标对话'
    }
  ]
})
/** 默认 '' 与显式「全部」（'all'）是同一档：高亮与筛选都按这个归一键判断 */
const gcStatusKey = computed(() => (statusFilter.value === 'all' ? 'all' : statusFilter.value || 'all'))
/** 完结率 KPI（旧分布带副文的读数）：后端给两位小数字符串，四舍五入到整数避免 70.00% 的假精度 */
const completionRatePct = computed(() => {
  const s = stats.value
  if (!s) return '—'
  const n = Number(s.completionRate)
  return Number.isFinite(n) ? `${Math.round(n)}%` : '—'
})
/* G3a（2026-10-10）：挂载时一次性读回「路径格下钻前」存下的列表态（consume-once，
   存储见文件顶 <script> 块）；未下钻过的普通进入读回 null，一切走初值 */
function takeSavedListState(): GcSavedListState | null {
  const s = gcSavedListState
  gcSavedListState = null
  return s
}
const restoredListState = takeSavedListState()
const keyword = ref(restoredListState?.keyword || '')
const statusFilter = ref(restoredListState?.statusFilter || '')
/* 「未生成路径」快筛（2026-10-08）：进行中且尚未生成学习路径的运营卡点会话。
   与分布条状态筛选叠加为 AND；再点取消。不显计数——分布条计数是服务端全量口径
   （stats），本快筛只能按已加载窗口算，同屏两个口径会数字打架（同 TS 页教训） */
const noPathOnly = ref(restoredListState?.noPathOnly || false)
/** 「未生成路径」谓词：hasPath 与路径列「—」同口径（均由后端 learningPathId 推导）；
    已完成桶口径 = 已生成学习路径，故「未生成」只拦进行中，两处口径呼应不矛盾 */
const isPathPendingRow = (r: Row) => r.status === 'active' && !r.hasPath
/** pill 命中数（2026-10-11 统一判例：筛选 pill 一律显命中数；按当前已加载窗口计） */
const pathPendingCount = computed(() => rows.value.filter(isPathPendingRow).length)

/* P1-3 列显隐（公共组件 MkCols）：目标摘要/状态/阶段/澄清进度/约束条件/路径/创建时间 可隐藏，用户/操作固定 */
const gcColDefs = [
  { key: 'summary', label: '目标摘要', title: '对话目标摘要' },
  { key: 'status', label: '状态 / 阶段', title: '目标对话状态与所在阶段（合并列）：进行中出阶段词 + 过程条，终态/异常出结果词 + 过程条' },
  { key: 'turns', label: '澄清进度', title: '学习者发言轮次（澄清深度）' },
  { key: 'constraints', label: '约束条件', title: '澄清中收集的可用时间 / 期限等约束' },
  { key: 'path', label: '路径', title: '路径是否已生成' },
  { key: 'stageDate', label: '最近活动', title: '目标对话最近一次活动日（进行中=最后活动日，已完成=完成日，失败/取消=终态日）；悬停看完整阶段时间线' },
  { key: 'created', label: '创建时间', title: '对话创建时间' },
] as const
const gcHiddenCols = ref<Set<string>>(new Set())

/* 窄档列降级（UI 方案 §1 LAYOUT-3）：8 列 nowrap 表（2026-10-15 状态+阶段合并后少一列）
   在 1440 容器级仍有横滚，操作列易被挤出。
   ≤1599 收「约束条件」（真实数据稀疏、自然宽仅 ~83px）；≤1320 再收「创建时间」
   （日期信号由「阶段日期」列承载，2026-10-15 该日期自阶段格副行拆为独立列）。强制收起的列同时从 MkCols 菜单过滤，避免死开关。 */
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
      toast.warning(`未能定位该目标对话：可能不在最近 ${LIST_LIMIT} 条内，或已被删除`)
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

/** 状态快筛 pills（2026-10-17 由分布带迁回）：再点已选中的状态取消，回「全部」（空串）。
    「已取消」走 isCancelledBucketRow 取补集（与计数同口径，点进去对得上）。
    「全部」必须显式清成空串——写 'all' 会进过滤分支把每一行都判成不匹配。 */
function toggleStatusBand(key: string) {
  statusFilter.value = statusFilter.value === key ? '' : key
}
function selectStatus(key: string) {
  if (key === 'all') {
    statusFilter.value = ''
    return
  }
  toggleStatusBand(key)
}

/** 「已取消」筛选谓词：与桶同取补集（非进行中且非已完成），保证 pill 与桶数字/语义一致 */
const isCancelledBucketRow = (r: Row) => r.status !== 'active' && r.status !== 'completed'

/** 状态词一律走全局字典（单源）；空值给「—」。原私有字典与 statusText 逐条重合，故删除 */
const statusLabel = (s: string) => statusText(s) || '—'
const statusBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'active' ? 'mk-badge--info' : s === 'cancelled' ? 'mk-badge--bad' : 'mk-badge--muted'

/** 头像 tone（列表行与抽屉头共用；与全站身份色一致：虚拟=紫 / 测试=琥珀 / 真实=默认蓝） */
function avatarTone(r: Pick<Row, 'isVirtualLearner' | 'isTestAccount'>): 'virtual' | 'test' | 'default' {
  return r.isVirtualLearner ? 'virtual' : r.isTestAccount ? 'test' : 'default'
}

/** 状态原因提示（UI 复查 #18）：回收机制会把约 30 分钟无心跳的会话标为 abandoned，
 *  列表里给一句解释，避免「会话莫名停下」；不新增后端字段，仅是文案。 */
const statusHint = (s: string | null | undefined) => {
  const k = String(s || '').toLowerCase()
  if (k === 'abandoned') return '目标对话已中止：因长时间无操作被自动回收，可在对应学习中重新发起'
  if (k === 'failed') return '目标对话失败：可在只读详情查看失败原因与日志'
  return ''
}

/** 状态列出词口径（2026-10-15 用户拍板）：状态列只说「阶段列说不出的话」——
    进行中族（active 等）必然落在澄清/方案某个阶段上，与阶段列同出两枚同色蓝胶囊属复读，
    故留「—」把进度让给阶段列；终态（已完成/已取消）与异常终止（失败/已放弃）阶段列表达不了，才单独成徽章。
    黑名单（仅列进行中族）而非白名单：将来新增的终态/异常状态自动出词，不会静默丢信息。 */
const ONGOING_STATUS = new Set(['active', 'in_progress', 'inprogress', 'running'])
const showsStatusBadge = (s: string | null | undefined) => !ONGOING_STATUS.has(String(s || '').toLowerCase())

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
  const stageTl = stageTimeline({
    stage,
    status: String(c.status || ''),
    createdAt: String(c.createdAt || ''),
    updatedAt: String(c.updatedAt || ''),
    completedAt: String(c.completedAt || '')
  })
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
    // 写法用「10月13日」而非裸「10-13」——单看不再是数字区间的形状（2026-10-13 运营走查 F2）
    timelineDate: monthDayText(stageTl.at(-1)?.date || ''),
    // 2026-10-15 用户拍板：阶段日期拆独立列。末站绝对时间与 stageTimeline 末条同源——
    // 已完成=completedAt（缺则回落 createdAt），其余=updatedAt || createdAt；仅排序用
    stageDateAbs: String(
      (String(c.status || '').toLowerCase() === 'completed' ? (c.completedAt || c.createdAt) : (c.updatedAt || c.createdAt)) || ''
    ),
  }
}

/* 客户端排序：默认保持服务端顺序。窗口截断时（含测试口径触 LIST_LIMIT）排序与关键词
   只覆盖已加载窗口，属「窗口内排序」而非全量排序 —— 由 sortWindowTitle 在表头与卡头披露
   （2026-10-06 审核 #35：原注释「全量拉取 → 排序诚实」在截断口径下不成立） */
const { toggle: toggleGcSort, sortState: gcSortState, sortRows: sortGcRows, sortKey: gcSortKey, reset: gcResetSort } = useTableSort<Row>({
  accessors: {
    user: (r) => r.userName,
    status: (r) => r.stageIndex,
    stageDate: (r) => r.stageDateAbs,
    turns: (r) => r.turns ?? -1,
    created: (r) => r.createdAtAbs
  },
  storageKey: 'wf_goal_conversations_sort'
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return sortGcRows(rows.value.filter((r) => {
    if (noPathOnly.value && !isPathPendingRow(r)) return false
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

const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value || noPathOnly.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
  noPathOnly.value = false
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   列表为客户端全量数据（limit:LIST_LIMIT 拉取后本地筛选），按页切片。
   回第 1 页只监听筛选输入（G3b，2026-10-10，对齐 TeachingSessions/OpsContent 判例）：
   此前监听 filtered 结果——删除行/口径切换回填数据也会把页码拽回第 1 页；
   且快照恢复的页码会被「重挂载后 rows 回填」触发的 filtered watch 打回初值，
   G3a 的 page 恢复就永远无效。越界收敛由 Pagination 自带 watcher 兜底 */
const page = ref(restoredListState?.page || 1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([keyword, statusFilter, noPathOnly], () => {
  page.value = 1
})

/* 列表拉取上限：请求与深链提示文案共用同一常量，避免「文案 100 / 实现 1000」再次漂移（同 TeachingSessions.LIST_LIMIT） */
const LIST_LIMIT = 1000

/* 截断口径披露（2026-10-06 审核 #35）：触 LIST_LIMIT 时表头排序与关键词搜索只覆盖已加载窗口，
   可排序表头 title 与卡头 meta 都须如实说明，不能读起来像全量 */
const sortWindowTitle = computed(() =>
  truncated.value ? `排序与搜索覆盖当前显示的 ${LIST_LIMIT} 条（全部共 ${listTotal.value} 条）` : ''
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
    // 首屏主体是会话列表：只 await 列表接口，页面就绪时间不再被 stats 拖住；
    // 测试视角（2026-10-10「真实/测试」互斥视角）带 testOnly 只回虚拟 + 测试账号的对话
    const listRes = await adminGoalConversationsApi.list({
      limit: LIST_LIMIT,
      includeTest: includeTest.value,
      testOnly: includeTest.value || undefined,
    })
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
  void adminGoalConversationsApi.getStats(includeTest.value, includeTest.value)
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
/** 用户格 → 学习者详情（2026-10-18 用户走查：三处列表都没有这个入口）。
 *  行点击仍是进会话座舱，单元格按钮上 stop 冒泡。 */
function openLearner(userId: string) {
  const id = String(userId || '')
  if (id) openSubPage('learner', id)
}
const { goTrace, goConsole } = useSessionDrill(closeDetail)

/** 页头副题只说这一页管什么；当前视角由右上角真实/测试开关表达，副文不再复述
 *  （2026-10-21 用户「右上角已经是真实了啊」同一判例：界面不重复控件状态） */
const gcScopeSub = '与学习者澄清真实目标 · 约束条件与澄清轮次'

/** 路径格 → 会话座舱的 Path 阶段页签（2026-10-12 拍板：路径不再有独立详情页）。
 *  行本身就是目标对话（r.id），直接开座舱并落 Path 页签，无需 id 反查。
 *  G3a（2026-10-10）：目标对话是一级列表页，from.view 无合法 SubPageView 可填，
 *  改走列表态快照（判例 OpsContent.vue #39）：出站前存 page/筛选，返回重挂载时
 *  一次性读回——此前返回直接落「第 1 页 + 无筛选」的初值列表，翻页/筛选全丢。 */
function openPathPage(r: Row) {
  if (!r.pathId) return
  gcSavedListState = {
    page: page.value,
    keyword: keyword.value,
    statusFilter: statusFilter.value,
    noPathOnly: noPathOnly.value,
  }
  openSubPage('session-real', r.id, { stage: 'path' })
}

async function regenerate(r: Row) {
  if (r.regenerating) return
  const ok = await askConfirm({
    title: '重建学习路径',
    message: `确认为「${r.userName}」重新生成学习路径？\n将基于该目标对话重新生成路径，覆盖当前路径。`,
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
    message: `确认删除「${r.userName}」的这条目标对话？\n该操作不可撤销。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  try {
    await adminGoalConversationsApi.remove(r.id)
    rows.value = rows.value.filter((x) => x.id !== r.id)
    toast.success('目标对话已删除')
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
/* 原「子组件根节点 .gc-host > .mk-page--fill」已删（2026-10-14）：本页 2026-09-29 从合并宿主
   拆回独立页后不再内嵌 fill 子页，规则空转（浏览器实测 .gc-host 的 4 个直接子级 = 页头 /
   KPI 带 / 分布带 / 列表卡，全树 .mk-page--fill 计数 0）。同形规则在 People(pp-host) /
   OpsHub(oh-host) / ApiConfig(ac-host) 仍在用，别照抄删除。 */
.gc-host > .mk-status { flex: none; }/* 概览卡样式由共享 mk-overview/mk-kpi 体系承载；此处仅保留堆叠条（pre slot 内）与行样式 */
/* 行点击/焦点态已升共享契约（table.mk-table--click + tr:focus-visible 原语，2026-10-03） */
/* 用户格 min-width：本表为自动布局（无 colgroup），补「澄清进度/约束条件」两列后
   该列会被内容多的列挤到 ~90px（2026-10-02 视觉核对实测），名字/邮箱全截断——
   给内容格兜底宽度，压缩由可换行的摘要/约束列吸收 */
.gc-user { display: flex; align-items: center; gap: 9px; min-width: 200px; }
/* 分布条已退役（2026-10-17）：原页面级分布带连同 .gc-distband 类一起下线，
   卡头状态 pills 与「未生成路径」快筛并列；页面级间距仍由 .mk-page 的 --mk-stack-gap 统一供 */
.gc-user .mk-cell-main { min-width: 0; flex: 1; }/* 阶段列：徽章 + 四步过程点条 + 轻量时间线（创建→澄清→方案→完成，statusText 单源） */
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

/* 中宽档（≤1599）：8 列 nowrap 表在 1280 仍会横滚（UI 方案 §1）。
   单元格 padding 16→12 + 三处 min-width 各收一档；「约束条件」列默认不进表（showCol 同源）。
   状态/阶段合并列含四点过程条（4×6px + gap ≈ 45px）保留：min-width 120px 已容得下点条 */
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
