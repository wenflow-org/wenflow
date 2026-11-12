<template>
  <div class="mk-page mk-page--fill oh-host">
    <!-- 页头（newui/admin pagehead）：页名 + 页级读数的口径开关与刷新/重试
         （2026-10-04 状态条退役：整块下线，读数各归其位） -->
    <MkPageHead title="运营中心">
      <template #actions>
        <!-- 视角开关随页级读数带走（2026-10-18）：读数带在任何页签都在（见下），它管的就是那几个数
             ——留在「运营待办」卡头会变成「数在页级、开关在某个页签里」。口径开关收页头同学习组六页判例。 -->
        <!-- 2026-10-23：刷新跟顶栏（liveRefreshSeq → refreshActive，含当前页签面板与失败态的读数带重试），
             页头不再出第二颗 -->
      </template>
    </MkPageHead>

    <!-- 页级读数带（2026-10-18 用户拍板：读数卡升到页签栏之上、任何页签都能看见）：
         这四个域是跨页签的（反馈 / 路径 / 事件 / 公告），读数与各页签的工作台同屏。
         2026-11-09 运营待办空壳页签下线后，这四张卡同时是唯一的快捷入口：卡本身就是
         「切到对应页签」的按钮，不再隔一层待办清单去点「去处理」。
         失败必须显式落地：取不到 ≠ 没事（原实现把失败写成 0，页面伪装成「全部已清零」） -->
    <!-- 失败态的重试出口不放页头（顶栏已有刷新，页头第二颗钮重复）：失败时本行就地给重试
         2026-10-23，与记忆与复习总览的失败条同一形态 -->
    <div v-if="wbHasError" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">待办数据加载失败，对应计数不可信：{{ wbErrorText }}</span>
      <button type="button" class="mk-alert__btn" :disabled="refreshing" @click="refreshActive">{{ refreshing ? '重试中…' : '重试' }}</button>
    </div>
    <!-- 首屏加载态：待办请求在途且尚无 stats 时渲染骨架，不落定 0 值读数 -->
    <MockSkeletonTable v-if="wbLoading && !stats" :cols="4" :rows="1" />
    <section v-else class="mk-kpi-grid oh-metrics" aria-label="运营读数">
      <MkKpi
        v-for="m in kpiReadings"
        :key="m.key"
        :clickable="!m.failed"
        :label="m.label"
        :value="m.failed ? '—' : m.count"
        :tone="countTone(m)"
        :hint="m.failed ? '加载失败，计数不可信' : ''"
        :hint-tone="m.failed ? 'bad' : ''"
        :title="m.title"
        @click="onKpiClick(m)"
      />
    </section>

    <!-- 视图切换（原型 .tabs 下划线页签：12px/600、激活蓝字+2px 蓝下划线、通栏底线；
         2026-10-01 由 mk-pills 胶囊迁入——胶囊只做筛选 chips，视图/分区切换归页签。
         2026-10-27 用户「tab 里面的数字不要了」：页签不再挂计数角标，
         计数只在页级 KPI 读数卡里出现（待处理反馈 / 生成失败路径 / 事件投递失败 / 草稿公告），
         单一出处，页签只负责切换视图。 -->
    <div class="tabs" role="tablist" aria-label="运营中心视图切换" @keydown="onTabKeydown">
      <button type="button" class="tab" role="tab" id="oh-tab-feedback" :ref="(el) => setTabRef(el, 0)" :tabindex="tab === 'feedback' ? 0 : -1" aria-controls="oh-panel-feedback" :aria-selected="tab === 'feedback'" @click="switchTab('feedback')">反馈</button>
      <button type="button" class="tab" role="tab" id="oh-tab-achievements" :ref="(el) => setTabRef(el, 1)" :tabindex="tab === 'achievements' ? 0 : -1" aria-controls="oh-panel-achievements" :aria-selected="tab === 'achievements'" @click="switchTab('achievements')">成就</button>
      <button type="button" class="tab" role="tab" id="oh-tab-announce" :ref="(el) => setTabRef(el, 2)" :tabindex="tab === 'announce' ? 0 : -1" aria-controls="oh-panel-announce" :aria-selected="tab === 'announce'" @click="switchTab('announce')">公告</button>
      <button type="button" class="tab" role="tab" id="oh-tab-inapp" :ref="(el) => setTabRef(el, 3)" :tabindex="tab === 'inapp' ? 0 : -1" aria-controls="oh-panel-inapp" :aria-selected="tab === 'inapp'" @click="switchTab('inapp')">站内通知</button>
      <!-- 2026-11-01 四个系统页签（运维工具/数据导出/会话安全/访问与注册）迁去「系统设置」。
           2026-11-09「运营待办」空壳页签下线：它只放了一个跳到隔壁「反馈」的按钮，而顶部四张
           读数卡已经把待办数讲完。本页现在直接以「反馈」起头，四张卡即快捷切换入口。 -->
    </div>

    <!-- ===== Tab1: 反馈（Feedback embedded；口径开关已退役，默认全部非虚拟账号） =====
         2026-11-09 默认落点：进入运营中心直接看到反馈表并当场处理，不再隔一层「运营待办」。 -->
    <Feedback v-if="tab === 'feedback'" id="oh-panel-feedback" role="tabpanel" aria-labelledby="oh-tab-feedback" ref="feedbackRef" embedded @status="onFeedbackStatus" />
    <!-- ===== Tab2: 成就（OpsAchievements embedded） ===== -->
    <OpsAchievements v-else-if="tab === 'achievements'" id="oh-panel-achievements" role="tabpanel" aria-labelledby="oh-tab-achievements" ref="achievementsRef" embedded />
    <!-- ===== Tab3: 公告（Announcements embedded） =====
         2026-10-26 用户「重新设计一下，包括站内通知」：宿主不再单起一行工具行放主操作。
         原先页签条与卡片之间夹着一整行、只有一个靠右的「新建公告」，既不在卡里也不在页头，
         读起来像掉出来的一颗钮。主操作归位到子页卡头右组（搜索 → 主操作），
         嵌入/独立两种形态同一处出口。 -->
    <Announcements
      v-else-if="tab === 'announce'"
      id="oh-panel-announce"
      role="tabpanel"
      aria-labelledby="oh-tab-announce"
      ref="announceRef"
      embedded
    />
    <!-- ===== Tab4: 站内通知（Notifications embedded）=====
         与公告 tab 同判例：主操作「发送通知」由子页卡头自己给，宿主不再补工具行。 -->
    <Notifications
      v-else-if="tab === 'inapp'"
      id="oh-panel-inapp"
      role="tabpanel"
      aria-labelledby="oh-tab-inapp"
      ref="notifRef"
      embedded
    />

  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadLiveData, liveFailures, errMsg, liveRefreshSeq, setLiveOpsPendingCounts } from './live'
import { intent } from './store'
import { adminFeedbackApi, adminLearningContentApi, adminDevtoolsApi, type LearningContentStats } from '@/api/adminApi'
import { announcementCounts } from './opsShared'
import Feedback from './Feedback.vue'
import OpsAchievements from './OpsAchievements.vue'
import Announcements from './Announcements.vue'
import Notifications from './Notifications.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MockSkeletonTable from './SkeletonTable.vue'

/* ===== 宿主：反馈 · 成就 · 公告 · 站内通知 =====
   低频页折入 tab 宿主；?tab= 双向同步，深链/刷新/前进后退可寻址（对齐消息/用户宿主约定）。
   2026-10-16 用户拍板：「系统工具」（ops-center）场景解散并入本页——它是「发现→去处理」的
   动作枢纽（事件投递失败已作为运营待办项挂在这里），而健康中心是只读报表，落这边更顺。
   原三页签整体迁入为 tools/export/security，旧深链 /admin/devtools|export-data|session-security
   在 router 重定向到对应 tab。
   2026-10-27 用户「这个页面转移到运营中心，作为一个 tab 页面」：访问与注册（原独立场景
   access-control）并入为 access 页签，旧深链 /admin/access-control 重定向过来。
   2026-11-09 用户「运营待办是空壳，直接砍掉」：顶部四张读数卡已经讲完待办数，原第一个页签
   只剩一个跳到隔壁「反馈」的按钮。删掉 todo，反馈成为默认落点；四张卡升级为快捷切换入口。 */
const OH_TABS = ['feedback', 'achievements', 'announce', 'inapp'] as const

type OhTab = (typeof OH_TABS)[number]
const tab = ref<OhTab>('feedback')
/* 页级读数带（待办四域）现在恒显：2026-11-01 四个系统页签迁走后，本页每个页签都属内容运营，
   读数带与它们全都相关（原 SYSTEM_TABS 那套「系统页签隐藏读数带」的判据随之退役）。 */
const route = useRoute()
const router = useRouter()

/* 2026-10-27 用户「tab 里面的数字不要了」：页签计数角标整体退役。
   计数只在页级 KPI 读数卡里出现（反馈 / 路径 / 事件 / 公告四域），页签只负责切换视图；
   子视图不再向宿主上报计数，也不再需要「未访问不显示」这套取数态。 */
const feedbackRef = ref<{ refresh?: () => void } | null>(null)
const achievementsRef = ref<{ refresh?: () => void } | null>(null)
const announceRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)
const notifRef = ref<{ reload?: () => void; openSend?: () => void } | null>(null)
const refreshing = ref(false)
/* 顶栏刷新广播：与旧页头刷新钮同一入口（当前页签面板 + 待办读数带） */
watch(liveRefreshSeq, () => { void refreshActive() })

async function refreshActive() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    /* 告警条的重试要清掉它展示的失败域：只刷当前页签会让公告等域的 liveFailures 常驻 */
    if (wbHasError.value || annFailed.value) void loadLiveData()
    if (tab.value === 'feedback') feedbackRef.value?.refresh?.()
    else if (tab.value === 'achievements') achievementsRef.value?.refresh?.()
    else if (tab.value === 'announce') announceRef.value?.refresh?.()
    else if (tab.value === 'inapp') notifRef.value?.reload?.()
    /* 页级读数带在每个页签都可见（2026-10-18），所以待办域始终可刷：
       当前页签面板先刷，再补一次读数带——失败态下重试钮必须真的重拉读数带。 */
    await loadWorkbench()
  } finally {
    refreshing.value = false
  }
}

/* URL ↔ tab 双向同步：?tab=feedback|achievements|announce|inapp。
   2026-11-09 退役 todo：老深链 ?tab=todo 由 router 改投 ?tab=feedback（路由级，见 index.ts），
   本层再把任何不认识的 tab 静默回落到 feedback，避免无 router 的单测/嵌入场景落到空壳页签。 */
watch(
  () => route?.query?.tab,
  (t) => {
    const v = typeof t === 'string' && (OH_TABS as readonly string[]).includes(t) ? (t as OhTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'feedback') tab.value = 'feedback'
  },
  { immediate: true }
)
/** 切页签 + 写 URL。F5-3 审核：intent 直达必须与点页签同构——URL 才是可刷新/可复制/
    可后退的权威；原先 intent 路径只改 tab.value 不写 URL，地址栏停在旧页签。
    单测可无 router 挂载，故访问保持可选 */
/** 目标页签的 URL query：只保留与该页签有关的预筛键。
    2026-10-26：?status= 原样跨页签带走——从反馈（new）切到公告，公告把它当状态筛选，
    匹配不到任何枚举就渲染「没有匹配的公告」。离开反馈即清掉 status。 */
function queryFor(t: OhTab): Record<string, string | (string | null)[]> {
  const q: Record<string, string | (string | null)[]> = { ...route?.query, tab: t }
  if (t !== 'achievements') delete q.sub
  if (t !== 'feedback') delete q.status
  return q
}
function switchTab(t: OhTab) {
  tab.value = t
  // push：注释承诺「可后退」——从反馈切到公告后，后退应回反馈而不是离开运营中心（2026-10-24）
  if (route && router && route.query.tab !== t) void router.push({ query: queryFor(t) })
}
/** 同场景内的直达：切 tab 且把目的地视图的预筛一并写进 URL（单次 replace）。tab 取显式
    目标值——不用 route.query.tab，它此刻可能仍是旧值，会把 tab 写回去（F5-3 竞态根因）。 */
function openTabWith(t: OhTab, extra: Record<string, string>) {
  tab.value = t
  if (!route || !router) return
  const changed = route.query.tab !== t || Object.entries(extra).some(([k, v]) => route.query[k] !== v)
  if (changed) void router.push({ query: { ...queryFor(t), ...extra } })
}
/** 反馈筛选（?status=）→ URL：由宿主统一写（Feedback 上报筛选值），tab 取本层权威的
    tab.value——子组件自己写会用旧 route.query.tab 覆盖在途的 ?tab= replace（F5-3 竞态）。
    值未变（URL 已是它、tab 也已对齐）时不重复导航，避免与 openTabWith 的 replace 相扰。 */
function onFeedbackStatus(v: string) {
  if (!route || !router) return
  const cur = typeof route.query.status === 'string' ? route.query.status : ''
  if (cur === v && route.query.tab === tab.value) return
  const q: Record<string, string | (string | null)[]> = { ...route.query, tab: tab.value }
  if (v) q.status = v
  else delete q.status
  /* 显式带 path（2026-11-09）：无 path 的 replace 以「当前 route」解析——场景切换在途时会写回旧路径 */
  void router.replace({ path: OPS_HUB_PATH, query: q })
}

/* 页签键盘契约（审核 #167）：roving tabindex（仅选中项可 Tab 进入）+ 左右方向键循环切换并移动焦点，
   兑现 role=tablist/role=tab 的 ARIA tabs 语义（判例 HealthCenter.vue:471-490） */
const tabEls = ref<(HTMLButtonElement | null)[]>([])
function setTabRef(el: unknown, i: number) {
  tabEls.value[i] = (el as HTMLButtonElement) || null
}
function onTabKeydown(e: KeyboardEvent) {
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const n = OH_TABS.length
  const cur = OH_TABS.indexOf(tab.value)
  const from = cur >= 0 ? cur : 0
  let next = from
  if (e.key === 'ArrowRight') next = (from + 1) % n
  else if (e.key === 'ArrowLeft') next = (from - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else next = n - 1
  e.preventDefault()
  switchTab(OH_TABS[next])
  void nextTick(() => tabEls.value[next]?.focus())
}

/* intent 深链：跨页跳转带 tab（待处理反馈 → feedback / 公告管理 → announce）。
   F5-3：消费时走 switchTab 写 URL——原先只改 tab.value，地址栏停在旧页签，刷新/复制链接
   落回已删除的空壳页签。2026-11-09：老调用方仍可能传 todo，一律归一到默认 feedback。
   （反馈的预筛不在此处：goFeedbackPending 与 tab 同一次 replace 落定，见下——
   两个写入者各写一半会互相覆盖：子组件此刻读到的 route 仍是旧 tab。） */
watch(
  () => intent.tab,
  (t) => {
    const v: OhTab | null = t === 'todo' ? 'feedback'
      : t && (OH_TABS as readonly string[]).includes(t) ? (t as OhTab) : null
    if (v) {
      intent.tab = ''
      switchTab(v)
    }
  },
  { immediate: true }
)
/* intent 快捷动作「新建公告」：本层只负责切到公告 tab；打开新建弹窗与清空 quickAction
   由 Announcements 自己的 watcher 消费（已在 announce tab 时也由其触发，无需重复处理） */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-announcement' && tab.value !== 'announce') switchTab('announce')
  },
  { immediate: true }
)

/* ===== 运营待办：反馈待处理 / 失败路径 / 死信 / 草稿公告 ===== */
/* 口径开关已退役（2026-10-21 用户拍板「没有测试，测试只是备注」）：
   反馈与失败路径按全部非虚拟账号计数；事件投递（outbox 死信）与草稿公告是系统全域。 */
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
    // outbox 死信：系统工具页同源（返回 {deadCount, items}）；系统全域，无视角
    adminDevtoolsApi.getOutboxDead(),
  ])

  if (feedbackR.status === 'fulfilled') {
    /* D7：后端信封为 { success, data: [...], pagination: { total } }——pagination 与 data 平级，
       而非 data.pagination。原 `data?.data?.pagination` 恒 undefined → 真实 10 条待处理显示成 0。
       对齐 Feedback.vue:388 的 `res.data?.pagination?.total`。 */
    const body = feedbackR.value.data ?? {}
    wbPendingFeedback.value = Number(body.pagination?.total ?? 0)
    setLiveOpsPendingCounts({ feedback: wbPendingFeedback.value })
  } else {
    errors.feedback = errMsg(feedbackR.reason)
  }

  if (statsR.status === 'fulfilled') {
    const s = (statsR.value.data?.data ?? statsR.value.data) as LearningContentStats | null
    stats.value = s
    wbFailedPaths.value = s?.byStatus?.failed ?? 0
    setLiveOpsPendingCounts({ paths: wbFailedPaths.value })
  } else {
    errors.paths = errMsg(statsR.reason)
  }

  if (deadR.status === 'fulfilled') {
    const d = deadR.value.data?.data as { deadCount?: number } | null | undefined
    wbDeadLetters.value = Number(d?.deadCount ?? 0)
    setLiveOpsPendingCounts({ dead: wbDeadLetters.value })
  } else {
    errors.dead = errMsg(deadR.reason)
  }

  wbErrors.value = errors
  wbLoading.value = false
}

/** 任一待办域加载失败 → 页面基调降为 bad（禁止静默归零后仍显示「一切正常」） */
const wbHasError = computed(() => Object.keys(wbErrors.value).length > 0 || annFailed.value)
/** 公告域失败标志来自 live 层（只读既有导出 liveFailures，不改 live.ts）：
    公告由 live 层加载而非本页 loadWorkbench，失败时草稿公告计数同样不可信 */
const annFailed = computed(() => !!liveFailures.value.announcements)
const wbErrorText = computed(() =>
  [...Object.values(wbErrors.value).filter(Boolean), ...(annFailed.value ? ['公告列表加载失败'] : [])].join('；')
)
/* 2026-10-04 状态条退役：页头基调 statusTone（ok/warn/bad）与宿主分 tab 基调 hostTone
   随状态条整块删除——失败信号由页签体内 mk-alert + 指标卡「加载失败」foot 承载，
   页面不再有整页红绿基调（wbHasError/wbErrorText 仍供 alert 与页头重试钮消费） */
/* 公告三态计数（live 层共享，与侧栏徽章同源） */
const ann = announcementCounts

/* 待办四域（单一来源）：页级读数带按此顺序出四张卡。
   2026-11-09 起这四张卡就是页面的快捷入口（承载原「运营待办」页签的去处理动作）：
   反馈 / 草稿公告有本页对应页签 → 切页签并带上预筛；生成失败路径 / 事件投递失败的处理
   面板已迁到别的场景 → 直接深链过去，仍是一步直达。
   域加载失败时该卡显「—」且不可点（读数不可信，不能带人去目标页）。 */
type KpiReading = {
  key: string
  label: string
  /** 悬停说明：卡点击后落到哪里（MkKpi 把它挂到卡根 title） */
  title: string
  count: number
  severity: 'bad' | 'warn' | 'muted'
  failed: boolean
  /** 本页有对应页签时的目标页签；跨场景深链的域为 null */
  tab: OhTab | null
}

const kpiReadings = computed<KpiReading[]>(() => [
  { key: 'feedback', label: '未处理反馈', title: '反馈列表', count: wbPendingFeedback.value, severity: 'warn' as const, failed: !!wbErrors.value.feedback, tab: 'feedback' },
  { key: 'paths', label: '生成失败路径', title: '生成失败的学习路径', count: wbFailedPaths.value, severity: 'bad' as const, failed: !!wbErrors.value.paths, tab: null },
  { key: 'dead', label: '事件投递失败', title: '健康中心 · 事件投递失败清单', count: wbDeadLetters.value, severity: 'warn' as const, failed: !!wbErrors.value.dead, tab: null },
  { key: 'draft', label: '草稿公告', title: '公告列表', count: ann.value.draft, severity: 'muted' as const, failed: annFailed.value, tab: 'announce' },
])

/** KPI 卡 = 快捷切换入口：本页有页签的切页签 + 预筛，其余走跨场景深链。 */
function onKpiClick(m: KpiReading) {
  if (m.failed) return
  if (m.key === 'feedback') goFeedbackPending()
  else if (m.key === 'draft') goAnnouncements()
  else if (m.key === 'paths') goFailedPaths()
  else goDeadLetters()
}

/**
 * 待办读数的值色分档：按事项严重度分档，不把 bad/warn 压成一个布尔——
 * 「生成失败路径 23」（bad）与「待处理反馈 10」（warn）必须不同色，颜色承载紧急度。
 * 失败态读数显红（加载失败为 bad），muted（草稿公告）/零值维持原样不着色。
 */
function countTone(t: { count: number; severity: 'bad' | 'warn' | 'muted'; failed: boolean }): 'bad' | 'warn' | '' {
  if (t.failed || (t.count > 0 && t.severity === 'bad')) return 'bad'
  return t.count > 0 && t.severity === 'warn' ? 'warn' : ''
}

/* 状态面板：路径四态 + 公告三态（比例条 + 行式计数）——2026-10-26 撤除：
   这两张卡的数字与页级读数带同源（生成失败路径 = 读数卡「生成失败路径」、草稿 = 读数卡「草稿公告」），
   空态时又各占 95px 只说一句「暂无」；公告域加载失败还会与读数卡的「加载失败」自相矛盾。
   同批撤除的「生效中公告」清单也一样：公告页签本身有完整列表与新建入口，待办页签不必再放一份。 */

/* ===== 跨页深链（运营组内各页均为独立场景，操作对象页唯一） ===== */
/** 待处理反馈 → 反馈中心（预筛「待处理」）：tab 与预筛一次写进 URL（F5-3）。
    原先只设 intent.tab、由 Feedback onMounted 供内存预筛——地址栏不动，刷新/复制链接
    回落「运营待办」；改由 URL 承载后刷新/后退/复制链接都复原同一视图。
    intent.statusFilter 仍设：Feedback onMounted 消费它（无 router 的单测/兜底路径），
    已是同一值时不会二次写 URL（Feedback 对 ?status= 做双向同步，见 Feedback.vue）。 */
function goFeedbackPending() {
  intent.statusFilter = 'new'
  intent.quickAction = '' // 确保不触发其他快捷动作
  intent.scene = 'ops-hub'
  openTabWith('feedback', { status: 'new' })
}
/** 生成失败路径 → 学习路径页（预筛 failed）：与 goFeedbackPending 同构——预筛进 URL，
    刷新/复制链接/前进后退都复原同一视图（OpsContent onMounted 读 ?status= 还原）。
    intent.statusFilter 不再走（URL 已是唯一通道，双通道会互相覆盖）；无 router 的单测
    兜底保留 intent 既有通道（Overview 路径失败 pill 仍走它）。 */
function goFailedPaths() {
  if (router) {
    void router.push({ path: '/admin/learning-paths', query: { status: 'failed' } })
    return
  }
  intent.statusFilter = 'failed'
  intent.scene = 'learning-paths'
}
/** outbox 死信 → 健康中心「事件投递」卡片（2026-11-11：原运维工具页签下线，
    处置表并回健康中心；focus=outbox 让对面滚到那张卡） */
function goDeadLetters() {
  void router.push({ path: '/admin/health-center', query: { focus: 'outbox' } })
}
/** 草稿公告 → 本页「公告」页签并预筛草稿（2026-10-24）：预筛进 URL，刷新/复制链接可复原。
    单写者纪律（F5-3）：只由 openTabWith 一次写定 tab + status，不再同时设 intent.tab
    （两个写入者各写一半会互相覆盖：intent 的 watcher 会用不带 status 的 query 覆盖在途导航）。 */
function goAnnouncements() {
  intent.statusFilter = 'draft'
  intent.scene = 'ops-hub'
  openTabWith('announce', { status: 'draft' })
}

/* 默认进入即拉取待办聚合（公告计数由 live 层加载）。 */
onMounted(() => {
  void loadWorkbench()
})

/** 本场景的规范路径（侧栏 id → URL 的唯一映射，见 AdminConsole 的 `scene → /admin/${s}`） */
const OPS_HUB_PATH = '/admin/ops-hub'

/* 默认落「反馈」页签；裸进入（URL 既无 ?tab 也无 ?status）时把「待处理」预筛写进 URL——
   「进入运营中心直接看那几条未处理反馈」的可分享/可刷新形态。已有 ?tab 的深链不打扰（尊重调用方意图）。
   2026-11-09 走查修复（地址栏停在上一页）：原实现在 onMounted 里写，而场景切换是 AdminConsole 的
   scene watch 异步 push——挂载时 route 往往还停在上一页，**不带 path 的 replace 会以旧 path 解析**
   并把在途 push 顶掉，实测「总览 → 运营中心」地址栏留在 /admin/overview（刷新/分享/后退全落错页）。
   改为等路径真正落到本场景再写：此时 route 已是权威，且显式带上 path，不再有竞态窗口。 */
watch(
  () => route?.path,
  (p) => {
    if (!router || p !== OPS_HUB_PATH) return
    if (route?.query.tab || route?.query.status) return
    void router.replace({ path: OPS_HUB_PATH, query: { ...route.query, tab: 'feedback', status: 'new' } })
  },
  { immediate: true }
)
</script>

<style scoped>
/* ================= 宿主布局（嵌入子页占满剩余高度） ================= */
/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （含 __count 角标，mk-primitives.css），本页不再私持拷贝。 */
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度。
   2026-11-09 原「运营待办」页签的 .oh-body 内滚容器与行动队列样式一并撤除——
   空壳页签下线后本页只剩嵌入子页，滚动由子页自己管。 */
.oh-host > .mk-page--fill { flex: 1 1 auto; min-height: 0; }
/* 公告 / 站内通知页签此前各有一行 .oh-tabbar 只放主操作（2026-10-26 撤除：
   整行一颗钮夹在页签条与卡片之间，既不属于页头也不属于卡；主操作已归位到子页卡头右组）。 */
</style>
