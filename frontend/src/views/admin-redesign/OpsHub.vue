<template>
  <div class="mk-page mk-page--fill oh-host">
    <!-- 页头（newui/admin pagehead）：页名 + 页级读数的口径开关与刷新/重试
         （2026-10-04 状态条退役：整块下线，读数各归其位） -->
    <MkPageHead title="运营中心">
      <template #actions>
        <!-- 视角开关随页级读数带走（2026-10-18）：读数带在任何页签都在（见下），它管的就是那几个数
             ——留在「运营待办」卡头会变成「数在页级、开关在某个页签里」。口径开关收页头同学习组六页判例。 -->
        <span class="oh-scope" title="事件投递失败与草稿公告不随视角变化">
          <DataScopeToggle v-model="wbScope" />
        </span>
        <!-- 刷新钮在所有页签都在：页级读数带在 8 个页签都可见（含 export 表单页），
             待办域始终有可刷的东西；失败时它是读数带的重试出口，故文案随读数带的失败态走 -->
        <button type="button" class="mk-btn mk-btn--sm" :disabled="refreshing" @click="refreshActive">
          {{ refreshing ? '刷新中…' : (wbHasError ? '重试' : '刷新') }}
        </button>
      </template>
    </MkPageHead>

    <!-- 页级待办读数（2026-10-18 用户拍板：读数卡升到页签栏之上、任何页签都能看见）：
         这四个域是跨页签的（反馈 / 路径 / 事件 / 公告各属别的页签），读数原先只长在「运营待办」
         页签里，成了「页签内才有、页签名还与本块同名」的错位；升为页级 = 页级概览 + 页签内工作台，
         页签体内的清单只留行动（事项 + 类别 + 去处理），数字不再讲两遍。
         失败必须显式落地：取不到 ≠ 没事（原实现把失败写成 0，页面伪装成「全部已清零」） -->
    <p v-if="wbHasError" class="mk-alert" role="alert">
      待办数据加载失败，对应计数不可信：{{ wbErrorText }}
    </p>
    <!-- 首屏加载态：待办请求在途且尚无 stats 时渲染骨架，不落定 0 值读数 -->
    <MockSkeletonTable v-if="wbLoading && !stats" :cols="4" :rows="1" />
    <section v-else class="mk-kpi-grid oh-metrics" aria-label="运营待办读数">
      <MkKpi
        v-for="m in todoReadings"
        :key="m.key"
        :label="m.label"
        :value="m.failed ? '—' : m.count"
        :tone="countTone(m)"
        :hint="m.failed ? '加载失败，计数不可信' : ''"
        :hint-tone="m.failed ? 'bad' : ''"
      />
    </section>

    <!-- 视图切换（原型 .tabs 下划线页签：12px/600、激活蓝字+2px 蓝下划线、通栏底线；
         2026-10-01 由 mk-pills 胶囊迁入——胶囊只做筛选 chips，视图/分区切换归页签。
         各视图计数以角标随页签呈现，形态同共享 MkSubTabs 的 count 角标） -->
    <div class="tabs" role="tablist" aria-label="运营中心视图切换" @keydown="onTabKeydown">
      <button type="button" class="tab" role="tab" id="oh-tab-todo" :ref="(el) => setTabRef(el, 0)" :tabindex="tab === 'todo' ? 0 : -1" aria-controls="oh-panel-todo" :aria-selected="tab === 'todo'" @click="switchTab('todo')">运营待办</button>
      <button type="button" class="tab" role="tab" id="oh-tab-feedback" :ref="(el) => setTabRef(el, 1)" :tabindex="tab === 'feedback' ? 0 : -1" aria-controls="oh-panel-feedback" :aria-selected="tab === 'feedback'" @click="switchTab('feedback')">反馈<span v-if="domainCount.feedback !== null" class="tab__count">{{ domainCount.feedback }}</span></button>
      <button type="button" class="tab" role="tab" id="oh-tab-achievements" :ref="(el) => setTabRef(el, 2)" :tabindex="tab === 'achievements' ? 0 : -1" aria-controls="oh-panel-achievements" :aria-selected="tab === 'achievements'" @click="switchTab('achievements')">成就<span v-if="domainCount.achievements !== null" class="tab__count" title="含虚拟学习者">{{ domainCount.achievements }}</span></button>
      <button type="button" class="tab" role="tab" id="oh-tab-announce" :ref="(el) => setTabRef(el, 3)" :tabindex="tab === 'announce' ? 0 : -1" aria-controls="oh-panel-announce" :aria-selected="tab === 'announce'" @click="switchTab('announce')">公告<span v-if="announcePillCount !== ''" class="tab__count" :title="announcePillTitle">{{ announcePillCount }}</span></button>
      <button type="button" class="tab" role="tab" id="oh-tab-inapp" :ref="(el) => setTabRef(el, 4)" :tabindex="tab === 'inapp' ? 0 : -1" aria-controls="oh-panel-inapp" :aria-selected="tab === 'inapp'" @click="switchTab('inapp')">站内通知<span v-if="domainCount.inapp !== null" class="tab__count">{{ domainCount.inapp }}</span></button>
      <!-- 系统工具三页签（2026-10-16 由退役的「系统工具」场景整体迁入：运维工具/数据导出/会话安全） -->
      <button type="button" class="tab" role="tab" id="oh-tab-tools" :ref="(el) => setTabRef(el, 5)" :tabindex="tab === 'tools' ? 0 : -1" aria-controls="oh-panel-tools" :aria-selected="tab === 'tools'" @click="switchTab('tools')">运维工具</button>
      <button type="button" class="tab" role="tab" id="oh-tab-export" :ref="(el) => setTabRef(el, 6)" :tabindex="tab === 'export' ? 0 : -1" aria-controls="oh-panel-export" :aria-selected="tab === 'export'" @click="switchTab('export')">数据导出</button>
      <button type="button" class="tab" role="tab" id="oh-tab-security" :ref="(el) => setTabRef(el, 7)" :tabindex="tab === 'security' ? 0 : -1" aria-controls="oh-panel-security" :aria-selected="tab === 'security'" @click="switchTab('security')">会话安全<span v-if="domainCount.security !== null" class="tab__count">{{ domainCount.security }}</span></button>
    </div>

    <!-- ===== Tab1: 运营待办（原运营中心全量内容） ===== -->
    <template v-if="tab === 'todo'">
    <div class="oh-body" id="oh-panel-todo" role="tabpanel" aria-labelledby="oh-tab-todo">
    <!-- 运营待办工作台（原型 1905-1914）：读数已升页级（见上），本卡只留行动清单
         （原型 290-295 .ranklist/.rankrow：事项 + 行尾 mute 类别 pill +「去处理」）——
         数字单源在页级读数带，卡头只给结论句，同一件事不在两处讲。 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <!-- 左组（卡头成组判据：space-between 下三子元素会把 meta 挤到中间，标题+结论须成组吃 flex） -->
        <div class="oh-wb-head">
          <h4 class="mk-card__title">待办清单</h4>
          <!-- 2026-10-04 状态条退役：结论句（原页头状态条 strong）并入卡头 meta，不另占一条。
               三态纪律：首屏三请求未回来前不得渲染「全部已清零」（取不到 ≠ 没事） -->
          <span class="mk-card__meta">{{ wbLoading && !stats ? '正在拉取待办…' : `${todoConclusion}` }}</span>
        </div>
        <!-- 卡头不再挂视角开关：它管的是页级读数带那几个数，随读数带去了页头（2026-10-18） -->
      </div>
      <!-- 首屏加载期间整段不落定（不渲染「已清零 / 去处理」），改渲染共用加载骨架，
           避免把「还没拉到」显示成「确认清零」 -->
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

    <!-- 状态面板：路径 / 公告并列，紧凑行式区别于 Dashboard KPI 卡 -->
    <div class="ow-panels">
      <section class="mk-card">
        <div class="mk-card__head">
          <h4 class="mk-card__title">学习路径</h4>
          <button type="button" class="mk-link" @click="goContent">管理 →</button>
        </div>
        <div class="ow-state">
          <!-- 构成条走共享原语（2026-10-04）：原自搓 .ow-state__seg 与 .stageband 四项分叉
               （高度/gap/轨道色/子元素）+ muted 硬编码，收编后只传段数据 -->
          <MkStageband
            v-if="pathTotal > 0 && pathHasDistribution"
            :segments="pathSegments"
            size="sm"
            :legend="false"
            aria-hidden="true"
          />
          <!-- #72：stats 拉取失败时 pathSegments 为空，原先落成「暂无学习路径」——读不到 ≠ 没有 -->
          <div v-else-if="wbErrors.paths" class="mk-alert ow-state__error" role="alert">路径数据加载失败，计数暂不可用</div>
          <div v-else-if="pathTotal === 0" class="ow-state__empty">暂无学习路径</div>
          <!-- P3（2026-10-04 全站评审）：空态时三行 0 计数不再与「暂无…」并存（零信息复读） -->
          <div v-if="pathTotal > 0" class="ow-state__rows">
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
          <MkStageband
            v-if="annTotal > 0 && annHasDistribution"
            :segments="annSegments"
            size="sm"
            :legend="false"
            aria-hidden="true"
          />
          <div v-else-if="annTotal === 0" class="ow-state__empty">暂无公告</div>
          <!-- P3：同上，空态只留占位行 -->
          <div v-if="annTotal > 0" class="ow-state__rows">
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
    <Feedback v-else-if="tab === 'feedback'" id="oh-panel-feedback" role="tabpanel" aria-labelledby="oh-tab-feedback" ref="feedbackRef" embedded @count="onDomainCount('feedback', $event)" @status="onFeedbackStatus" />
    <!-- ===== Tab3: 成就（OpsAchievements embedded） ===== -->
    <OpsAchievements v-else-if="tab === 'achievements'" id="oh-panel-achievements" role="tabpanel" aria-labelledby="oh-tab-achievements" ref="achievementsRef" embedded @count="onDomainCount('achievements', $event)" />
    <!-- ===== Tab4: 公告（Announcements embedded） =====
         嵌入态下 Announcements 隐藏自身承载「新建公告」的状态条，列表非空时无可见入口；
         由宿主提供工具行并调用其暴露的 openCreate()（defineExpose），不再重复按钮。 -->
    <template v-else-if="tab === 'announce'">
      <div class="oh-tabbar">
        <span class="oh-tabbar__sub">面向学习者的公告</span>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="announceRef?.openCreate?.()">新建公告</button>
      </div>
      <Announcements id="oh-panel-announce" role="tabpanel" aria-labelledby="oh-tab-announce" ref="announceRef" embedded @count="onDomainCount('announce', $event)" />
    </template>
    <!-- ===== Tab5: 站内通知（Notifications embedded） =====
         与公告 tab 同判例：嵌入态下 Notifications 隐藏自身状态条，列表非空时
         「发送通知」主钮无处可见（空态按钮只在无数据时出现），宿主补工具行并调其 openSend()。 -->
    <template v-else-if="tab === 'inapp'">
      <div class="oh-tabbar">
        <span class="oh-tabbar__sub">站内信与推送</span>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="notifRef?.openSend?.()">发送通知</button>
      </div>
      <Notifications id="oh-panel-inapp" role="tabpanel" aria-labelledby="oh-tab-inapp" ref="notifRef" embedded @count="onDomainCount('inapp', $event)" @go-announce="switchTab('announce')" />
    </template>

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
import { timeAgo, liveAnnouncements, liveFailures, errMsg } from './live'
import { intent } from './store'
import { adminFeedbackApi, adminLearningContentApi, adminDevtoolsApi, type LearningContentStats } from '@/api/adminApi'
import { announcementCounts, segmentPct, PATH_STATUS_TEXT } from './opsShared'
import Feedback from './Feedback.vue'
import OpsAchievements from './OpsAchievements.vue'
import Announcements from './Announcements.vue'
import Notifications from './Notifications.vue'
import ServerToolsPanel from './ServerToolsPanel.vue'
import DataExportPanel from './DataExportPanel.vue'
import SessionSecurity from './SessionSecurity.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkStageband from '@/components/mk/MkStageband.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import DataScopeToggle from './DataScopeToggle.vue'
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
    if (tab.value === 'todo' || tab.value === 'export' || wbHasError.value) await loadWorkbench()
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
function switchTab(t: OhTab) {
  tab.value = t
  if (route && router && route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}
/** 同场景内的直达：切 tab 且把目的地视图的预筛一并写进 URL（单次 replace）。tab 取显式
    目标值——不用 route.query.tab，它此刻可能仍是旧值，会把 tab 写回去（F5-3 竞态根因）。 */
function openTabWith(t: OhTab, extra: Record<string, string>) {
  tab.value = t
  if (!route || !router) return
  const changed = route.query.tab !== t || Object.entries(extra).some(([k, v]) => route.query[k] !== v)
  if (changed) void router.replace({ query: { ...route.query, ...extra, tab: t } })
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
/* 真实/测试互斥视角（2026-10-10 拍板方言）：false=真实用户；true=虚拟学习者与测试账号。
   反馈与失败路径按此视角计数；事件投递（outbox 死信）与草稿公告是系统全域，不随视角变化 */
const wbScope = ref(false)
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
    // 待处理反馈：后端 status=new 计数（与 Feedback 页口径一致）；按真实/测试视角过滤
    adminFeedbackApi.list({ limit: 1, status: 'new', includeTest: wbScope.value || undefined, testOnly: wbScope.value || undefined }),
    // 失败路径：学习内容 stats（与内容管理页口径一致）；按真实/测试视角过滤
    adminLearningContentApi.getStats(wbScope.value || undefined, wbScope.value || undefined),
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
/** P2-1（2026-10-04 全站评审）：待办结论句——只点名非零事项，全零给清零句；
    数字细节唯一住在下方指标卡（「已清零」逐行状态由行动行承载）。
    2026-10-06 审核 #173：原句逐项复述数字，与下方四张指标卡 + 行动行构成「同一组四项讲三遍」。
    改为总括句（项数 + 排序 + 直达承诺），逐项数字只留指标卡一处。 */
const todoConclusion = computed(() => {
  const pending = todoItems.value.filter((t) => t.count > 0 && !t.failed).length
  /* 有域失败时不得断言「全部已清零」：失败域的计数未被更新，清零结论不可信 */
  if (wbHasError.value) return pending ? `${pending} 项待处理。另有部分待办加载失败，结论不完整` : '待办数据加载失败，无法确认是否清零'
  if (!pending) return '运营待办全部已清零'
  return `${pending} 项待处理`
})
const TODO_SEV_RANK = { bad: 0, warn: 1, muted: 2 } as const
/** 页级读数卡的短脚注（4-6 字，同其余页级 KPI 带的口径写法——长句口径住行内 title） */
/* 待办四域（单一来源）：页级读数带按此顺序出四张卡，页签内的行动清单按严重度重排。
   零值弱化为「已清零」；域加载失败时该行显示「加载失败」，读数显「—」，都不伪装成 0；
   actionable = 有计数且未失败——「已清零 / 加载失败」行不给 pointer 样式也不挂跳转
   （原实现 cursor 已是 default，点击却仍跳转，是「看起来不可点其实可点」的误导） */
const todoReadings = computed(() => [
  { key: 'feedback', label: '待处理反馈', category: '反馈', hint: '', count: wbPendingFeedback.value, severity: 'warn' as const, action: goFeedbackPending, failed: !!wbErrors.value.feedback, actionable: !wbErrors.value.feedback && wbPendingFeedback.value > 0 },
  { key: 'paths', label: '生成失败路径', category: '路径', hint: '', count: wbFailedPaths.value, severity: 'bad' as const, action: goFailedPaths, failed: !!wbErrors.value.paths, actionable: !wbErrors.value.paths && wbFailedPaths.value > 0 },
  { key: 'dead', label: '事件投递失败', category: '事件', hint: '影响画像与成就更新', count: wbDeadLetters.value, severity: 'warn' as const, action: goDeadLetters, failed: !!wbErrors.value.dead, actionable: !wbErrors.value.dead && wbDeadLetters.value > 0 },
  { key: 'draft', label: '草稿公告', category: '公告', hint: '', count: ann.value.draft, severity: 'muted' as const, action: goAnnouncements, failed: annFailed.value, actionable: !annFailed.value && ann.value.draft > 0 },
])
/* 行动清单：按严重度排序（坏>警告>中性，同档按计数降序），与页级读数带是同一份数据的两种排布 */
const todoItems = computed(() =>
  todoReadings.value.slice().sort((a, b) => TODO_SEV_RANK[a.severity] - TODO_SEV_RANK[b.severity] || b.count - a.count)
)

/**
 * 待办读数的值色分档（原指标卡的 tone 分档；2026-10-18 读数从行内回到页级读数带，判据不变）：
 * 按事项严重度分档，不把 bad/warn 压成一个布尔——原 `severity !== 'muted' && count > 0` 让
 * 「生成失败路径 23」（bad，排在第一行）与「待处理反馈 10」（warn）同为琥珀，颜色不再承载
 * 紧急度；同屏「学习路径」面板的「生成失败」已显红（ow-state__bad），同一事实两色。
 * 失败态读数显红（加载失败为 bad），muted（草稿公告）/零值维持原样不着色。
 */
function countTone(t: { count: number; severity: 'bad' | 'warn' | 'muted'; failed: boolean }): 'bad' | 'warn' | '' {
  if (t.failed || (t.count > 0 && t.severity === 'bad')) return 'bad'
  return t.count > 0 && t.severity === 'warn' ? 'warn' : ''
}

/* 公告三态计数（live 层共享，与侧栏徽章同源） */
const ann = announcementCounts

/**
 * 公告 pill / 状态条计数（P1-4）：
 * 原实现走嵌入门 @count（domainCount.announce），未访问 announce tab 前恒为 0——
 * 而同页待办的公告数用 live 层真实 N 条，同一指标两种口径互相矛盾。
 * 改为以 live 层已加载计数 announcementCounts.rows 为 seed，
 * 嵌入门 @count 仅作覆盖刷新（进入 tab 后仍以其上报为准）。
 */
const announcePillCount = computed(() => {
  /* 加载失败：与「未加载」同形占位（审核 #171——同排页签角标统一为「数字 / 未加载」两态，
     不再出现第三种「—」形态；失败语义由 title 说明）。
     措辞从「待访问」改「未加载」（2026-10-13 运营走查 O7）：角标位天然被读成「待处理量」，
     「待访问」在中文里更像「有东西等我访问」，恰好读反——它只说计数还没拉。 */
  if (annFailed.value) return ''
  const embedded = domainCount.value.announce
  if (embedded !== null && embedded > 0) return embedded
  return ann.value.rows
})
/** 公告角标悬停说明：失败与未加载分开口径（数字态不给 title，避免复读） */
const announcePillTitle = computed(() => {
  if (annFailed.value) return '公告列表加载失败，计数不可信，此处显示为占位'
  return undefined
})

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
/** 学习路径管理 → 学习路径页（URL 直达，与 goFailedPaths 同构） */
function goContent() {
  if (router) {
    void router.push('/admin/learning-paths')
    return
  }
  intent.scene = 'learning-paths'
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
/* 切换真实/测试视角 → 按新视角重拉（事件投递与草稿公告全域不变，仍随请求刷新无妨） */
watch(wbScope, () => {
  void loadWorkbench()
})
</script>

<style scoped>
/* ================= 宿主布局（tab 宿主：运营待办内滚；嵌入子页占满剩余高度） ================= */
/* 视图切换（原型 .tabs 下划线页签）：样式 2026-10-05 CM1 收敛到全局 .tabs/.tab
   （含 __count 角标，mk-primitives.css），本页不再私持拷贝。 */
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
/* 公告 tab 工具行：嵌入态宿主提供「新建公告」唯一入口（子页自身工具条在 embedded 隐藏），
   形态对齐子页 .an-toolbar（左说明 + grow + 右 primary sm） */
.oh-tabbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0 10px;
}
.oh-tabbar__sub { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.oh-tabbar .mk-btn { margin-left: auto; }
/* 待办卡头左组（卡头成组判例）：标题+结论成组吃 flex，视角切换贴右 */
.oh-wb-head { flex: 1 1 auto; min-width: 0; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.oh-scope { flex: none; }

/* ================= 运营工作台（待办清单 + 状态面板，区别于 Dashboard 统计卡） ================= */
/* 状态面板：路径 / 公告并列（行式计数 + 比例条，非 KPI 卡） */
.ow-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  /* P2-2（2026-10-04 全站评审）：撤 align-items:start——空态分支让右卡天然矮一截时
     底边悬空 28.9px（先例 42107f8e 同判）；stretch 拉齐，增量由 .ow-state 行距消化 */
}

/* ranklist 行动行（原型 290-295 .ranklist/.rankrow）：事项 + 行尾 mute 类别 pill + 动作。
   计数已于 2026-10-18 回到页级读数带（页签栏之上的 .oh-metrics）——一处讲一次。
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

/* 状态面板：构成条（MkStageband）+ 行式计数 */
.ow-state { padding: 8px 14px 12px; display: grid; gap: 10px; }
/* 无数据时的占位：保留比例条的高度位，但不画空灰条（避免「像坏图」）。
   8px = MkStageband size="sm" 的轨道高度，占位与实条同高才不跳。 */
.ow-state__empty {
  height: 8px;
  display: flex;
  align-items: center;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  line-height: 1;
}
/* 区块级失败走共享 .mk-alert；只清掉它在状态区里的外边距 */
.ow-state__error { margin: 0; }
.ow-state__rows { display: grid; gap: 5px; }
.ow-state__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.ow-state__row b {
  font-size: var(--mk-fs-body);
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
/* 行式图例点：tone 名与 MkStageband 同词汇。muted→--mk-faint（原 #c3cbda/#404244 硬编码
   与另两页同槽位（MemoryReview「5天后及以远」、LearnerCenter 低置信档）不一致，收编为全站语义色）。 */
.ow-state__dot--ok { background: var(--mk-green); }
.ow-state__dot--info { background: var(--mk-blue); }
.ow-state__dot--warn { background: var(--mk-amber); }
.ow-state__dot--bad { background: var(--mk-red); }
.ow-state__dot--muted { background: var(--mk-faint); }

/* 生效中公告列表 */
.ow-ann-list { padding: 2px 14px 6px; }
.ow-ann {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 4px;
  border: 0;
  border-bottom: 1px solid var(--mk-table-row-line);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.ow-ann:last-child { border-bottom: none; }
.ow-ann:hover { background: var(--mk-table-row-hover-bg); }
/* 审核 #166：原暗色覆写 #252627 / #202122 是同一语义的第二个真源；基础规则已引
   --mk-table-row-line / --mk-table-row-hover-bg，暗色随 token 自动换档，覆写删除 */
.ow-ann__title {
  flex: 1;
  min-width: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ow-ann__meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }
.ow-ann__go { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue); white-space: nowrap; }
@media (max-width: 1100px) {
  .ow-panels { grid-template-columns: 1fr; }
}

/* 4K：待办 metricCard / ranklist 行跟随全站节奏
   （metricCard 档位已归共享 MkKpi，2026-10-06 审核 #174 删除页内死档） */
@media (min-width: 2000px) {
  .ow-rankrow__main { font-size: var(--mk-fs-body); }
  .ow-rankrow__go { font-size: var(--mk-fs-micro); }
  .ow-state__row { font-size: var(--mk-fs-micro); }
  .ow-state__row b { font-size: var(--mk-fs-emphasis); }
  .ow-ann__title { font-size: var(--mk-fs-body); }
  .ow-ann__meta, .ow-ann__go { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .ow-rankrow__main { font-size: var(--mk-fs-body); }
  .ow-rankrow__go { font-size: var(--mk-fs-micro); }
  .ow-state__row { font-size: var(--mk-fs-micro); }
  .ow-state__row b { font-size: var(--mk-fs-body); }
  .ow-ann__title { font-size: var(--mk-fs-body); }
  .ow-ann__meta, .ow-ann__go { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .ow-rankrow__main { font-size: var(--mk-fs-emphasis); }
  .ow-rankrow__go { font-size: var(--mk-fs-body); }
  .ow-state__row { font-size: var(--mk-fs-body); }
  .ow-state__row b { font-size: var(--mk-fs-emphasis); }
  .ow-ann__title { font-size: var(--mk-fs-emphasis); }
  .ow-ann__meta, .ow-ann__go { font-size: var(--mk-fs-body); }
}
</style>
