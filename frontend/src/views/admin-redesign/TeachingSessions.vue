<template>
  <div :class="embedded ? 'mk-page--fill ts-embedded' : 'mk-page mk-page--fill'">
    <!-- 教学会话页头（newui/admin pagehead：页名 + 刷新上移；embedded 由宿主承载，本组件不渲染页头）。
         状态条 = 原型 .statusbar 结构（结论粗体 + 分隔线 + meta 串 + 右侧快捷筛选钮），
         也是本页唯一统计带（2026-10-02 用户拍板「新UI没有第二个kpi区」撤 KPI 栅格）：
         meta 只放别处没有的计数——总数=后端全量口径（分布卡/列表都是加载窗口）、
         有建议=全页唯一出口；已完成/失败/进行中由分布卡图例单源承载，不在两处复读 -->
    <MkPageHead v-if="!embedded" title="教学会话" sub="会话状态实时监视 · 状态分布与需关注识别">
      <template #actions>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="refreshing" @click="refreshNow">
          {{ refreshing ? '刷新中…' : '刷新' }}
        </button>
      </template>
    </MkPageHead>
    <!-- 口径标注（P1#4）：状态带里只有「共 N」可能是后端全量口径（后端未回 total 时退化为
         窗口行数，title 如实降级、不得再声称全量）；需关注 / 有建议 / 缺总结三个计数全部来自
         最近 LIST_LIMIT 条加载窗口，就地括注「（最近 1000 条）」防窗口冒充全量。
         bad 档（异常堆积）阈值在条 title 披露（告警条件化纪律：着色必须带阈值） -->
    <div
      v-if="!embedded"
      class="mk-status"
      :class="tsDashTone === 'bad' ? 'mk-status--bad' : tsDashTone === 'warn' ? 'mk-status--warn' : tsDashTone === 'muted' ? 'mk-status--muted' : 'mk-status--ok'"
      :title="tsDashTone === 'bad' ? `异常堆积：失败 / 收尾失败 / 超时合计 ${abnormalSessionCount} ≥ ${TS_BAD_THRESHOLD}（最近 ${LIST_LIMIT} 条窗口），页头转红` : undefined"
    >
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title" title="需关注 = 关注度高 / 中的会话数（失败 / 超时 / 终态缺总结 / 高优建议）；最近加载窗口计数，非全量">{{ attentionCount }} 个会话需关注（最近 {{ LIST_LIMIT }} 条）</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta" :title="totalTitle">共 {{ listTotal || rows.length }}</span>
      <button
        type="button"
        class="mk-status__meta-link"
        :class="{ 'mk-status__meta-link--on': onlyAdvisory }"
        :aria-pressed="onlyAdvisory"
        title="含教学建议（完课调整 / 复习建议）的会话数；最近加载窗口计数。点击 = 服务端过滤只看有建议（再点取消）"
        @click="toggleOnlyAdvisory"
      >有建议 {{ advisoryCount }}（最近 {{ LIST_LIMIT }} 条）</button>
      <span class="mk-status__meta" :title="`终态（已完成 / 失败 / 超时 / 废弃 / 收尾失败）会话缺课后总结数；非终态缺失是过程态不计；最近 ${LIST_LIMIT} 条窗口计数`">缺总结 {{ missingWrapupCount }}（最近 {{ LIST_LIMIT }} 条）</span>
      <!-- 达 LIST_LIMIT 上限才提示截断（「共 N」的口径见上：后端回 total 才是全量，否则窗口行数） -->
      <span v-if="truncated" class="mk-status__meta" :title="`列表仅加载最近 ${LIST_LIMIT} 条`">仅显示最近 {{ LIST_LIMIT }} 条</span>
      <!-- 右侧快捷钮（原型 .statusbar__act「只看需关注」）：接页面既有「待关注」筛选，
           再点取消；纯导航，不新增数据口径 -->
      <span class="mk-status__actions">
        <button
          type="button"
          class="mk-status__action"
          :class="{ 'ts-status-action--on': pill === 'attention' }"
          :aria-pressed="pill === 'attention'"
          title="只看关注度非低的会话（高 / 中关注），再点取消"
          @click="pill = pill === 'attention' ? 'all' : 'attention'"
        >只看需关注</button>
      </span>
    </div>

    <!-- 状态分布条（newui 原型 renderSessions「闭环阶段分布」卡同位移植）：distBand 结构 =
         OpsContent 状态分布卡判例（stageband 五段条 + stageband__legend/sbl 逐行同构）。
         原型五段按回合状态机 stage（开场澄清/教学回合/介入补强/检查点/收尾·产出）聚合，
         但教学会话列表/后端均无 stage 字段——字段没有的不硬造，改按现有 status 枚举聚合
         （文案复用 statusOptions，不另造词；未知取值归「其它」档），卡头 meta 如实注明口径。
         卡头右组 pill 位（原型 card__tools「N 个介入中」）= 现有「异常」warn 徽章（失败 /
         收尾失败 / 超时合计，需排查）；介入中需 stage 字段，同样不硬造。
         数据 = 已加载列表行（rows，最近 LIST_LIMIT 条加载窗口），非后端全量口径。
         embedded 时整卡隐藏（宿主状态条承载域计数）；无数据/加载失败不留空卡 -->
    <section v-if="!embedded && rows.length" class="mk-card">
      <div class="mk-card__head">
        <span class="mk-card__title">会话状态分布</span>
        <span class="mk-card__meta">按状态聚合 · 最近 {{ rows.length }} 条（加载窗口，非全量）</span>
        <div class="mk-card__head-right">
          <!-- 异常 badge 可点穿（评审 §5）：点击 = 状态多选筛选（失败 / 收尾失败 / 超时），再点取消 -->
          <button
            v-if="abnormalSessionCount"
            type="button"
            class="mk-badge mk-badge--warn ts-badge-toggle"
            :class="{ 'ts-badge-toggle--on': abnormalOnly }"
            :aria-pressed="abnormalOnly"
            title="失败 / 收尾失败 / 超时 合计——需排查。点击只看异常会话（状态多选），再点取消"
            @click="abnormalOnly = !abnormalOnly"
          >异常 {{ abnormalSessionCount }}</button>
        </div>
      </div>
      <div class="ts-bandcard__body">
        <div class="stageband">
          <span
            v-for="seg in statusBandSegments"
            :key="seg.key"
            :style="{ width: seg.pct, background: seg.tone }"
            :title="`${seg.name} · ${seg.n}`"
          ></span>
        </div>
        <div class="stageband__legend">
          <!-- 枚举内档位可点 = 状态筛选 toggle（与工具条状态 chips 同源）；「其它」档无对应筛选项不可点。
               零值档不渲染（与段条已滤零的口径一致），折成一行「+N 个零值状态」提示（title 披露档名） -->
          <component
            :is="seg.clickable ? 'button' : 'div'"
            v-for="seg in statusBandVisible"
            :key="seg.key"
            :type="seg.clickable ? 'button' : undefined"
            class="sbl"
            :class="{ 'sbl--link': seg.clickable, 'sbl--on': seg.clickable && statusFilter === seg.key }"
            :title="seg.clickable ? `点击${statusFilter === seg.key ? '取消筛选' : '筛选'}「${seg.name}」` : `${seg.name} · ${seg.n}`"
            @click="seg.clickable ? toggleStatusFilter(seg.key) : undefined"
          >
            <span class="sbl__sw" :style="{ background: seg.tone }"></span>
            <span class="sbl__name">{{ seg.name }}</span>
            <span class="sbl__n">{{ seg.n }}</span>
          </component>
          <div v-if="zeroBandCount" class="sbl" :title="`零值档未列出：${zeroBandNames}`">+{{ zeroBandCount }} 个零值状态</div>
        </div>
      </div>
    </section>

    <!-- 深链未命中提示：?session= 存在但当前列表（最近 LIST_LIMIT 条）中找不到 -->
    <div v-if="deepLinkMiss" class="mk-alert" role="alert">
      未能定位该会话：它可能不在当前列表范围内（最近 {{ LIST_LIMIT }} 条），或已被删除。
    </div>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <MkFilterSearch v-model="keyword" placeholder="搜索主题 / 用户 / 邮箱 / ID" />
          <select v-model="dateFilter" class="mk-filter__select" aria-label="按开始时间筛选">
            <option value="">全部时间</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select>
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <DataScopeToggle v-model="includeTest" />
          <MkCols
            :col-defs="tsColDefs"
            storage-key="wf_teaching_hidden_cols"
            v-model:hidden="tsHiddenCols"
          />
          <span class="mk-card__meta" :title="includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户'">{{ filtered.length }} / {{ rows.length }} 条（{{ includeTest ? '含模拟' : '仅真实' }}）</span>
        </div>
      </div>

      <!-- 卡内工具条（原型 .toolbar：左 chips + grow + 右 chips；原状态下拉 select 已按原型
           改为右组 chips，枚举严格取现有 statusOptions，不另造取值）。
           左组 = 页面既有「焦点」筛选（全部 / 进行中 / 待关注 / 缺总结）——
           原型左组为阶段筛选，但列表无 stage 字段（字段没有的不硬造），
           故左组沿用既有筛选轴；两组均 aria-pressed 与 .mk-pill--active 同源 -->
      <div class="ts-toolbar">
        <div class="mk-pills" role="group" aria-label="焦点筛选">
          <button
            v-for="p in pills"
            :key="p.id"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': pill === p.id }"
            :aria-pressed="pill === p.id"
            @click="pill = p.id"
          >
            {{ p.label }}<span v-if="p.count != null" class="mk-pill__count">{{ p.count }}</span>
          </button>
        </div>
        <span class="ts-toolbar__grow"></span>
        <div class="mk-pills" role="group" aria-label="按状态筛选">
          <button
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': !statusFilter }"
            :aria-pressed="!statusFilter"
            @click="statusFilter = ''"
          >全部状态</button>
          <button
            v-for="s in statusOptions"
            :key="s.value"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': statusFilter === s.value }"
            :aria-pressed="statusFilter === s.value"
            @click="statusFilter = statusFilter === s.value ? '' : s.value"
          >{{ s.label }}</button>
        </div>
      </div>

      <div v-if="loadFailed" class="ts-error" role="alert">
        <span>教学会话加载失败</span>
        <button type="button" class="mk-link" :disabled="refreshing" @click="refreshNow">{{ refreshing ? '重试中…' : '重试' }}</button>
      </div>

      <MockSkeletonTable v-if="refreshing && !rows.length" :cols="9" />
      <div v-else class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap、
             列按内容自然分宽；长内容由 .ts-summary-preview / .mk-cell-main 的 max-width 截断兜底 -->
        <table v-if="filtered.length" class="mk-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable"
                :aria-sort="tsSortState('topic')"
                @click="toggleTsSort('topic')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('topic')">会话<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!tsHiddenCols.has('user')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="tsSortState('user')"
                @click="toggleTsSort('user')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!tsHiddenCols.has('status')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="tsSortState('status')"
                @click="toggleTsSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                v-if="!tsHiddenCols.has('interact')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="tsSortState('interact')"
                @click="toggleTsSort('interact')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('interact')">互动<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th v-if="!tsHiddenCols.has('progress')">进度</th>
              <th v-if="!tsHiddenCols.has('output')">产物</th>
              <th v-if="!tsHiddenCols.has('attention')">关注</th>
              <th
                v-if="!tsHiddenCols.has('start')"
                scope="col"
                class="mk-th--sortable"
                :aria-sort="tsSortState('start')"
                @click="toggleTsSort('start')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleTsSort('start')">时间<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in paged"
              :key="r.id || `row-${i}`"
              class="ts-row"
              :class="`ts-row--att-${r.attention}`"
              tabindex="0"
              @click="goConsole(r)"
              @keydown.enter.prevent="goConsole(r)"
            >
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.topic }}</strong>
                  <span class="mk-cell-sub" :title="taskTypeTitle(r.taskType)">{{ r.subject }} · {{ taskTypeText(r.taskType) }}</span>
                  <span
                    v-if="r.wrapup?.topicSummary"
                    class="ts-summary-preview"
                    :title="r.wrapup.topicSummary"
                  >{{ r.wrapup.topicSummary }}</span>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('user')">
                <div class="mk-cell-main">
                  <strong>{{ r.userName }}</strong>
                  <span v-if="r.email" class="mk-cell-sub">{{ r.email }}</span>
                  <span v-else-if="r.userId" class="mk-cell-sub mono" :title="r.userId">{{ shortId(r.userId) }}</span>
                </div>
                <div class="ts-tags">
                  <MkVariantBadge v-if="r.isVirtualLearner" kind="virtual" />
                  <MkVariantBadge v-else-if="r.isTestAccount" kind="test" />
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('status')"><span class="mk-badge" :class="statusBadge(r.status)">{{ statusText(r.status) }}</span></td>
              <td v-if="!tsHiddenCols.has('interact')">
                <!-- 行级设计（批B）：时长主值+档位 tone（≥25 分钟挂机红 / <1 分钟秒退弱化），消息/知识点降 sub 行；
                     挂机红阈值（duration ≥ 1500 秒）写进 title 披露（P3） -->
                <div class="ts-ia" :title="interactTitle(r)">
                  <b class="ts-ia__dur" :class="{ 'mk-latency--slow': r.duration >= IDLE_RED_SECONDS, 'ts-ia__dur--brief': r.duration > 0 && r.duration < 60 }">{{ r.duration ? fmtDuration(r.duration) : '—' }}</b>
                  <span class="mk-cell-sub">{{ r.messageCount }} 条<template v-if="r.knowledgePointCount"> · 知识 {{ r.knowledgePointCount }} 点</template></span>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('progress')">
                <template v-if="sessionProgressDone(r.status)">
                  <span class="ts-prog ts-prog--done" :title="progressTitle(r)">已完成</span>
                </template>
                <template v-else-if="sessionProgressPct(r.progress) !== null">
                  <span class="ts-prog" :title="progressTitle(r)">
                    <span class="ts-prog__num">{{ sessionProgressText(r.progress, r.status) }}</span>
                    <span class="mk-minibar ts-prog__bar">
                      <i
                        class="mk-minibar__fill"
                        :data-tone="sessionProgressTone(r.status)"
                        :style="{ width: (sessionProgressPct(r.progress) ?? 0) + '%' }"
                      ></i>
                    </span>
                  </span>
                </template>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="!tsHiddenCols.has('output')">
                <!-- 建议徽章可读（评审 §5）：行内直出建议标题（首行预览），title 挂完整建议文本 -->
                <span class="mk-badge" :class="wrapupBadge(r)">{{ wrapupText(r) }}</span>
                <span
                  v-if="r.hasAdvisory"
                  class="mk-badge ts-adv-badge"
                  :class="advisoryBadge(r.advisory?.priority)"
                  :title="r.advisory ? `${r.advisory.title || '教学建议'}：${r.advisory.text}` : '教学建议'"
                ><span class="ts-adv-badge__txt">{{ r.advisory?.title || '建议' }}</span></span>
              </td>
              <td v-if="!tsHiddenCols.has('attention')">
                <span
                  class="ts-att"
                  :class="`ts-att--${r.attention}`"
                  :title="r.attention === 'high' ? '高关注：需优先介入' : r.attention === 'medium' ? '中关注' : '低关注'"
                >{{ r.attention === 'high' ? '高' : r.attention === 'medium' ? '中' : '低' }}</span>
              </td>
              <td v-if="!tsHiddenCols.has('start')">
                <!-- 原型末数据列「时间」.sub mono 形态：相对时间 + title 绝对时间（Users 判例） -->
                <span class="mk-cell-sub mono" :title="r.startTime || r.startAt">{{ r.startAt || '—' }}</span>
              </td>
              <td>
                <!-- 操作列文字钮（原型 .tbl 操作列 btn--sm「详情/下线」形态，不用纯图标钮）；
                     右对齐走共享 .mk-actions，与 mk-th--right 表头对齐 -->
                <div class="mk-actions">
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="goTrace(r)">链路</button>
                  <button v-if="r.id" type="button" class="mk-btn mk-btn--sm" @click.stop="goConsole(r)">详情</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <MkEmptyState
          v-else-if="!loadFailed"
          :title="rows.length ? '当前筛选无会话' : '暂无教学会话'"
          :description="rows.length ? '放宽筛选条件试试。' : '学习者开始上课后，会话记录将自动出现在这里。'"
          :action-text="isFiltered ? '清除筛选' : ''"
          @action="clearFilters"
        />
      </div>
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
import { useSessionDrill } from './useSessionDrill'
import { timeAgo, isPageCacheFresh, markPageFetched, shortId } from './live'
import { statusText, sessionProgressPct, sessionProgressText, sessionProgressTone, sessionProgressDone } from './statusText'
import type { SessionProgress } from './statusText'
import { adminTeachingSessionsApi } from '@/api/adminApi'
import { useSafePolling } from '@/composables/useSafePolling'
import MockSkeletonTable from './SkeletonTable.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import { useTableSort } from './useTableSort'
import MkCols from '@/components/mk/MkCols.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'

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
  userName: string
  email: string
  /** 数据隔离标记（includeTest=true 时后端带回，供灰标） */
  isVirtualLearner: boolean
  isTestAccount: boolean
  status: string
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
  advisory: { title: string; text: string; priority: string } | null
  progress: SessionProgress | null
}

const rows = ref<Row[]>([])
const refreshing = ref(false)
const loadFailed = ref(false)

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；切换「含虚拟·测试」后重拉全量并灰标虚拟/测试行 */
const includeTest = ref(false)

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
/* 后端是否真的返回了 total（P1#4）：false 时「共 N」退化为已加载窗口行数，
   状态条 title 必须如实降级，不得再声称全量 */
const totalFromBackend = ref(false)
/* 「只看有建议」服务端过滤（评审 §5 可点穿）：接 adminApi 既有 onlyWithAdvisory 参数 */
const onlyAdvisory = ref(false)
const truncated = computed(() => rows.value.length >= LIST_LIMIT)

/* 静默拉取：成功即整表替换；失败保留旧数据（轮询不闪空态），并标记错误条。
   force = true 绕过页面级 TTL 缓存（显式刷新/口径切换/轮询用） */
async function fetchRows(force = false): Promise<boolean> {
  // 页面级 TTL 缓存：切换页面回来时跳过重复请求（轮询/显式刷新传 force 不受影响）
  if (!force && isPageCacheFresh('teaching-sessions') && rows.value.length) return true
  try {
    const res = await adminTeachingSessionsApi.list({
      limit: LIST_LIMIT,
      includeTest: includeTest.value,
      ...(onlyAdvisory.value ? { onlyWithAdvisory: true } : {})
    })
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
    loadFailed.value = true
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

/** 「共 N」口径 title（P1#4）：后端真返回 total 才可声称全量；
    「只看有建议」过滤生效时 total 是过滤口径，同样要说明 */
const totalTitle = computed(() => {
  if (onlyAdvisory.value) return `「只看有建议」服务端过滤生效：此处为该过滤口径的总数；列表按最近 ${LIST_LIMIT} 条窗口展示`
  return totalFromBackend.value
    ? '后端全量口径；下方分布卡与列表按最近加载窗口展示'
    : `后端未返回总数：此处为最近加载窗口内已加载行数（≤ ${LIST_LIMIT} 条），非全量`
})

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

/* 数据隔离切换：仅真实 ↔ 含虚拟/测试（切换后立即按新口径重拉） */
watch(includeTest, () => {
  refreshing.value = true
  void fetchRows(true).finally(() => {
    refreshing.value = false
  })
})

/** 用户名兜底：userName → 邮箱前缀 → 「用户 ·尾4位」（不把裸 cuid 显示给运营） */
function displayName(s: Record<string, unknown>): string {
  const name = String(s.userName || '').trim()
  if (name) return name
  const email = String(s.email || '').trim()
  if (email && email.includes('@')) return email.slice(0, email.indexOf('@')) || email
  const uid = String(s.userId || '').trim()
  return uid ? `用户 ·${uid.slice(-4)}` : '用户'
}

function mapRow(s: Record<string, unknown>): Row {
  const wrapup = (s.wrapup as Record<string, unknown>) || null
  const summary = (wrapup?.summary as WrapupSummary) || null
  /* 后端 ReplanAdvisory：{shouldSuggest, priority, recommendation, scope, rationale, reasonCodes, ui:{title,body,options}} */
  const rawAdvisory = (s.advisory as Record<string, unknown>) || null
  const advisoryUi = rawAdvisory ? (rawAdvisory.ui as Record<string, unknown>) || {} : {}
  const advisory = rawAdvisory
    ? {
        title: String(advisoryUi.title || ''),
        text: String(advisoryUi.body || rawAdvisory.rationale || ''),
        priority: String(rawAdvisory.priority || '')
      }
    : null
  const advisoryRelevant = !!advisory && rawAdvisory?.shouldSuggest !== false && !['none', ''].includes(advisory.priority)
  const wrapupStatus = wrapup?.status === 'complete' ? 'complete' : 'missing'
  const wrapupSources = (wrapup?.sources as Record<string, string>) || {}
  const rawPracticeAdvice = String(summary?.practiceAdvice || '')
  const wrapupDegraded = wrapup?.status === 'summary-only'
    || String(wrapupSources.summary || '').includes('fallback')
    || /重新开始本节|重新完成一次完整的学习/.test(rawPracticeAdvice)
  const attention: Row['attention'] =
    s.status === 'failed' || s.status === 'timeout' || (s.status === 'completed' && wrapupStatus === 'missing')
      ? 'high'
      : advisoryRelevant && advisory?.priority === 'high'
        ? 'high'
        : advisoryRelevant
          ? 'medium'
          : 'low'
  return {
    /* s.id 缺失不得拼出 "undefined"（控制台按钮/抽屉标题已由 v-if="r.id" 守卫） */
    id: s.id ? String(s.id) : '',
    userId: String(s.userId || ''),
    /* 兜底不展示裸 cuid：主题回「未命名会话」；用户缺失降级邮箱前缀 → 「用户 ·尾4位」 */
    topic: String(s.topic || '未命名会话'),
    subject: String(s.subject || '—'),
    taskType: String(s.taskType || ''),
    userName: displayName(s),
    email: String(s.email || ''),
    isVirtualLearner: !!s.isVirtualLearner,
    isTestAccount: !!s.isTestAccount,
    status: String(s.status || ''),
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
    advisory,
    progress: (s.progress as SessionProgress) || null
  }
}

/* 筛选 */
const pill = ref<'all' | 'active' | 'attention' | 'missing'>('all')
const keyword = ref('')
const statusFilter = ref('')
const dateFilter = ref('')

/* P1-3 列显隐（公共组件 MkCols）：用户/状态/互动/进度/产物/关注 可隐藏，会话/详情固定 */
const tsColDefs = [
  { key: 'user', label: '用户', title: '用户姓名 + 邮箱' },
  { key: 'status', label: '状态', title: '会话状态' },
  { key: 'interact', label: '互动', title: '时长 / 消息数 / 知识点' },
  { key: 'progress', label: '进度', title: '学习进度' },
  { key: 'output', label: '产物', title: '课后总结 / 建议' },
  { key: 'attention', label: '关注', title: '关注度' },
  { key: 'start', label: '时间', title: '开始时间（相对 · 悬停看绝对时间）' },
] as const
const tsHiddenCols = ref<Set<string>>(new Set())
const pills = computed(() => {
  const all = rows.value
  return [
    { id: 'all' as const, label: '全部', count: all.length },
    { id: 'active' as const, label: '进行中', count: all.filter((r) => r.status === 'active').length },
    // 计数与下方 missingWrapupCount / attentionCount 同源：那两者同时服务页头基调，
    // 避免「同一个 pill 有两个不同数字」（原状态条「高关注」按 attention==='high' 统计，
    // 而本 pill 的筛选口径是 attention!=='low'，点击后条数对不上 —— 已删该状态条计数）。
    { id: 'attention' as const, label: '待关注', count: attentionCount.value },
    { id: 'missing' as const, label: '缺总结', count: missingWrapupCount.value }
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

/* ===== 状态分布条（newui 原型「闭环阶段分布」stageband 移植）=====
   数据 = 已加载列表行（rows，最近 LIST_LIMIT 条加载窗口）按 status 聚合；
   文案复用上方 statusOptions（不另造词）。tone 与表格状态徽章同语义：
   过程态（初始化/进行中/收尾中）蓝、完成绿、失败族（失败/收尾失败）红、
   超时/已被替代琥珀、暂停/废弃中性灰；枚举之外的取值归「其它」档（灰）。 */
const STATUS_BAND_TONE: Record<string, string> = {
  initializing: 'var(--mk-blue)',
  active: 'var(--mk-blue)',
  finalizing: 'var(--mk-blue)',
  completed: 'var(--mk-green)',
  failed: 'var(--mk-red)',
  finalization_failed: 'var(--mk-red)',
  timeout: 'var(--mk-amber)',
  superseded: 'var(--mk-amber)',
  paused: 'var(--mk-faint)',
  discarded: 'var(--mk-faint)'
}
interface StatusBandEntry { key: string; name: string; n: number; tone: string; clickable: boolean }
const statusBand = computed<StatusBandEntry[]>(() => {
  const counts = new Map<string, number>()
  for (const r of rows.value) counts.set(r.status, (counts.get(r.status) || 0) + 1)
  const known = new Set(statusOptions.map((s) => s.value))
  const entries: StatusBandEntry[] = statusOptions.map((s) => ({
    key: s.value,
    name: s.label,
    n: counts.get(s.value) || 0,
    tone: STATUS_BAND_TONE[s.value] || 'var(--mk-faint)',
    clickable: true
  }))
  /* 「其它」档：仅枚举外取值实际出现时追加（无对应筛选项 → 不可点） */
  let other = 0
  for (const [k, n] of counts) if (!known.has(k)) other += n
  if (other > 0) entries.push({ key: 'other', name: '其它', n: other, tone: 'var(--mk-faint)', clickable: false })
  return entries
})
/* legend 零值档折叠（P2）：只渲染非零档（与段条已滤零一致），零值折成「+N 个零值状态」提示 */
const statusBandVisible = computed(() => statusBand.value.filter((e) => e.n > 0))
const zeroBandEntries = computed(() => statusBand.value.filter((e) => e.n === 0))
const zeroBandCount = computed(() => zeroBandEntries.value.length)
const zeroBandNames = computed(() => zeroBandEntries.value.map((e) => e.name).join('、'))
/* 段宽 = n / 合计（原型 distBand 口径，合计为 0 时按 1 兜底）；零值段不渲染 */
const statusBandSegments = computed(() => {
  const total = statusBand.value.reduce((a, e) => a + e.n, 0) || 1
  return statusBand.value
    .filter((e) => e.n > 0)
    .map((e) => ({ ...e, pct: `${(e.n / total) * 100}%` }))
})
/* 卡头异常 badge：失败/收尾失败/超时合计（与进度列中断态、时间线失败/超时的排查口径一致） */
const ABNORMAL_STATUSES = new Set(['failed', 'finalization_failed', 'timeout'])
const abnormalSessionCount = computed(() =>
  rows.value.filter((r) => ABNORMAL_STATUSES.has(r.status)).length
)
/* 异常 badge 可点穿（评审 §5）：点击 = 异常状态多选筛选（与单选 statusFilter 叠加为 AND） */
const abnormalOnly = ref(false)
/* legend 可点档：点击 = 状态筛选 toggle（与表头状态下拉、清除筛选同一 statusFilter） */
function toggleStatusFilter(key: string) {
  statusFilter.value = statusFilter.value === key ? '' : key
}

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const { toggle: toggleTsSort, sortState: tsSortState, sortRows: sortTsRows, sortKey: tsSortKey, sortDir: tsSortDir } = useTableSort<Row>({
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

const isFiltered = computed(() => pill.value !== 'all' || abnormalOnly.value || !!statusFilter.value || !!dateFilter.value || !!keyword.value.trim())
function clearFilters() {
  pill.value = 'all'
  abnormalOnly.value = false
  statusFilter.value = ''
  dateFilter.value = ''
  keyword.value = ''
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   筛选输入 / 排序变化时回第 1 页：20s 轮询整表替换 rows 也会让 filtered 重算，
   若监听 filtered 会把用户所在页打回第 1 页（P2）——故监听筛选输入与排序而非结果 */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([pill, statusFilter, dateFilter, keyword, tsSortKey, tsSortDir], () => {
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
const wrapupText = (r: Row) => (wrapupTier(r) === 'complete' ? '有总结' : wrapupTier(r) === 'missing' ? '缺总结' : '未生成')
const wrapupBadge = (r: Row) =>
  wrapupTier(r) === 'complete' ? 'mk-badge--ok' : wrapupTier(r) === 'missing' ? 'mk-badge--warn' : 'mk-badge--muted'
const isMissingWrapup = (r: Row) => wrapupTier(r) === 'missing'

/* 教学概览（ts-dash：会话域结论，状态条承载基调；逐项计数由卡头 pills 承载，不重复渲染）。
   bad 档（补死代码分支）：失败 / 收尾失败 / 超时合计 ≥ TS_BAD_THRESHOLD 视为异常堆积，页头转红
   （阈值在状态条 title 披露，见模板）；warn 只由终态缺失 / 待关注触发：missingWrapupCount 已按
   P1 口径只数终态会话，进行中会话不再把页头钉死在 warn。 */
const TS_BAD_THRESHOLD = 10
const tsDashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() => {
  if (!rows.value.length) return 'muted'
  if (abnormalSessionCount.value >= TS_BAD_THRESHOLD) return 'bad'
  if (missingWrapupCount.value > 0) return 'warn'
  if (attentionCount.value > 0) return 'warn'
  return 'ok'
})

const route = useRoute()
const router = useRouter()
/** 深链存在但列表加载后仍未命中（超出最近 LIST_LIMIT 条 / 已删除） */
const deepLinkMiss = ref(false)
/* ?session= 语义（2026-10-01 对齐原型习惯：会话行 → 二级详情页，不再开抽屉）：
   深链直达座舱只读监控（session-real），随后清掉查询参数避免与座舱返回冲突 */
watch(
  // 同时监听行数：刷新场景下 immediate 触发时 rows 尚未返回，仅监听 query 会错过恢复时机
  [() => route.query.session, () => rows.value.length],
  ([sid]) => {
    const id = typeof sid === 'string' ? sid : ''
    if (!id) { deepLinkMiss.value = false; return }
    const r = rows.value.find((x) => x.id === id)
    if (r) {
      deepLinkMiss.value = false
      openSubPage('session-real', id)
      const q = { ...route.query }; delete q.session
      void router.replace({ query: q })
    } else {
      deepLinkMiss.value = rows.value.length > 0
    }
  },
  { immediate: true }
)
/** 座舱跳转族收尾：清理 URL 深链（?session=）是唯一动作 */
function closeDetail() {
  const q = { ...route.query }; delete q.session; void router.replace({ query: q })
}

/** 真实教学会话与控制台数据契约不兼容（座舱仅服务虚拟会话）：轻量深链 = 学习者详情 / Trace 瀑布按 sessionId 归组 */
const { goTrace, goConsole } = useSessionDrill(closeDetail)

/* 状态映射统一走共享字典（对齐后端枚举：initializing/active/paused/timeout/superseded/failed/finalizing/finalization_failed/completed/discarded） */
/* 状态徽章降噪（P0-5）：只对异常态上色，正常态统一灰——对齐 Langfuse「只有
   ERROR/WARNING 上色」；completed/succeeded 不再绿（绿留给业务正向信号） */
const statusBadge = (s: string) =>
  s === 'failed' || s === 'timeout' || s === 'discarded' || s === 'finalization_failed'
    ? 'mk-badge--bad'
    : s === 'superseded'
      ? 'mk-badge--warn'
      : 'mk-badge--muted'
/* 建议徽章带优先级色（T3）：high=bad / medium=warn / 其余 info */
const advisoryBadge = (p?: string) => (p === 'high' ? 'mk-badge--bad' : p === 'medium' ? 'mk-badge--warn' : 'mk-badge--info')
/* 任务类型字典：未命中枚举回退「—」，原文进 title（不裸直出枚举，也不猜词） */
const TASK_TYPE_TEXT: Record<string, string> = {
  reading: '阅读', practice: '练习', project: '项目', quiz: '测验', acquire: '获取', deconstruct: '拆解', model: '建模', execute: '执行', diagnose: '诊断', refine: '打磨', consolidate: '巩固'
}
const taskTypeText = (t: string) => TASK_TYPE_TEXT[t] || '—'
const taskTypeTitle = (t: string) => (t && !TASK_TYPE_TEXT[t] ? `任务类型原文：${t}` : undefined)
/* 时长格式化：分钟向下取整（P3：90 秒显示「1 分钟」而非四舍五入成「2 分钟」） */
const fmtDuration = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} 分钟` : `${sec} 秒`)
/** 挂机红阈值（秒）：≥1500s（25 分钟）时长标红；阈值写进互动列 title 披露 */
const IDLE_RED_SECONDS = 1500
/** 互动列 title：时长 + 消息数；触发挂机红时披露阈值口径 */
function interactTitle(r: Row): string | undefined {
  if (!r.duration) return undefined
  const base = `时长 ${fmtDuration(r.duration)} · ${r.messageCount} 条消息`
  return r.duration >= IDLE_RED_SECONDS ? `${base} · 时长 ≥ 25 分钟按挂机标红` : base
}
/** 进度工具提示（人话）：阶段 n/m · 任务 x/y；无里程碑维度只给任务 */
function progressTitle(r: Row): string {
  const p = r.progress
  if (!p) return ''
  if (p.totalMilestones > 0 && p.milestoneIndex > 0) return `阶段 ${p.milestoneIndex}/${p.totalMilestones} · 任务 ${p.taskIndex}/${p.totalTasks}`
  return `任务 ${p.taskIndex}/${p.totalTasks}`
}

/* 宿主刷新联动（学习会话合并宿主「刷新」按钮 → refreshNow） */
defineExpose({ refreshNow })
</script>

<style scoped>/* 嵌入模式（宿主学习会话页 flex 列内）：占满剩余高度，表格区内滚（对齐 oc-embedded 先例） */
.ts-embedded { flex: 1; min-height: 0; overflow: hidden; }/* 总结预览行（P1-2）：单行 ellipsis + hover 全文，对齐 Intercom 最后消息预览 */
.ts-summary-preview {
  display: block;
  max-width: 320px;
  margin-top: 3px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: help;
}.ts-summary-preview::before { content: '📝 '; opacity: 0.7; }.ts-row { cursor: pointer; position: relative; }/* 关注度行首色条（P0-5）：高关注红 / 中关注琥珀 / 低关注透明——扫视被红色拉住 */
.ts-row--att-high { box-shadow: inset 3px 0 0 var(--mk-red); }.ts-row--att-medium { box-shadow: inset 3px 0 0 var(--mk-amber); }/* 关注度列：小色点 + 文字（从徽章降级，不占徽章位） */
.ts-att { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); white-space: nowrap; }.ts-att--high { color: var(--mk-red); }.ts-att--medium { color: var(--mk-amber); }.ts-att--low { color: var(--mk-faint); }/* 虚拟/测试行灰标（数据隔离 A3：includeTest 切换后显式标记） */
.ts-tags { display: flex; gap: 6px; margin-top: 2px; }/* 卡内工具条（原型 .toolbar：左右 chips + grow，底边框分隔表头）：两组筛选 chips 同行 */
.ts-toolbar {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid var(--mk-line);
}.ts-toolbar__grow { flex: 1 1 auto; }/* 会话列副行上限 300px（原 387px 由 sub 行撑开；主行 260px 由 --mk-cell-main-max 兜底） */
.ts-row td:first-child .mk-cell-sub { max-width: 300px; }/* 原型 .tbl td：nowrap（表格已改自动布局，列宽随内容；
   长内容由 .ts-summary-preview / .mk-cell-main / .mk-cell-sub 的 max-width 截断兜底）。
   本组件仅列表一张 mk-table（抽屉内无表格），裸选择器即可 */
.mk-table td { white-space: nowrap; }/* 进度列：数字 x/y + 迷你条（mk-minibar 复用，会话域统一进度表达） */
/* 互动列（批B）：时长主值+副行 */
.ts-ia { display: grid; gap: 2px; justify-items: start; }.ts-ia__dur { font-variant-numeric: tabular-nums; font-weight: 700; }.ts-ia__dur--brief { color: var(--mk-faint); font-weight: 400; }.ts-prog { display: grid; gap: 4px; max-width: 96px; }.ts-prog__num { font-variant-numeric: tabular-nums; font-size: var(--mk-fs-micro); font-weight: 700; white-space: nowrap; }.ts-prog__bar { width: 88px; height: 5px; }/* 终态完成列（P1 语义修复）：只显「已完成」文字，不再与进度条并存；title 保留历史进度 */
.ts-prog--done {
  display: inline-flex;
  align-items: center;
  color: var(--mk-green);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  white-space: nowrap;
}/* 状态条快捷钮选中态（原型 .statusbar__act 语义 = 筛选生效高亮）：与 .mk-pill--active 同词汇。
   页面前缀命名（规则 1：mk- 前缀属全局原语，页面不得自造） */
.ts-status-action--on {
  background: var(--mk-blue-bg);
  border-color: color-mix(in srgb, var(--mk-blue) 44%, var(--mk-line));
  color: var(--mk-pill-active-fg);
}/* 状态徽章：固定最小宽度，筛选不同状态时列宽不跳动（"已被替代"最长 4 字） */
.ts-row td:nth-child(3) .mk-badge { min-width: 60px; justify-content: center; }/* 可点异常徽章（button 形态的 .mk-badge）：reset 原生按钮外观保徽章样，选中态描边（token 复用，同 .mk-pill--active 语义） */
.ts-badge-toggle { border: 0; cursor: pointer; font: inherit; }.ts-badge-toggle--on { outline: 2px solid var(--mk-blue); outline-offset: 1px; }/* 建议徽章：行内直出建议标题（首行预览），超长 ellipsis 截断、hover 看全文（title）。
   badge 本体 inline-flex，截断由内层文本节点承载（flex 项 overflow!=visible → min-width 归 0 可收缩） */
.ts-adv-badge { margin-left: 4px; max-width: 168px; }.ts-adv-badge__txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }/* 加载失败错误条 */
.ts-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 10px;
  padding: 8px 12px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
}/* ===== 状态分布条（newui 原型 stageband/sbl 原样移植；token 映射：
   --surface-3→--mk-surface-3、--dur/--ease→--mk-dur/--mk-ease-out、
   --fs-micro→--mk-fs-micro、--muted→--mk-muted、sbl__sw 3px→--mk-radius-xs）===== */
.ts-bandcard__body { padding: 12px 16px 16px; }.stageband { display: flex; gap: 2px; height: 12px; border-radius: 999px; overflow: hidden; background: var(--mk-surface-3); }.stageband > span { display: block; height: 100%; transition: width var(--mk-dur) var(--mk-ease-out); }.stageband__legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px 18px; margin-top: 14px; }.sbl { display: flex; align-items: center; gap: 8px; font-size: var(--mk-fs-micro); }.sbl__sw { width: 10px; height: 10px; border-radius: var(--mk-radius-xs); flex: none; }.sbl__name { color: var(--mk-muted); }.sbl__n { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }/* legend 可点档（button 形态的 .sbl）：reset 原生按钮外观，选中档高亮 */
.sbl--link { border: 0; background: transparent; padding: 0; font: inherit; cursor: pointer; }.sbl--link:hover .sbl__name { color: var(--mk-ink); }.sbl--on .sbl__name { color: var(--mk-ink); font-weight: 700; }/* 4K：抽屉加宽 + 字号跟随壳层放大（置于基础样式之后确保覆盖） */
@media (min-width: 2000px) {
}/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
}

</style>
