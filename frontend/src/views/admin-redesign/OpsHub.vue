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

    <!-- 页级待办读数（2026-10-18 用户拍板：读数卡升到页签栏之上、任何页签都能看见）：
         这四个域是跨页签的（反馈 / 路径 / 事件 / 公告各属别的页签），读数原先只长在「运营待办」
         页签里，成了「页签内才有、页签名还与本块同名」的错位；升为页级 = 页级概览 + 页签内工作台，
         页签体内的清单只留行动（事项 + 类别 + 去处理），数字不再讲两遍。
         失败必须显式落地：取不到 ≠ 没事（原实现把失败写成 0，页面伪装成「全部已清零」） -->
    <!-- 失败态的重试出口不放页头（顶栏已有刷新，页头第二颗钮重复）：失败时本行就地给重试
         2026-10-23，与记忆与复习总览的失败条同一形态 -->
    <div v-if="wbHasError" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">待办数据加载失败，对应计数不可信：{{ wbErrorText }}</span>
      <button type="button" class="mk-alert__btn" :disabled="refreshing" @click="refreshActive">{{ refreshing ? '重试中…' : '重试' }}</button>
    </div>
    <!-- 首屏加载态：待办请求在途且尚无 stats 时渲染骨架，不落定 0 值读数 -->
    <MockSkeletonTable v-if="wbLoading && !stats" :cols="4" :rows="1" />
    <section v-else class="mk-kpi-grid oh-metrics" aria-label="运营待办读数">
      <MkKpi
        v-for="m in todoReadings"
        :key="m.key"
        :clickable="!m.failed"
        :label="m.label"
        :value="m.failed ? '—' : m.count"
        :tone="countTone(m)"
        :hint="m.failed ? '加载失败，计数不可信' : ''"
        :hint-tone="m.failed ? 'bad' : ''"
        @click="m.failed ? undefined : m.action()"
      />
    </section>

    <!-- 视图切换（原型 .tabs 下划线页签：12px/600、激活蓝字+2px 蓝下划线、通栏底线；
         2026-10-01 由 mk-pills 胶囊迁入——胶囊只做筛选 chips，视图/分区切换归页签。
         各视图计数以角标随页签呈现，形态同共享 MkSubTabs 的 count 角标） -->
    <div class="tabs" role="tablist" aria-label="运营中心视图切换" @keydown="onTabKeydown">
      <button type="button" class="tab" role="tab" id="oh-tab-todo" :ref="(el) => setTabRef(el, 0)" :tabindex="tab === 'todo' ? 0 : -1" aria-controls="oh-panel-todo" :aria-selected="tab === 'todo'" @click="switchTab('todo')">运营待办</button>
      <button type="button" class="tab" role="tab" id="oh-tab-feedback" :ref="(el) => setTabRef(el, 1)" :tabindex="tab === 'feedback' ? 0 : -1" aria-controls="oh-panel-feedback" :aria-selected="tab === 'feedback'" @click="switchTab('feedback')">反馈<span v-if="domainCount.feedback !== null && domainCount.feedback >= 0" class="tab__count">{{ domainCount.feedback }}</span></button>
      <button type="button" class="tab" role="tab" id="oh-tab-achievements" :ref="(el) => setTabRef(el, 2)" :tabindex="tab === 'achievements' ? 0 : -1" aria-controls="oh-panel-achievements" :aria-selected="tab === 'achievements'" @click="switchTab('achievements')">成就</button>
      <button type="button" class="tab" role="tab" id="oh-tab-announce" :ref="(el) => setTabRef(el, 3)" :tabindex="tab === 'announce' ? 0 : -1" aria-controls="oh-panel-announce" :aria-selected="tab === 'announce'" @click="switchTab('announce')">公告<span v-if="announcePillCount !== ''" class="tab__count" :title="announcePillTitle">{{ announcePillCount }}</span></button>
      <button type="button" class="tab" role="tab" id="oh-tab-inapp" :ref="(el) => setTabRef(el, 4)" :tabindex="tab === 'inapp' ? 0 : -1" aria-controls="oh-panel-inapp" :aria-selected="tab === 'inapp'" @click="switchTab('inapp')">站内通知<span v-if="domainCount.inapp !== null && domainCount.inapp >= 0" class="tab__count">{{ domainCount.inapp }}</span></button>
      <!-- 域分界（2026-10-24）：左四是内容运营，右三是系统运维。两组动作的后果不同
           （改文案 vs 重放事件/导数据/踢会话），用一条竖线把「谁来处理」分开。 -->
      <span class="tabs__sep" aria-hidden="true"></span>
      <!-- 系统工具三页签（2026-10-16 由退役的「系统工具」场景整体迁入：运维工具/数据导出/会话安全） -->
      <button type="button" class="tab" role="tab" id="oh-tab-tools" :ref="(el) => setTabRef(el, 5)" :tabindex="tab === 'tools' ? 0 : -1" aria-controls="oh-panel-tools" :aria-selected="tab === 'tools'" @click="switchTab('tools')">运维工具</button>
      <button type="button" class="tab" role="tab" id="oh-tab-export" :ref="(el) => setTabRef(el, 6)" :tabindex="tab === 'export' ? 0 : -1" aria-controls="oh-panel-export" :aria-selected="tab === 'export'" @click="switchTab('export')">数据导出</button>
      <button type="button" class="tab" role="tab" id="oh-tab-security" :ref="(el) => setTabRef(el, 7)" :tabindex="tab === 'security' ? 0 : -1" aria-controls="oh-panel-security" :aria-selected="tab === 'security'" @click="switchTab('security')">会话安全<span v-if="domainCount.security !== null && domainCount.security >= 0" class="tab__count">{{ domainCount.security }}</span></button>
    </div>

    <!-- ===== Tab1: 运营待办 =====
         页级读数带只报四个数；带「去处理」的行动清单在本页签。两者不是同一件事的两份拷贝：
         读数卡是「有多少」，清单是「点哪去处理」，撤掉清单等于把页签清空（2026-10-26 走查：
         本页签一度只剩公告空态，而公告有独立页签）。按严重度排序，零值行弱化为「已清零」。 -->
    <template v-if="tab === 'todo'">
    <div class="oh-body" id="oh-panel-todo" role="tabpanel" aria-labelledby="oh-tab-todo">
    <section class="mk-card">
      <div class="mk-card__head">
        <div class="oh-wb-head">
          <h4 class="mk-card__title">待办清单</h4>
          <span class="mk-card__meta">{{ wbLoading && !stats ? '正在拉取待办…' : todoConclusion }}</span>
        </div>
      </div>
      <MockSkeletonTable v-if="wbLoading && !stats" :cols="4" :rows="4" />
      <div v-else class="ow-ranklist">
        <button
          v-for="t in todoItems"
          :key="t.key"
          type="button"
          class="ow-rankrow"
          :class="{ 'ow-rankrow--done': t.count === 0 && !t.failed, 'ow-rankrow--failed': t.failed, 'ow-rankrow--act': t.actionable }"
          :disabled="!t.actionable"
          :title="t.failed ? '该项数据加载失败，计数不可信' : (t.count > 0 ? t.hint : '该事项已清零')"
          @click="t.actionable ? t.action() : undefined"
        >
          <span class="ow-rankrow__main">{{ t.label }}</span>
          <span class="mk-badge mk-badge--muted">{{ t.category }}</span>
          <span class="ow-rankrow__go" :class="{ 'ow-rankrow__go--bad': t.failed }">{{ t.failed ? '加载失败' : (t.count > 0 ? '去处理 →' : '已清零') }}</span>
        </button>
      </div>
    </section>
    </div><!-- /oh-body -->
    </template>

    <!-- ===== Tab2: 反馈（Feedback embedded；口径开关已退役，默认全部非虚拟账号） ===== -->
    <Feedback v-else-if="tab === 'feedback'" id="oh-panel-feedback" role="tabpanel" aria-labelledby="oh-tab-feedback" ref="feedbackRef" embedded @count="onDomainCount('feedback', $event)" @status="onFeedbackStatus" />
    <!-- ===== Tab3: 成就（OpsAchievements embedded） ===== -->
    <OpsAchievements v-else-if="tab === 'achievements'" id="oh-panel-achievements" role="tabpanel" aria-labelledby="oh-tab-achievements" ref="achievementsRef" embedded @count="onDomainCount('achievements', $event)" />
    <!-- ===== Tab4: 公告（Announcements embedded） =====
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
      @count="onDomainCount('announce', $event)"
    />
    <!-- ===== Tab5: 站内通知（Notifications embedded）=====
         与公告 tab 同判例：主操作「发送通知」由子页卡头自己给，宿主不再补工具行。 -->
    <Notifications
      v-else-if="tab === 'inapp'"
      id="oh-panel-inapp"
      role="tabpanel"
      aria-labelledby="oh-tab-inapp"
      ref="notifRef"
      embedded
      @count="onDomainCount('inapp', $event)"
    />

    <!-- ===== Tab6: 运维工具（时间推进模拟 + outbox 死信重放；原「系统工具」页 Tab1） ===== -->
    <ServerToolsPanel
      v-else-if="tab === 'tools'"
      id="oh-panel-tools"
      role="tabpanel"
      aria-labelledby="oh-tab-tools"
      ref="toolsRef"
    />

    <!-- ===== Tab7: 数据导出（多表 CSV 快照；原「系统工具」页 Tab2） ===== -->
    <DataExportPanel v-else-if="tab === 'export'" id="oh-panel-export" role="tabpanel" aria-labelledby="oh-tab-export" />

    <!-- ===== Tab8: 会话安全（SessionSecurity embedded；原「系统工具」页 Tab3） =====
         role=tabpanel/aria-labelledby 透传到 SessionSecurity 根 div（单根组件） -->
    <SessionSecurity
      v-else
      id="oh-panel-security"
      role="tabpanel"
      aria-labelledby="oh-tab-security"
      ref="securityRef"
      embedded
      @count="onDomainCount('security', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { liveFailures, errMsg, liveRefreshSeq } from './live'
import { intent } from './store'
import { adminFeedbackApi, adminLearningContentApi, adminDevtoolsApi, type LearningContentStats } from '@/api/adminApi'
import { announcementCounts } from './opsShared'
import Feedback from './Feedback.vue'
import OpsAchievements from './OpsAchievements.vue'
import Announcements from './Announcements.vue'
import Notifications from './Notifications.vue'
import ServerToolsPanel from './ServerToolsPanel.vue'
import DataExportPanel from './DataExportPanel.vue'
import SessionSecurity from './SessionSecurity.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MockSkeletonTable from './SkeletonTable.vue'

/* ===== 宿主：运营待办 · 反馈 · 成就 · 公告 · 站内通知 · 运维工具 · 数据导出 · 会话安全 =====
   低频页折入 tab 宿主；?tab= 双向同步，深链/刷新/前进后退可寻址（对齐消息/用户宿主约定）。
   2026-10-16 用户拍板：「系统工具」（ops-center）场景解散并入本页——它是「发现→去处理」的
   动作枢纽（事件投递失败已作为运营待办项挂在这里），而健康中心是只读报表，落这边更顺。
   原三页签整体迁入为 tools/export/security，旧深链 /admin/devtools|export-data|session-security
   在 router 重定向到对应 tab。 */
const OH_TABS = ['todo', 'feedback', 'achievements', 'announce', 'inapp', 'tools', 'export', 'security'] as const

type OhTab = (typeof OH_TABS)[number]
const tab = ref<OhTab>('todo')
const route = useRoute()
const router = useRouter()

/** 宿主域计数（由激活子视图上报）：反馈总数 / 解锁数 / 公告数 / 通知数 / 会话数。
    null = 该子页签尚未访问、计数未拉取 → 2026-10-21 起角标不渲染（用户「我刚进来就显示
    未加载，为什么会有这个状态」）：「未加载」是页面自己的取数状态，不是待处理量，
    挂在页签上会被读成第 N 项待办。有数就显示数字，没拉过就什么都不显示
    （0 照常显示——0 是「确认没有」，与「还没查」不是一回事）。 */
const domainCount = ref<{ feedback: number | null; achievements: number | null; announce: number | null; inapp: number | null; security: number | null }>({
  feedback: null,
  achievements: null,
  announce: null,
  inapp: null,
  security: null
})
function onDomainCount(domain: keyof typeof domainCount.value, n: number) {
  domainCount.value[domain] = n
}
const feedbackRef = ref<{ refresh?: () => void } | null>(null)
const achievementsRef = ref<{ refresh?: () => void } | null>(null)
const announceRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)
const notifRef = ref<{ reload?: () => void; openSend?: () => void } | null>(null)
const toolsRef = ref<{ refresh?: () => void } | null>(null)
const securityRef = ref<{ refresh?: () => void } | null>(null)
const refreshing = ref(false)
/* 顶栏刷新广播：与旧页头刷新钮同一入口（当前页签面板 + 待办读数带） */
watch(liveRefreshSeq, () => { void refreshActive() })

async function refreshActive() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    if (tab.value === 'feedback') feedbackRef.value?.refresh?.()
    else if (tab.value === 'achievements') achievementsRef.value?.refresh?.()
    else if (tab.value === 'announce') announceRef.value?.refresh?.()
    else if (tab.value === 'inapp') notifRef.value?.reload?.()
    else if (tab.value === 'tools') toolsRef.value?.refresh?.()
    else if (tab.value === 'security') securityRef.value?.refresh?.()
    /* 页级读数带在 8 个页签都可见（2026-10-18），所以待办域始终可刷：
       todo / export 无本页签面板，直接刷读数带；其它页签在刷本面板之后再补一次待办域
       ——失败态下页头钮是「重试」，点它必须真的重拉读数带，不能刷成别的面板。 */
    /* 页级读数带常驻 8 个页签，任何页签刷新都要重拉它（2026-10-24 修「切走页签后读数带陈旧」） */
    await loadWorkbench()
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
/** 切页签 + 写 URL。F5-3 审核：intent 直达必须与点页签同构——URL 才是可刷新/可复制/
    可后退的权威；原先 intent 路径只改 tab.value 不写 URL，地址栏停在 ?tab=todo
    （页面与地址栏脱节，刷新/复制链接回落「运营待办」）。单测可无 router 挂载，故访问保持可选 */
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
  // push：注释承诺「可后退」——从待办切到反馈后，后退应回待办而不是离开运营中心（2026-10-24）
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
  void router.replace({ query: q })
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
   F5-3：消费时走 switchTab 写 URL（replace，与点页签同历史行为）——原先只改 tab.value，
   地址栏停在 ?tab=todo、刷新/复制链接回落「运营待办」，与点页签不同构。
   （反馈的预筛不在此处：goFeedbackPending 与 tab 同一次 replace 落定，见下——
   两个写入者各写一半会互相覆盖：子组件此刻读到的 route 仍是旧 tab。） */
watch(
  () => intent.tab,
  (t) => {
    if (t && (OH_TABS as readonly string[]).includes(t)) {
      const v = t as OhTab
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

/* 待办四域（单一来源）：页级读数带按此顺序出四张卡，卡本身即入口。
   域加载失败时该卡显「—」且不可点（读数不可信，不能带人去目标页）。
   2026-10-26：页级读数卡接上点击后，页签内的「待办清单」只保留「点哪去处理」这一件事，
   不再复述卡头结论与四张状态卡（那两张状态卡的数字与读数带同源，已删）。 */
const todoReadings = computed(() => [
  { key: 'feedback', label: '待处理反馈', category: '反馈', hint: '', count: wbPendingFeedback.value, severity: 'warn' as const, action: goFeedbackPending, failed: !!wbErrors.value.feedback, actionable: !wbErrors.value.feedback && wbPendingFeedback.value > 0 },
  { key: 'paths', label: '生成失败路径', category: '路径', hint: '', count: wbFailedPaths.value, severity: 'bad' as const, action: goFailedPaths, failed: !!wbErrors.value.paths, actionable: !wbErrors.value.paths && wbFailedPaths.value > 0 },
  { key: 'dead', label: '事件投递失败', category: '事件', hint: '影响画像与成就更新', count: wbDeadLetters.value, severity: 'warn' as const, action: goDeadLetters, failed: !!wbErrors.value.dead, actionable: !wbErrors.value.dead && wbDeadLetters.value > 0 },
  { key: 'draft', label: '草稿公告', category: '公告', hint: '', count: ann.value.draft, severity: 'muted' as const, action: goAnnouncements, failed: annFailed.value, actionable: !annFailed.value && ann.value.draft > 0 },
])

const TODO_SEV_RANK = { bad: 0, warn: 1, muted: 2 } as const

/** 行动清单：按严重度排序（坏 > 警告 > 中性，同档按计数降序），与页级读数带同一份数据两种排布 */
const todoItems = computed(() =>
  todoReadings.value.slice().sort((a, b) => TODO_SEV_RANK[a.severity] - TODO_SEV_RANK[b.severity] || b.count - a.count)
)

/** 卡头结论句：三态纪律——首屏未拉回前不得渲染「全部已清零」（取不到 ≠ 没事） */
const todoConclusion = computed(() => {
  const pendingItems = todoItems.value.filter((t) => t.count > 0 && !t.failed)
  const pending = pendingItems.length
  const total = pendingItems.reduce((n, t) => n + t.count, 0)
  if (wbHasError.value) {
    return pending ? `${pending} 类 · ${total} 件待处理。另有部分待办加载失败，结论不完整` : '待办数据加载失败，无法确认是否清零'
  }
  if (!pending) return '运营待办全部已清零'
  return `${pending} 项待处理（${pending} 类 · ${total} 件）`
})

/**
 * 待办读数的值色分档：按事项严重度分档，不把 bad/warn 压成一个布尔——
 * 「生成失败路径 23」（bad）与「待处理反馈 10」（warn）必须不同色，颜色承载紧急度。
 * 失败态读数显红（加载失败为 bad），muted（草稿公告）/零值维持原样不着色。
 */
function countTone(t: { count: number; severity: 'bad' | 'warn' | 'muted'; failed: boolean }): 'bad' | 'warn' | '' {
  if (t.failed || (t.count > 0 && t.severity === 'bad')) return 'bad'
  return t.count > 0 && t.severity === 'warn' ? 'warn' : ''
}

/**
 * 公告页签角标：报草稿数（页签位天然被读成待办量）。
 * 以 live 层已加载计数为 seed，嵌入门 @count 进入页签后覆盖刷新。
 * 加载失败不出角标（失败是取数状态，不是待处理量）。
 */
const announcePillCount = computed(() => {
  if (annFailed.value) return ''
  const embedded = domainCount.value.announce
  if (embedded !== null) return embedded
  return ann.value.draft
})
/** 角标悬停：公告页签角标只报草稿，不报全部公告数 */
const announcePillTitle = computed(() => {
  if (annFailed.value) return '公告列表加载失败'
  return '草稿公告数'
})

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
/** outbox 死信 → 本页「运维工具」页签（2026-10-16：系统工具场景解散并入本页后，
    不再跨页跳转，直接切到同页的重放面板；死信清单由该面板挂载时自拉） */
function goDeadLetters() {
  switchTab('tools')
}
/** 草稿公告 → 本页「公告」页签并预筛草稿（2026-10-24）：此前只设 intent 不切 tab，
    点「去处理」停在运营待办；预筛进 URL，刷新/复制链接可复原。 */
function goAnnouncements() {
  intent.tab = 'announce'
  intent.statusFilter = 'draft'
  intent.scene = 'ops-hub'
  openTabWith('announce', { status: 'draft' })
}

/* 默认进入即拉取待办聚合（公告计数由 live 层加载） */
onMounted(() => {
  void loadWorkbench()
})
</script>

<style scoped>
/* ================= 宿主布局（tab 宿主：运营待办内滚；嵌入子页占满剩余高度） ================= */
/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （含 __count 角标，mk-primitives.css），本页不再私持拷贝。 */
/* 内容运营 / 系统运维的域分界：竖线与页签底线同色，高度对齐文字行高 */
.tabs__sep {
  align-self: center;
  width: 1px;
  height: 14px;
  margin: 0 8px;
  background: var(--mk-line);
}
/* 待办 tab：内容在宿主 flex 列内独立滚动（页头/页签固定） */
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
/* 系统工具迁入的两个面板（2026-10-16）：根节点是普通 div，不占满整高，改为占满剩余高度
   并自管纵向滚动——原 OpsCenter 的 .oc-card__body 承担同一职责（表单/清单长时卡内滚动） */
.oh-host > .stp-body,
.oh-host > .exp-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* 窄屏：KPI 竖排后剩余高度只剩几十像素，面板内部滚动变成「一条缝」——退回内容高度，由页面滚动 */
@media (max-width: 900px) {
  .oh-host > .stp-body,
  .oh-host > .exp-body { flex: none; min-height: 0; overflow: visible; }
}
/* 公告 / 站内通知页签此前各有一行 .oh-tabbar 只放主操作（2026-10-26 撤除：
   整行一颗钮夹在页签条与卡片之间，既不属于页头也不属于卡；主操作已归位到子页卡头右组）。 */

/* 待办行动行：事项 + 类别 + 出口。计数在页级读数带，本清单只负责「点哪去处理」。
   仅可跳转行给 pointer（「已清零 / 加载失败」行不挂跳转）。 */
.ow-ranklist { padding: 0 14px 6px; }
.ow-rankrow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 0;
  border: 0;
  border-bottom: 1px solid var(--mk-line);
  background: transparent;
  font: inherit;
  text-align: left;
  transition: background 0.12s;
}
.ow-rankrow:last-child { border-bottom: 0; }
.ow-rankrow--act { cursor: pointer; }
.ow-rankrow--act:hover { background: var(--mk-surface-2); }
.ow-rankrow__main {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--mk-fs-body);
  font-weight: 700;
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ow-rankrow__go {
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-blue);
  white-space: nowrap;
  padding: 3px 8px;
  border-radius: var(--mk-radius-sm);
  transition: background 0.12s;
}
.ow-rankrow--act:hover .ow-rankrow__go { background: var(--mk-surface-2); }
/* 已清零：整体弱化 */
.ow-rankrow--done { cursor: default; }
.ow-rankrow--done .ow-rankrow__main { color: var(--mk-faint); font-weight: 600; }
.ow-rankrow--done .ow-rankrow__go { color: var(--mk-green); }
/* 加载失败：与「已清零」明确区分（红而非绿，不弱化为完成态） */
.ow-rankrow--failed { cursor: default; }
.ow-rankrow--failed .ow-rankrow__main { color: var(--mk-red); }
.ow-rankrow__go--bad { color: var(--mk-red); }
</style>
