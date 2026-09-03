<template>
  <div class="mk-page mk-page--fill">
    <!-- 教学会话页头（单行状态条：页面名 + 短计数 + 可点击筛选 + 刷新；与其他列表页统一形态） -->
    <div class="mk-status" :class="tsDashTone === 'bad' ? 'mk-status--bad' : tsDashTone === 'warn' ? 'mk-status--warn' : tsDashTone === 'muted' ? 'mk-status--muted' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">教学会话</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">进行中 {{ inProgressCount }}</span>
      <button
        type="button"
        class="ts-count-link"
        :class="{ 'ts-count-link--on': pill === 'missing' }"
        title="点击筛选「缺总结」会话"
        @click="pill = pill === 'missing' ? 'all' : 'missing'"
      >缺总结 {{ missingWrapupCount }}</button>
      <button
        type="button"
        class="ts-count-link"
        :class="{ 'ts-count-link--on': pill === 'attention' }"
        title="点击筛选「待关注」会话"
        @click="pill = pill === 'attention' ? 'all' : 'attention'"
      >高关注 {{ highAttentionCount }}</button>
      <span v-if="advisoryCount" class="mk-status__meta" title="含建议的会话数">有建议 {{ advisoryCount }}</span>
      <span class="mk-status__meta">共 {{ rows.length }} 条</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="refreshing" @click="refreshNow">
          {{ refreshing ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </div>

    <!-- 深链未命中提示：?session= 存在但当前列表（最近 100 条）中找不到 -->
    <div v-if="deepLinkMiss" class="mk-alert" role="alert">
      未能定位该会话：它可能不在最近 {{ rows.length }} 条记录内，或已被删除。
    </div>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <div class="mk-filter">
          <div class="mk-pills">
            <button
              v-for="p in pills"
              :key="p.id"
              type="button"
              class="mk-pill"
              :class="{ 'mk-pill--active': pill === p.id }"
              @click="pill = p.id"
            >
              {{ p.label }}
            </button>
          </div>
          <select v-model="statusFilter" class="mk-filter__select" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option v-for="s in statusOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
          <select v-model="dateFilter" class="mk-filter__select" aria-label="按开始时间筛选">
            <option value="">全部时间</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select>
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索主题 / 用户 / ID" />
        </div>
        <div class="mk-card__head-right">
          <DataScopeToggle v-model="includeTest" />
          <MkCols
            :col-defs="tsColDefs"
            storage-key="wf_teaching_hidden_cols"
            v-model:hidden="tsHiddenCols"
          />
          <span class="mk-card__meta">{{ filtered.length }} / {{ rows.length }}<template> · {{ includeTest ? '含模拟' : '仅真实' }} · 仅显示最近 100 条</template></span>
        </div>
      </div>

      <div v-if="loadFailed" class="ts-error" role="alert">
        <span>教学会话加载失败</span>
        <button type="button" class="mk-link" :disabled="refreshing" @click="refreshNow">{{ refreshing ? '重试中…' : '重试' }}</button>
      </div>

      <MockSkeletonTable v-if="refreshing && !rows.length" :cols="8" />
      <div v-else class="mk-table-scroll">
        <table v-if="filtered.length" class="mk-table mk-table--fixed">
          <thead>
            <tr>
              <th style="width:220px">会话</th>
              <th v-if="!tsHiddenCols.has('user')" style="width:140px">用户</th>
              <th v-if="!tsHiddenCols.has('status')" class="mk-col--badge" style="width:90px">状态</th>
              <th v-if="!tsHiddenCols.has('interact')" style="width:140px">互动</th>
              <th v-if="!tsHiddenCols.has('progress')" style="width:120px">进度</th>
              <th v-if="!tsHiddenCols.has('output')" class="mk-col--badge" style="width:90px">产物</th>
              <th v-if="!tsHiddenCols.has('attention')" class="mk-col--badge" style="width:60px">关注</th>
              <th class="mk-col--actions">详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paged" :key="r.id" class="ts-row" :class="`ts-row--att-${r.attention}`" @click="openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.topic }}</strong>
                  <span class="mk-cell-sub">{{ r.subject }} · {{ taskTypeText(r.taskType) }}</span>
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
                  <span class="mk-cell-sub">{{ r.email }}</span>
                </div>
                <div class="ts-tags">
                  <span v-if="r.isVirtualLearner" class="mk-badge mk-badge--sm mk-badge--virtual" title="虚拟学习者（仿真数据，可再生成）">虚拟</span>
                  <span v-else-if="r.isTestAccount" class="mk-badge mk-badge--sm mk-badge--warn" title="测试/审计账号">测试</span>
                </div>
              </td>
              <td v-if="!tsHiddenCols.has('status')"><span class="mk-badge" :class="statusBadge(r.status)">{{ statusText(r.status) }}</span></td>
              <td v-if="!tsHiddenCols.has('interact')">
                <span class="mk-num">{{ r.duration ? fmtDuration(r.duration) : '—' }} · {{ r.messageCount }} 条</span>
                <span v-if="r.knowledgePointCount" class="mk-cell-sub">知识 {{ r.knowledgePointCount }} 点</span>
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
                <span class="mk-badge" :class="r.wrapupStatus === 'complete' ? 'mk-badge--ok' : 'mk-badge--muted'">
                  {{ r.wrapupStatus === 'complete' ? '有总结' : '缺总结' }}
                </span>
                <span v-if="r.hasAdvisory" class="mk-badge" :class="advisoryBadge(r.advisory?.priority)" style="margin-left:4px">建议</span>
              </td>
              <td v-if="!tsHiddenCols.has('attention')">
                <span
                  class="ts-att"
                  :class="`ts-att--${r.attention}`"
                  :title="r.attention === 'high' ? '高关注：需优先介入' : r.attention === 'medium' ? '中关注' : '低关注'"
                >{{ r.attention === 'high' ? '高' : r.attention === 'medium' ? '中' : '低' }}</span>
              </td>
              <td>
                <div class="ts-actions">
                  <button type="button" class="mk-icon-btn" title="链路" @click.stop="goTrace(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg></button>
                  <button v-if="r.id" type="button" class="mk-icon-btn" title="控制台" @click.stop="goConsole(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/></svg></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-else-if="!loadFailed" class="mk-empty">
          <strong>{{ rows.length ? '当前筛选无会话' : '暂无教学会话' }}</strong>
          <span>{{ rows.length ? '放宽筛选条件试试。' : '学习者开始上课后，会话记录将自动出现在这里。' }}</span>
          <button v-if="isFiltered && rows.length" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
        </div>
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

    <!-- 详情抽屉 -->
    <Teleport to="body">
      <div v-if="detail" ref="maskRef" class="ts-mask">
        <aside ref="panelRef" class="ts-panel" role="dialog" aria-label="会话详情">
          <header class="ts-panel__head">
            <div class="ts-panel__title">
              <span class="mk-badge" :class="attentionBadge(detail.attention)">
                {{ detail.attention === 'high' ? '高关注' : detail.attention === 'medium' ? '中关注' : '低关注' }}
              </span>
              <h3>{{ detail.topic }}</h3>
              <span class="ts-panel__id">{{ detail.id }}</span>
            </div>
            <button type="button" class="ts-panel__close" aria-label="关闭" @click="closeDetail">✕</button>
          </header>

          <div class="ts-panel__body">
            <!-- P2-2 抽屉 tabs（对齐 LangSmith side panel） -->
            <div class="ts-tabs" role="tablist" aria-label="会话详情分区">
              <button
                v-for="t in panelTabs"
                :key="t.id"
                type="button"
                class="ts-tabs__item"
                :class="{ 'ts-tabs__item--on': panelTab === t.id }"
                role="tab"
                :aria-selected="panelTab === t.id"
                @click="panelTab = t.id"
              >{{ t.label }}</button>
            </div>

            <!-- 概览 tab -->
            <div v-if="panelTab === 'overview'">
              <div class="ts-facts">
                <div><span>用户</span><strong>{{ detail.userName }}</strong></div>
                <div><span>学科</span><strong>{{ detail.subject }}</strong></div>
                <div><span>状态</span><strong>{{ statusText(detail.status) }}</strong></div>
                <div><span>开始</span><strong>{{ detail.startAt }}</strong></div>
                <div><span>时长</span><strong>{{ detail.duration ? fmtDuration(detail.duration) : '—' }}</strong></div>
                <div><span>消息</span><strong>{{ detail.messageCount }}</strong></div>
              </div>

              <!-- 事件时间线（P2-2：非消息事件，对齐 Intercom 左对齐垂直线） -->
              <section v-if="timelineOf(detail).length" class="ts-section">
                <h4>事件时间线</h4>
                <ul class="ts-timeline">
                  <li v-for="(ev, i) in timelineOf(detail)" :key="i" class="ts-timeline__item" :class="`ts-timeline__item--${ev.tone}`">
                    <span class="ts-timeline__dot" aria-hidden="true"></span>
                    <div class="ts-timeline__body">
                      <strong>{{ ev.text }}</strong>
                      <span>{{ ev.time }}</span>
                    </div>
                  </li>
                </ul>
              </section>
            </div>

            <!-- 总结 tab -->
            <div v-if="panelTab === 'wrapup'">
              <section v-if="detail.wrapup" class="ts-section">
                <h4>会话总结 <span class="ts-src">来源：<span class="mk-badge" :class="detail.wrapupSource === '模型生成' ? 'mk-badge--info' : 'mk-badge--muted'">{{ detail.wrapupSource }}</span></span></h4>
                <div class="ts-card" v-if="detail.wrapup.topicSummary">
                  <span>主题摘要</span>
                  <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('topic') }">{{ detail.wrapup.topicSummary }}</p>
                  <button v-if="isLong(detail.wrapup.topicSummary)" type="button" class="ts-more" @click="toggleCard('topic')">{{ openCards.has('topic') ? '收起' : '展开全文' }}</button>
                </div>
                <div class="ts-card" v-if="detail.wrapup.knowledgeSummary">
                  <span>知识总结</span>
                  <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('knowledge') }">{{ detail.wrapup.knowledgeSummary }}</p>
                  <button v-if="isLong(detail.wrapup.knowledgeSummary)" type="button" class="ts-more" @click="toggleCard('knowledge')">{{ openCards.has('knowledge') ? '收起' : '展开全文' }}</button>
                </div>
                <div class="ts-card" v-if="detail.wrapup.practiceAdvice">
                  <span>练习建议</span>
                  <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('practice') }">{{ detail.wrapup.practiceAdvice }}</p>
                  <button v-if="isLong(detail.wrapup.practiceAdvice)" type="button" class="ts-more" @click="toggleCard('practice')">{{ openCards.has('practice') ? '收起' : '展开全文' }}</button>
                </div>
                <div class="ts-card" v-if="detail.wrapup.learningEvaluation">
                  <span>学习评估</span>
                  <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('evaluation') }">{{ detail.wrapup.learningEvaluation }}</p>
                  <button v-if="isLong(detail.wrapup.learningEvaluation)" type="button" class="ts-more" @click="toggleCard('evaluation')">{{ openCards.has('evaluation') ? '收起' : '展开全文' }}</button>
                </div>
              </section>
              <p v-else class="ts-empty">该会话暂无课后总结。</p>
            </div>

            <!-- 建议 tab -->
            <div v-if="panelTab === 'advisory'">
              <section v-if="detail.advisory && detail.advisory.priority && detail.advisory.priority !== 'none'" class="ts-section">
                <h4>额外建议</h4>
                <div class="ts-card ts-card--advisory">
                  <span>优先级 {{ detail.advisory.priority || '—' }}<template v-if="detail.advisory.title"> · {{ detail.advisory.title }}</template></span>
                  <p class="ts-clamp" :class="{ 'ts-clamp--open': openCards.has('advisory') }">{{ detail.advisory.text || '—' }}</p>
                  <button v-if="isLong(detail.advisory.text)" type="button" class="ts-more" @click="toggleCard('advisory')">{{ openCards.has('advisory') ? '收起' : '展开全文' }}</button>
                </div>
              </section>
              <p v-else class="ts-empty">该会话暂无额外建议。</p>
            </div>

            <!-- 原始数据 tab -->
            <div v-if="panelTab === 'raw'">
              <details class="ts-section ts-raw" open>
                <summary>原始数据</summary>
                <pre class="ts-json">{{ detail.rawJson }}</pre>
              </details>
            </div>

            <div class="ts-actions">
              <button v-if="detail.userId" type="button" class="mk-link" @click="goLearner(detail)">学习者详情 →</button>
              <button type="button" class="mk-link" @click="goTrace(detail)">Trace 链路 →</button>
              <button v-if="detail.id" type="button" class="mk-link" @click="goConsole(detail)">进控制台 →</button>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dataSource, openSession, openSubPage } from './store'
import { timeAgo, isPageCacheFresh, markPageFetched } from './live'
import { statusText, sessionProgressPct, sessionProgressText, sessionProgressTone, sessionProgressDone } from './statusText'
import type { SessionProgress } from './statusText'
import { useOverlay, useMaskClose } from './useOverlay'
import { adminTeachingSessionsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useSafePolling } from '@/composables/useSafePolling'
import MockSkeletonTable from './SkeletonTable.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import Pagination from './Pagination.vue'
import MkCols from './MkCols.vue'

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
  wrapupSource: string
  advisory: { title: string; text: string; priority: string } | null
  rawJson: string
  progress: SessionProgress | null
}

const rows = ref<Row[]>([])
const refreshing = ref(false)
const loadFailed = ref(false)

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；切换「含虚拟·测试」后重拉全量并灰标虚拟/测试行 */
const includeTest = ref(false)

/* 静默拉取：成功即整表替换；失败保留旧数据（轮询不闪空态），并标记错误条。
   force = true 绕过页面级 TTL 缓存（显式刷新/口径切换/轮询用） */
async function fetchRows(force = false): Promise<boolean> {
  // 页面级 TTL 缓存：切换页面回来时跳过重复请求（轮询/显式刷新传 force 不受影响）
  if (!force && isPageCacheFresh('teaching-sessions') && rows.value.length) return true
  try {
    const res = await adminTeachingSessionsApi.list({ limit: 100, includeTest: includeTest.value })
    const body = res.data?.data ?? res.data ?? {}
    const items = body.items || []
    rows.value = items.map((s: Record<string, unknown>) => mapRow(s))
    loadFailed.value = false
    markPageFetched('teaching-sessions')
    return true
  } catch {
    loadFailed.value = true
    return false
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

/* 数据隔离切换：仅真实 ↔ 含虚拟/测试（切换后立即按新口径重拉） */
watch(includeTest, () => {
  refreshing.value = true
  void fetchRows(true).finally(() => {
    refreshing.value = false
  })
})

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
  const attention: Row['attention'] =
    s.status === 'failed' || s.status === 'timeout' || (s.status === 'completed' && wrapupStatus === 'missing')
      ? 'high'
      : advisoryRelevant && advisory?.priority === 'high'
        ? 'high'
        : advisoryRelevant
          ? 'medium'
          : 'low'
  return {
    id: String(s.id),
    userId: String(s.userId || ''),
    topic: String(s.topic || s.taskId || '未命名会话'),
    subject: String(s.subject || '—'),
    taskType: String(s.taskType || ''),
    userName: String(s.userName || s.userId),
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
    wrapupSource: (wrapup?.sources as Record<string, string>)?.summary === 'model' ? '模型生成' : '规则/其他',
    advisory,
    rawJson: JSON.stringify({ wrapup, advisory }, null, 2),
    progress: (s.progress as SessionProgress) || null
  }
}

/* 筛选 */
const pill = ref<'all' | 'attention' | 'missing'>('all')
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
] as const
const tsHiddenCols = ref<Set<string>>(new Set())
const pills = [
  { id: 'all' as const, label: '全部' },
  { id: 'attention' as const, label: '待关注' },
  { id: 'missing' as const, label: '缺总结' }
]
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

const filtered = computed(() => {
  let list = rows.value
  if (pill.value === 'attention') list = list.filter((r) => r.attention !== 'low')
  if (pill.value === 'missing') list = list.filter((r) => r.wrapupStatus === 'missing')
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
  return list
})

const isFiltered = computed(() => pill.value !== 'all' || !!statusFilter.value || !!dateFilter.value || !!keyword.value.trim())
function clearFilters() {
  pill.value = 'all'
  statusFilter.value = ''
  dateFilter.value = ''
  keyword.value = ''
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
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

const inProgressCount = computed(() => rows.value.filter((r) => r.status === 'active').length)
const advisoryCount = computed(() => rows.value.filter((r) => r.hasAdvisory).length)
const missingWrapupCount = computed(() => rows.value.filter((r) => r.wrapupStatus === 'missing').length)
const attentionCount = computed(() => rows.value.filter((r) => r.attention !== 'low').length)

/* ===== 教学概览（ts-dash：会话域结论，状态条承载） ===== */
const highAttentionCount = computed(() => rows.value.filter((r) => r.attention === 'high').length)
const tsDashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() => {
  if (!rows.value.length) return 'muted'
  if (missingWrapupCount.value > 0) return 'warn'
  if (attentionCount.value > 0) return 'warn'
  return 'ok'
})

/* 详情 — URL 同步 ?session=id 支持深链/刷新恢复 */
const detail = ref<Row | null>(null)
/* P2-2 抽屉 tabs（概览/总结/建议/原始数据） */
const panelTab = ref<'overview' | 'wrapup' | 'advisory' | 'raw'>('overview')
const panelTabs = [
  { id: 'overview' as const, label: '概览' },
  { id: 'wrapup' as const, label: '总结' },
  { id: 'advisory' as const, label: '建议' },
  { id: 'raw' as const, label: '原始数据' }
]
/** 事件时间线（P2-2）：由行数据派生非消息事件，按时间倒序 */
function timelineOf(r: Row): Array<{ text: string; time: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> {
  const events: Array<{ text: string; time: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = []
  events.push({ text: '会话开始', time: r.startAt, tone: 'muted' })
  if (r.status === 'completed' || r.status === 'succeeded') {
    events.push({ text: '会话完成', time: r.startAt, tone: 'ok' })
  } else if (r.status === 'failed' || r.status === 'timeout') {
    events.push({ text: `会话${r.status === 'timeout' ? '超时' : '失败'}`, time: r.startAt, tone: 'bad' })
  } else if (r.status === 'active' || r.status === 'initializing' || r.status === 'finalizing') {
    events.push({ text: '会话进行中', time: r.startAt, tone: 'muted' })
  }
  if (r.wrapupStatus === 'complete' && r.wrapup) {
    events.push({ text: `课后总结生成（${r.wrapupSource}）`, time: r.startAt, tone: 'ok' })
  } else if (r.wrapupStatus === 'missing') {
    events.push({ text: '缺少课后总结', time: r.startAt, tone: 'warn' })
  }
  if (r.hasAdvisory && r.advisory) {
    events.push({ text: `建议触发（优先级 ${r.advisory.priority}）`, time: r.startAt, tone: r.advisory.priority === 'high' ? 'bad' : 'warn' })
  }
  return events
}
const route = useRoute()
const router = useRouter()
/** 深链存在但列表加载后仍未命中（超出最近 100 条 / 已删除） */
const deepLinkMiss = ref(false)
watch(
  // 同时监听行数：刷新场景下 immediate 触发时 rows 尚未返回，仅监听 query 会错过恢复时机
  [() => route.query.session, () => rows.value.length],
  ([sid]) => {
    const id = typeof sid === 'string' ? sid : ''
    if (id && (!detail.value || detail.value.id !== id)) {
      const r = rows.value.find((x) => x.id === id)
      if (r) { detail.value = r; openCards.value = new Set(); deepLinkMiss.value = false }
      else {
        detail.value = null
        deepLinkMiss.value = rows.value.length > 0
      }
    } else if (!id && detail.value) {
      detail.value = null
      deepLinkMiss.value = false
    }
  },
  { immediate: true }
)
useEscape(() => !!detail.value, closeDetail)
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!detail.value), panelRef)
useMaskClose(maskRef, closeDetail)
const openCards = ref<Set<string>>(new Set())

/** 关闭详情面板并同步清除 URL 中的 ?session= 深链参数 */
function closeDetail() {
  detail.value = null
  const q = { ...route.query }; delete q.session; void router.replace({ query: q })
}

function openDetail(r: Row) {
  detail.value = r
  openCards.value = new Set()
  void router.push({ query: { ...route.query, session: r.id } })
}

/** 真实教学会话与控制台数据契约不兼容（座舱仅服务虚拟会话）：轻量深链 = 学习者详情 / Trace 瀑布按 sessionId 归组 */
function goLearner(r: Row) {
  if (!r.userId) return
  detail.value = null
  openSubPage('learner', r.userId)
}

function goTrace(r: Row) {
  detail.value = null
  openSession(r.id)
}

/** 真实会话进控制台（双模式）：session-real 只读座舱，经 /admin/session-console 同构映射渲染 */
function goConsole(r: Row) {
  if (!r.id) return
  detail.value = null
  openSubPage('session-real', r.id)
}

function toggleCard(key: string) {
  const next = new Set(openCards.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openCards.value = next
}

const isLong = (s?: string) => (s || '').length > 120

/* 状态映射统一走共享字典（对齐后端枚举：initializing/active/paused/timeout/superseded/failed/finalizing/finalization_failed/completed/discarded） */
/* 状态徽章降噪（P0-5）：只对异常态上色，正常态统一灰——对齐 Langfuse「只有
   ERROR/WARNING 上色」；completed/succeeded 不再绿（绿留给业务正向信号） */
const statusBadge = (s: string) =>
  s === 'failed' || s === 'timeout' || s === 'discarded' || s === 'finalization_failed'
    ? 'mk-badge--bad'
    : s === 'superseded'
      ? 'mk-badge--warn'
      : 'mk-badge--muted'
const attentionBadge = (a: string) => (a === 'high' ? 'mk-badge--bad' : a === 'medium' ? 'mk-badge--warn' : 'mk-badge--ok')
/* 建议徽章带优先级色（T3）：high=bad / medium=warn / 其余 info */
const advisoryBadge = (p?: string) => (p === 'high' ? 'mk-badge--bad' : p === 'medium' ? 'mk-badge--warn' : 'mk-badge--info')
const taskTypeText = (t: string) =>
  ({ reading: '阅读', practice: '练习', project: '项目', quiz: '测验', acquire: '获取', deconstruct: '拆解', model: '建模', execute: '执行', diagnose: '诊断', refine: '打磨', consolidate: '巩固' }[t] || t || '任务')
const fmtDuration = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)} 分钟` : `${sec} 秒`)
/** 进度工具提示（人话）：阶段 n/m · 任务 x/y；无里程碑维度只给任务 */
function progressTitle(r: Row): string {
  const p = r.progress
  if (!p) return ''
  if (p.totalMilestones > 0 && p.milestoneIndex > 0) return `阶段 ${p.milestoneIndex}/${p.totalMilestones} · 任务 ${p.taskIndex}/${p.totalTasks}`
  return `任务 ${p.taskIndex}/${p.totalTasks}`
}
</script>

<style scoped>
/* 页头合并（替代独立状态条）：共 N 条 + 刷新按钮，与概览结论同行 */
.ts-head-meta { font-size: var(--mk-fs-12_5); color: var(--mk-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* 页头计数锚点（与学习者中心 lc-count-link 同形态）：缺总结/高关注可点击筛选 */
.ts-count-link {
  border: 0; background: transparent; padding: 2px 6px;
  font: inherit; font-size: var(--mk-fs-12_5); font-weight: 700;
  color: var(--mk-muted); cursor: pointer; border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.ts-count-link:hover { color: var(--mk-blue); background: rgba(44, 99, 208, 0.08); }
.ts-count-link--on { color: var(--mk-blue); background: rgba(44, 99, 208, 0.12); }
/* 总结预览行（P1-2）：单行 ellipsis + hover 全文，对齐 Intercom 最后消息预览 */
.ts-summary-preview {
  display: block;
  max-width: 320px;
  margin-top: 3px;
  font-size: var(--mk-fs-12);
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: help;
}
.ts-summary-preview::before { content: '📝 '; opacity: 0.7; }
.ts-row { cursor: pointer; position: relative; }
/* 关注度行首色条（P0-5）：高关注红 / 中关注琥珀 / 低关注透明——扫视被红色拉住 */
.ts-row--att-high { box-shadow: inset 3px 0 0 var(--mk-red); }
.ts-row--att-medium { box-shadow: inset 3px 0 0 var(--mk-amber); }
/* 关注度列：小色点 + 文字（从徽章降级，不占徽章位） */
.ts-att { font-size: var(--mk-fs-12); font-weight: 700; color: var(--mk-faint); white-space: nowrap; }
.ts-att--high { color: var(--mk-red); }
.ts-att--medium { color: var(--mk-amber); }
.ts-att--low { color: var(--mk-faint); }
/* 虚拟/测试行灰标（数据隔离 A3：includeTest 切换后显式标记） */
.ts-tags { display: flex; gap: 6px; margin-top: 2px; }
.ts-tag {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.03em;
}
.ts-tag--virtual { background: #f1f5f9; color: #64748b; border: 1px dashed #cbd5e1; }
.ts-tag--test { background: #fef3c7; color: #b45309; }
/* 会话列副行上限 300px（原 387px 由 sub 行撑开；主行 260px 由 --mk-cell-main-max 兜底） */
.ts-row td:first-child .mk-cell-sub { max-width: 300px; }
/* 进度列：数字 x/y + 迷你条（mk-minibar 复用，会话域统一进度表达） */
.ts-prog { display: grid; gap: 4px; max-width: 96px; }
.ts-prog__num { font-variant-numeric: tabular-nums; font-size: var(--mk-fs-12); font-weight: 700; white-space: nowrap; }
.ts-prog__bar { width: 88px; height: 5px; }
/* 终态完成列（P1 语义修复）：只显「已完成」文字，不再与进度条并存；title 保留历史进度 */
.ts-prog--done {
  display: inline-flex;
  align-items: center;
  color: var(--mk-green);
  font-size: var(--mk-fs-12);
  font-weight: 700;
  white-space: nowrap;
}
.ts-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.ts-actions .mk-link { padding: 0; }
/* 状态徽章：固定最小宽度，筛选不同状态时列宽不跳动（"已被替代"最长 4 字） */
.ts-row td:nth-child(3) .mk-badge { min-width: 60px; justify-content: center; }
.ts-go { color: var(--mk-faint); font-weight: 700; }
.ts-row:hover .ts-go { color: var(--mk-blue); }

/* 加载失败错误条 */
.ts-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
}

.ts-mask {
  position: fixed;
  inset: 0;
  z-index: var(--mk-z-drawer);
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.ts-panel {
  width: min(560px, 100vw);
  height: 100%;
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-drawer);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: ts-in 0.2s ease;
}

/* 4K 断点见文件末尾（需在基础样式之后定义） */
@keyframes ts-in { from { transform: translateX(30px); opacity: 0; } }
.ts-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--mk-line);
}
.ts-panel__title { display: grid; gap: 6px; justify-items: start; }
.ts-panel__title h3 { margin: 0; font-size: var(--mk-fs-16); }
.ts-panel__id { font-family: var(--mk-mono); font-size: var(--mk-fs-11); color: var(--mk-faint); word-break: break-all; }
.ts-panel__close { border: 0; background: var(--mk-close-bg, #f0f2f5); width: 30px; height: 30px; border-radius: 8px; cursor: pointer; color: var(--mk-muted); transition: background 0.12s, color 0.12s; }
.ts-panel__close:hover { background: var(--mk-line, #e2eaf7); color: var(--mk-ink); }
.ts-panel__body { padding: 16px 18px; display: grid; gap: 16px; align-content: start; overflow-y: auto; }
/* P2-2 抽屉 tabs（对齐 AntD Tabs 下划线式：选中态底部 2px 品牌蓝 + 蓝字） */
.ts-tabs { display: flex; gap: 2px; padding-bottom: 0; border-bottom: 1px solid var(--mk-line); position: sticky; top: 0; background: var(--mk-surface); z-index: 1; }
html[data-theme='dark'] .ts-tabs { background: var(--mk-surface); }
.ts-tabs__item {
  border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 7px 12px;
  margin-bottom: -1px; border-radius: 0; font: inherit; font-size: var(--mk-fs-12_5); font-weight: 600;
  color: var(--mk-muted); cursor: pointer; transition: color 0.12s ease, border-color 0.12s ease;
}
.ts-tabs__item:hover { color: var(--mk-ink); }
.ts-tabs__item--on { border-bottom-color: var(--mk-blue); color: var(--mk-blue); font-weight: 700; }
.ts-empty { margin: 0; font-size: var(--mk-fs-12_5); color: var(--mk-faint); padding: 12px 0; }
/* P2-2 事件时间线（左对齐垂直线，对齐 Intercom） */
.ts-timeline { margin: 0; padding: 0; list-style: none; display: grid; gap: 0; }
.ts-timeline__item { display: flex; gap: 10px; padding: 7px 0; position: relative; }
.ts-timeline__item::before { content: ''; position: absolute; left: 4px; top: 18px; bottom: -7px; width: 1px; background: var(--mk-line); }
.ts-timeline__item:last-child::before { display: none; }
.ts-timeline__dot { width: 9px; height: 9px; border-radius: 50%; background: var(--mk-faint); flex-shrink: 0; margin-top: 4px; z-index: 1; box-shadow: 0 0 0 2px var(--mk-surface); }
html[data-theme='dark'] .ts-timeline__dot { box-shadow: 0 0 0 2px var(--mk-surface); }
.ts-timeline__item--ok .ts-timeline__dot { background: var(--mk-green); }
.ts-timeline__item--warn .ts-timeline__dot { background: var(--mk-amber); }
.ts-timeline__item--bad .ts-timeline__dot { background: var(--mk-red); }
.ts-timeline__body { display: grid; gap: 1px; min-width: 0; }
.ts-timeline__body strong { font-size: var(--mk-fs-12_5); color: var(--mk-ink); }
.ts-timeline__body span { font-size: var(--mk-fs-11); color: var(--mk-faint); }

.ts-facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.ts-facts > div { display: grid; gap: 2px; }
.ts-facts span { font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 600; }
.ts-facts strong { font-size: var(--mk-fs-12_5); }

@media (max-width: 560px) {
  .ts-facts { grid-template-columns: repeat(2, 1fr); }
}

.ts-section { display: grid; gap: 8px; }
.ts-section h4 {
  margin: 0;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
  display: flex;
  align-items: center;
  gap: 8px;
}
.ts-src { font-size: var(--mk-fs-11); font-weight: 600; text-transform: none; letter-spacing: 0; }
.ts-card {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}
.ts-card span { font-size: var(--mk-fs-11); color: var(--mk-faint); font-weight: 700; }
.ts-card p { margin: 0; font-size: var(--mk-fs-12_5); line-height: 1.7; white-space: pre-wrap; }
.ts-card--advisory { border-color: rgba(180, 83, 9, 0.3); background: #fffdf5; }

/* 长文本截断 */
.ts-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ts-clamp--open { -webkit-line-clamp: unset; overflow: visible; }
.ts-more {
  justify-self: start;
  border: 0;
  background: transparent;
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}
.ts-raw summary {
  cursor: pointer;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
  padding: 2px 0;
}
.ts-json {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--mk-code-bg);
  color: var(--mk-code-fg);
  font: 10.5px/1.6 var(--mk-mono);
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 4K：抽屉加宽 + 字号跟随壳层放大（置于基础样式之后确保覆盖） */
@media (min-width: 2000px) {
  .ts-panel { width: min(700px, 100vw); }
  .ts-panel__head { padding: 20px 24px; }
  .ts-panel__title h3 { font-size: 19px; }
  .ts-panel__id { font-size: 12.5px; }
  .ts-panel__body { padding: 20px 24px; }
  .ts-facts span { font-size: 13px; }
  .ts-facts strong { font-size: 14.5px; }
  .ts-section h4 { font-size: 13px; }
  .ts-card p { font-size: 14.5px; }
  .ts-card span { font-size: 13px; }
  .ts-json { font-size: 12.5px; }
  .ts-more { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .ts-panel { width: min(880px, 100vw); }
  .ts-panel__head { padding: 24px 30px; }
  .ts-panel__title h3 { font-size: 23px; }
  .ts-panel__id { font-size: 15px; }
  .ts-panel__body { padding: 24px 30px; }
  .ts-facts span { font-size: 15.5px; }
  .ts-facts strong { font-size: 17px; }
  .ts-section h4 { font-size: 15.5px; }
  .ts-card p { font-size: 17px; }
  .ts-card span { font-size: 15.5px; }
  .ts-json { font-size: 15px; }
  .ts-more { font-size: 16px; }
}
/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
  .ts-panel { width: min(1040px, 100vw); }
  .ts-panel__head { padding: 28px 36px; }
  .ts-panel__title h3 { font-size: 27px; }
  .ts-panel__id { font-size: 17.5px; }
  .ts-panel__body { padding: 28px 36px; }
  .ts-facts span { font-size: 18px; }
  .ts-facts strong { font-size: 20px; }
  .ts-section h4 { font-size: 18px; }
  .ts-card p { font-size: 20px; }
  .ts-card span { font-size: 18px; }
  .ts-json { font-size: 17.5px; }
  .ts-more { font-size: 18.5px; }
}

/* ================= 暗色模式（D1 补完）：教学会话 ================= */
html[data-theme='dark'] {
  .ts-mask { background: rgba(4, 8, 16, 0.55); }
  .ts-tag--virtual { background: #1c2637; color: #8fa3bd; border-color: #33415c; }
  .ts-tag--test { background: rgba(251, 191, 36, 0.16); color: #fcd34d; }
  .ts-panel__close { background: #232f45; color: var(--mk-muted); }
  .ts-panel__close:hover { background: #2c3a55; color: var(--mk-ink); }
  .ts-card--advisory { background: #2a2410; border-color: rgba(251, 191, 36, 0.3); }
  .ts-json { background: #0f1624; color: #c6d4ea; }
}

</style>
