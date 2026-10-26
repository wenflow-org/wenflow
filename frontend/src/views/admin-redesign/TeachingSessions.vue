<template>
  <div :class="embedded ? 'mk-page--fill ts-embedded' : 'mk-page mk-page--fill'">
    <!-- 教学会话页头（embedded 由宿主承载，本组件不渲染页头）。
         本页 20s 静默轮询 + 顶栏刷新（watch liveRefreshSeq）；拉取失败走错误条重试钮。 -->
    <MkPageHead v-if="!embedded" title="教学会话" />

    <!-- 会话 KPI：需关注 / 缺总结 / 有建议 / 完结率。
         2026-10-26：「异常终态」卡退役（与「需关注」在同一行数据上同源同数），
         异常数只由卡头「异常」chip 承载；「需关注」改可点，点卡 = 选中同名 chip。 -->
    <section v-if="!embedded && rows.length" class="mk-kpi-grid" aria-label="教学会话运维关注量">
      <MkKpi
        clickable
        label="需关注"
        :value="attentionCount"
        :tone="attentionCount ? 'warn' : ''"
        @click="pill = 'attention'"
      />
      <MkKpi
        label="缺总结"
        :value="missingWrapupCount"
        :tone="missingWrapupCount ? 'warn' : ''"
      />
      <MkKpi
        label="有建议"
        :value="advisoryCount"
      />
      <MkKpi
        label="完结率"
        :value="completionRate"
      />
    </section>

    <!-- 首载占位（2026-10-06 审核 #44）：KPI 带以 rows.length 为渲染条件，
         首载整块不存在，数据到达后插入把主表卡下推；改为首载渲染等高 .mk-skeleton 占位
         （R3 卡片区加载态），主表卡位置不跳。2026-10-17 分布带退役后只补 KPI 一排。 -->
    <section
      v-if="!embedded && refreshing && !rows.length && !loadFailed"
      class="mk-kpi-grid"
      aria-hidden="true"
    >
      <div v-for="n in 4" :key="n" class="mk-skeleton ts-skel-kpi"></div>
    </section>

    <!-- G5（2026-10-10）：深链未命中提示由常驻 alert 横幅改为一次性 toast（见 script 区 watch），
         此前横幅无关闭出口、?session= 不清就永久挂着 -->

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 表前只此一行（2026-10-04 用户拍板：快筛并回卡头）：
               左组 = 焦点 chips（单选）+ 两枚独立开关（有建议服务端过滤 / 异常多选），
               随后是 10 档状态下拉与总结筛选（2026-10-26 从弹层提到主栏——逐条排查的主路径）；
               课堂类型与时间窗仍收在右侧「筛选」弹层。 -->
          <div class="mk-pills" role="group" aria-label="焦点筛选">
            <button
              v-for="p in pills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': pill === p.id }"
              :aria-pressed="pill === p.id"
              @click="pill = pill === p.id && p.id !== 'all' ? 'all' : p.id"
            >
              {{ p.label }}<span v-if="p.count != null" class="mk-pill__count">{{ p.count }}</span>
            </button>
          </div>
          <div class="mk-pills" role="group" aria-label="快捷筛选">
            <button
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': onlyAdvisory }"
              :aria-pressed="onlyAdvisory"
              @click="toggleOnlyAdvisory"
            >有建议<span class="mk-pill__count">{{ advisoryCount }}</span></button>
            <button
              v-if="abnormalSessionCount"
              type="button"
              class="mk-pill ts-abn-chip"
              :class="{ 'mk-pill--active': abnormalOnly, 'ts-abn-chip--heap': abnormalHeap && !abnormalOnly }"
              :aria-pressed="abnormalOnly"
              :title="`失败 / 收尾失败 / 超时合计 ${abnormalSessionCount}${abnormalHeap ? `（≥ ${TS_BAD_THRESHOLD}，异常堆积）` : ''}`"
              @click="abnormalOnly = !abnormalOnly"
            >异常<span class="mk-pill__count">{{ abnormalSessionCount }}</span></button>
          </div>
          <select v-model="statusFilter" class="mk-filter__select" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
          <select v-model="wrapFilter" class="mk-filter__select" aria-label="按总结筛选">
            <option value="">全部总结</option>
            <option value="degraded">降级总结</option>
            <option value="eval-failed">评估失败</option>
            <option value="missing">缺总结</option>
          </select>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
          <!-- 排序复位（2026-10-26 动线收口）：排序态写 localStorage，点过表头后无法回默认序 -->
          <button v-if="!tsSortIsDefault" type="button" class="mk-link" @click="resetTsSort">恢复默认序</button>
        </div>
        <div class="mk-card__head-right">
          <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索主题 / 用户 / 邮箱" />
          <!-- 口径切换/刷新加载反馈（2026-10-06 审核 F2-3）：列表接口实测可滞后数秒，
               此前全程无加载提示；这里给一处文字化「正在加载」（MkLoading 共享原语，
               含 role=status）。常驻卡头，切换口径时位置不跳。 -->
          <MkLoading v-if="refreshing" inline text="加载中…" />
          <MkCols
            :col-defs="tsColDefs"
            storage-key="wf_teaching_hidden_cols_v2"
            :default-hidden="TS_DEFAULT_HIDDEN"
            v-model:hidden="tsHiddenCols"
          />
          <div class="mk-adv">
            <!-- 主栏已放状态与总结两档筛选；课堂类型与时间窗收进弹层 -->
            <button
              type="button"
              class="mk-btn mk-btn--sm"
              :aria-expanded="advOpen"
              @click="advOpen = !advOpen"
            >
              <Filter :size="14" :stroke-width="1.75" />筛选<span v-if="advCount" class="mk-pill__count">{{ advCount }}</span>
            </button>
            <div v-if="advOpen" class="mk-adv__mask" @click="advOpen = false"></div>
            <div v-show="advOpen" class="mk-adv__pop" @click.stop>
              <label class="mk-adv__field">
                <span class="mk-cell-sub">课型</span>
                <select v-model="modeFilter" class="mk-filter__select" aria-label="按课型筛选">
                  <option value="">全部课型</option>
                  <option value="tutor">正课</option>
                  <option value="review">复习课</option>
                  <option value="extension">延伸课</option>
                </select>
              </label>
              <label class="mk-adv__field">
                <span class="mk-cell-sub">开始时间</span>
                <select v-model="dateFilter" class="mk-filter__select" aria-label="按开始时间筛选">
                  <option value="">全部时间</option>
                  <option value="7d">近 7 天</option>
                  <option value="30d">近 30 天</option>
                </select>
              </label>
            </div>
          </div>
          <span v-if="truncated" class="mk-card__meta">共 {{ listTotal }} 条 · 当前显示最近 {{ LIST_LIMIT }} 条</span>
        </div>
      </div>

      <div v-if="loadFailed" class="mk-alert mk-alert--row ts-error" role="alert">
        <span class="mk-alert__msg">教学会话加载失败</span>
        <button type="button" class="mk-alert__btn" :disabled="refreshing" @click="refreshNow">{{ refreshing ? '重试中…' : '重试' }}</button>
      </div>

      <MockSkeletonTable v-if="refreshing && !rows.length" :cols="tsVisibleColCount" />
      <!-- 0 行不渲染滚动容器（2026-10-24 全站空态收齐）：它带 flex:1 会吃满卡高，把空态顶到卡底
           （实测文案上方 603px 空白）；空态改挂卡级 + min，吃掉卡内剩余高度并居中 -->
      <div v-else-if="filtered.length" class="mk-table-scroll">
        <!-- 固定列宽（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）：自动布局下课堂/用户
             两列按当页最长内容分宽，翻页就跳；改 fixed + 逐列表头宽度，课堂列吸收余量。
             单元格 nowrap 不变，长内容仍由 .mk-cell-main / .mk-cell-sub 的 max-width 截断兜底。 -->
        <table v-if="filtered.length" class="mk-table mk-table--click mk-table--nowrap mk-table--fixed ts-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable ts-c-topic"
                :aria-sort="tsSortState('topic')"
                @click="toggleTsSort('topic')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('topic')">课堂<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!tsHiddenCols.has('user')"
                scope="col"
                class="mk-th--sortable ts-c-user"
                :aria-sort="tsSortState('user')"
                @click="toggleTsSort('user')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!tsHiddenCols.has('status')"
                scope="col"
                class="mk-th--sortable ts-c-status"
                :aria-sort="tsSortState('status')"
                @click="toggleTsSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('status')">状态 / 进度<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!tsHiddenCols.has('mode')"
                scope="col"
                class="ts-c-mode"
              >课型</th>
              <th
                v-if="!isTableNarrow && !tsHiddenCols.has('track')"
                scope="col"
                class="ts-c-track"
              >完成方式</th>
              <th
                v-if="!tsHiddenCols.has('duration')"
                scope="col"
                class="mk-th--sortable ts-c-dur"
                :aria-sort="tsSortState('interact')"
                @click="toggleTsSort('interact')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('interact')">时长<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="!tsHiddenCols.has('messages')" scope="col" class="ts-c-msg">消息</th>
              <th v-if="!isTableMid && !tsHiddenCols.has('knowledge')" scope="col" class="ts-c-kp">知识点</th>
              <th v-if="!tsHiddenCols.has('output')" scope="col" class="ts-c-out">课后总结</th>
              <th v-if="!isTableNarrow && !tsHiddenCols.has('attention')" scope="col" class="ts-c-att">关注</th>
              <th
                v-if="!isTableCompact && !tsHiddenCols.has('start')"
                scope="col"
                class="mk-th--sortable ts-c-start"
                :aria-sort="tsSortState('start')"
                @click="toggleTsSort('start')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('start')">开始时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in paged"
              :key="r.id || `row-${i}`"
              class="ts-row"
              tabindex="0"
              @click="openRow(r)"
              @keydown.enter.self.prevent="openRow(r)"
            >
              <td>
                <div class="mk-cell-main">
                  <strong :title="r.topic">{{ r.topic }}</strong>
                  <!-- 副行并档（2026-10-06 审核 #39）：原「学科·任务类型」与「总结摘要」两行
                       合成一条（全文仍留 title），会话列三行并回两行，行高向全站 66px 档收敛 -->
                  <span class="mk-cell-sub" :class="{ 'ts-summary': tsSubNote(r) }" :title="sessionSubTitle(r)">{{ sessionSubText(r) }}</span>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('user')">
                <!-- 用户格对齐全站判例（2026-10-08：六个同格页均 MkCellAvatar，本页是遗漏）：
                     头像 + 主副行，同 Users.ul-user / GoalConversations.gc-user -->
                <div class="ts-user">
                  <MkCellAvatar :name="r.userName" :tone="avatarTone(r)" />
                  <div class="mk-cell-main">
                    <!-- 2026-10-18：姓名即学习者详情入口（行点击仍是进座舱，stop 冒泡） -->
                    <button
                      type="button"
                      class="mk-user-link"
                      @click.stop="openLearner(r.userId)"
                      @keydown.enter.stop.prevent="openLearner(r.userId)"
                    >{{ r.userName }}</button>
                    <!-- 备注在副行：姓名行保持全额宽度（2026-10-24 压字回归） -->
                    <!-- 副行去重（2026-10-24 视觉修复）：邮箱 local part 与姓名同值时跳过；
                         主行已是纯 ID 时不再用 shortId 复读同一标识 -->
                    <span v-if="emailSubline(r.email, r.userName) || (r.userId && !isIdentifierLike(r.userName)) || r.isTestAccount" class="mk-cell-subline">
                      <span v-if="emailSubline(r.email, r.userName)" class="mk-cell-sub" :title="r.email">{{ r.email }}</span>
                      <span v-else-if="r.userId && !isIdentifierLike(r.userName)" class="mk-cell-sub mono" :title="r.userId">{{ shortId(r.userId) }}</span>
                      <span v-if="r.isTestAccount" class="mk-badge mk-badge--sm mk-badge--test">测试</span>
                    </span>
                  </div>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('status')">
                <div class="ts-status">
                  <span class="mk-badge ts-status__main" :class="statusBadge(r.status)">{{ statusText(r.status) }}</span>
                  <!-- 2026-10-23 用户「已完成和进度是一样的吧，应该保留一个就行」：
                       生命周期终态与任务位置并成一列。位置只写「停在 x/y」，不再用「结束于/中断于」
                       复述左侧徽章已经说过的结果；x/y 是位置，不是完成数（表头 title 已说明）。 -->
                  <span v-if="progressStopText(r)" class="ts-prog" :title="progressTitle(r)">{{ progressStopText(r) }}</span>
                  <span v-else class="mk-na">—</span>
                  <span
                    v-if="r.status === 'completed' && (r.messageCount ?? 0) < 2"
                    class="mk-badge mk-badge--sm mk-badge--muted"
                  >低参与</span>
                  <span
                    v-if="r.status === 'completed' && r.endReason === 'manual-end'"
                    class="mk-badge mk-badge--sm mk-badge--muted"
                  >手动结束</span>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('mode')">
                <div class="ts-classroom">
                  <span class="mk-badge mk-badge--sm" :class="sessionModeBadgeCls(r.mode)">{{ sessionModeText(r.mode) }}</span>
                </div>
              </td>
              <td v-if="!isTableNarrow && !tsHiddenCols.has('track')">
                <div class="ts-track">
                  <span v-if="r.closure" class="ts-track__mode">{{ closureSourceText(r.closure.completionSource) }}</span>
                  <span v-else class="mk-na">—</span>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('duration')">
                <div class="ts-ia ts-ia--dur" :title="interactTitle(r)">
                  <b class="ts-ia__dur" :class="{ 'ts-ia__dur--long': r.duration >= IDLE_LONG_MINUTES }">{{ r.duration ? fmtDuration(r.duration) : '—' }}</b>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('messages')">
                <div class="ts-ia ts-ia--msg" :title="interactTitle(r)">{{ r.messageCount }} 条</div>
              </td>
              <td v-if="!isTableMid && !tsHiddenCols.has('knowledge')">
                <div class="ts-ia ts-ia--kp" :title="interactTitle(r)">
                  <span v-if="r.knowledgePointCount">{{ r.knowledgePointCount }} 个</span>
                  <span v-else class="mk-na">—</span>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('output')">
                <!-- 产物徽章（评审 §5）：「有总结」且 wrapupDegraded（summary-only / fallback 兜底来源）
                     时文案改「降级总结」+ title 说明（2026-10-06 审核 #40）。
                     建议徽章读运营口径（2026-10-22 用户走查「这个页面看的视角是运营者」）：
                     后端 advisory.ui.* 是写给学习者的（「建议先确认路径调整」），运营要看的是
                     处置状态 + 触发原因 + 影响范围，见 statusText.advisoryOps*。
                     固定列宽后两枚徽章在窄档会超出本列：外层 flex-wrap 换行，不裁不挤邻列。 -->
                <div class="ts-out">
                  <span class="mk-badge" :class="wrapupBadge(r)">{{ wrapupText(r) }}</span>
                  <span
                    v-if="r.hasAdvisory"
                    class="mk-badge ts-adv-badge"
                    :class="advisoryOpsBadgeCls(r.advisory)"
                    :title="advisoryOpsTitle(r.advisory)"
                  ><span class="ts-adv-badge__txt">{{ advisoryOpsText(r.advisory) }}</span></span>
                </div>
              </td>
              <td v-if="!isTableNarrow && !tsHiddenCols.has('attention')">
                <span
                  class="ts-att"
                  :class="`ts-att--${r.attention}`"
                >{{ r.attention === 'high' ? '高' : r.attention === 'medium' ? '中' : '低' }}</span>
              </td>
              <td v-if="!isTableCompact && !tsHiddenCols.has('start')">
                <span class="mk-cell-sub" :title="startAbsTitle(r)">{{ r.startAt || '—' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <MkEmptyState
        v-else-if="!loadFailed"
        min
        :title="isFiltered ? '当前筛选无课堂' : '暂无教学会话'"
        :action-text="isFiltered ? '清除筛选' : ''"
        @action="clearFilters"
      />
      <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片 -->
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
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dataSource, openSubPage } from './store'
import { isDegradedWrapup } from './cockpitWrapup'
import { useSessionDrill } from './useSessionDrill'
import { useIsNarrow } from './useIsNarrow'
import { useListQueryState } from './learner-profile'
import { timeAgo, isPageCacheFresh, liveRefreshSeq, markPageFetched, shortId } from './live'
import { statusText, sessionProgressTitle, taskTypeText, taskTypeTitle, sessionStatusBadgeCls as statusBadge, closureSourceText, sessionModeText, sessionModeBadgeCls, advisoryOpsText, advisoryOpsTitle, advisoryOpsBadgeCls } from './statusText'
import type { SessionProgress, OpsAdvisoryLike } from './statusText'
import { adminTeachingSessionsApi } from '@/api/adminApi'
import { useSafePolling } from '@/composables/useSafePolling'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import { useTableSort } from './useTableSort'
import MkCols from '@/components/mk/MkCols.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import { emailSubline, isIdentifierLike } from '@/components/mk/avatarName'
import MkKpi from '@/components/mk/MkKpi.vue'

import { Filter } from 'lucide-vue-next'
import { toast } from '@/utils/toast'
import { useEscape } from './useEscape'

/** 嵌入模式：作为「学习会话」页「教学会话」tab 渲染（宿主状态条承载域计数，本组件不上状态条）。
    （原 count/stats 上报链随合并宿主退役，2026-10-02 撤页头 KPI 区时一并清除） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

interface WrapupSummary {
  topicSummary?: string
  knowledgeSummary?: string
  practiceAdvice?: string
  learningEvaluation?: string
}

interface Row {
  id: string
  userId: string
  topic: string
  subject: string
  taskType: string
  /** 课堂类型：tutor=正课 / review=复习课 / extension=延伸课（后两者不结算任务） */
  mode: string
  userName: string
  email: string
  /** 测试/审计备注标记（行内「测试」） */
  isVirtualLearner: boolean
  isTestAccount: boolean
  status: string
  /** 收束原因（后端从 teachingState.sessionArtifacts.endReason 读）：manual-end / task-completed /
      learner-abandoned；老会话缺失为 null。只用于给 completed 行加「手动结束」标注。 */
  endReason: string | null
  duration: number
  messageCount: number
  knowledgePointCount: number
  wrapupStatus: string
  hasAdvisory: boolean
  attention: 'high' | 'medium' | 'low'
  startAt: string
  /** 原始开始时间戳（日期范围筛选用） */
  startTime?: string
  wrapup: WrapupSummary | null
  /** 降级总结：超时/收束失败兜底（summary-only/*-fallback），练习建议是学习者向占位，后台不原样展示 */
  wrapupDegraded: boolean
  /** 评估失败：wrapup.sources.evaluation 非 model（failed / unavailable） */
  wrapupEvalFallback: boolean
  advisory: OpsAdvisoryLike | null
  progress: SessionProgress | null
  /** #105 收束观测（后端统一口径）：该会话任务完成事件的轨道/通道；null = 无收束记录 */
  closure: { track: string; completionSource: string } | null
}

const rows = ref<Row[]>([])
const refreshing = ref(false)
const loadFailed = ref(false)

/* 列表拉取上限：文案与实现共用同一常量，避免再次漂移
   （此前文案写「最近 100 条」而实现是 limit: 1000 —— 审计 附 A #9） */
const LIST_LIMIT = 1000

/* 终态集合：只有终态（completed/failed/timeout/discarded/finalization_failed）会话
   才适用「缺总结」口径；initializing/active/paused/finalizing 等非终态总结尚未到
   生成时机，缺失是正常过程态（此前把进行中会话也算「缺总结」，页头恒 warn、
   pill 计数虚高 —— P1） */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'timeout', 'discarded', 'finalization_failed'])
const isTerminal = (s: string) => TERMINAL_STATUSES.has(s)

/* 列表真实总量（后端 body.total）：达 LIST_LIMIT 上限时用于真实截断提示 */
const listTotal = ref(0)
/* 后端是否真的返回了 total：false 时卡头 meta 的「共 N」退化为已加载窗口行数 */
const totalFromBackend = ref(false)
/* 「只看有建议」服务端过滤（评审 §5 可点穿）：接 adminApi 既有 onlyWithAdvisory 参数 */
const onlyAdvisory = ref(false)
const truncated = computed(() => rows.value.length >= LIST_LIMIT)

/* 请求代际号（2026-10-06 审核 F2-3，判例 GoalConversations.statsReqSeq）：
   本页列表接口实测可滞后数秒，且 20s 轮询与口径切换/手动刷新会并发；
   代际比对确保只有最新一笔写回 rows/总数，迟到的旧口径响应不得覆盖新口径。 */
let fetchSeq = 0

/* 静默拉取：成功即整表替换；失败保留旧数据（轮询不闪空态），并标记错误条。
   force = true 绕过页面级 TTL 缓存（显式刷新/口径切换/轮询用） */
async function fetchRows(force = false): Promise<boolean> {
  // 页面级 TTL 缓存：切换页面回来时跳过重复请求（轮询/显式刷新传 force 不受影响）
  if (!force && isPageCacheFresh('teaching-sessions') && rows.value.length) return true
  const seq = ++fetchSeq
  try {
    const res = await adminTeachingSessionsApi.list({
      limit: LIST_LIMIT,
      ...(onlyAdvisory.value ? { onlyWithAdvisory: true } : {})
    })
    // 已有更新的一笔在途/已回写 → 丢弃本笔（防旧口径覆盖新口径）
    if (seq !== fetchSeq) return true
    const body = res.data?.data ?? res.data ?? {}
    const items = body.items || []
    rows.value = items.map((s: Record<string, unknown>) => mapRow(s))
    /* 后端总量：达上限时给「共 N 条 · 仅显示最近 LIST_LIMIT 条」的真实截断提示（此前前端未用）。
       后端未回 total（非法/缺失）时兜底为窗口行数，且 totalFromBackend=false 禁止「全量」措辞 */
    const total = Number(body.total)
    totalFromBackend.value = Number.isFinite(total) && total > 0
    listTotal.value = totalFromBackend.value ? total : rows.value.length
    loadFailed.value = false
    markPageFetched('teaching-sessions')
    return true
  } catch {
    if (seq === fetchSeq) loadFailed.value = true
    return false
  }
}

/** 「只看有建议」toggle：服务端过滤切换后必须强制重拉（绕过 TTL 缓存） */
async function toggleOnlyAdvisory() {
  onlyAdvisory.value = !onlyAdvisory.value
  refreshing.value = true
  try {
    await fetchRows(true)
  } finally {
    refreshing.value = false
  }
}

async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await fetchRows(true)
  } finally {
    refreshing.value = false
  }
}

/* G4：停留页面时静默轮询，避免状态过期（setTimeout 链 + 并发守卫 + 指数退避）。
   轮询传 force 绕过 TTL 缓存，保证每次 tick 都真实拉取；
   immediate:false —— 首拉由下方 watch 负责，避免同帧重复请求 */
const { start: startPolling } = useSafePolling(
  async () => { await fetchRows(true) },
  {
    interval: 20000,
    maxBackoff: 120000,
    circuitBreakerThreshold: 5,
    skipWhenHidden: true,
    immediate: false,
  }
)

watch(
  () => dataSource.value,
  async () => {
    refreshing.value = true
    try {
      const ok = await fetchRows()
      if (!ok) rows.value = []
    } finally {
      refreshing.value = false
    }
    // 首拉完成后再启动静默轮询（immediate:false，不会与首拉重复请求）
    startPolling()
  },
  { immediate: true }
)

/* 顶栏刷新（全站唯一刷新钮）：轮询之外的一次显式重拉 */
watch(liveRefreshSeq, () => { void fetchRows(true) })

/** 用户名兜底：userName → 邮箱前缀 → 「用户 ·尾4位」（不把裸 cuid 显示给运营） */
function displayName(s: Record<string, unknown>): string {
  const name = String(s.userName || '').trim()
  if (name) return name
  const email = String(s.email || '').trim()
  if (email && email.includes('@')) return email.slice(0, email.indexOf('@')) || email
  const uid = String(s.userId || '').trim()
  return uid ? `用户 ·${uid.slice(-4)}` : '用户'
}

/** 用户格 → 学习者详情（2026-10-18 用户走查：三处列表都没有这个入口） */
function openLearner(userId: string) {
  const id = String(userId || '')
  if (id) openSubPage('learner', id)
}
/** 头像 tone（同 GoalConversations 判例；与全站身份色一致：虚拟=紫 / 测试=琥珀 / 真实=默认蓝） */
function avatarTone(r: Pick<Row, 'isVirtualLearner' | 'isTestAccount'>): 'virtual' | 'test' | 'default' {
  return r.isVirtualLearner ? 'virtual' : r.isTestAccount ? 'test' : 'default'
}

/* ===== 完成方式列（#105 读侧接入）=====
   方式/轨道来自后端统一收束观测（closure），不是本页自算；无记录展示「—」，
   不用用户身份字段回填（回填/猜测正是 #105 要消灭的分叉口径）。
   文案字典单源在 statusText.ts（closureSourceText），与总览「完课量」KPI 共用。 */

/* ===== 课堂类型列（2026-10-21）=====
   复习课 / 延伸课不结算任务，列表原先与正课无法区分；类型读自 teaching_sessions.mode。
   文案/徽章单源在 statusText.ts（学习者详情页共用）。 */

function mapRow(s: Record<string, unknown>): Row {
  const wrapup = (s.wrapup as Record<string, unknown>) || null
  const summary = (wrapup?.summary as WrapupSummary) || null
  /* 后端 ReplanAdvisory：{shouldSuggest, priority, recommendation, scope, rationale, reasonCodes,
     learnerResponse:{action,at}, ui:{title,body,options}}；ui.* 是学员端文案，这里只留运营要用的
     字段（处置态/原因/范围），措辞由 statusText.advisoryOps* 单点给出 */
  const rawAdvisory = (s.advisory as Record<string, unknown>) || null
  const advisory = rawAdvisory
    ? {
        priority: String(rawAdvisory.priority || ''),
        recommendation: String(rawAdvisory.recommendation || ''),
        scope: String(rawAdvisory.scope || ''),
        reasonCodes: Array.isArray(rawAdvisory.reasonCodes) ? rawAdvisory.reasonCodes.map(String) : [],
        rationale: String(rawAdvisory.rationale || ''),
        learnerResponse: (rawAdvisory.learnerResponse as OpsAdvisoryLike['learnerResponse']) || null,
        ui: (rawAdvisory.ui as OpsAdvisoryLike['ui']) || null
      }
    : null
  const advisoryRelevant = !!advisory && rawAdvisory?.shouldSuggest !== false && !['none', ''].includes(advisory.priority)
  const wrapupStatus = wrapup?.status === 'complete' ? 'complete' : 'missing'
  const rawPracticeAdvice = String(summary?.practiceAdvice || '')
  const wrapupDegraded = isDegradedWrapup(wrapup, rawPracticeAdvice)
  /* 评估来源：artifact.sources.evaluation（session-wrapup 落库形状）；兼容顶层 evaluationSource。
     只有明确记为 model 才算评估成功——缺来源字段的老产物不猜。 */
  const wrapupSources = (wrapup?.sources as Record<string, unknown>) || null
  const evalSource = String(wrapupSources?.evaluation ?? wrapup?.evaluationSource ?? '')
  const wrapupEvalFallback = !!wrapup && evalSource !== '' && evalSource !== 'model'
  const attention: Row['attention'] =
    s.status === 'failed' || s.status === 'timeout' || (s.status === 'completed' && wrapupStatus === 'missing')
      ? 'high'
      : advisoryRelevant && advisory?.priority === 'high'
        ? 'high'
        : advisoryRelevant
          ? 'medium'
          : 'low'
  /* #105 收束观测：后端字段直通；缺失/空对象按「无收束记录」null（模板走中性「—」） */
  const rawClosure = (s.closure as Record<string, unknown>) || null
  return {
    /* s.id 缺失不得拼出 "undefined"（控制台按钮/抽屉标题已由 v-if="r.id" 守卫） */
    id: s.id ? String(s.id) : '',
    userId: String(s.userId || ''),
    /* 兜底不展示裸 cuid：主题回「未命名会话」；用户缺失降级邮箱前缀 → 「用户 ·尾4位」 */
    topic: String(s.topic || '未命名课堂'),
    subject: String(s.subject || '—'),
    taskType: String(s.taskType || ''),
    mode: String(s.mode || 'tutor'),
    userName: displayName(s),
    email: String(s.email || ''),
    isVirtualLearner: !!s.isVirtualLearner,
    isTestAccount: !!s.isTestAccount,
    status: String(s.status || ''),
    endReason: s.endReason ? String(s.endReason) : null,
    duration: Number(s.duration || 0),
    messageCount: Number(s.messageCount || 0),
    knowledgePointCount: Number(s.knowledgePointCount || 0),
    wrapupStatus,
    hasAdvisory: advisoryRelevant,
    attention,
    startAt: timeAgo(String(s.startTime || '')),
    startTime: s.startTime ? String(s.startTime) : undefined,
    wrapup: summary,
    wrapupDegraded,
    wrapupEvalFallback,
    advisory,
    progress: (s.progress as SessionProgress) || null,
    closure: rawClosure
      ? { track: String(rawClosure.track || 'legacy'), completionSource: String(rawClosure.completionSource || 'unknown') }
      : null
  }
}

/* 筛选 */
const pill = ref('all')
const keyword = ref('')
const statusFilter = ref('')
const modeFilter = ref('')
const dateFilter = ref('')
/* 总结筛选（degraded / eval-failed / missing）：总览「评估失败」「降级总结」的落地入口 */
const wrapFilter = ref('')
/* 筛选弹层（课堂 / 时间两个下拉）：表前只留一行，放不进主栏的次级筛选收在这里。
   Esc 关闭走共享 useEscape（与 用户与学习者 同一外壳 .mk-adv*） */
const advOpen = ref(false)
useEscape(() => advOpen.value, () => { advOpen.value = false })
/** 弹层里生效的筛选数：触发钮上标出来，收起来也不丢状态（0 = 不标） */
const advCount = computed(() => (modeFilter.value ? 1 : 0) + (dateFilter.value ? 1 : 0))

/* P1-3 列显隐（公共组件 MkCols）：除课堂/操作外都可隐藏。
   2026-10-22 用户「信息噪点太多了需要优化，可能要拿掉一些列」：默认只留
   课堂 / 用户 / 状态 / 时长 / 进度 / 产物 / 开始时间 / 操作 八列——
   · 完成方式：真实视角绝大多数行是「—」，逐条通道在详情/座舱里看；
   · 消息、知识点：条数读数与「时长 + 进度」重复，且「N 个」本身不可行动；
   · 关注：高/中/低三档在真实数据里近乎恒定，页头「需关注」KPI 与 chips 已承担分诊。
   四项都留在「列」菜单里可随时打开（升存储键 v2，旧本地配置不覆盖新默认）。 */
const TS_DEFAULT_HIDDEN = ['track', 'messages', 'knowledge', 'attention'] as const
const tsColDefs = [
  { key: 'user', label: '用户' },
  { key: 'status', label: '状态 / 进度' },
  { key: 'mode', label: '课堂' },
  { key: 'track', label: '完成方式' },
  { key: 'duration', label: '时长' },
  { key: 'messages', label: '消息' },
  { key: 'knowledge', label: '知识点' },
  { key: 'output', label: '课后总结' },
  { key: 'attention', label: '关注' },
  { key: 'start', label: '开始时间' },
] as const
const tsHiddenCols = ref<Set<string>>(new Set<string>(TS_DEFAULT_HIDDEN))
/* 首载骨架列数 = 当前可见列数（+操作列），避免骨架到真表横向跳一格 */
const tsVisibleColCount = computed(() => 1 + tsColDefs.filter((c) => !tsHiddenCols.value.has(c.key)).length)
/* 宽度分三档（auto 布局会把缺口全压给带 ellipsis 的身份列，只能靠减列）：
   · <1440（isTableCompact）：「会话」在 1280 只剩 113px、用户 89px，默认收起需求最小、
     信息含量也最低的「开始时间 / 关注」（96+58px）。该阈值沿用 2026-10 的判例
     （1366/1400 会话列 167/187px，仍不够）。
   · <1500（isTableNarrow）：#105 的「完成归属」与「关注」也收起（+83/+58px）。前者是
     可显隐列（MkCols），收起不丢数据——该档仍有「消息」「时长」，逐条归属可在 ≥1500 视口查看；
     后者只有高/中/低三档，是这几列里信息密度最低的一列。
   · <1700（isTableMid）：知识点一列收起。1600 实测同时出现会把会话列挤到 99px；读数仍在
     「消息」列的说明文字里（interactTitle），信息不丢。
   实测（2026-10-21 归属合列后）：归属只占一列，原先「完成方式」那 88px 还给表宽，1600 档
   不再需要为它减列。与 VirtualLearners 的 useIsNarrow 同一先例（窄档勾了「列」也不显，
   行详情进座舱，信息不丢）。 */
const isTableCompact = useIsNarrow(1439)
const isTableNarrow = useIsNarrow(1499)
const isTableMid = useIsNarrow(1699)
/* 焦点 chips（2026-10-05：计数升 KPI 面板后本组退为纯筛选开关——学习状态判例：
   KPI 孪生 pill 不再显数）。「进行中」保留计数：它是 active 单状态口径，分布卡
   「进行中」是四状态合并档，两个数互为唯一来源；「全部」不显数 = 卡头 meta 的已加载行数。
   历史教训：pill 与页头状态条曾各算一遍「高关注」，口径不同（attention==='high' vs
   !=='low'）致数字打架，该状态条计数已删。 */
const pills = computed(() => {
  const all = rows.value
  return [
    { id: 'all' as const, label: '全部', count: undefined as number | undefined },
    {
      id: 'active' as const,
      label: '进行中',
      count: all.filter((r) => r.status === 'active').length
    },
    /* 2026-10-16 KPI 审计补完：本页 KPI 叫「需关注」、这枚筛选 chip 叫「待关注」，同一件事两个词。
       全站「需关注」42 处、「待关注」7 处，按多数统一为「需关注」（id 不变，筛选口径不受影响）。 */
    { id: 'attention' as const, label: '需关注', count: attentionCount },
    { id: 'missing' as const, label: '缺总结', count: missingWrapupCount }
  ]
})
/* 状态筛选选项（对齐后端枚举：initializing/active/paused/timeout/superseded/failed/finalizing/finalization_failed/completed/discarded） */
const statusOptions = [
  { value: 'initializing', label: '初始化中' },
  { value: 'active', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'timeout', label: '超时' },
  { value: 'superseded', label: '已被替代' },
  { value: 'failed', label: '失败' },
  { value: 'finalizing', label: '收尾中' },
  { value: 'finalization_failed', label: '收尾失败' },
  { value: 'completed', label: '已完成' },
  { value: 'discarded', label: '已废弃' }
]

/* 卡头异常 badge：失败/收尾失败/超时合计（与进度列中断态、时间线失败/超时的排查口径一致） */
const ABNORMAL_STATUSES = new Set(['failed', 'finalization_failed', 'timeout'])
const abnormalSessionCount = computed(() =>
  rows.value.filter((r) => ABNORMAL_STATUSES.has(r.status)).length
)
/* 异常 badge 可点穿（评审 §5）：点击 = 异常状态多选筛选（与单选 statusFilter 叠加为 AND）；
   与分布条「异常终态」段的差别：chip 可与其它筛选叠加 + 承载异常堆积告警（阈值转红），
   分布条段 = 互斥切片（一次只看一组）。 */
const abnormalOnly = ref(false)

/* ===== 完结率（2026-10-17 分布带退役后从带副文迁入 KPI）=====
   口径 = 已加载会话窗口（rows，最近 LIST_LIMIT 条），非后端全量；后端两位小数的
   46.15% 在这里四舍五入成 46%，避免小样本假精度。 */
const completionRate = computed(() => {
  const total = rows.value.length
  if (!total) return '—'
  return `${Math.round((rows.value.filter((r) => r.status === 'completed').length / total) * 100)}%`
})

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const {
  toggle: toggleTsSort, sortState: tsSortState, sortRows: sortTsRows,
  sortKey: tsSortKey, sortDir: tsSortDir, reset: resetTsSort, isDefault: tsSortIsDefault
} = useTableSort<Row>({
  accessors: {
    topic: (r) => r.topic,
    user: (r) => r.userName,
    status: (r) => r.status,
    interact: (r) => r.duration,
    start: (r) => r.startTime || r.startAt
  },
  storageKey: 'wf_teaching_sessions_sort'
})

const filtered = computed(() => {
  let list = rows.value
  if (pill.value === 'active') list = list.filter((r) => r.status === 'active')
  if (pill.value === 'attention') list = list.filter((r) => r.attention !== 'low')
  if (pill.value === 'missing') list = list.filter(isMissingWrapup)
  if (abnormalOnly.value) list = list.filter((r) => ABNORMAL_STATUSES.has(r.status))
  if (statusFilter.value) {
    list = list.filter((r) => r.status === statusFilter.value)
  }
  if (wrapFilter.value) {
    list = list.filter((r) => matchesWrapFilter(r, wrapFilter.value))
  }
  if (modeFilter.value) {
    list = list.filter((r) => (r.mode || 'tutor') === modeFilter.value)
  }
  if (dateFilter.value === '7d' || dateFilter.value === '30d') {
    const cutoff = Date.now() - (dateFilter.value === '7d' ? 7 : 30) * 86400000
    list = list.filter((r) => {
      if (!r.startTime) return true // 无时间戳的行不拦截
      const t = new Date(r.startTime).getTime()
      return Number.isFinite(t) && t >= cutoff
    })
  }
  const q = keyword.value.trim().toLowerCase()
  if (q) list = list.filter((r) => `${r.topic} ${r.userName} ${r.email} ${r.id}`.toLowerCase().includes(q))
  return sortTsRows(list)
})

/** 总结筛选三档：降级总结（兜底来源）/ 评估失败（evaluation 非 model）/ 缺总结（终态无产物） */
function matchesWrapFilter(r: Row, key: string): boolean {
  if (key === 'degraded') return r.wrapupDegraded
  if (key === 'eval-failed') return r.wrapupEvalFallback
  if (key === 'missing') return isMissingWrapup(r)
  return true
}

const isFiltered = computed(() => pill.value !== 'all' || abnormalOnly.value || !!statusFilter.value || !!wrapFilter.value || !!modeFilter.value || !!dateFilter.value || !!keyword.value.trim() || onlyAdvisory.value)
function clearFilters() {
  const hadOnlyAdvisory = onlyAdvisory.value
  pill.value = 'all'
  abnormalOnly.value = false
  statusFilter.value = ''
  wrapFilter.value = ''
  modeFilter.value = ''
  dateFilter.value = ''
  keyword.value = ''
  /* 「有建议」是服务端过滤参数：只改本地不生效，需强制重拉（绕过 TTL 缓存） */
  if (hadOnlyAdvisory) {
    onlyAdvisory.value = false
    refreshing.value = true
    void fetchRows(true).finally(() => { refreshing.value = false })
  }
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   筛选输入 / 排序变化时回第 1 页：20s 轮询整表替换 rows 也会让 filtered 重算，
   若监听 filtered 会把用户所在页打回第 1 页（P2）——故监听筛选输入与排序而非结果 */
const page = ref(1)
const pageSize = ref(15)

/* 筛选 / 页码 ↔ URL query（2026-10-13 运营走查 O2）：本页是「逐条排查异常会话」的主页面，
   而筛选此前只活在内存里——实测点「异常18」→ 进详情 → 返回（或刷新）都回到全部 167 条，
   逐条看要重筛一遍，也没法把「这批异常」的链接发给同事。与 用户与学习者 / 学习状态 /
   虚拟学习者 / 学习路径 同一组合式单点（learner-profile.ts useListQueryState）。
   焦点 chip、状态组、异常开关、筛选（状态/时间）、有建议开关全部进 URL：
   缺省值不写（URL 短且人可读），空结果也不怕深链缺失。
   必须在下方「筛选变化回第 1 页」的 watch 之前调用：URL 落位要发生在监听建立之前，
   否则挂载时还原出来的筛选会被当成用户改筛选、把还原的页码打回 1（Users.vue 判例）。 */
useListQueryState(
  {
    pill,
    keyword,
    page,
    pageSize,
    allowedPills: ['all', 'active', 'attention', 'missing'],
    extra: [
      { key: 'abn', get: () => (abnormalOnly.value ? '1' : ''), set: (v) => (abnormalOnly.value = v === '1'), allowed: ['1'] },
      {
        key: 'adv',
        get: () => statusFilter.value,
        set: (v) => (statusFilter.value = v),
        allowed: statusOptions.map((o) => o.value)
      },
      { key: 'mode', get: () => modeFilter.value, set: (v) => (modeFilter.value = v), allowed: ['tutor', 'review', 'extension'] },
      { key: 'date', get: () => dateFilter.value, set: (v) => (dateFilter.value = v) },
      { key: 'wrap', get: () => wrapFilter.value, set: (v) => (wrapFilter.value = v), allowed: ['degraded', 'eval-failed', 'missing'] },
      { key: 'advisory', get: () => (onlyAdvisory.value ? '1' : ''), set: (v) => (onlyAdvisory.value = v === '1'), allowed: ['1'] }
    ]
  }
)

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([pill, statusFilter, wrapFilter, modeFilter, dateFilter, keyword, tsSortKey, tsSortDir, abnormalOnly, onlyAdvisory], () => {
  page.value = 1
})

const advisoryCount = computed(() => rows.value.filter((r) => r.hasAdvisory).length)
/* P1：只有终态会话的总结缺失才算运营口径「缺总结」；非终态缺失是过程态（未生成） */
const missingWrapupCount = computed(() => rows.value.filter(isMissingWrapup).length)
const attentionCount = computed(() => rows.value.filter((r) => r.attention !== 'low').length)

/* 总结口径三档（P1）：complete=有总结；终态缺失=缺总结（运营关注，warn）；
   非终态缺失=未生成（总结尚未到生成时机，muted 不做告警）。
   页头基调与「缺总结」pill 同源：missingWrapupCount 只数终态缺失，避免只要有
   进行中会话页头就恒 warn、计数虚高。 */
const wrapupTier = (r: Row): 'complete' | 'missing' | 'pending' =>
  r.wrapupStatus === 'complete' ? 'complete' : isTerminal(r.status) ? 'missing' : 'pending'
const wrapupText = (r: Row) => {
  const t = wrapupTier(r)
  /* 降级总结（#40）：summary-only / fallback 兜底来源与「完全没总结」同档计数，
     但行内文案区分——否则 wrapupDegraded 算出无消费（死数据） */
  return t === 'complete' ? '有总结' : t === 'missing' ? (r.wrapupDegraded ? '降级总结' : '缺总结') : '未生成'
}
const wrapupBadge = (r: Row) =>
  wrapupTier(r) === 'complete' ? 'mk-badge--ok' : wrapupTier(r) === 'missing' ? 'mk-badge--warn' : 'mk-badge--muted'
const isMissingWrapup = (r: Row) => wrapupTier(r) === 'missing'

/* P3（设计评审 4.3-9）：异常态（失败/收尾失败/超时）会话列副行是后端降级模板句
   「本次会话未正常结束，为你保留了基础学习记录。」——与状态徽章同事实且首屏多行同文。
   命中模板句时改显行内已有的增量信息（时长优先，缺时长用开始时间；两者皆缺撤副行不硬凑）。
   后端模板句不动，title 保留降级总结原文供排查。 */
const ABNORMAL_SUMMARY_MARK = '本次会话未正常结束'
/* 会话列副行：只报运营扫表要的两件事——学科 · 任务类型，异常态用时长/开始时间替代。
   课后总结（wrapup.summary.topicSummary）是写给学习者的长句（「本节课围绕…」「为你保留了
   基础总结」），截断到 300px 后既读不全又占行高，2026-10-23 运营视角走查后只留 title 全文。 */
const tsSubNote = (r: Row): { text: string; title?: string } | null => {
  const summary = String(r.wrapup?.topicSummary || '')
  if (!ABNORMAL_STATUSES.has(r.status) || !summary.includes(ABNORMAL_SUMMARY_MARK)) return null
  /* 2026-10-24：异常行副行不再复述「时长 N」——右侧已有独立时长列，同值同屏两遍；
     只有没有时长读数时才退回开始时间（那是时长列给不出的信息）。 */
  if (r.duration > 0) return null
  if (r.startAt) return { text: `开始于 ${r.startAt}`, title: '异常会话：此处显示开始时间' }
  return null
}

/** 会话列副行文案（#39 行高并档）：学科 · 任务类型 [+ 异常态替代] */
function sessionSubText(r: Row): string {
  const base = `${r.subject} · ${taskTypeText(r.taskType)}`
  const note = tsSubNote(r)
  return note ? `${base} · ${note.text}` : base
}
/** 会话列副行 title：任务类型原文 + 课后总结全文（副行不再承载学员向长句，全文退到悬停） */
function sessionSubTitle(r: Row): string | undefined {
  const summary = String(r.wrapup?.topicSummary || '')
  const parts = [taskTypeTitle(r.taskType), tsSubNote(r)?.title]
  if (summary && !tsSubNote(r)) parts.push(`课后总结：${summary}`)
  const kept = parts.filter(Boolean)
  return kept.length ? kept.join('；') : undefined
}

/* 异常堆积告警（原页头状态条 mk-status--bad 的同一判据，2026-10-04 状态条退役后迁往
   工具条右组「异常」chip）：失败 / 收尾失败 / 超时合计 ≥ TS_BAD_THRESHOLD → chip 转红，
   阈值在 chip title 披露（告警条件化纪律：着色必须带阈值）。
   原 warn / ok / muted 三档只服务状态条底色，随状态条一并退役——彼时 warn 的
   「终态缺总结 / 待关注」信号由缺总结 / 待关注 chips 的计数直接可见，不靠底色转译。 */
const TS_BAD_THRESHOLD = 10
const abnormalHeap = computed(() => abnormalSessionCount.value >= TS_BAD_THRESHOLD)

const route = useRoute()
const router = useRouter()
/* G5（2026-10-10）：深链未命中由常驻 alert 横幅改为一次性 toast——判例 GoalConversations
   ?goal= 未命中（toast.warning），两页行为归一；此前横幅无关闭出口，?session= 不清就永久挂着。
   missToasted 仅作去重：本 watch 同时监听 rows.length，翻页/轮询回填会重复进未命中分支，
   不能每次都弹；?session= 被清或命中后复位，下次深链未命中可再提示。 */
let missToasted = false
/* ?session= 语义（2026-10-01 对齐原型习惯：会话行 → 二级详情页，不再开抽屉）：
   深链直达座舱只读监控（session-real），随后清掉查询参数避免与座舱返回冲突 */
watch(
  // 同时监听行数：刷新场景下 immediate 触发时 rows 尚未返回，仅监听 query 会错过恢复时机
  [() => route.query.session, () => rows.value.length],
  ([sid]) => {
    const id = typeof sid === 'string' ? sid : ''
    if (!id) { missToasted = false; return }
    const r = rows.value.find((x) => x.id === id)
    if (r) {
      missToasted = false
      openSubPage('session-real', id)
      const q = { ...route.query }; delete q.session
      void router.replace({ query: q })
    } else if (rows.value.length > 0 && !missToasted) {
      missToasted = true
      // 明示而非静默忽略：可能超出最近 LIST_LIMIT 条或已被删除（文案对齐 GoalConversations）
      toast.warning(`未能定位该会话：可能不在最近 ${LIST_LIMIT} 条内，或已被删除`)
    }
  },
  { immediate: true }
)
/** 座舱跳转族收尾：清理 URL 深链（?session=）是唯一动作 */
function closeDetail() {
  const q = { ...route.query }; delete q.session; void router.replace({ query: q })
}

/** 真实教学会话与控制台数据契约不兼容（座舱仅服务虚拟会话）：轻量深链 = 学习者详情 / 只读座舱。
    链路（Trace 按 sessionId 归组）行内入口已下线（2026-10-19 用户拍板：工程排查面不进运营列表），
    故这里不再取 goTrace。 */
const { goConsole } = useSessionDrill(closeDetail)

/** 行点击落点：缺总结的课堂直接落座舱总结页签（否则默认页签看不到该处理的东西） */
function openRow(r: Row) {
  if (!r.id) return
  if (isMissingWrapup(r)) {
    closeDetail()
    openSubPage('session-real', r.id, { stage: 'wrapup' })
    return
  }
  goConsole(r)
}

/* 状态映射统一走共享字典（对齐后端枚举：initializing/active/paused/timeout/superseded/failed/finalizing/finalization_failed/completed/discarded） */
/* 状态徽章已上收共享单源 statusText.sessionStatusBadgeCls（收尾批 C10，import 别名 statusBadge——语义逐值等价迁移） */
/* 建议徽章带优先级色（T3）：high=bad / medium=warn / 其余 info */
/* 任务类型字典已上收共享单源 statusText.ts（F2-2：路径详情同批枚举不再各自维护一份） */
/* 时长格式化。后端 duration 的单位是**分钟**（computeEffectiveDurationMinutes = ms/60000），
   不是秒——原先按秒解释，3 分钟的课在列表里显示成「3 秒」（2026-10-20 跑数时发现）。
   1 分钟以内后端已封底为 1，这里只需要「N 分钟 / N 小时 M 分」两档。 */
const fmtDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}
/** 时间列悬停：本地化绝对时刻（后端原始 ISO 为 UTC 带 Z，直出跨时区读不出真实时刻——审核 #38） */
function startAbsTitle(r: Row): string | undefined {
  if (!r.startTime) return r.startAt || undefined
  const t = new Date(r.startTime).getTime()
  return Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : r.startAt || undefined
}
/** 长时阈值（分钟）：≥25 分钟标琥珀；阈值写进时长列 title 与表头披露 */
const IDLE_LONG_MINUTES = 25
/** 时长 / 消息 / 知识点共用的悬停读数：拆列后知识点在窄档不占列宽，读数仍可查 */
function interactTitle(r: Row): string | undefined {
  if (!r.duration) return undefined
  const parts = [`时长 ${fmtDuration(r.duration)}`, `${r.messageCount} 条消息`]
  if (r.knowledgePointCount) parts.push(`${r.knowledgePointCount} 个知识点`)
  if (r.duration >= IDLE_LONG_MINUTES) parts.push(`≥ ${IDLE_LONG_MINUTES} 分钟按长时标注`)
  return parts.join(' · ')
}
/** 进度工具提示（人话）：阶段 n/m · 任务 x/y；无里程碑维度只给任务 */
/** 进度工具提示（人话）：阶段 n/m · 第 x 个任务（共 y 个）。
 *  写成「第 x 个」而不是「任务 x/y」，是因为后端 taskIndex 是**位置**不是完成数——
 *  「任务 1/4」容易被读成「4 个里做完了 1 个」。 */
function progressTitle(r: Row): string {
  // 措辞单源在 statusText.sessionProgressTitle：taskIndex=0（结束时还没定位到具体任务）
  // 不能 clamp 成「第 1 个」——同一行的可见文本写的是「停在 0/4」，两处互相打脸
  return sessionProgressTitle(r.progress, { withMilestone: true })
}
/** 状态 / 进度合并列的定位短语：只说停在哪一格；结果（完成/中断/超时）由左侧徽章承担，
    不再用「结束于 / 中断于」把同一件事说两遍（2026-10-23 用户走查）。 */
function progressStopText(r: Row): string {
  const p = r.progress
  if (!p || !Number.isFinite(p.totalTasks) || p.totalTasks <= 0) return ''
  const pos = `${Math.min(Math.max(p.taskIndex, 0), p.totalTasks)}/${p.totalTasks}`
  return `停在 ${pos}`
}

/* 宿主刷新联动（学习会话合并宿主「刷新」按钮 → refreshNow） */
defineExpose({ refreshNow })
</script>

<style scoped>/* 嵌入模式（宿主学习会话页 flex 列内）：占满剩余高度，表格区内滚（对齐 oc-embedded 先例） */
/* 首载占位（#44）：等比 MkKpi 卡一排（16px 内边距 + 三行内容 ≈ 114px）。
   2026-10-17 分布带退役，原 ts-skel-distband 占位随之下线 */
.ts-skel-kpi { height: 114px; border-radius: var(--mk-radius-xl); }
.ts-embedded { flex: 1; min-height: 0; overflow: hidden; }/* 总结预览行（P1-2）：副行语义走 .mk-cell-sub（截断/灰阶原语承担）；页私有只留 help 悬停。
   2026-10-14 用户质询「怎么会有 emoji」：原 ::before 给副行加了个记事本 emoji 前缀，且对所有带
   topicSummary 的行生效——包括异常会话那条降级替代文案（显示的是兜底读数「开始于 …」，加总结
   前缀更不符）。管理端不用 emoji（判例 AchIcon：2026-09-14 摘除后端成就图标那批，改色块 + 首字标）。
   去掉前缀，信息由文案本身与 title 承担。 */
.ts-summary { cursor: help; }
/* 行首关注度色条已撤（2026-10-03 用户拍板：与「关注」列同源冗余、语义不可发现）；
   关注度由「关注」列（高/中/低 色字 + title）单源承载 *//* 关注度列：小色点 + 文字（从徽章降级，不占徽章位） */
.ts-att { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); white-space: nowrap; }.ts-att--high { color: var(--mk-red); }.ts-att--medium { color: var(--mk-amber); }.ts-att--low { color: var(--mk-faint); }
/* 固定列宽（2026-10-22 用户「翻页不同页码时候，列宽怎么还在变呢」）：auto 布局下
   课堂/用户两列按当页最长内容分宽（课堂 135→340px、用户 169→256px），翻页整表跳动。
   fixed 档下按表头宽度定死，余量按各列宽度权重摊开；断点与 isTableCompact/Narrow/Mid
   的列显隐对齐，隐藏列的宽度不参与分配。 */
/* 2026-10-24 视觉修复：状态（204）/课后总结（190）/开始时间（92）在多数行是短内容，
   富余宽度让给课堂主列；状态列仍够放下「已完成 + 停在 x/y」一行。 */
.ts-c-user { width: 150px; }
.ts-c-status { width: 150px; }
.ts-c-track { width: 84px; }
.ts-c-dur { width: 74px; }
.ts-c-msg { width: 66px; }
.ts-c-kp { width: 62px; }
.ts-c-mode { width: 88px; }
.ts-c-out { width: 150px; }
.ts-c-att { width: 50px; }
.ts-c-start { width: 80px; }
/* 课堂列宽度随断点给基准值，余量由 fixed 布局按各列宽度权重摊开（不再是单列吃掉全部余量，
   否则 1920 下课堂列 ~480px、右侧留大片空白）；断点与列显隐对齐：
   ≤1439 八列 / 1440-1499 九列 / 1500-1699 十一列 / ≥1700 十二列。 */
.ts-c-topic { width: 190px; }
/* 1200 档（125% 缩放的 1440 屏）也要无横滚：八列合计须 ≤914，短列同步收一点 */
@media (max-width: 1279px) {
  .ts-c-topic { width: 260px; }
  .ts-c-user { width: 140px; }
  .ts-c-status { width: 150px; }
  .ts-c-dur { width: 72px; }
  .ts-c-msg { width: 64px; }
  .ts-c-out { width: 150px; }
}
/* 1280 起默认只显示 7–8 列（完成方式/消息/知识点/关注已默认收起）：
   课堂列是主标识列，优先吃足宽度；状态/总结/开始时间等短列让位。 */
@media (min-width: 1280px) { .ts-c-topic { width: 330px; } }
@media (min-width: 1440px) { .ts-c-topic { width: 330px; } }
@media (min-width: 1500px) { .ts-c-topic { width: 300px; } }
@media (min-width: 1700px) { .ts-c-topic { width: 300px; } }
/* 课堂列吸收余量后可能远超 .mk-cell-main 的 300/360 上限，让文本跟着列宽走（否则右侧留空白） */
.ts-c-topic .mk-cell-main strong, .ts-row td:first-child .mk-cell-sub { max-width: 100%; }
/* 固定列内不允许内容越界挤压邻列（徽章/按钮按内容裁切，悬停 title 仍在） */
.ts-table td { overflow: hidden; }
/* 用户格（对齐 Users.ul-user / GoalConversations.gc-user 头像判例）：头像 + 主副行 */
.ts-user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ts-user .mk-cell-main { min-width: 0; flex: 1; }
/* 筛选弹层里的字段（标签在上、控件在下；外壳 .mk-adv* 是共享原语） */
/* 会话列副行上限 300px（原 387px 由 sub 行撑开；主行 260px 由 --mk-cell-main-max 兜底） */
.ts-row td:first-child .mk-cell-sub { max-width: 300px; }/* 原型 .tbl td：nowrap（表格为 fixed，列宽由表头决定；
   长内容由 .ts-summary-preview / .mk-cell-main / .mk-cell-sub 的 max-width 截断兜底）。
   2026-10-05 CM6：收敛为全局修饰类 .mk-table--nowrap（表元素已挂该 class），本页不再私持拷贝 *//* 进度列：数字 x/y + 迷你条（mk-minibar 复用，会话域统一进度表达） */
/* 互动列（批B）：时长主值+副行。副行 messageCount/知识点 nowrap 撑到 109px 溢出 70px 单元格、
   压到「进度」列（走查 #37）：容器限宽到单元格内宽并裁切，副行由 mk-cell-sub 自带省略号截断 */
/* 完成归属列（#105 读侧接入）：徽章（真实 / 虚拟 / 未标记）+ 通道副行垂直两行（同 .ts-ia 判例）。
   .ts-track / .ts-ia / .ts-status 这些 display:grid|flex 的容器一律是 td 内层 div：
   直接挂在 td 上会让表格单元脱离表格布局，整行塌成竖排（2026-10-19 实测行高 271px、
   各格错位）。改列时只动 td 的 v-if，别把类挪回 td。 */
.ts-track { display: grid; gap: 2px; justify-items: start; }
.ts-ia { display: grid; gap: 2px; justify-items: start; max-width: 100%; min-width: 0; overflow: hidden; }.ts-ia > * { min-width: 0; max-width: 100%; }/* 时长格：容器别再裁主值（2026-10-21 用户「时长被截断」：td 81px / 内容盒 49px /「27 分钟」53px，
   被 overflow:hidden 切掉 4px）。.ts-ia 的 min-width:0 + overflow:hidden 本是给副行省略号用的，
   主值只有 4~6 个字，让回 max-content，auto 布局才会按字宽给这列留位 */
.ts-ia--dur { overflow: visible; }.ts-ia--dur > .ts-ia__dur { min-width: max-content; max-width: none; white-space: nowrap; }.ts-ia__dur { font-variant-numeric: tabular-nums; font-weight: 700; }.ts-ia__dur--long { color: var(--mk-amber); }/* 状态 / 进度合并列（2026-10-23）：位置短语只占一行原地文字，不再配迷你条；
   结果由左侧徽章着色（完成绿 / 超时红 / 暂停琥珀），条与文字同说一件事。 */
.ts-prog { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-muted); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: help; }/* 异常堆积（合计 ≥ 阈值）chip 转红：原状态条 mk-status--bad 的同一告警，阈值在 chip title 披露。
   选中态（筛选生效中）由模板守卫——abnormalOnly 时不再加本类，让位给 .mk-pill--active 的蓝 */
/* 分布带已退役（2026-10-17）：原页面级 .ts-distband 与类名一并下线，状态筛选在卡头 chips
   与「筛选」下拉；页面级间距仍由 .mk-page 的 --mk-stack-gap 统一供 */
.ts-abn-chip--heap {
  color: var(--mk-red);
  border-color: color-mix(in srgb, var(--mk-red) 45%, var(--mk-line));
}/* 状态徽章：固定最小宽度，筛选不同状态时列宽不跳动（"已被替代"最长 4 字）。
   锚点用稳定类 .ts-status（2026-10-06 审核 #37）：原 td:nth-child(3) 在用户列被
   隐藏后失配（状态列变第 2 个 td），切换状态筛选时列宽照样跳动——正是本规则要防的。
   该类挂在 td 内层 div 上（display:flex 不能挂 td，见上方 .ts-track 注释）。
   68px = 4 字 × micro 档 + 徽章内边距，容得下最长档。
   只给主状态徽章（.ts-status__main）：标注徽章（低参与 / 手动结束）是内容宽，
   套上 68px 会把「低参与 + 手动结束」撑到 ~150px，把状态列拉宽又没换来任何对齐。 */
.ts-status { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: 100%; }.ts-status .ts-status__main { min-width: 64px; justify-content: center; }/* 可点异常徽章已迁工具条右组「异常」chip（2026-10-04 分布卡退役后两度搬家，ts-badge-toggle 随撤） *//* 建议徽章：行内直出建议标题（首行预览），超长 ellipsis 截断、hover 看全文（title）。
   badge 本体 inline-flex，截断由内层文本节点承载（flex 项 overflow!=visible → min-width 归 0 可收缩） */
/* 产物格：两枚徽章在固定列宽内换行（不再靠 margin-left 贴前一枚） */
.ts-out { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.ts-adv-badge { max-width: 96px; }.ts-adv-badge__txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }/* 加载失败错误条：形态回归共享 .mk-alert--row（红底/字号/按钮形态），页私有只留外边距 */
.ts-error { margin: 0 16px 10px; }/* 状态分布卡已退役改 buckets 构成带（2026-10-04，共享原语 MkBuckets；stageband 原语留仍用页）。
   4K：抽屉加宽 + 字号跟随壳层放大（置于基础样式之后确保覆盖） */
@media (min-width: 2000px) {
}/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
}

</style>
