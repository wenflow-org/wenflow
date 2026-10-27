<template>
  <div class="mk-page mk-page--fill gc-host">
    <!-- 页头（newui/admin pagehead）：页名 + 刷新上移；
         2026-09-29 拆回独立页：本组件从「学习会话」合并宿主还原为「目标对话」单页。
         原页面级状态条整体退役（dot 的加载/有数状态由 KPI 卡与列表自明）。 -->
    <MkPageHead title="目标对话" />

    <!-- 会话总量 KPI（2026-10-05 用户令对齐学习路径家族：MkKpi 卡带置于分布卡上方，OpsContent 同款）。
         2026-10-26：删「参与用户」「近 7 天新增」两张增长读数卡——它们没有对应处理页；
         近 7 天新增改挂总数卡的数值行注记。口径「不含虚拟学习者」只说一次，在页头之外不再重复。 -->
    <section class="mk-kpi-grid" aria-label="目标对话总量">
      <MkKpi
        label="目标对话数"
        :value="stats?.total ?? '—'"
        :value-note="recentCreated7d != null ? `近 7 天 +${recentCreated7d}` : ''"
      />
      <MkKpi
        label="完结率"
        :value="completionRatePct"
      />
      <!-- P-49（#74）：停滞会话此前只活在分布带 hint 里；升为卡，0 是健康信号。
           2026-10-26 动线：读数有对应行就得能落到那几行——点卡即筛「停滞」，
           与学习状态页可点 KPI 同一语法（本页原先只有它是点了没反应的卡）。 -->
      <MkKpi
        label="停滞目标对话"
        :value="rows.length ? staleActiveCount : '—'"
        :tone="staleActiveCount ? 'warn' : ''"
        :clickable="!!rows.length && staleActiveCount > 0"
        :class="{ 'gc-kpi--on': stalledOnly }"
        :aria-pressed="rows.length && staleActiveCount > 0 ? stalledOnly : undefined"
        @click="stalledOnly = !stalledOnly"
      />
    </section>
    <!-- stats 三态（P1#6）：失败显错误条 + 重试（原错误桶随构成带退役，2026-10-04 晚贴表分布条） -->
    <div v-if="statsError" class="mk-status mk-status--bad">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta">统计暂不可用</span>
      <button type="button" class="mk-status__meta mk-status__meta-link" @click="load(true)">重试</button>
    </div>

    <!-- ===== 目标对话列表 =====
         2026-10-24 用户「空数据的时候，页面很奇怪，没有统一设计」：原「本来就没数据」走的是
         页面级一行裸文字（不在卡里、无图标无说明，且与同页「筛选无匹配」的完整空态两副面孔），
         已删除——下面列表卡的 else 分支本就覆盖这一态，走同一骨架与同一位置（min 居中）。
         注意：卡不能再包进 <template> 包装器（原生 template 内容惰性，整张卡不渲染、页面只剩 KPI 带）。 -->

    <!-- 目标对话状态分布带已退役（2026-10-17 用户走查「这个东西不好了」）：
         三状态里「已取消」常年为 0，图上只剩两段 = 一个比例，而同一个比例已在 KPI「完结率」；
         且它同时是唯一状态筛选入口，2026-10-14 又被要求默认折叠 → 筛选被藏进折叠区。
         状态筛选回到卡头 pills（计数仍取 stats 服务端全量口径），完结率升独立 KPI 卡。 -->

    <!-- 列表 -->
    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 状态筛选（2026-10-17 恢复为卡头 pills）：取消 / 失败 / 放弃三档分开
               （2026-10-26：此前合一档，筛「已取消」出来的行状态列却写「失败」）。
               计数取 stats 服务端全量口径，但后端只给合并桶 → 取消与失败两档不显计数。
               2026-10-27 筛选语法对齐教学会话（M3：同页 chip 组不得一组单选一组多选）：
               状态一组单选；「未生成路径 / 停滞」是两个可叠加的开关 → 独立「标志筛选」组，
               激活时前缀勾（此前两组同形并排，点下去才知道行为不同）。 -->
          <MkPillSelect
            v-model="statusFilter"
            label="状态"
            aria-label="按状态筛选"
            :options="gcStatusOptions"
            :active="gcStatusKey !== 'all'"
          />
          <div class="mk-pills" role="group" aria-label="标志筛选">
            <button
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': noPathOnly }"
              :aria-pressed="noPathOnly"
              @click="noPathOnly = !noPathOnly"
            ><Check v-if="noPathOnly" :size="12" :stroke-width="2.5" aria-hidden="true" />未生成路径</button>
            <!-- 停滞快筛（KPI 卡同源同判据）：从「停滞 N」读数进来的人，落点就是这枚 chip。
                 2026-10-27 计数收敛：数字只留在 KPI 卡（唯一出处），chip 只表达「已应用」。 -->
            <button
              v-if="staleActiveCount"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': stalledOnly }"
              :aria-pressed="stalledOnly"
              :title="`停滞 ${staleActiveCount} 个（KPI 同源）`"
              @click="stalledOnly = !stalledOnly"
            ><Check v-if="stalledOnly" :size="12" :stroke-width="2.5" aria-hidden="true" />停滞</button>
          </div>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位——
               左组只留快筛/清除，右组 = 搜索 → 列 → 计数 meta，全站同一槽位序 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索用户 / 邮箱 / 目标摘要" />
          <MkCols
            :col-defs="gcColDefsFiltered"
            storage-key="wf_goal_hidden_cols_v2"
            :default-hidden="GC_DEFAULT_HIDDEN"
            v-model:hidden="gcHiddenCols"
          />
          <!-- 卡头 meta 只放分页器没有的事实：口径（真实/测试）由页头那个开关自明，
               这里再写一遍「（真实）」是同一状态复读（2026-10-19 用户走查「这个小文案不要」） -->
          <span v-if="truncated" class="mk-card__meta">共 {{ listTotal }} 条 · 当前显示最近 {{ rows.length }} 条</span>
        </div>
      </div>

      <MockSkeletonTable v-if="loading && !rows.length" :cols="7" />
      <!-- P0 修复：加载失败行内错误 + 重试（此前失败伪装成「暂无会话」）。
           形态收敛共享 MkEmptyState tone="error"（2026-10-06 审核 #48）：私有 .gc-error
           与同页 stats 失败条两套错误形态并存的局面收敛，role=alert + 重试由原语承担 -->
      <MkEmptyState
        v-else-if="loadError"
        min
        tone="error"
        title="目标对话列表加载失败"
        :description="loadError"
        action-text="重试"
        @action="load(true)"
      />
      <div v-else-if="filtered.length" class="mk-table-scroll">
      <!-- 固定列宽（2026-10-22 与教学会话同判例）：自动布局下摘要/用户两列按当页最长文本分宽，
           翻页整表跳动（摘要 303↔325、用户 241↔219）；改 fixed + 逐列表头宽度，余量按权重摊开。
           长摘要/长邮箱仍由 .mk-cell-text / .mk-cell-main 的截断兜底 -->
      <table class="mk-table mk-table--click mk-table--nowrap mk-table--fixed gc-table">
        <thead>
          <tr>
            <th v-if="showCol('summary')" scope="col" class="gc-c-summary">目标摘要</th>
            <th
              scope="col"
              class="mk-th--sortable gc-c-user"
              :aria-sort="gcSortState('user')"
              @click="toggleGcSort('user')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="showCol('status')"
              scope="col"
              class="mk-th--sortable gc-c-status"
              :aria-sort="gcSortState('status')"
              @click="toggleGcSort('status')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="showCol('turns')"
              scope="col"
              class="mk-th--sortable mk-th--right gc-c-turns"
              :aria-sort="gcSortState('turns')"
              @click="toggleGcSort('turns')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('turns')">澄清轮次<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th v-if="showCol('constraints')" scope="col" class="gc-c-constraints">约束条件</th>
            <th v-if="showCol('path')" scope="col" class="gc-c-path">路径</th>
            <th
              v-if="showCol('stageDate')"
              scope="col"
              class="mk-th--sortable gc-c-stage-date"
              :aria-sort="gcSortState('stageDate')"
              @click="toggleGcSort('stageDate')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('stageDate')">最近活动<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th
              v-if="showCol('created')"
              scope="col"
              class="mk-th--sortable gc-c-created"
              :aria-sort="gcSortState('created')"
              @click="toggleGcSort('created')"
            ><button type="button" class="mk-th__btn" @click.stop="toggleGcSort('created')">创建时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            <th scope="col" class="mk-th--right gc-c-act">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in paged" :key="r.id" tabindex="0" @click="openDetail(r)" @keydown.enter.self.prevent="openDetail(r)">
            <td v-if="showCol('summary')">
              <!-- 原型目标摘要格 = wrap 两行：strong 摘要 + sub mono 会话 ID。
                   2026-10-23 走查：会话 ID 副行撤除——它是内部键，本页搜索也不匹配 ID，
                   截图里逐行 `gc_1792…` 只增噪点；ID 只在排障时从日志取用。
                   列序统一（2026-10-03）：主体列恒在首（同 TS 会话/OC 路径/MR 学习者），用户列随后。
                   摘要改两行档 .mk-cell-text--wrap（2026-10-03 用户反馈「截断到看不清含义」）：
                   单行 320px 只露出 ~24 字，两行档保留语义骨架（同虚拟学习者倾向列判例） -->
              <div class="mk-cell-main">
                <strong class="mk-cell-text--wrap" :title="r.summary">{{ r.summary }}</strong>
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
                    @click.stop="openLearner(r.userId)"
                    @keydown.enter.stop.prevent="openLearner(r.userId)"
                  >{{ r.userName }}</button>
                  <!-- 备注在副行：姓名行保持全额宽度（2026-10-24 压字回归） -->
                  <!-- 副行去重（2026-10-24）：邮箱 local part 与姓名同值时不再复读 -->
                  <span v-if="emailSubline(r.userEmail, r.userName) || r.isTestAccount" class="mk-cell-subline">
                    <span v-if="emailSubline(r.userEmail, r.userName)" class="mk-cell-sub" :title="r.userEmail">{{ r.userEmail }}</span>
                    <span v-if="r.isTestAccount" class="mk-badge mk-badge--sm mk-badge--test">测试</span>
                  </span>
                </div>
              </div>
            </td>
            <td v-if="showCol('status')">
              <!-- 2026-10-22 用户「目标对话怎么会有阶段这一说？不应是完成未完成吗」：
                   状态列只回答完成没有——进行中 / 已完成 / 已取消 / 失败 / 已放弃。
                   四步过程点条退役；进行中的细阶段（正在了解情况 / 方案待确认 /
                   等待生成路径）收进悬停说明，不再作为徽章词或列名上屏。 -->
              <span
                class="mk-badge"
                :class="isOngoingStatus(r.status) ? 'mk-badge--info' : statusBadge(r.status)"
                :title="statusCellTitle(r)"
              >{{ isOngoingStatus(r.status) ? '进行中' : statusLabel(r.status) }}</span>
            </td>
            <td v-if="showCol('turns')" class="mk-num">
              <span v-if="r.turns != null" class="mk-num">{{ r.turns }} 轮</span>
              <span v-else class="mk-na">—</span>
            </td>
            <td v-if="showCol('constraints')">
              <div v-if="r.constraints.length" class="gc-constraints">
                <span v-for="cst in r.constraints" :key="cst" class="mk-badge mk-badge--muted">{{ cst }}</span>
              </div>
              <span v-else class="mk-na">—</span>
            </td>
            <td v-if="showCol('path')">
              <!-- 路径列即入口：点击直接落座舱「路径」页签（详情默认落目标对话页签，
                   已生成路径的人不必再切一次）。 -->
              <button
                v-if="r.pathId || r.hasPath"
                type="button"
                class="mk-user-link"
                @click.stop="openPathStage(r)"
              >已生成</button>
              <span v-else class="mk-na">—</span>
            </td>
            <td v-if="showCol('stageDate')">
              <span v-if="r.timelineDate" :title="`阶段时间线 ${r.timeline}`">{{ r.timelineDate }}</span>
              <span v-else class="mk-na">—</span>
            </td>
            <!-- 相对时间是人话（「3 天前」），走正文无衬线；等宽只留给 id/代码类机器串 -->
            <td v-if="showCol('created')"><span class="mk-cell-sub" :title="r.createdAtAbs">{{ r.createdAt }}</span></td>
            <td>
              <div class="mk-actions">
                <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDetail(r)">详情</button>
                <div class="mk-menu">
                  <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === r.id" @click.stop="toggleMenu(r.id)">⋯</button>
                  <div v-if="openMenu === r.id" class="mk-menu__pop" role="menu" aria-label="更多操作" :style="popStyle" @click.stop>
                    <button type="button" class="mk-menu__item" role="menuitem" @click="goTrace(r)">链路</button>
                    <button
                      type="button"
                      class="mk-menu__item"
                      role="menuitem"
                      :disabled="r.regenerating || !canRegenerate(r)"
                      @click="regenerate(r)"
                    >{{ r.regenerating ? '生成中…' : (r.hasPath ? '重建路径' : '生成路径') }}</button>
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
      <!-- 同一骨架覆盖两态（筛选无匹配 / 本来就没数据），只有标题与动作不同；
           补 min 让空态吃掉卡内剩余高度并居中（2026-10-24「空数据的时候页面很奇怪」）。 -->
      <MkEmptyState
        v-else
        min
        icon="◌"
        :title="isFiltered ? '当前筛选无匹配' : '暂无目标对话'"
        :action-text="isFiltered ? '清除筛选' : '查看学习者'"
        @action="isFiltered ? clearFilters() : goLearners()"
      />
      <!-- 客户端分页常驻（2026-10-26）：0 行时也渲染「共 0 条 · 第 1 / 1 页」，否则整页像数据没了 -->
      <Pagination
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
import { Check } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { isLive, openSubPage } from './store'
import { useListQueryState } from './learner-profile'
import { useSessionDrill } from './useSessionDrill'
import { errMsg, timeAgo, isPageCacheFresh, liveRefreshSeq, markPageFetched } from './live'
import { stageProgressIndex, stageTimelineText, stageTimeline, monthDayText, GOAL_STAGE_TOTAL, statusText } from './statusText'
import { useRowMenu } from './useRowMenu'
import { useIsNarrow } from './useIsNarrow'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { useTableSort } from './useTableSort'
import MkCols from '@/components/mk/MkCols.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import { emailSubline } from '@/components/mk/avatarName'
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
/* 近 7 日新增（总数卡数值行注记）：dailyStats 按创建日（UTC 日历日）归集；「7 天内完成但更早创建」
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
/** 停滞判据单点：KPI 计数与「停滞」快筛共用，避免读数和筛出来的行对不上 */
function isStalledRow(r: Row): boolean {
  if (r.status !== 'active' || !r.updatedAt) return false
  const t = new Date(r.updatedAt).getTime()
  return Number.isFinite(t) && t < Date.now() - STALLED_DAYS * 86400000
}
const staleActiveCount = computed(() => rows.value.filter(isStalledRow).length)
/* ===== 状态快筛 pills（2026-10-17 从退役的分布带迁回；2026-10-26 拆开混合桶）=====
   「已取消」只含用户取消与自动回收（cancelled / abandoned），「失败」单列 failed——
   此前三值合一档，筛出来的行状态列却写着「失败」。
   计数取 stats 服务端全量，而后端只给合并桶（total − active − completed），
   故拆分后的两档不显计数（不拿窗口口径冒充全量）。 */
const gcStatusPills = computed<Array<{ key: string; label: string; n: number | null }>>(() => {
  const s = stats.value
  return [
    { key: 'all', label: '全部', n: null },
    { key: 'active', label: '进行中', n: s ? s.active : null },
    { key: 'completed', label: '已完成', n: s ? s.completed : null },
    { key: 'cancelled', label: '已取消', n: null },
    { key: 'failed', label: '失败', n: null }
  ]
})
/** 卡头「状态」下拉：后端未拆分的档（取消 / 失败）不显计数 */
const gcStatusOptions = computed(() => [
  { value: '', label: '全部状态' },
  ...gcStatusPills.value
    .filter((p) => p.key !== 'all')
    .map((p) => ({ value: p.key, label: p.n != null ? `${p.label}（${p.n}）` : p.label }))
])
/** 默认 '' 与显式「全部」（'all'）是同一档：高亮与筛选都按这个归一键判断 */
const gcStatusKey = computed(() => (statusFilter.value === 'all' ? 'all' : statusFilter.value || 'all'))
/** 完结率 KPI（旧分布带副文的读数）：后端给两位小数字符串，四舍五入到整数避免 70.00% 的假精度 */
const completionRatePct = computed(() => {
  const s = stats.value
  if (!s) return '—'
  const n = Number(s.completionRate)
  return Number.isFinite(n) ? `${Math.round(n)}%` : '—'
})
const keyword = ref('')
const statusFilter = ref('')
/* 「未生成路径」快筛（2026-10-08）：进行中且尚未生成学习路径的运营卡点会话。
   与状态筛选叠加为 AND；再点取消。不显计数——它与「进行中」是包含关系，
   计数会让两个 pill 看起来是两档（同 TS 页口径教训）。 */
const noPathOnly = ref(false)
/** 「停滞」快筛（2026-10-26 动线收口）：本页 KPI 里「停滞目标对话」是唯一一张点了没反应的卡，
 *  而同组学习状态页的需关注/观察 KPI 都可点即筛。读数有对应行就必须能落到那几行，
 *  否则它只是「知道了但动不了」。与状态筛选、未生成路径叠加为 AND。 */
const stalledOnly = ref(false)
/** 「未生成路径」谓词：hasPath 与路径列「—」同口径（均由后端 learningPathId 推导）；
    已完成桶口径 = 已生成学习路径，故「未生成」只拦进行中，两处口径呼应不矛盾 */
const isPathPendingRow = (r: Row) => r.status === 'active' && !r.hasPath

/* P1-3 列显隐（公共组件 MkCols）：目标摘要/状态/澄清轮次/约束条件/路径/最近活动/创建时间 可隐藏，用户/操作固定。
   2026-10-22 默认只留 6 列（目标摘要/用户/状态/澄清轮次/路径/最近活动/操作）：
   · 创建时间：与「最近活动」同为时间轴，分诊只看最近活动；
   · 约束条件：真实数据稀疏（~35% 有值），逐条约束在详情里看。
   两项仍可在「列」菜单打开；存储键升 v2，旧本地配置不覆盖新默认。 */
const GC_DEFAULT_HIDDEN = ['constraints', 'created'] as const
const gcColDefs = [
  { key: 'summary', label: '目标摘要' },
  { key: 'status', label: '状态' },
  { key: 'turns', label: '澄清轮次' },
  { key: 'constraints', label: '约束条件' },
  { key: 'path', label: '路径' },
  { key: 'stageDate', label: '最近活动' },
  { key: 'created', label: '创建时间' },
] as const
const gcHiddenCols = ref<Set<string>>(new Set<string>(GC_DEFAULT_HIDDEN))

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

const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

/** 菜单项执行：先关菜单再执行（避免菜单残留与整行点击冒泡） */
function menuRemove(r: Row) {
  closeMenu()
  void remove(r)
}

/** 「已取消」档 = 用户取消 + 长时间无操作回收；失败（failed）独立成档 */
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'abandoned'])
const isCancelledRow = (r: Row) => CANCELLED_STATUSES.has(String(r.status || '').toLowerCase())
const isFailedRow = (r: Row) => String(r.status || '').toLowerCase() === 'failed'

/** 状态词一律走全局字典（单源）；空值给「—」。原私有字典与 statusText 逐条重合，故删除 */
const statusLabel = (s: string) => statusText(s) || '—'
/* spec 语义色：失败 = 需立即行动（红）；取消 / 放弃 = 不适用（灰）；已完成 = ok */
const statusBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'failed' ? 'mk-badge--bad' : s === 'active' ? 'mk-badge--info' : 'mk-badge--muted'

/** 头像 tone（列表行与抽屉头共用；与全站身份色一致：虚拟=紫 / 测试=琥珀 / 真实=默认蓝） */
function avatarTone(r: Pick<Row, 'isVirtualLearner' | 'isTestAccount'>): 'virtual' | 'test' | 'default' {
  return r.isVirtualLearner ? 'virtual' : r.isTestAccount ? 'test' : 'default'
}

/** 状态列出词口径（2026-10-15 用户拍板）：状态列只说「阶段列说不出的话」——
    进行中族（active 等）必然落在澄清/方案某个阶段上，与阶段列同出两枚同色蓝胶囊属复读，
    故留「—」把进度让给阶段列；终态（已完成/已取消）与异常终止（失败/已放弃）阶段列表达不了，才单独成徽章。
    黑名单（仅列进行中族）而非白名单：将来新增的终态/异常状态自动出词，不会静默丢信息。 */
const ONGOING_STATUS = new Set(['active', 'in_progress', 'inprogress', 'running'])
const isOngoingStatus = (s: string | null | undefined) => ONGOING_STATUS.has(String(s || '').toLowerCase())

/** 进行中行的细阶段（动作词，2026-10-22）：只进悬停说明，不占列宽/徽章 */
const ONGOING_STAGE_HINT: Record<string, string> = {
  initial: '尚未开始澄清',
  understanding: '正在了解你的情况',
  clarifying: '正在了解你的情况',
  proposing: '方案待学习者确认',
  proposal: '方案待学习者确认',
  planning: '正在生成学习方案',
  ready: '方案已确认，等待生成路径'
}

/** 状态格悬停：进行中给阶段动作 + 第几步（终态只出状态词，不再解释） */
function statusCellTitle(r: Row): string | undefined {
  if (!isOngoingStatus(r.status)) return undefined
  const hint = ONGOING_STAGE_HINT[String(r.stage || '').toLowerCase()] || '进行中'
  return `${hint} · 第 ${r.stageIndex + 1}/${GOAL_STAGE_TOTAL} 步`
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

/* 状态档固定序（与状态列出词同序）：进行中 → 已完成 → 已取消 → 失败 → 已放弃；
   未收录取值排最后。此前按 stageIndex 排，列里状态看着根本没排过。 */
const STATUS_ORDER: Record<string, number> = { active: 0, completed: 1, cancelled: 2, failed: 3, abandoned: 4 }
const statusOrderOf = (r: Row) => STATUS_ORDER[String(r.status || '').toLowerCase()] ?? 99

/* 客户端排序：默认保持服务端顺序。窗口截断时（含测试口径触 LIST_LIMIT）排序与关键词
   只覆盖已加载窗口，属「窗口内排序」而非全量排序（卡头 meta 已如实给出窗口条数） */
const {
  toggle: toggleGcSort, sortState: gcSortState, sortRows: sortGcRows,
  sortKey: gcSortKey, sortDir: gcSortDir
} = useTableSort<Row>({
  accessors: {
    user: (r) => r.userName,
    status: (r) => statusOrderOf(r),
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
    if (stalledOnly.value && !isStalledRow(r)) return false
    if (statusFilter.value === 'cancelled') {
      if (!isCancelledRow(r)) return false
    } else if (statusFilter.value === 'failed') {
      if (!isFailedRow(r)) return false
    } else if (statusFilter.value && r.status !== statusFilter.value) {
      return false
    }
    if (!k) return true
    return `${r.userName} ${r.userEmail} ${r.summary}`.toLowerCase().includes(k)
  }))
})

const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value || noPathOnly.value || stalledOnly.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
  noPathOnly.value = false
  stalledOnly.value = false
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   列表为客户端全量数据（limit:LIST_LIMIT 拉取后本地筛选），按页切片。
   回第 1 页只监听筛选输入（G3b，2026-10-10，对齐 TeachingSessions/OpsContent 判例）：
   此前监听 filtered 结果——删除行/口径切换回填数据也会把页码拽回第 1 页；
   页码恢复交给 URL（下方 useListQueryState），不再依赖组件内快照。
   越界收敛由 Pagination 自带 watcher 兜底 */
const page = ref(1)
const pageSize = ref(15)
/* 列表态 URL 化（2026-10-24）：此前用模块级快照，刷新/分享即回初值。
   参数名：status / q / page / size / noPath / stalled；缺省值不写 URL。 */
/* helper 的中性档约定是 'all'，本页内部用空串表示「全部」（'' 才能绕过过滤分支）：
   用可写计算属性做两侧映射，URL 仍写 pill=all 时归一成空串 */
const gcPillFilter = computed({
  get: () => statusFilter.value || 'all',
  set: (v: string) => { statusFilter.value = v === 'all' ? '' : v },
})
useListQueryState(
  {
    pill: gcPillFilter,
    keyword,
    page,
    pageSize,
    allowedPills: ['all', 'active', 'completed', 'cancelled', 'failed'],
    extra: [{
      key: 'noPath',
      get: () => (noPathOnly.value ? '1' : ''),
      set: (v) => { noPathOnly.value = v === '1' },
    }, {
      key: 'stalled',
      get: () => (stalledOnly.value ? '1' : ''),
      set: (v) => { stalledOnly.value = v === '1' },
    }],
  },
  { pill: 'status' }
)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([keyword, statusFilter, noPathOnly, stalledOnly, gcSortKey, gcSortDir], () => {
  // 排序/筛选变化必须回第 1 页（2026-10-22 走查：在第 2 页点排序仍停在第 2 页，
  // 与教学组其余页不一致——它们都在 watch 里带 sortKey/sortDir）
  page.value = 1
})

/* 列表拉取上限：请求与深链提示文案共用同一常量，避免「文案 100 / 实现 1000」再次漂移（同 TeachingSessions.LIST_LIMIT） */
const LIST_LIMIT = 1000

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
    // 默认口径 = 全部非虚拟账号（2026-10-21 拍板：虚拟学习者的对话归虚拟学习者域）
    const listRes = await adminGoalConversationsApi.list({ limit: LIST_LIMIT })
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
  void adminGoalConversationsApi.getStats()
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

/** 进会话座舱（行点击 / 操作列「详情」共用；路径与对话同一座舱的不同页签）。
 *  2026-10-24：列表态（页码 / 关键词 / 状态 / 未生成路径）改由 URL 承载，
 *  不再用模块级一次性快照——返回、刷新、复制链接都能复原。 */
function openDetail(r: Row) {
  goConsole(r)
}

/** 路径格 → 座舱「路径」页签（列表默认落目标对话页签，已生成路径的人不必再切一次） */
function openPathStage(r: Row) {
  if (!r.id) return
  closeDetail()
  openSubPage('session-real', r.id, { stage: 'path' })
}

/** 空态出口：目标对话由学习者端发起，平台侧只能去看学习者 */
function goLearners() {
  void router.push('/admin/people')
}

/** 「重建路径」只对已谈成（已完成）的会话开放：后端 generateLearningPathFromConversation
    直接 JSON.parse(collectedData) 取 collected，未澄清的会话没有该结构会 500。 */
const canRegenerate = (r: Row) => String(r.status || '').toLowerCase() === 'completed'

async function regenerate(r: Row) {
  if (r.regenerating || !canRegenerate(r)) return
  const hasPath = r.hasPath
  const ok = await askConfirm({
    title: hasPath ? '重建学习路径' : '生成学习路径',
    message: hasPath
      ? `确认为「${r.userName}」重新生成学习路径？\n将覆盖当前路径。`
      : `确认为「${r.userName}」生成学习路径？`,
    confirmText: hasPath ? '重建路径' : '生成路径',
    danger: false
  })
  if (!ok) return
  r.regenerating = true
  try {
    const res = await adminGoalConversationsApi.regeneratePath(r.id)
    const d = res.data?.data ?? res.data ?? {}
    toast.success(`已生成路径「${d.learningPathName || '未命名'}」（v${d.version ?? '—'}）`)
    if (d.learningPathId) r.pathId = String(d.learningPathId)
    r.hasPath = !!r.pathId
  } catch (e) {
    toast.error(`生成失败：${errMsg(e)}`)
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
/* 顶栏刷新（全站唯一刷新钮）：绕过 45s 页缓存强制重拉 */
watch(liveRefreshSeq, () => { void load(true) })
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
/* 可点 KPI 的选中态（停滞卡 → 停滞快筛）：蓝只给可交互与选中，与
   MemoryReview .mr-kpi--on / LearnerCenter .lc-kpi--on 同一判例 */
.gc-kpi--on { border-color: var(--mk-blue); }
/* 行点击/焦点态已升共享契约（table.mk-table--click + tr:focus-visible 原语，2026-10-03） */
/* 固定列宽（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）：摘要/用户两列
   在 auto 布局下按当页最长文本分宽，翻页跳动；fixed 后按表头宽度定死，余量按权重摊到各列。
   宽度取 1280 下的现值再留一点余量，保证 1200 档不出横滚。 */
/* 2026-10-24 视觉修复：状态（100）/创建时间（84）让出的宽度归目标摘要主列，
   摘要两行档不再在 240px 里只露出语义碎片。 */
.gc-c-summary { width: 330px; }
.gc-c-user { width: 160px; }
.gc-c-status { width: 84px; }
.gc-c-turns { width: 68px; }
.gc-c-constraints { width: 140px; }
.gc-c-path { width: 82px; }
.gc-c-stage-date { width: 78px; }
.gc-c-created { width: 72px; }
.gc-c-act { width: 90px; }
/* fixed 档里列宽即契约：行内 min-width 会把内容顶出单元格，统一归零由截断兜底 */
.gc-table .gc-user { min-width: 0; }
.gc-table .gc-c-summary .mk-cell-text--wrap { min-width: 0; max-width: 100%; }
/* 用户格布局：列宽由 fixed 表头契约决定（.gc-c-user），行内不再设 min-width——
   2026-10-22 之前给过 200/176px 兜底，是为自动布局下防被长摘要挤扁；fixed 后
   min-width 只会把内容顶出单元格，已由上方 .gc-table .gc-user 归零 */
.gc-user { display: flex; align-items: center; gap: 9px; min-width: 0; }
/* 分布条已退役（2026-10-17）：原页面级分布带连同 .gc-distband 类一起下线，
   卡头状态 pills 与「未生成路径」快筛并列；页面级间距仍由 .mk-page 的 --mk-stack-gap 统一供 */
.gc-user .mk-cell-main { min-width: 0; flex: 1; }
.gc-user > .mk-badge { flex: none; }/* 约束条件列：mute 徽章多枚 wrap（原型 .wrap 格内 pill--mute 判例） */
.gc-constraints { display: flex; flex-wrap: wrap; gap: 5px; max-width: 220px; }/* 原型 .tbl td：nowrap（表格为 fixed，列宽由表头决定；
   长摘要 .mk-cell-text 与 .mk-cell-main/.mk-cell-sub 的 max-width 截断兜底）。
   2026-10-05 CM6：裸 `.mk-table td { white-space: nowrap }` 收敛为全局修饰类
   .mk-table--nowrap（表元素已挂该 class），本页不再私持拷贝。 */
/* 按钮规格对齐 .mk-btn（8x16 / 12.5px）；危险操作实心红（与 .mk-btn--danger 一致） */

/* 中宽档（≤1599）：8 列 nowrap 表在 1280 仍会横滚（UI 方案 §1）。
   单元格 padding 16→12 + 三处 min-width 各收一档；「约束条件」列默认不进表（showCol 同源）。
   状态/阶段合并列含四点过程条（4×6px + gap ≈ 45px）保留：min-width 120px 已容得下点条 */
@media (max-width: 1599px) {
  /* fixed 表里列宽即契约（.gc-c-user），行内再设 min-width 会把内容顶出单元格 */
  .gc-user { min-width: 0; }
  .mk-cell-main .mk-cell-text--wrap { min-width: 0; }
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
