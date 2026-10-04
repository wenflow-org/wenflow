<template>
  <div :class="embedded ? 'mk-page--fill ts-embedded' : 'mk-page mk-page--fill'">
    <!-- 教学会话页头（newui/admin pagehead；embedded 由宿主承载，本组件不渲染页头）。
         本页 20s 静默轮询，手动「刷新」钮与之重复已撤（对齐执行日志/健康中心先例：
         轮询页不放刷新钮）；拉取失败走错误条重试钮（refreshNow 仍被错误态与宿主联动使用）。
         统计口径（2026-10-04 晚贴表分布条）：全页统计带 = 表格卡内 MkDistBand 唯一一处；
         计数每个只出现一次——加载/筛选/总量/截断住卡头 meta，待关注 / 缺总结 / 有建议住
         卡头 chips（后两者无分布组覆盖），进行中 chip 是 active 单状态 ≠ 分布条
         「进行中」四状态合并档（两个不同口径，见各自 title） -->
    <MkPageHead v-if="!embedded" title="教学会话" sub="会话状态实时监视 · 状态分布与需关注识别">
      <template #actions>
        <!-- 整组统一口径开关（2026-10-04 用户拍板：撤页头刷新钮，学习组六页同一位、同一状态） -->
        <DataScopeToggle v-model="includeTest" />
      </template>
    </MkPageHead>
    <!-- 页头状态条整体退役（2026-10-04 用户拍板：教学组已有统计带，顶部这条复读）——
         它的「需关注 / 缺总结」与焦点 chips 同源同数、异常计数与分布条「异常终态」段
         同源同数（同一数字不两处渲染）；「只看需关注」= 待关注 chip 的同一动作，直接删。
         两个别处没有的**动作**（有建议服务端过滤 / 异常多选筛选）随迁卡头 chips；
         总数与窗口截断口径并进卡头 meta（真触上限才算限定，未触限时窗口=全量）。 -->

    <!-- 深链未命中提示：?session= 存在但当前列表（最近 LIST_LIMIT 条）中找不到 -->
    <div v-if="deepLinkMiss" class="mk-alert" role="alert">
      未能定位该会话：它可能不在当前列表范围内（最近 {{ LIST_LIMIT }} 条），或已被删除。
    </div>

    <!-- 会话状态分布（教学组标准件 MkDistBand；2026-10-05 用户拍板「分段条在上」：回到卡上方
         页面级，与旧构成带同位）：十状态按收束语义归四组 + 完结率（组内合并口径在分段悬停披露，
         完结率随副标）；枚举外取值归「其它」段（仅实际出现时追加）。数据 = 已加载列表行
         （rows，最近 LIST_LIMIT 条加载窗口），非后端全量口径。分段/图例点击 = 只看该组
         （与「高级筛选」弹层的单状态下拉互斥切换）；embedded 时隐藏（宿主承载域计数）；
         无数据不留空带 -->
    <MkDistBand
      v-if="!embedded && rows.length"
      class="ts-distband"
      title="会话状态分布"
      :sub="tsBandSub"
      unit="条"
      aria-label="按会话状态组筛选"
      :bins="tsBandBins"
      :active-key="bandGroup"
      @select="toggleBandGroup"
    />

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <!-- 表前只此一行（2026-10-04 用户拍板：快筛并回卡头，与教学组其余五页一致）：
               左组 = 焦点 chips（单选 全部/进行中/待关注/缺总结）+ 两枚独立开关
               （有建议服务端过滤 / 异常多选，aria-pressed 表开关态，故另起 aria group），
               随后是搜索；放不下主栏的次级筛选（全部状态 / 全部时间 两个下拉）收进
               右侧「高级筛选」弹层（与用户与学习者同构，外壳见 .mk-adv 原语）。 -->
          <div class="mk-pills" role="group" aria-label="焦点筛选">
            <button
              v-for="p in pills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': pill === p.id }"
              :aria-pressed="pill === p.id"
              :title="p.title"
              @click="pill = p.id"
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
              title="含教学建议（完课调整 / 复习建议）的会话数；最近加载窗口计数。点击 = 服务端过滤只看有建议（再点取消）"
              @click="toggleOnlyAdvisory"
            >有建议<span class="mk-pill__count">{{ advisoryCount }}</span></button>
            <button
              v-if="abnormalSessionCount"
              type="button"
              class="mk-pill ts-abn-chip"
              :class="{ 'mk-pill--active': abnormalOnly, 'ts-abn-chip--heap': abnormalHeap && !abnormalOnly }"
              :aria-pressed="abnormalOnly"
              :title="`失败 / 收尾失败 / 超时合计 ${abnormalSessionCount}（${abnormalHeap ? `≥ ${TS_BAD_THRESHOLD}，异常堆积` : '需排查'}）；数字见上方「异常终态」桶。点击只看异常会话（状态多选），再点取消`"
              @click="abnormalOnly = !abnormalOnly"
            >异常</button>
          </div>
          <MkFilterSearch v-model="keyword" placeholder="搜索主题 / 用户 / 邮箱 / ID" />
          <button v-if="isFiltered" type="button" class="mk-link" @click="clearFilters">清除筛选</button>
        </div>
        <div class="mk-card__head-right">
          <MkCols
            :col-defs="tsColDefs"
            storage-key="wf_teaching_hidden_cols"
            v-model:hidden="tsHiddenCols"
          />
          <div class="mk-adv">
            <!-- 高级筛选：主栏只留 chips + 搜索；10 档状态枚举与时间窗收进弹层
                 （点击展开、遮罩吞外点、Esc 关闭）。触发钮标出生效数，收起来也不丢状态 -->
            <button
              type="button"
              class="mk-btn mk-btn--sm"
              :aria-expanded="advOpen"
              @click="advOpen = !advOpen"
            >
              <Filter :size="14" :stroke-width="1.75" />高级筛选<span v-if="advCount" class="mk-pill__count">{{ advCount }}</span>
            </button>
            <div v-if="advOpen" class="mk-adv__mask" @click="advOpen = false"></div>
            <div v-show="advOpen" class="mk-adv__pop" @click.stop>
              <label class="ts-adv__field">
                <span class="mk-cell-sub">状态</span>
                <select v-model="statusFilter" class="mk-filter__select" aria-label="按状态筛选">
                  <option value="">全部状态</option>
                  <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
                </select>
              </label>
              <label class="ts-adv__field">
                <span class="mk-cell-sub">开始时间</span>
                <select v-model="dateFilter" class="mk-filter__select" aria-label="按开始时间筛选">
                  <option value="">全部时间</option>
                  <option value="7d">近 7 天</option>
                  <option value="30d">近 30 天</option>
                </select>
              </label>
            </div>
          </div>
          <span class="mk-card__meta" :title="`${includeTest ? '含虚拟学习者与测试账号，行内带标记' : '仅真实用户'}；${totalTitle}`">{{ filtered.length }} / {{ rows.length }} 条（{{ includeTest ? '含模拟' : '仅真实' }}）<template v-if="truncated"> · 共 {{ listTotal }}，仅显示最近 {{ LIST_LIMIT }} 条</template></span>
        </div>
      </div>

      <div v-if="loadFailed" class="ts-error" role="alert">
        <span>教学会话加载失败</span>
        <button type="button" class="mk-link" :disabled="refreshing" @click="refreshNow">{{ refreshing ? '重试中…' : '重试' }}</button>
      </div>

      <MockSkeletonTable v-if="refreshing && !rows.length" :cols="9" />
      <div v-else class="mk-table-scroll">
        <!-- 原型 .tbl：width:100% 自动布局（无 colgroup/无 fixed），单元格 nowrap、
             列按内容自然分宽；长内容由 .ts-summary(.mk-cell-sub) / .mk-cell-main 的 max-width 截断兜底 -->
        <table v-if="filtered.length" class="mk-table mk-table--click">
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
              tabindex="0"
              @click="goConsole(r)"
              @keydown.enter.prevent="goConsole(r)"
            >
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.topic }}</strong>
                  <span class="mk-cell-sub" :title="taskTypeTitle(r.taskType)">{{ r.subject }} · {{ taskTypeText(r.taskType) }}</span>
                  <span
                    v-if="tsSubNote(r)"
                    class="mk-cell-sub ts-summary"
                    :title="tsSubNote(r)?.title"
                  >{{ tsSubNote(r)?.text }}</span>
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
import { timeAgo, isPageCacheFresh, markPageFetched, shortId, liveIncludeVirtual, liveSetIncludeVirtual } from './live'
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
import MkDistBand from '@/components/mk/MkDistBand.vue'
import { Filter } from 'lucide-vue-next'
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

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；口径整组统一（2026-10-04 用户拍板）——
   get/set 走 live.ts 共享态（页头 DataScopeToggle 同源），本页 watch 只负责按新口径重拉 */
const includeTest = computed({
  get: () => liveIncludeVirtual.value,
  set: (v) => liveSetIncludeVirtual(v)
})

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
    ? '后端全量口径；上方构成带与列表按最近加载窗口展示'
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
/* 高级筛选弹层（状态 / 时间两个下拉）：表前只留一行，放不进主栏的次级筛选收在这里。
   Esc 关闭走共享 useEscape（与 用户与学习者 同一外壳 .mk-adv*） */
const advOpen = ref(false)
useEscape(() => advOpen.value, () => { advOpen.value = false })
/** 弹层里生效的筛选数：触发钮上标出来，收起来也不丢状态（0 = 不标） */
const advCount = computed(() => (statusFilter.value ? 1 : 0) + (dateFilter.value ? 1 : 0))

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
/* 焦点 chips（本组是这些计数的唯一来源，2026-10-04 页头状态条退役后）：
   「全部」不显数——它 = 卡头 meta「已加载 N 条」的同一个数，不两处渲染（同 People 页判例）；
   待关注 / 缺总结别处没有（构成带四桶不含），保留计数；
   「进行中」= active 单状态口径，title 注明与构成带「进行中」（初始化/进行中/已暂停/收尾中
   四状态合并）不是同一个数——避免同名两数无解释。
   历史教训：pill 与页头状态条曾各算一遍「高关注」，口径不同（attention==='high' vs
   !=='low'）致数字打架，该状态条计数已删。 */
const pills = computed(() => {
  const all = rows.value
  return [
    { id: 'all' as const, label: '全部', count: undefined as number | undefined, title: undefined as string | undefined },
    {
      id: 'active' as const,
      label: '进行中',
      count: all.filter((r) => r.status === 'active').length,
      title: '仅 status=active；上方构成带「进行中」含初始化 / 暂停 / 收尾中，口径更宽'
    },
    { id: 'attention' as const, label: '待关注', count: attentionCount.value, title: '关注度高 / 中的会话数（关注度低不计）' },
    { id: 'missing' as const, label: '缺总结', count: missingWrapupCount.value, title: '终态（已完成 / 失败 / 超时 / 废弃 / 收尾失败）会话缺课后总结数；非终态缺失是过程态不计' }
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

/* ===== 会话状态分布（2026-10-04 晚贴表分布条，构成带换装 MkDistBand）=====
   十状态按收束语义归四组 + 枚举外归「其它」段（仅实际出现时追加）；完结率随副标披露。
   数据 = 已加载列表行（rows，最近 LIST_LIMIT 条加载窗口），非后端全量口径。
   点击分段/图例 = 只看该组（bandGroup，互斥开关）；与「高级筛选」弹层的单状态
   statusFilter 互斥切换（同属「状态范围」一个维度，两控件不同粒度）。 */
const TS_BAND_GROUPS = [
  { key: 'running', label: '进行中', tone: 'var(--mk-blue)', hint: '含初始化 / 暂停 / 收尾中', statuses: ['initializing', 'active', 'paused', 'finalizing'] },
  { key: 'completed', label: '已完成', tone: 'var(--mk-green)', hint: '终态', statuses: ['completed'] },
  { key: 'abnormal', label: '异常终态', tone: 'var(--mk-red)', hint: '失败 / 超时 / 收尾失败合计', statuses: ['failed', 'finalization_failed', 'timeout'] },
  { key: 'retired', label: '已废弃', tone: 'var(--mk-faint)', hint: '含已被替代', statuses: ['discarded', 'superseded'] }
] as const
const tsBandBins = computed(() => {
  const known = new Set(statusOptions.map((s) => s.value))
  const cnt = (pred: (s: string) => boolean) => rows.value.filter((r) => pred(r.status)).length
  // 显式放宽为 string：可变的「其它」段（枚举外聚合）要与 as const 组档同数组
  const bins: Array<{ key: string; label: string; tone: string; hint: string; n: number }> = TS_BAND_GROUPS.map((g) => ({
    key: g.key, label: g.label, tone: g.tone, hint: g.hint,
    n: cnt((s) => (g.statuses as readonly string[]).includes(s))
  }))
  const other = cnt((s) => !known.has(s))
  if (other > 0) bins.push({ key: 'other', label: '其它', tone: 'var(--mk-faint)', hint: '枚举外取值', n: other })
  return bins
})
const tsBandSub = computed(() =>
  `点击分段只看该组 · 窗口 ${rows.value.length} 条（最近 ${LIST_LIMIT} 条上限，非后端全量） · 完结率 ${((rows.value.filter((r) => r.status === 'completed').length / (rows.value.length || 1)) * 100).toFixed(2)}%`
)
const bandGroup = ref<string | null>(null)
/** 「其它」段 = 枚举外取值聚合，不能按组内枚举等值判断 */
function inBandGroup(status: string, key: string): boolean {
  if (key === 'other') return !statusOptions.some((s) => s.value === status)
  const group = TS_BAND_GROUPS.find((g) => g.key === key)
  return !!group && (group.statuses as readonly string[]).includes(status)
}
function toggleBandGroup(key: string) {
  bandGroup.value = bandGroup.value === key ? null : key
  if (bandGroup.value) statusFilter.value = ''
}
watch(statusFilter, (v) => {
  if (v) bandGroup.value = null // 单状态（高级筛选）与状态组（分布条）互斥切换
})

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
  const bg = bandGroup.value
  if (bg) list = list.filter((r) => inBandGroup(r.status, bg))
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

const isFiltered = computed(() => pill.value !== 'all' || abnormalOnly.value || !!bandGroup.value || !!statusFilter.value || !!dateFilter.value || !!keyword.value.trim())
function clearFilters() {
  pill.value = 'all'
  abnormalOnly.value = false
  bandGroup.value = null
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

/* P3（设计评审 4.3-9）：异常态（失败/收尾失败/超时）会话列副行是后端降级模板句
   「本次会话未正常结束，为你保留了基础学习记录。」——与状态徽章同事实且首屏多行同文。
   命中模板句时改显行内已有的增量信息（时长优先，缺时长用开始时间；两者皆缺撤副行不硬凑）。
   后端模板句不动，title 保留降级总结原文供排查。 */
const ABNORMAL_SUMMARY_MARK = '本次会话未正常结束'
const tsSubNote = (r: Row): { text: string; title?: string } | null => {
  const summary = String(r.wrapup?.topicSummary || '')
  if (!summary) return null
  if (!ABNORMAL_STATUSES.has(r.status) || !summary.includes(ABNORMAL_SUMMARY_MARK)) {
    return { text: summary, title: summary }
  }
  if (r.duration > 0) return { text: `时长 ${fmtDuration(r.duration)}`, title: '异常会话：降级总结与状态徽章同义已省略，此处显示会话时长' }
  if (r.startAt) return { text: `开始于 ${r.startAt}`, title: '异常会话：降级总结与状态徽章同义已省略，此处显示开始时间' }
  return null
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
.ts-embedded { flex: 1; min-height: 0; overflow: hidden; }/* 总结预览行（P1-2）：副行语义走 .mk-cell-sub（截断/灰阶原语承担）；页私有只留 help 悬停 + emoji 前缀 */
.ts-summary { cursor: help; }
.ts-summary::before { content: '📝 '; opacity: 0.7; }
/* 行首关注度色条已撤（2026-10-03 用户拍板：与「关注」列同源冗余、语义不可发现）；
   关注度由「关注」列（高/中/低 色字 + title）单源承载 *//* 关注度列：小色点 + 文字（从徽章降级，不占徽章位） */
.ts-att { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); white-space: nowrap; }.ts-att--high { color: var(--mk-red); }.ts-att--medium { color: var(--mk-amber); }.ts-att--low { color: var(--mk-faint); }/* 虚拟/测试行灰标（数据隔离 A3：includeTest 切换后显式标记） */
.ts-tags { display: flex; gap: 6px; margin-top: 2px; }/* 高级筛选弹层里的字段（标签在上、控件在下；外壳 .mk-adv* 是共享原语） */
.ts-adv__field { display: grid; gap: 4px; justify-items: start; }/* 会话列副行上限 300px（原 387px 由 sub 行撑开；主行 260px 由 --mk-cell-main-max 兜底） */
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
}/* 异常堆积（合计 ≥ 阈值）chip 转红：原状态条 mk-status--bad 的同一告警，阈值在 chip title 披露。
   选中态（筛选生效中）由模板守卫——abnormalOnly 时不再加本类，让位给 .mk-pill--active 的蓝 */
/* 分布条在卡上方页面级（2026-10-05 用户拍板「分段条在上」）：卡片内的贴条 padding/下边框随撤，
   页面级间距由 .mk-page 的 --mk-stack-gap 统一供。ts-distband 类保留作测试与定位钩子 */
.ts-abn-chip--heap {
  color: var(--mk-red);
  border-color: color-mix(in srgb, var(--mk-red) 45%, var(--mk-line));
}/* 状态徽章：固定最小宽度，筛选不同状态时列宽不跳动（"已被替代"最长 4 字） */
.ts-row td:nth-child(3) .mk-badge { min-width: 60px; justify-content: center; }/* 可点异常徽章已迁工具条右组「异常」chip（2026-10-04 分布卡退役后两度搬家，ts-badge-toggle 随撤） *//* 建议徽章：行内直出建议标题（首行预览），超长 ellipsis 截断、hover 看全文（title）。
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
}/* 状态分布卡已退役改 buckets 构成带（2026-10-04，共享原语 MkBuckets；stageband 原语留仍用页）。
   4K：抽屉加宽 + 字号跟随壳层放大（置于基础样式之后确保覆盖） */
@media (min-width: 2000px) {
}/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
}

</style>
