<template>
  <div class="mk-page mk-page--fill">
    <!-- 目标对话页头（单行状态条：结论 + 堆叠条 + 可点击计数 + 刷新；与教学会话统一形态） -->
    <div class="mk-status" :class="gcDashTone === 'bad' ? 'mk-status--bad' : gcDashTone === 'warn' ? 'mk-status--warn' : gcDashTone === 'muted' ? 'mk-status--muted' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ gcDashTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">{{ gcDashSubline }}</span>
      <div v-if="isLive && stats && stats.total > 0" class="gc-stack gc-stack--inline" :title="`进行中 ${stats.active} · 已完成 ${stats.completed} · 其他 ${stackOther}`">
        <span class="gc-stack__bar">
          <i class="gc-stack__seg gc-stack__seg--active" :style="{ width: stackPct('active') }"></i>
          <i class="gc-stack__seg gc-stack__seg--completed" :style="{ width: stackPct('completed') }"></i>
          <i class="gc-stack__seg gc-stack__seg--cancelled" :style="{ width: stackPct('other') }"></i>
        </span>
      </div>
      <button
        type="button"
        class="gc-count-link"
        :class="{ 'gc-count-link--on': statusFilter === 'active' }"
        title="点击筛选「进行中」对话"
        @click="statusFilter = statusFilter === 'active' ? '' : 'active'"
      >进行中 {{ stats?.active ?? 0 }}</button>
      <button
        type="button"
        class="gc-count-link"
        :class="{ 'gc-count-link--on': statusFilter === 'completed' }"
        title="点击筛选「已完成」对话"
        @click="statusFilter = statusFilter === 'completed' ? '' : 'completed'"
      >已完成 {{ stats?.completed ?? 0 }}</button>
      <span v-if="stackOther" class="mk-status__meta">待澄清 {{ stackOther }}</span>
      <span v-if="isLive && stats" class="mk-status__meta" title="仅真实用户（不含模拟账号）；切换「含模拟」后显示全量并灰标模拟行">共 {{ stats.total }} 条 · 近 30 天</span>
      <button type="button" class="mk-status__action" :disabled="loading" @click="load(true)">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </div>

    <!-- 非 live：无演示数据 -->
    <div v-if="!isLive" class="mk-empty">
      <strong>暂无 Goal 会话数据</strong>
      <span>刷新或切换到真实数据查看。</span>
    </div>

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
                @click="statusFilter = statusFilter === p.id ? '' : p.id"
              >
                {{ p.label }}
              </button>
            </div>
            <input v-model="keyword" class="mk-filter__input" placeholder="搜索用户 / 邮箱 / 目标摘要" />
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

        <MockSkeletonTable v-if="loading && !rows.length" :cols="6" />
        <!-- P0 修复：加载失败行内错误 + 重试（此前失败伪装成「暂无会话」） -->
        <div v-else-if="loadError" class="gc-error" role="alert">
          <span>{{ loadError }}</span>
          <button type="button" class="mk-link" @click="load(true)">重试</button>
        </div>
        <div v-else-if="filtered.length" class="mk-table-scroll">
        <table class="mk-table mk-table--fixed">
          <thead>
            <tr>
              <th style="width:160px">用户</th>
              <th v-if="!gcHiddenCols.has('summary')" style="width:35%">目标摘要</th>
              <th v-if="!gcHiddenCols.has('status')" class="mk-col--badge">状态</th>
              <th v-if="!gcHiddenCols.has('stage')" style="width:160px">阶段</th>
              <th v-if="!gcHiddenCols.has('path')" class="mk-col--badge">路径</th>
              <th v-if="!gcHiddenCols.has('created')" class="mk-col--time-full">创建时间</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paged" :key="r.id" class="gc-row" @click="openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.userName }}</strong>
                  <span class="mk-cell-sub">{{ r.userEmail }}</span>
                </div>
                <div class="gc-tags">
                  <span v-if="r.isVirtualLearner" class="mk-badge mk-badge--sm mk-badge--virtual" title="虚拟学习者（仿真数据，可再生成）">虚拟</span>
                  <span v-else-if="r.isTestAccount" class="mk-badge mk-badge--sm mk-badge--warn" title="测试/审计账号">测试</span>
                </div>
              </td>
              <td v-if="!gcHiddenCols.has('summary')"><span class="gc-summary" :title="r.summary">{{ r.summary }}</span></td>
              <td v-if="!gcHiddenCols.has('status')"><span class="mk-badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td v-if="!gcHiddenCols.has('stage')">
                <div class="gc-stage-cell">
                  <div class="gc-stage-cell__head">
                    <span class="mk-badge" :class="stageBadgeCls(r.stage)" :title="`阶段：${stageText(r.stage) || '—'}`">{{ stageText(r.stage) || '—' }}</span>
                    <span v-if="r.timeline" class="gc-stage-cell__dots" :title="stageDotsTitle(r)" aria-label="阶段进度">
                      <i v-for="d in GOAL_STAGE_TOTAL" :key="d" class="gc-stage-cell__dot" :class="{ 'is-on': d <= r.stageIndex + 1 }"></i>
                    </span>
                  </div>
                  <span v-if="r.timeline" class="gc-stage-cell__tl" :title="r.timeline">{{ r.timeline }}</span>
                  <span v-else class="mk-na">—</span>
                </div>
              </td>
              <td v-if="!gcHiddenCols.has('path')">
                <span v-if="r.hasPath" class="mk-badge mk-badge--info">已生成</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td v-if="!gcHiddenCols.has('created')"><span class="mk-cell-sub" :title="r.createdAt">{{ r.createdAt }}</span></td>
              <td>
                <div class="mk-actions mk-actions--left">
                  <button type="button" class="mk-icon-btn" title="链路" @click.stop="goTrace(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg></button>
                  <button type="button" class="mk-icon-btn" title="控制台" @click.stop="goConsole(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/></svg></button>
                  <button type="button" class="mk-icon-btn" :disabled="r.regenerating" :title="r.regenerating ? '生成中…' : '重建路径'" @click.stop="regenerate(r)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg></button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu(r.id)">⋯</button>
                    <div v-if="openMenu === r.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuRemove(r)">删除会话</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <div v-else class="mk-empty">
          <span v-if="!loading" class="mk-empty__icon" aria-hidden="true">◌</span>
          <strong>{{ loading ? '加载中…' : (keyword || statusFilter ? '当前筛选无匹配' : '暂无目标对话') }}</strong>
          <span v-if="!loading">{{ keyword || statusFilter ? '放宽筛选条件试试。' : (includeTest ? '全量口径下暂无目标对话。' : '默认仅展示真实用户；切换「含模拟」可查看全部。') }}</span>
          <button v-if="isFiltered && !loading" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
        </div>
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

    <!-- 详情面板 -->
    <Teleport to="body">
      <div v-if="detail" ref="maskRef" class="gc-mask">
        <aside ref="panelRef" class="gc-panel" role="dialog" aria-label="会话详情">
          <header class="gc-panel__head">
            <div class="gc-panel__title">
              <span class="mk-badge" :class="statusBadge(detail.status)">{{ statusLabel(detail.status) }}</span>
              <h3>{{ detail.userName }} 的目标对话</h3>
              <span class="gc-panel__id mono">{{ detail.id }}</span>
            </div>
            <button type="button" class="gc-panel__close" aria-label="关闭" @click="closeDetail">✕</button>
          </header>
          <div ref="bodyRef" class="gc-panel__body">
            <div class="gc-facts">
              <div><span>邮箱</span><strong :title="detail.userEmail">{{ detail.userEmail || '—' }}</strong></div>
              <div>
                <span>置信度</span>
                <strong v-if="detailConfidence !== null" class="gc-conf-row">
                  <span class="gc-conf" :class="confToneCls(detailConfidence)">{{ detailConfidence }}%</span>
                  <span class="mk-minibar gc-conf__bar">
                    <i class="mk-minibar__fill" :data-tone="confTone(detailConfidence)" :style="{ width: detailConfidence + '%' }"></i>
                  </span>
                </strong>
                <strong v-else>—</strong>
              </div>
              <div><span>关联路径</span><strong>{{ detail.hasPath ? '已生成' : '未生成' }}</strong></div>
              <div><span>创建</span><strong>{{ detail.createdAt }}</strong></div>
              <div><span>更新</span><strong>{{ detail.updatedAt }}</strong></div>
              <div><span>完成</span><strong>{{ detail.completedAt || '—' }}</strong></div>
            </div>

            <p v-if="detailLoading" class="gc-none"><span class="mk-spinner" aria-hidden="true"></span> 正在加载对话详情…</p>

            <!-- P0 修复：详情加载失败行内提示 + 重试 -->
            <div v-if="detailError" class="gc-error" role="alert">
              <span>{{ detailError }}</span>
              <button type="button" class="mk-link" @click="retryDetail">重试</button>
            </div>

            <section v-if="detail.description" class="gc-section">
              <h4>目标描述</h4>
              <p class="gc-desc">{{ detail.description }}</p>
            </section>

            <!-- 理解与方案（结构化卡片） -->
            <section
              v-if="detailUnderstanding.realProblem || detailUnderstanding.successCriterion || detailProposal.direction || detailProposal.stages.length"
              class="gc-section"
            >
              <h4>理解与方案</h4>
              <div class="gc-insight">
                <div v-if="detailUnderstanding.realProblem" class="gc-insight__row">
                  <span>真实问题</span>
                  <p>{{ detailUnderstanding.realProblem }}</p>
                </div>
                <div v-if="detailUnderstanding.successCriterion" class="gc-insight__row">
                  <span>成功标准</span>
                  <p>{{ detailUnderstanding.successCriterion }}</p>
                </div>
                <div v-if="detailUnderstanding.timeBudget" class="gc-insight__row">
                  <span>时间预算</span>
                  <p>{{ detailUnderstanding.timeBudget }}</p>
                </div>
                <div v-if="detailProposal.direction" class="gc-insight__row">
                  <span>学习方向</span>
                  <p>{{ detailProposal.direction }}</p>
                </div>
                <div v-if="detailProposal.stages.length" class="gc-insight__row">
                  <span>关键阶段</span>
                  <ol class="gc-insight__stages">
                    <li v-for="(s, i) in detailProposal.stages" :key="i">{{ s }}</li>
                  </ol>
                </div>
              </div>
            </section>

            <section v-if="detail.messages.length" class="gc-section">
              <h4>对话轮次 <span class="mono">{{ detail.messages.length }}</span>
                <button type="button" class="gc-msg-jump" title="滚动到最新消息" @click="scrollMsgsToBottom">最新 ↓</button>
              </h4>
              <div class="gc-msgs">
                <div v-for="(m, i) in detail.messages" :key="i" class="gc-msg" :class="`gc-msg--${m.role}`">
                  <div class="gc-msg__bubble">
                    <div class="gc-msg__head">
                      <span class="gc-msg__role">{{ m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role }}</span>
                      <span v-if="m.time" class="gc-msg__time">{{ m.time }}</span>
                    </div>
                    <p>{{ m.text }}</p>
                  </div>
                </div>
              </div>
            </section>
            <p v-else-if="!detailLoading" class="gc-none">无对话消息记录。</p>

            <details v-if="detail.collectedData" class="gc-raw">
              <summary>原始数据（完整 JSON）</summary>
              <pre class="gc-json mono">{{ detail.collectedData }}</pre>
            </details>

            <div class="gc-actions">
              <button type="button" class="gc-btn-link" @click="goLearner(detail)">学习者画像 →</button>
              <button type="button" class="gc-btn-link" @click="goTrace(detail)">Trace 链路 →</button>
              <button v-if="detail.id" type="button" class="gc-btn-link" @click="goConsole(detail)">进控制台 →</button>
              <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" :disabled="detail.regenerating" @click="regenerate(detail)">
                {{ detail.regenerating ? '生成中…' : '重新生成学习路径' }}
              </button>
              <button type="button" class="mk-btn mk-btn--sm mk-btn--danger" :disabled="detail.regenerating" @click="remove(detail)">
                删除会话
              </button>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isLive, openSession, openSubPage } from './store'
import { errMsg, timeAgo, isPageCacheFresh, markPageFetched } from './live'
import { stageText, stageBadgeCls, stageProgressIndex, stageTimelineText, GOAL_STAGE_TOTAL, GOAL_STAGE_STEP_LABELS } from './statusText'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import Pagination from './Pagination.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import MkCols from './MkCols.vue'
import { adminGoalConversationsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
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
  hasPath: boolean
  createdAt: string
  /** 阶段过程步序号（0=创建 1=澄清 2=方案 3=完成，statusText 单源） */
  stageIndex: number
  /** 轻量阶段时间线文本（如「创建 08-12 → 澄清中 08-13」；无数据为空串） */
  timeline: string
  regenerating?: boolean
}

interface Detail extends Row {
  description: string
  updatedAt: string
  completedAt: string
  collectedData: string
  /** 解析后的采集数据对象（understanding / confirmedProposal 等结构化字段） */
  collectedRaw: Record<string, unknown> | null
  messages: Array<{ role: string; text: string; time: string }>
}

const loading = ref(false)
const rows = ref<Row[]>([])
const loadError = ref('')
const stats = ref<{ total: number; active: number; completed: number; completionRate: string } | null>(null)
const keyword = ref('')
const statusFilter = ref('')

/* P1-3 列显隐（公共组件 MkCols）：目标摘要/状态/阶段/路径/创建时间 可隐藏，用户/操作固定 */
const gcColDefs = [
  { key: 'summary', label: '目标摘要', title: '对话目标摘要' },
  { key: 'status', label: '状态', title: '对话状态' },
  { key: 'stage', label: '阶段', title: '澄清阶段 + 过程点' },
  { key: 'path', label: '路径', title: '路径是否已生成' },
  { key: 'created', label: '创建时间', title: '对话创建时间' },
] as const
const gcHiddenCols = ref<Set<string>>(new Set())
const detail = ref<Detail | null>(null)

/* URL 同步：?goal=id 记录当前打开的详情，支持深链/刷新恢复 */
const route = useRoute()
const router = useRouter()
/* URL → detail：页面加载/刷新时恢复 */
watch(
  () => route.query.goal,
  async (goalId) => {
    const gid = typeof goalId === 'string' ? goalId : ''
    if (gid && (!detail.value || detail.value.id !== gid)) {
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
      if (r) void openDetail(r)
      else {
        detail.value = null
        // 目标可能超出最近 100 条或已被删除：明示而非静默关闭
        toast.warning('未找到深链指向的会话：可能不在最近 100 条内，或已被删除')
      }
    } else if (!gid && detail.value) {
      detail.value = null
    }
  },
  { immediate: true }
)

/* 数据隔离（A3）：默认仅真实（排除虚拟/测试账号）；切换「含虚拟·测试」后重拉全量并灰标虚拟/测试行 */
const includeTest = ref(false)

/* 结构化字段（从 collectedData 提取，供详情面板卡片展示） */
const detailUnderstanding = computed(() => {
  const u = (detail.value?.collectedRaw?.understanding ?? detail.value?.collectedRaw?.collected ?? {}) as Record<string, unknown>
  return {
    realProblem: String(u.real_problem || u.realProblem || ''),
    successCriterion: String((u.success_criteria as Record<string, unknown>)?.observable_result || u.successCriteria || ''),
    timeBudget: String((u.available_resources as Record<string, unknown>)?.time_budget || u.timeBudget || '')
  }
})
const detailProposal = computed(() => {
  const p = (detail.value?.collectedRaw?.confirmedProposal ?? {}) as Record<string, unknown>
  return {
    direction: String(p.learning_direction || p.learningDirection || ''),
    stages: Array.isArray(p.key_stages) ? p.key_stages.map(String) : []
  }
})
const detailConfidence = computed(() => {
  const v = Number(detail.value?.collectedRaw?.confidence ?? 0)
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null
})

/* 置信度色阶（G2）：<50 红 / 50-80 琥珀 / >80 绿；数字保留，配 6px 迷你条 */
function confTone(pct: number): 'ok' | 'warn' | 'bad' {
  return pct < 50 ? 'bad' : pct < 80 ? 'warn' : 'ok'
}
function confToneCls(pct: number): string {
  return confTone(pct) === 'bad' ? 'gc-conf--low' : confTone(pct) === 'warn' ? 'gc-conf--warn' : ''
}

/* 状态条完成率堆叠条（G3）：进行中/已完成/其他 三色比例条 */
const stackOther = computed(() => {
  const t = stats.value?.total || 0
  return Math.max(0, t - (stats.value?.active || 0) - (stats.value?.completed || 0))
})
/* ===== Goal 概览（gc-dash：结论，状态条承载） ===== */
const gcDashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() => {
  if (!stats.value || stats.value.total === 0) return 'muted'
  if ((stats.value.active ?? 0) > 0) return 'ok'
  return 'ok'
})
const gcDashTitle = computed(() => {
  if (!stats.value || stats.value.total === 0) return '暂无目标对话'
  if ((stats.value.active ?? 0) > 0) return `${stats.value.active} 个目标澄清进行中`
  return '目标对话已收束'
})
const gcDashSubline = computed(() => {
  if (!stats.value || stats.value.total === 0) return '学习者发起目标对话后自动呈现'
  if ((stats.value.active ?? 0) > 0) return '学习者正在澄清学习目标，完成后自动进入路径生成'
  return `全部完成澄清或已收束 · 完成率 ${stats.value.completionRate}%`
})
function stackPct(seg: 'active' | 'completed' | 'other'): string {
  const t = stats.value?.total || 0
  if (t <= 0) return '0%'
  const n = seg === 'active' ? (stats.value?.active || 0) : seg === 'completed' ? (stats.value?.completed || 0) : stackOther.value
  return `${Math.max(0, Math.min(100, Math.round((n / t) * 100)))}%`
}

useEscape(() => !!detail.value, closeDetail)
const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()

/** 菜单项执行：先关菜单再执行（避免菜单残留与整行点击冒泡） */
function menuRemove(r: Row) {
  closeMenu()
  void remove(r)
}
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!detail.value), panelRef)
useMaskClose(maskRef, closeDetail)

/** P2：消息流「最新 ↓」——滚动抽屉内容到底部（长会话快捷定位） */
function scrollMsgsToBottom() {
  bodyRef.value?.scrollTo({ top: bodyRef.value.scrollHeight, behavior: 'smooth' })
}

const statusPills = [
  { id: 'active', label: '进行中' },
  { id: 'completed', label: '已完成' },
  { id: 'cancelled', label: '已取消' }
]

const statusLabel = (s: string) => ({ active: '进行中', completed: '已完成', cancelled: '已取消' })[s] || s || '—'
const statusBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'active' ? 'mk-badge--info' : s === 'cancelled' ? 'mk-badge--warn' : 'mk-badge--muted'

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
    summary: summaryOf(c),
    hasPath: !!c.learningPathId,
    createdAt: timeAgo(String(c.createdAt || '')),
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

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return rows.value.filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false
    if (!k) return true
    return `${r.userName} ${r.userEmail} ${r.summary}`.toLowerCase().includes(k)
  })
})

const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
}

/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   列表为客户端全量数据（limit:100 拉取后本地筛选），按页切片；
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

/* force = true 绕过页面级 TTL 缓存（显式刷新/口径切换用），保证用户操作必然重拉 */
async function load(force = false) {
  if (!isLive.value || loading.value) return
  // 页面级 TTL 缓存
  if (!force && isPageCacheFresh('goal-conversations') && rows.value.length) return
  loading.value = true
  loadError.value = ''
  try {
    const [listRes, statsRes] = await Promise.all([
      adminGoalConversationsApi.list({ limit: 100, includeTest: includeTest.value }),
      adminGoalConversationsApi.getStats().catch(() => null)
    ])
    const body = listRes.data?.data ?? listRes.data ?? {}
    rows.value = ((body.conversations as Record<string, unknown>[]) || []).map(mapRow)
    const s = statsRes?.data?.data ?? statsRes?.data
    stats.value = s
      ? {
          total: Number(s.total || 0),
          active: Number(s.active || 0),
          completed: Number(s.completed || 0),
          completionRate: String(s.completionRate || '0')
        }
      : null
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
}

/** 顶层 messages 兜底解析（兼容 JSON 字符串或数组） */
function parseMessages(raw: unknown): Array<{ role: string; text: string; time: string }> {
  let arr: unknown[] = []
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(v)) arr = v
  } catch {
    arr = []
  }
  return arr.slice(0, 60).map((m: unknown) => {
    const mm = (m ?? {}) as Record<string, unknown>
    return {
      role: normRole(mm.role),
      text: String(mm.content ?? mm.text ?? mm.message ?? ''),
      time: mm.time ? timeAgo(String(mm.time)) : ''
    }
  })
}

/** 详情面板加载态 */
/** 详情面板加载态 */
function retryDetail() {
  if (detail.value) void openDetail(detail.value)
}

const detailLoading = ref(false)
const detailError = ref('')
/* 详情抽屉竞态：请求代际号，关闭/切换行后丢弃迟到的响应 */
let detailReqSeq = 0

function closeDetail() {
  detailReqSeq += 1
  detail.value = null
  // URL 同步：移除 ?goal 参数
  const q = { ...route.query }
  delete q.goal
  void router.replace({ query: q })
}

/** 真实会话与控制台数据契约不兼容（座舱仅服务虚拟会话）：先提供轻量深链——学习者画像 + Trace 瀑布按 sessionId 归组 */
function goLearner(r: Row) {
  if (!r.userId) return
  closeDetail()
  openSubPage('learner', r.userId)
}

function goTrace(r: Row) {
  closeDetail()
  openSession(r.id)
}

/** 真实会话进控制台（双模式）：session-real 只读座舱，经 /admin/session-console 同构映射渲染 */
function goConsole(r: Row) {
  if (!r.id) return
  closeDetail()
  openSubPage('session-real', r.id)
}

/** 归一化消息角色：后端用 ai/assistant，统一为 assistant */
function normRole(r: unknown): string {
  const v = String(r || 'unknown').toLowerCase()
  if (v === 'ai' || v === 'assistant') return 'assistant'
  if (v === 'user' || v === 'human') return 'user'
  return v
}

/** 解析采集数据：兼容字符串与对象；消息在 collectedData.messages（后端无顶层 messages 字段） */
function parseCollected(raw: unknown): { obj: Record<string, unknown> | null; messages: Array<{ role: string; text: string; time: string }> } {
  let obj: Record<string, unknown> | null = null
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      obj = null
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  }
  const msgs = Array.isArray(obj?.messages) ? obj.messages : []
  const messages = msgs.slice(0, 60).map((m: Record<string, unknown>) => ({
    role: normRole(m.role),
    text: String(m.content ?? m.text ?? m.message ?? ''),
    time: m.time ? timeAgo(String(m.time)) : ''
  }))
  return { obj, messages }
}

async function openDetail(r: Row) {
  const seq = ++detailReqSeq
  // URL 同步：记录 ?goal=id
  if (route.query.goal !== r.id) {
    void router.push({ query: { ...route.query, goal: r.id } })
  }
  detail.value = {
    ...r,
    description: '',
    updatedAt: '—',
    completedAt: '',
    collectedData: '',
    collectedRaw: null,
    messages: []
  }
  detailLoading.value = true
  detailError.value = ''
  try {
    const res = await adminGoalConversationsApi.getDetail(r.id)
    // 已关闭抽屉或已切换到其他行：丢弃本次响应
    if (seq !== detailReqSeq || !detail.value || detail.value.id !== r.id) return
    const c = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    const parsed = parseCollected(c.collectedData ?? c.messages)
    detail.value = {
      ...detail.value,
      description: String(c.description || ''),
      updatedAt: timeAgo(String(c.updatedAt || '')),
      completedAt: c.completedAt ? timeAgo(String(c.completedAt)) : '',
      collectedData: parsed.obj ? JSON.stringify(parsed.obj, null, 2) : '',
      collectedRaw: parsed.obj,
      messages: parsed.messages.length ? parsed.messages : parseMessages(c.messages)
    }
  } catch (e) {
    if (seq !== detailReqSeq) return
    detailError.value = `详情加载失败：${errMsg(e)}`
    toast.error(detailError.value)
  } finally {
    if (seq === detailReqSeq) detailLoading.value = false
  }
}

async function regenerate(r: Row) {
  if (r.regenerating) return
  const ok = await askConfirm({
    title: '重建学习路径',
    message: `确认为「${r.userName}」重新生成学习路径？\n将基于该会话产出新版本路径，覆盖当前路径。`,
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
    if (detail.value?.id === r.id) detail.value.hasPath = true
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
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await adminGoalConversationsApi.remove(r.id)
    rows.value = rows.value.filter((x) => x.id !== r.id)
    if (detail.value?.id === r.id) {
      // 走 closeDetail 统一清除 ?goal 深链：否则刷新会落入「深链未命中」路径
      closeDetail()
    }
    toast.success('会话已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  }
}

watch(isLive, (v) => {
  if (v) void load()
})
/* 数据隔离切换：仅真实 ↔ 含虚拟/测试（切换后立即按新口径重拉，绕过 TTL 缓存） */
watch(includeTest, () => {
  if (isLive.value) void load(true)
})
onMounted(() => {
  if (isLive.value) void load()
})
</script>

<style scoped>
/* 概览卡样式由共享组件 MkOverview 承载；仅保留堆叠条（pre slot 内）与行样式 */
.gc-dash__stack { padding: 0; }
.gc-row { cursor: pointer; }
/* 虚拟/测试行灰标（数据隔离 A3：includeTest 切换后显式标记） */
.gc-tags { display: flex; gap: 6px; margin-top: 2px; }
.gc-tag {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.gc-tag--virtual { background: #f1f5f9; color: #64748b; border: 1px dashed #cbd5e1; }
.gc-tag--test { background: #fef3c7; color: #b45309; }
/* 阶段列：徽章 + 四步过程点条 + 轻量时间线（创建→澄清→方案→完成，statusText 单源） */
.gc-stage-cell { display: grid; gap: 4px; min-width: 148px; }
.gc-stage-cell__head { display: flex; align-items: center; gap: 8px; }
.gc-stage-cell__dots { display: inline-flex; gap: 3px; }
.gc-stage-cell__dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: #e2e8f2;
}
.gc-stage-cell__dot.is-on { background: var(--mk-blue); }
.gc-stage-cell__dot.is-on:last-child { background: var(--mk-green); }
.gc-stage-cell__tl {
  font-size: 10.5px;
  color: var(--mk-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gc-summary {
  display: inline-block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

/* 详情面板（与 ts/pcl 面板同构） */
.gc-mask {
  position: fixed;
  inset: 0;
  z-index: var(--mk-z-drawer);
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.gc-panel {
  width: min(560px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: var(--mk-shadow-drawer);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: gc-in 0.2s ease;
}


@keyframes gc-in { from { transform: translateX(30px); opacity: 0; } }
.gc-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--mk-line);
}
.gc-panel__title { display: grid; gap: 6px; justify-items: start; }
.gc-panel__title h3 { margin: 0; font-size: 16px; }
.gc-panel__id { font-size: 10.5px; color: var(--mk-faint); word-break: break-all; }
.gc-panel__close {
  border: 0;
  background: var(--mk-close-bg, #f0f2f5);
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--mk-muted);
}
.gc-panel__body { padding: 16px 18px; display: grid; gap: 16px; align-content: start; overflow-y: auto; }

.gc-facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.gc-facts > div { display: grid; gap: 2px; }
.gc-facts span { font-size: 11px; color: var(--mk-faint); font-weight: 600; }
.gc-facts strong { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 560px) {
  .gc-facts { grid-template-columns: repeat(2, 1fr); }
}

/* 置信度 */
.gc-conf {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--mk-green);
}
.gc-conf--low { color: var(--mk-red); }
.gc-conf--warn { color: var(--mk-amber); }
.gc-conf-row { display: grid; gap: 4px; align-items: start; }
.gc-conf__bar { width: 72px; }

/* 状态条完成率堆叠条（G3） */
.gc-stack { display: inline-flex; align-items: center; gap: 6px; }
.gc-stack__bar {
  display: inline-flex;
  width: 120px;
  height: 6px;
  border-radius: 99px;
  overflow: hidden;
  background: #f0f3f9;
}
.gc-stack__seg { height: 100%; min-width: 0; }
.gc-stack__seg--active { background: var(--mk-blue); }
.gc-stack__seg--completed { background: var(--mk-green); }
.gc-stack__seg--cancelled { background: var(--mk-amber); }
.gc-stack em { font-style: normal; font-size: 10.5px; color: var(--mk-faint); white-space: nowrap; }
/* 页头计数锚点（与教学会话 ts-count-link 同形态）：进行中/已完成可点击筛选 */
.gc-count-link {
  border: 0; background: transparent; padding: 2px 6px;
  font: inherit; font-size: 12.5px; font-weight: 700;
  color: var(--mk-muted); cursor: pointer; border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.gc-count-link:hover { color: var(--mk-blue); background: rgba(44, 99, 208, 0.08); }
.gc-count-link--on { color: var(--mk-blue); background: rgba(44, 99, 208, 0.12); }

/* 理解与方案卡片 */
.gc-insight {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  overflow: hidden;
}
.gc-insight__row {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 8px 10px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f2f5;
  align-items: baseline;
}
.gc-insight__row:last-child { border-bottom: none; }
.gc-insight__row > span {
  font-size: 11px;
  font-weight: 700;
  color: var(--mk-faint);
  white-space: nowrap;
}
.gc-insight__row p {
  margin: 0;
  font-size: 12.5px;
  color: var(--mk-muted);
  line-height: 1.7;
}
.gc-insight__stages {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 3px;
  font-size: 12.5px;
  color: var(--mk-muted);
  line-height: 1.6;
}

.gc-section { display: grid; gap: 8px; }
.gc-section h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.gc-section h4 .mono { margin-left: 4px; }
.gc-desc { margin: 0; font-size: 12.5px; color: var(--mk-muted); line-height: 1.7; }

/* 对话轮次：气泡式（用户右对齐蓝色，AI 左对齐浅灰） */
.gc-msgs { display: grid; gap: 8px; }
/* P2：消息流「最新 ↓」按钮（长会话快捷定位） */
.gc-msg-jump {
  border: 1px solid var(--mk-line); background: var(--mk-surface);
  color: var(--mk-blue); font: inherit; font-size: 11px; font-weight: 700;
  padding: 2px 9px; border-radius: 999px; cursor: pointer; margin-left: 8px;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.gc-msg-jump:hover { border-color: rgba(44, 99, 208, 0.5); background: #f0f5ff; }
html[data-theme='dark'] .gc-msg-jump:hover { background: #1f2b40; }.gc-msg { display: flex; }
.gc-msg--user { justify-content: flex-end; }
.gc-msg--assistant { justify-content: flex-start; }
.gc-msg--unknown { justify-content: flex-start; }
.gc-msg__bubble {
  max-width: 88%;
  padding: 8px 12px;
  border-radius: 12px;
  display: grid;
  gap: 4px;
}
.gc-msg--assistant .gc-msg__bubble,
.gc-msg--unknown .gc-msg__bubble {
  background: #f7f9fc;
  border: 1px solid #e6ecf6;
  border-top-left-radius: 4px;
}
.gc-msg--user .gc-msg__bubble {
  background: #eff6ff;
  border: 1px solid #d6e6ff;
  border-top-right-radius: 4px;
}
.gc-msg__head { display: flex; align-items: center; gap: 8px; }
.gc-msg__role { font-size: 10.5px; font-weight: 700; }
.gc-msg--user .gc-msg__role { color: var(--mk-blue); }
.gc-msg--assistant .gc-msg__role,
.gc-msg--unknown .gc-msg__role { color: var(--mk-muted); }
.gc-msg__time { font-size: 10.5px; color: var(--mk-faint); margin-left: auto; white-space: nowrap; }
.gc-msg__bubble p { margin: 0; font-size: 12.5px; line-height: 1.7; color: var(--mk-ink); white-space: pre-wrap; word-break: break-word; }
.gc-none { margin: 0; color: var(--mk-faint); font-size: 12px; }

.gc-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: #c0454a;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
}

.gc-raw summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
  padding: 2px 0;
}
.gc-json {
  margin: 6px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--mk-code-bg, #101826);
  border: 1px solid var(--mk-code-border, #1c2a40);
  color: var(--mk-code-fg, #9db8dc);
  font-size: 10.5px;
  line-height: 1.6;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.gc-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.gc-btn-link {
  border: 0;
  background: transparent;
  color: var(--mk-blue);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 8px 4px;
}
.gc-btn-link:hover { text-decoration: underline; }
/* 按钮规格对齐 .mk-btn（8x16 / 12.5px）；危险操作实心红（与 .mk-btn--danger 一致） */
.gc-btn-primary {
  padding: 8px 16px;
  border-radius: 8px;
  border: 0;
  background: var(--mk-blue);
  color: #fff;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
}
.gc-btn-primary:hover:not(:disabled) { background: #2b64d8; }
.gc-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.gc-btn-danger {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--mk-red-strong, var(--mk-red));
  background: var(--mk-red-strong, var(--mk-red));
  color: #fff;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
}
.gc-btn-danger:hover:not(:disabled) { background: #b91c1c; border-color: #b91c1c; }
.gc-btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }


/* 4K：抽屉加宽 + 字号跟随壳层放大 */
@media (min-width: 2000px) {
  .gc-panel { width: min(700px, 100vw); }
  .gc-panel__head { padding: 20px 24px; }
  .gc-panel__title h3 { font-size: 19px; }
  .gc-panel__id { font-size: 12.5px; }
  .gc-panel__body { padding: 20px 24px; }
  .gc-facts span { font-size: 13px; }
  .gc-facts strong { font-size: 14.5px; }
  .gc-section h4 { font-size: 13px; }
  .gc-desc { font-size: 14.5px; }
  .gc-msg { font-size: 14px; }
  .gc-msg__role { font-size: 12.5px; }
  .gc-json { font-size: 12.5px; }
  .mk-btn--sm { font-size: 14px; }
}
@media (min-width: 2800px) {
  .gc-panel { width: min(880px, 100vw); }
  .gc-panel__head { padding: 24px 30px; }
  .gc-panel__title h3 { font-size: 23px; }
  .gc-panel__id { font-size: 15px; }
  .gc-panel__body { padding: 24px 30px; }
  .gc-facts span { font-size: 15.5px; }
  .gc-facts strong { font-size: 17px; }
  .gc-section h4 { font-size: 15.5px; }
  .gc-desc { font-size: 17px; }
  .gc-msg { font-size: 16.5px; }
  .gc-msg__role { font-size: 15px; }
  .gc-json { font-size: 15px; }
  .mk-btn--sm { font-size: 16.5px; }
}
/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
  .gc-panel { width: min(1040px, 100vw); }
  .gc-panel__head { padding: 28px 36px; }
  .gc-panel__title h3 { font-size: 27px; }
  .gc-panel__id { font-size: 17.5px; }
  .gc-panel__body { padding: 28px 36px; }
  .gc-facts span { font-size: 18px; }
  .gc-facts strong { font-size: 20px; }
  .gc-section h4 { font-size: 18px; }
  .gc-desc { font-size: 20px; }
  .gc-msg { font-size: 19.5px; }
  .gc-msg__role { font-size: 17.5px; }
  .gc-json { font-size: 17.5px; }
  .mk-btn--sm { font-size: 19.5px; }
}

/* ================= 暗色模式（D1 补完）：目标对话 ================= */
html[data-theme='dark'] {
  .gc-tag--virtual { background: #1c2637; color: #8fa3bd; border-color: #33415c; }
  .gc-tag--test { background: rgba(251, 191, 36, 0.16); color: #fcd34d; }
  .gc-json { background: #0f1624; color: #c6d4ea; }
  .gc-msg { background: #141c2b; border-color: #232f45; }
  .gc-stack__bar { background: #232f45; }
}
</style>
