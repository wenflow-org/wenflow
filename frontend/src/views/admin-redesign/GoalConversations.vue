<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="mk-status" :class="stats && stats.active > 0 ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">Goal 会话</strong>
      <span class="mk-status__sep"></span>
      <template v-if="isLive && stats">
        <span class="mk-status__meta">总数 {{ stats.total }}</span>
        <span class="mk-status__meta">进行中 {{ stats.active }}</span>
        <span class="mk-status__meta">已完成 {{ stats.completed }}</span>
        <span class="mk-status__meta">完成率 {{ stats.completionRate }}%</span>
        <span
          v-if="stats.total > 0"
          class="gc-stack"
          :title="`进行中 ${stats.active} · 已完成 ${stats.completed} · 其他 ${stackOther}`"
        >
          <span class="gc-stack__bar">
            <i class="gc-stack__seg gc-stack__seg--active" :style="{ width: stackPct('active') }"></i>
            <i class="gc-stack__seg gc-stack__seg--completed" :style="{ width: stackPct('completed') }"></i>
            <i class="gc-stack__seg gc-stack__seg--cancelled" :style="{ width: stackPct('other') }"></i>
          </span>
          <em>进行中 / 已完成 / 其他</em>
        </span>
      </template>
      <button type="button" class="mk-status__action" :disabled="loading" @click="load">
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
      <div class="mk-card">
        <div class="mk-card__head">
          <div class="mk-filter">
            <input v-model="keyword" class="mk-filter__input" placeholder="搜索用户 / 邮箱 / 目标摘要" />
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
          </div>
          <span class="mk-card__meta">{{ filtered.length }} / {{ rows.length }}</span>
        </div>

        <MockSkeletonTable v-if="loading && !rows.length" :cols="6" />
        <!-- P0 修复：加载失败行内错误 + 重试（此前失败伪装成「暂无会话」） -->
        <div v-else-if="loadError" class="gc-error" role="alert">
          <span>{{ loadError }}</span>
          <button type="button" class="mk-link" @click="load">重试</button>
        </div>
        <div v-else-if="filtered.length" class="mk-table-scroll">
        <table class="mk-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>目标摘要</th>
              <th>状态</th>
              <th>阶段</th>
              <th>路径</th>
              <th class="mk-col--time-full">创建时间</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id" class="gc-row" @click="openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong>{{ r.userName }}</strong>
                  <span class="mk-cell-sub">{{ r.userEmail }}</span>
                </div>
              </td>
              <td><span class="gc-summary" :title="r.summary">{{ r.summary }}</span></td>
              <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td>
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
              <td>
                <span v-if="r.hasPath" class="mk-badge mk-badge--info">已生成</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td><span class="mk-cell-sub" :title="r.createdAt">{{ r.createdAt }}</span></td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click.stop="goTrace(r)">瀑布</button>
                  <button type="button" class="mk-link" @click.stop="goConsole(r)">控制台</button>
                  <button type="button" class="mk-link" @click.stop="regenerate(r)">
                    {{ r.regenerating ? '生成中…' : '重建路径' }}
                  </button>
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
          <strong>{{ loading ? '加载中…' : (keyword || statusFilter ? '当前筛选无匹配' : '暂无会话') }}</strong>
          <span v-if="!loading">{{ keyword || statusFilter ? '放宽筛选条件试试。' : '虚拟学习者发起目标对话后，会话记录会出现在这里。' }}</span>
          <button v-if="isFiltered && !loading" type="button" class="mk-empty__action" @click="clearFilters">清除筛选</button>
        </div>        <div v-if="canMore" class="gc-more">
          <button type="button" class="mk-link" @click="loadMore">加载更多（已显示 {{ shown.length }} / {{ filtered.length }}）</button>
        </div>
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
          <div class="gc-panel__body">
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

            <p v-if="detailLoading" class="gc-none">正在加载对话详情…</p>

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
              <h4>对话轮次 <span class="mono">{{ detail.messages.length }}</span></h4>
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
              <button type="button" class="gc-btn-link" @click="goTrace(detail)">Trace 瀑布 →</button>
              <button v-if="detail.id" type="button" class="gc-btn-link" @click="goConsole(detail)">进控制台 →</button>
              <button type="button" class="gc-btn-primary" :disabled="detail.regenerating" @click="regenerate(detail)">
                {{ detail.regenerating ? '生成中…' : '重新生成学习路径' }}
              </button>
              <button type="button" class="gc-btn-danger" :disabled="detail.regenerating" @click="remove(detail)">
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
import { isLive, openSession, openSubPage } from './store'
import { errMsg, timeAgo } from './live'
import { stageText, stageBadgeCls, stageProgressIndex, stageTimelineText, GOAL_STAGE_TOTAL, GOAL_STAGE_STEP_LABELS } from './statusText'
import { useLoadMore } from './useLoadMore'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import MockSkeletonTable from './SkeletonTable.vue'
import { adminGoalConversationsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'

interface Row {
  id: string
  userId: string
  userName: string
  userEmail: string
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
const detail = ref<Detail | null>(null)

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
useOverlay(computed(() => !!detail.value), panelRef)
useMaskClose(maskRef, closeDetail)

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

/* 长列表分批渲染：每批 20 行 */
const { shown, canMore, loadMore } = useLoadMore(filtered, 15)

async function load() {
  if (!isLive.value || loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const [listRes, statsRes] = await Promise.all([
      adminGoalConversationsApi.list({ limit: 100 }),
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
    if (detail.value?.id === r.id) detail.value = null
    toast.success('会话已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  }
}

watch(isLive, (v) => {
  if (v) void load()
})
onMounted(() => {
  if (isLive.value) void load()
})
</script>

<style scoped>
.gc-row { cursor: pointer; }
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
.gc-more {
  display: flex;
  justify-content: center;
  padding: 10px 0 12px;
  border-top: 1px dashed var(--mk-line);
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
  background: #f0f2f5;
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
.gc-msg { display: flex; }
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
  .gc-btn-primary, .gc-btn-danger { font-size: 14px; }
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
  .gc-btn-primary, .gc-btn-danger { font-size: 16.5px; }
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
  .gc-btn-primary, .gc-btn-danger { font-size: 19.5px; }
}
</style>
