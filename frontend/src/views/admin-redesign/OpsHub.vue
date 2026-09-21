<template>
  <div class="mk-page mk-page--fill oh-host">
    <!-- 页面级状态条：tab 相关域计数 + 刷新/重试（域计数由激活子视图上报，对齐消息/用户宿主） -->
    <div class="mk-status" :class="hostTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">运营中心</strong>
      <span class="mk-status__sep"></span>
      <template v-if="tab === 'todo'">
        <span class="mk-status__meta">待处理反馈 {{ wbErrors.feedback ? '—' : wbPendingFeedback }}</span>
        <span class="mk-status__meta" :class="wbFailedPaths > 0 ? 'mk-status__meta--bad' : ''">失败路径 {{ wbErrors.paths ? '—' : wbFailedPaths }}</span>
        <span class="mk-status__meta" :class="wbDeadLetters > 0 ? 'mk-status__meta--bad' : ''">死信 {{ wbErrors.dead ? '—' : wbDeadLetters }}</span>
        <span class="mk-status__meta">公告 {{ ann.rows }} 条</span>
        <span v-if="wbHasError" class="mk-status__meta mk-status__meta--bad" :title="wbErrorText">待办数据加载失败</span>
      </template>
      <template v-else-if="tab === 'feedback'">
        <span class="mk-status__meta">共 {{ domainCount.feedback }} 条反馈</span>
      </template>
      <template v-else-if="tab === 'achievements'">
        <span class="mk-status__meta">解锁 {{ domainCount.achievements }}</span>
      </template>
      <template v-else-if="tab === 'announce'">
        <span class="mk-status__meta">公告 {{ domainCount.announce }} 条</span>
      </template>
      <template v-else>
        <span class="mk-status__meta">站内通知 {{ domainCount.inapp }} 条</span>
      </template>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="refreshing" @click="refreshActive">
          {{ refreshing ? '刷新中…' : (tab === 'todo' && wbHasError ? '重试' : '刷新') }}
        </button>
      </span>
    </div>

    <!-- 视图切换 pills（唯一的 tab 控件）：各视图计数随 pill 呈现 -->
    <div class="mk-pills oh-tabs">
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'todo' }" @click="switchTab('todo')">运营待办</button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'feedback' }" @click="switchTab('feedback')">反馈<span class="mk-pill__count">{{ domainCount.feedback }}</span></button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'achievements' }" @click="switchTab('achievements')">成就<span class="mk-pill__count">{{ domainCount.achievements }}</span></button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'announce' }" @click="switchTab('announce')">公告<span class="mk-pill__count">{{ domainCount.announce }}</span></button>
      <button type="button" class="mk-pill" :class="{ 'mk-pill--active': tab === 'inapp' }" @click="switchTab('inapp')">站内通知<span class="mk-pill__count">{{ domainCount.inapp }}</span></button>
    </div>

    <!-- ===== Tab1: 运营待办（原运营中心全量内容） ===== -->
    <template v-if="tab === 'todo'">
    <div class="oh-body">
    <!-- 失败必须显式落地：取不到 ≠ 没事（原实现把失败写成 0，页面伪装成「全部已清零」） -->
    <p v-if="wbHasError" class="mk-alert" role="alert">
      待办数据加载失败，对应计数不可信：{{ wbErrorText }}
    </p>

    <!-- 运营待办（全宽：按严重度排序的行动清单，非统计卡） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">运营待办</h4>
        <span class="mk-card__meta">按优先级排序 · 点击直达对应页面</span>
      </div>
      <div class="ow-todo-list">
        <button
          v-for="t in todoItems"
          :key="t.key"
          type="button"
          class="ow-todo"
          :class="[`ow-todo--${t.severity}`, { 'ow-todo--done': t.count === 0 && !t.failed, 'ow-todo--failed': t.failed }]"
          :title="t.failed ? '该域数据加载失败，计数不可信' : (t.count > 0 ? t.hint : '该事项已清零')"
          @click="t.action"
        >
          <i class="ow-todo__dot" aria-hidden="true"></i>
          <span class="ow-todo__main">
            <strong class="ow-todo__label">{{ t.label }}</strong>
            <em class="ow-todo__hint">{{ t.hint }}</em>
          </span>
          <b class="ow-todo__count" :class="{ 'ow-todo__count--bad': t.count > 0 && !t.failed }">{{ t.failed ? '—' : t.count }}</b>
          <span class="ow-todo__go">{{ t.failed ? '加载失败' : (t.count > 0 ? '去处理 →' : '已清零') }}</span>
        </button>
      </div>
    </section>

    <!-- 状态面板：路径 / 公告并列，紧凑行式区别于 Dashboard KPI 卡 -->
    <div class="ow-panels">
      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">学习路径</h4>
          <button type="button" class="mk-link" @click="goContent">管理 →</button>
        </div>
        <div class="ow-state">
          <div v-if="pathTotal > 0 && pathHasDistribution" class="ow-state__seg" aria-hidden="true">
            <i v-for="s in pathSegments" :key="s.key" :class="`ow-seg--${s.tone}`" :style="{ width: s.pct }" :title="`${s.label} ${s.count}`"></i>
          </div>
          <div v-else-if="pathTotal === 0" class="ow-state__empty">暂无学习路径</div>
          <div class="ow-state__rows">
            <div v-for="c in pathCards" :key="c.label" class="ow-state__row">
              <span><i class="ow-state__dot" :class="`ow-state__dot--${c.tone || 'muted'}`"></i>{{ c.label }}</span>
              <b :class="{ 'ow-state__bad': c.tone === 'bad' && Number(c.value) > 0 }">{{ c.value }}</b>
            </div>
          </div>
        </div>
      </section>
      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">公告</h4>
          <button type="button" class="mk-link" @click="goAnnouncements">管理 →</button>
        </div>
        <div class="ow-state">
          <div v-if="annTotal > 0 && annHasDistribution" class="ow-state__seg" aria-hidden="true">
            <i v-for="s in annSegments" :key="s.key" :class="`ow-seg--${s.tone}`" :style="{ width: s.pct }" :title="`${s.label} ${s.count}`"></i>
          </div>
          <div v-else-if="annTotal === 0" class="ow-state__empty">暂无公告</div>
          <div class="ow-state__rows">
            <div v-for="s in annSegments" :key="s.key" class="ow-state__row">
              <span><i class="ow-state__dot" :class="`ow-state__dot--${s.tone}`"></i>{{ s.label }}</span>
              <b>{{ s.count }}</b>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 生效中公告（最近发布，行动入口） -->
    <section v-if="livePublished.length" class="mk-card">
      <div class="mk-card__head">
        <h4 class="mk-card__title">生效中公告</h4>
        <button type="button" class="mk-link" @click="goAnnouncements">全部公告 →</button>
      </div>
      <div class="ow-ann-list">
        <button v-for="a in livePublished" :key="a.id" type="button" class="ow-ann" @click="goAnnouncements">
          <span class="mk-badge" :class="annBadge(a.severity)">{{ annSeverityText(a.severity) }}</span>
          <span class="ow-ann__title" :title="a.body">{{ a.title }}</span>
          <span class="ow-ann__meta">{{ a.publishedAt ? timeAgo(a.publishedAt) : '—' }}</span>
          <span class="ow-ann__go">查看 →</span>
        </button>
      </div>
    </section>
    </div><!-- /oh-body -->
    </template>

    <!-- ===== Tab2: 反馈（Feedback embedded） ===== -->
    <Feedback v-else-if="tab === 'feedback'" ref="feedbackRef" embedded @count="onDomainCount('feedback', $event)" />
    <!-- ===== Tab3: 成就（OpsAchievements embedded） ===== -->
    <OpsAchievements v-else-if="tab === 'achievements'" ref="achievementsRef" embedded @count="onDomainCount('achievements', $event)" />
    <!-- ===== Tab4: 公告（Announcements embedded） ===== -->
    <Announcements v-else-if="tab === 'announce'" ref="announceRef" embedded @count="onDomainCount('announce', $event)" />
    <!-- ===== Tab5: 站内通知（Notifications embedded） ===== -->
    <Notifications v-else ref="notifRef" embedded @count="onDomainCount('inapp', $event)" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { timeAgo, liveAnnouncements, errMsg } from './live'
import { intent } from './store'
import { adminFeedbackApi, adminLearningContentApi, adminDevtoolsApi, type LearningContentStats } from '@/api/adminApi'
import { announcementCounts, segmentPct, PATH_STATUS_TEXT } from './opsShared'
import Feedback from './Feedback.vue'
import OpsAchievements from './OpsAchievements.vue'
import Announcements from './Announcements.vue'
import Notifications from './Notifications.vue'

/* ===== 宿主：运营待办 · 反馈 · 成就 · 公告 · 站内通知（阶段 1 导航收敛） =====
   低频页折入 tab 宿主；?tab= 双向同步，深链/刷新/前进后退可寻址（对齐消息/用户宿主约定） */
const OH_TABS = ['todo', 'feedback', 'achievements', 'announce', 'inapp'] as const
type OhTab = (typeof OH_TABS)[number]
const tab = ref<OhTab>('todo')
const route = useRoute()
const router = useRouter()

/** 宿主域计数（由激活子视图上报）：反馈总数 / 解锁数 / 公告数 / 通知数 */
const domainCount = ref<{ feedback: number; achievements: number; announce: number; inapp: number }>({
  feedback: 0,
  achievements: 0,
  announce: 0,
  inapp: 0
})
function onDomainCount(domain: keyof typeof domainCount.value, n: number) {
  domainCount.value[domain] = n
}
const feedbackRef = ref<{ refresh?: () => void } | null>(null)
const achievementsRef = ref<{ refresh?: () => void } | null>(null)
const announceRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)
const notifRef = ref<{ reload?: () => void; openSend?: () => void } | null>(null)
const refreshing = ref(false)
async function refreshActive() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    if (tab.value === 'todo') await loadWorkbench()
    else if (tab.value === 'feedback') feedbackRef.value?.refresh?.()
    else if (tab.value === 'achievements') achievementsRef.value?.refresh?.()
    else if (tab.value === 'announce') announceRef.value?.refresh?.()
    else notifRef.value?.reload?.()
  } finally {
    refreshing.value = false
  }
}

/* URL ↔ tab 双向同步：?tab=todo|feedback|achievements|announce|inapp */
watch(
  () => route?.query?.tab,
  (t) => {
    const v = typeof t === 'string' && (OH_TABS as readonly string[]).includes(t) ? (t as OhTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'todo') tab.value = 'todo'
  },
  { immediate: true }
)
function switchTab(t: OhTab) {
  tab.value = t
  if (route && router && route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}

/* intent 深链：跨页跳转带 tab（待处理反馈 → feedback / 公告管理 → announce） */
watch(
  () => intent.tab,
  (t) => {
    if (t && (OH_TABS as readonly string[]).includes(t)) {
      tab.value = t as OhTab
      intent.tab = ''
    }
  },
  { immediate: true }
)
/* intent 快捷动作「新建公告」：确保落在公告 tab（Announcements 挂载后自行消费 quickAction） */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-announcement' && tab.value !== 'announce') tab.value = 'announce'
  },
  { immediate: true }
)

/* ===== 运营待办：反馈待处理 / 失败路径 / 死信 / 草稿公告 ===== */
const wbPendingFeedback = ref(0)
const wbFailedPaths = ref(0)
const wbDeadLetters = ref(0)
const wbLoading = ref(false)
const stats = ref<LearningContentStats | null>(null)
/**
 * 三个待办域各自的加载失败原因（键存在 = 该域失败）。
 * 失败必须显式暴露：原先 .catch 一律把计数写成 0，后端故障时本页会伪装成
 * 「全部已清零」——这是驾驶舱最不可接受的一种假信号（审计 §附 A #2）。
 */
const wbErrors = ref<Record<string, string>>({})

async function loadWorkbench() {
  if (wbLoading.value) return
  wbLoading.value = true
  const errors: Record<string, string> = {}
  const [feedbackR, statsR, deadR] = await Promise.allSettled([
    // 待处理反馈：后端 status=new 计数（与 Feedback 页口径一致）
    adminFeedbackApi.list({ limit: 1, status: 'new' }),
    // 失败路径：学习内容 stats（与内容管理页口径一致）
    adminLearningContentApi.getStats(),
    // outbox 死信：系统工具页同源（返回 {deadCount, items}）
    adminDevtoolsApi.getOutboxDead(),
  ])

  if (feedbackR.status === 'fulfilled') {
    const d = feedbackR.value.data?.data ?? feedbackR.value.data ?? {}
    wbPendingFeedback.value = Number(d.pagination?.total ?? d.total ?? 0)
  } else {
    errors.feedback = errMsg(feedbackR.reason)
  }

  if (statsR.status === 'fulfilled') {
    const s = (statsR.value.data?.data ?? statsR.value.data) as LearningContentStats | null
    stats.value = s
    wbFailedPaths.value = s?.byStatus?.failed ?? 0
  } else {
    errors.paths = errMsg(statsR.reason)
  }

  if (deadR.status === 'fulfilled') {
    const d = deadR.value.data?.data as { deadCount?: number } | null | undefined
    wbDeadLetters.value = Number(d?.deadCount ?? 0)
  } else {
    errors.dead = errMsg(deadR.reason)
  }

  wbErrors.value = errors
  wbLoading.value = false
}

/** 任一待办域加载失败 → 页面基调降为 bad（禁止静默归零后仍显示「一切正常」） */
const wbHasError = computed(() => Object.keys(wbErrors.value).length > 0)
const wbErrorText = computed(() => Object.values(wbErrors.value).filter(Boolean).join('；'))
/** 页头基调：任一域失败 → bad；有失败路径/死信 → warn；否则 ok（R2 状态语义表） */
const statusTone = computed(() =>
  wbHasError.value
    ? 'mk-status--bad'
    : (wbFailedPaths.value > 0 || wbDeadLetters.value > 0)
      ? 'mk-status--warn'
      : 'mk-status--ok'
)
/** 宿主状态条基调：待办 tab 沿用三域聚合；其余 tab 按域计数 ok/muted */
const hostTone = computed(() => {
  if (tab.value === 'todo') return statusTone.value
  const n = domainCount.value[tab.value as keyof typeof domainCount.value] || 0
  return n > 0 ? 'mk-status--ok' : 'mk-status--muted'
})

/* 待办清单：按严重度排序（坏>警告>中性），零值弱化为「已清零」；
   域加载失败时该行显示「—」+「加载失败」，不再伪装成 0 */
const todoItems = computed(() => [
  { key: 'feedback', label: '待处理反馈', hint: '学习者低分反馈等待分流', count: wbPendingFeedback.value, severity: 'warn' as const, action: goFeedbackPending, failed: !!wbErrors.value.feedback },
  { key: 'paths', label: '生成失败路径', hint: '目标对话产出路径失败，需排查', count: wbFailedPaths.value, severity: 'bad' as const, action: goFailedPaths, failed: !!wbErrors.value.paths },
  { key: 'dead', label: 'Outbox 死信', hint: '领域事件投递失败，影响画像/成就', count: wbDeadLetters.value, severity: 'warn' as const, action: goDeadLetters, failed: !!wbErrors.value.dead },
  { key: 'draft', label: '草稿公告', hint: '已创建未发布的公告', count: ann.value.draft, severity: 'muted' as const, action: goAnnouncements, failed: false },
])

/* 公告三态计数（live 层共享，与侧栏徽章同源） */
const ann = announcementCounts

/* 状态面板：路径四态 + 公告三态（比例条 + 行式计数） */
const pathSegments = computed(() =>
  segmentPct([
    { key: 'active', label: PATH_STATUS_TEXT.active, count: stats.value?.byStatus?.active || 0, tone: 'ok' },
    { key: 'completed', label: PATH_STATUS_TEXT.completed, count: stats.value?.byStatus?.completed || 0, tone: 'info' },
    { key: 'failed', label: PATH_STATUS_TEXT.failed, count: stats.value?.byStatus?.failed || 0, tone: 'bad' },
    { key: 'archived', label: PATH_STATUS_TEXT.archived, count: stats.value?.byStatus?.archived || 0, tone: 'muted' },
  ])
)
/* 路径状态行（原 MkKpi 色板口径：非零计数的警示态才着色） */
const pathCards = computed(() => {
  const s = stats.value?.byStatus || {}
  const failedN = s.failed || 0
  return [
    { label: PATH_STATUS_TEXT.active, value: String(s.active || 0), tone: (s.active || 0) > 0 ? ('ok' as const) : '' },
    { label: PATH_STATUS_TEXT.completed, value: String(s.completed || 0), tone: '' },
    { label: PATH_STATUS_TEXT.failed, value: String(failedN), tone: failedN > 0 ? ('bad' as const) : '' },
    { label: PATH_STATUS_TEXT.archived, value: String(s.archived || 0), tone: '' },
  ]
})
const annSegments = computed(() =>
  segmentPct([
    { key: 'published', label: '生效中', count: ann.value.published, tone: 'info' },
    { key: 'draft', label: '草稿', count: ann.value.draft, tone: 'warn' },
    { key: 'archived', label: '已下线', count: ann.value.archived, tone: 'muted' },
  ])
)
/** 总量为 0 时比例条会渲染为空灰条（观感像坏图），改为渲染空态文案 */
const pathTotal = computed(() => pathSegments.value.reduce((n, s) => n + s.count, 0))
const annTotal = computed(() => annSegments.value.reduce((n, s) => n + s.count, 0))
/** 只有 ≥2 个非零状态时才画「构成条」：单一状态会渲染成整条满格绿，
    被误读为进度条（比例失真），此时交给下方行式计数表达即可。 */
const pathHasDistribution = computed(() => pathSegments.value.filter((s) => s.count > 0).length > 1)
const annHasDistribution = computed(() => annSegments.value.filter((s) => s.count > 0).length > 1)

/* 生效中公告列表（最近发布优先） */
const livePublished = computed(() =>
  liveAnnouncements.value
    .filter((a) => a.status === 'published')
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, 4)
)
const annSeverityText = (s: string) => ({ info: '通知', warning: '提醒', critical: '紧急' }[s] || s)
const annBadge = (s: string) =>
  s === 'critical' ? 'mk-badge--bad' : s === 'warning' ? 'mk-badge--warn' : 'mk-badge--info'

/* ===== 跨页深链（运营组内各页均为独立场景，操作对象页唯一） ===== */
/** 待处理反馈 → 反馈中心（预筛待处理） */
/** 待处理反馈 → 反馈中心（预筛「待处理」；Feedback onMounted 消费 intent.statusFilter 后清空）。
    原先只设 scene、由注释「由 Feedback 页默认筛选待处理」承诺，但 Feedback 从未消费该 intent
    → 用户点「去处理」看到的是全量列表（审计 附 A #11）。 */
function goFeedbackPending() {
  intent.statusFilter = 'new'
  intent.quickAction = '' // 确保不触发其他快捷动作
  intent.tab = 'feedback' // 宿主 tab 切换（Feedback onMounted 消费 statusFilter 后清空）
  intent.scene = 'ops-hub'
}
/** 生成失败路径 → 学习会话页「学习路径」tab（预筛 failed，宿主消费 intent.statusFilter/tab 后清空） */
function goFailedPaths() {
  intent.statusFilter = 'failed'
  intent.tab = 'paths'
  intent.scene = 'sessions'
}
/** outbox 死信 → 系统工具页（原运维中心） */
function goDeadLetters() {
  intent.scene = 'ops-center'
}
/** 学习路径管理 → 学习会话页「学习路径」tab */
function goContent() {
  intent.tab = 'paths'
  intent.scene = 'sessions'
}
/** 公告管理（运营中心 · 公告 tab） */
function goAnnouncements() {
  intent.tab = 'announce'
  intent.scene = 'ops-hub'
}

/* 默认进入即拉取待办聚合（公告计数由 live 层加载） */
onMounted(() => {
  void loadWorkbench()
})
</script>

<style scoped>
/* ================= 宿主布局（tab 宿主：运营待办内滚；嵌入子页占满剩余高度） ================= */
.oh-tabs { width: fit-content; }
/* 待办 tab：内容在宿主 flex 列内独立滚动（状态条/pills 固定） */
.oh-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  align-content: start;
}
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度 */
.oh-host > .mk-page--fill { flex: 1 1 auto; min-height: 0; }

/* ================= 运营工作台（待办清单 + 状态面板，区别于 Dashboard 统计卡） ================= */
/* 状态面板：路径 / 公告并列（行式计数 + 比例条，非 KPI 卡） */
.ow-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

/* 待办清单：行动行式（严重度圆点 + 标题/说明 + 计数 + 去处理），非统计卡 */
.ow-todo-list { padding: 2px 10px 6px; }
.ow-todo {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-bottom: 1px solid #eef1f7;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.ow-todo:last-child { border-bottom: none; }
.ow-todo:hover { background: #f6f9ff; }
html[data-theme='dark'] .ow-todo { border-bottom-color: #1f2a3d; }
html[data-theme='dark'] .ow-todo:hover { background: #1a2436; }
.ow-todo__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--mk-faint);
  flex-shrink: 0;
}
.ow-todo--bad .ow-todo__dot { background: var(--mk-red); box-shadow: 0 0 0 3px var(--mk-red-bg); }
.ow-todo--warn .ow-todo__dot { background: var(--mk-amber); box-shadow: 0 0 0 3px var(--mk-amber-bg); }
.ow-todo__main { display: grid; gap: 1px; min-width: 0; }
.ow-todo__label { font-size: var(--mk-fs-13); font-weight: 700; color: var(--mk-ink); }
.ow-todo__hint {
  font-style: normal;
  font-size: var(--mk-fs-11);
  color: var(--mk-faint);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ow-todo__count {
  font-size: var(--mk-fs-18);
  font-weight: 800;
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  min-width: 42px;
  text-align: right;
}
.ow-todo__count--bad { color: var(--mk-red); }
.ow-todo__go {
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-blue);
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: 6px;
  transition: background 0.12s;
}
.ow-todo__go:hover { background: rgba(44, 99, 208, 0.08); }
/* 已清零：整体弱化 */
.ow-todo--done { cursor: default; }
.ow-todo--done .ow-todo__label, .ow-todo--done .ow-todo__count { color: var(--mk-faint); }
.ow-todo--done .ow-todo__go { color: var(--mk-green); }
.ow-todo--done:hover { background: transparent; }
/* 加载失败：与「已清零」明确区分（灰而非绿，且不弱化为完成态） */
.ow-todo--failed { cursor: default; }
.ow-todo--failed .ow-todo__count { color: var(--mk-red); }
.ow-todo--failed .ow-todo__go { color: var(--mk-red); }
.ow-todo--failed .ow-todo__dot { background: var(--mk-red); }
.ow-todo--failed:hover { background: transparent; }

/* 状态面板：比例条 + 行式计数 */
.ow-state { padding: 8px 14px 12px; display: grid; gap: 10px; }
.ow-state__seg {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--mk-line);
}
.ow-state__seg i { display: block; height: 100%; min-width: 0; transition: width 0.2s ease; }
/* 无数据时的占位：保留比例条的高度位，但不画空灰条（避免「像坏图」） */
.ow-state__empty {
  height: 8px;
  display: flex;
  align-items: center;
  font-size: 11px;
  color: var(--mk-faint);
  line-height: 1;
}
.ow-seg--ok { background: var(--mk-green); }
.ow-seg--info { background: var(--mk-blue); }
.ow-seg--warn { background: var(--mk-amber); }
.ow-seg--bad { background: var(--mk-red); }
.ow-seg--muted { background: #c3cbda; }
html[data-theme='dark'] .ow-seg--muted { background: #3b4a66; }
.ow-state__rows { display: grid; gap: 5px; }
.ow-state__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
}
.ow-state__row b {
  font-size: var(--mk-fs-14);
  font-weight: 800;
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
}
.ow-state__bad { color: var(--mk-red) !important; }
.ow-state__dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: 1px;
}
.ow-state__dot--ok { background: var(--mk-green); }
.ow-state__dot--info { background: var(--mk-blue); }
.ow-state__dot--warn { background: var(--mk-amber); }
.ow-state__dot--bad { background: var(--mk-red); }
.ow-state__dot--muted { background: #c3cbda; }
html[data-theme='dark'] .ow-state__dot--muted { background: #3b4a66; }

/* 生效中公告列表 */
.ow-ann-list { padding: 2px 14px 6px; }
.ow-ann {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 4px;
  border: 0;
  border-bottom: 1px solid #eef1f7;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.ow-ann:last-child { border-bottom: none; }
.ow-ann:hover { background: #f6f9ff; }
html[data-theme='dark'] .ow-ann { border-bottom-color: #1f2a3d; }
html[data-theme='dark'] .ow-ann:hover { background: #1a2436; }
.ow-ann__title {
  flex: 1;
  min-width: 0;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ow-ann__meta { font-size: var(--mk-fs-11); color: var(--mk-faint); white-space: nowrap; }
.ow-ann__go { font-size: var(--mk-fs-11); font-weight: 700; color: var(--mk-blue); white-space: nowrap; }
@media (max-width: 1100px) {
  .ow-panels { grid-template-columns: 1fr; }
}

/* 4K：待办/状态行跟随全站节奏 */
@media (min-width: 2000px) {
  .ow-todo__label { font-size: 14.5px; }
  .ow-todo__hint { font-size: var(--mk-fs-12); }
  .ow-todo__count { font-size: var(--mk-fs-20); }
  .ow-state__row { font-size: 13.5px; }
  .ow-state__row b { font-size: 15.5px; }
  .ow-ann__title { font-size: var(--mk-fs-14); }
  .ow-ann__meta, .ow-ann__go { font-size: var(--mk-fs-12); }
}
@media (min-width: 2800px) {
  .ow-todo__label { font-size: 17px; }
  .ow-todo__hint { font-size: var(--mk-fs-14); }
  .ow-todo__count { font-size: 23px; }
  .ow-state__row { font-size: 15.5px; }
  .ow-state__row b { font-size: var(--mk-fs-18); }
  .ow-ann__title { font-size: 16.5px; }
  .ow-ann__meta, .ow-ann__go { font-size: var(--mk-fs-14); }
}
@media (min-width: 3600px) {
  .ow-todo__label { font-size: var(--mk-fs-20); }
  .ow-todo__hint { font-size: 16.5px; }
  .ow-todo__count { font-size: 27px; }
  .ow-state__row { font-size: var(--mk-fs-18); }
  .ow-state__row b { font-size: 21px; }
  .ow-ann__title { font-size: 19.5px; }
  .ow-ann__meta, .ow-ann__go { font-size: 16.5px; }
}
</style>
