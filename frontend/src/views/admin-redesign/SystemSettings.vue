<template>
  <div class="mk-page mk-page--fill ss-host">
    <!-- 页头只留页名（2026-11-03 用户「最右上角那个多余的按钮…移入运维工具或合并处理，
         保持顶部干净」）：原「刷新注册表」重读的是模型注册表文件，属「模型与接入」那一张卡，
         已收进该卡右上的图标钮——它只在那张卡里有意义，挂在全局页头会让每个页签都看着有个
         与己无关的动作。顶栏的全局刷新广播仍会刷当前面板（见 refreshActive）。 -->
    <MkPageHead title="系统设置" />

    <!-- 四个页签由两类东西合并而来（2026-11-01 用户「这四个拆出来，和模型与接入作为一个页面」）：
         模型与接入原为独立场景，数据导出 / 会话安全 / 访问与注册原为运营中心的
         第二组页签。合并的由头是那个宿主把两类后果完全不同的动作放在一起——
         改文案 vs 导全库/踢会话，且旧页名「模型与接入」装不下后三项。
         2026-11-11 用户「运维工具，这一个孤零零的是干什么的」：事件投递失败处置已并回健康中心，
         本页不再留一个只装死信表的设置页签。 -->
    <div class="tabs" role="tablist" aria-label="系统设置视图切换" @keydown="onTabKeydown">
      <button
        v-for="(t, i) in SS_TABS"
        :key="t.key"
        type="button"
        class="tab"
        role="tab"
        :id="`ss-tab-${t.key}`"
        :ref="(el) => setTabRef(el, i)"
        :tabindex="tab === t.key ? 0 : -1"
        :aria-controls="`ss-panel-${t.key}`"
        :aria-selected="tab === t.key"
        @click="switchTab(t.key)"
      >{{ t.label }}</button>
    </div>

    <!-- 模型与接入：懒挂载 + v-show 常驻。
         它有未保存改动的离开守卫（onBeforeRouteLeave），但切页签只改 ?tab=、不换 route record，
         那条守卫根本不会触发——用 v-else-if 切走就等于把没保存的模型配置静默丢掉。
         访问与注册在同一宿主里早就因为同样的理由这么做了，这里是同一个判例。 -->
    <ApiConfig
      v-if="apiMounted"
      v-show="tab === 'api'"
      id="ss-panel-api"
      role="tabpanel"
      aria-labelledby="ss-tab-api"
      ref="apiRef"
      embedded
    />

    <!-- 其余三个无编辑态，切走即销毁。
         **必须是独立的 v-if，不能接在上一段的 v-else-if 链上**（2026-11-02 修）：上一段是
         `v-if="apiMounted" v-show="tab === 'api'"`，而 apiMounted 一旦为真就再不变假，
         v-else-if 只在链头为假时才求值——于是这些页签在「先看过模型与接入」之后全部空白，
         且不报任何错（2026-11-02 用户「这怎么没内容啊」）。条件由同一个 tab 值互斥，
         拆成独立 v-if 与原来的语义等价。 -->
    <DataExportPanel
      v-if="tab === 'export'"
      id="ss-panel-export"
      role="tabpanel"
      aria-labelledby="ss-tab-export"
    />
    <!-- 三个页签一律单列通栏（2026-11-07 用户撤回左右分栏：「会话安全 访问与注册的双栏
         不要了，换成之前的」）。此前的「左说明 + 右表单」只给会话安全/访问与注册做过，
         实测左侧说明列把可用宽度压掉 30%，卡片反而更窄，不如通栏。 -->
    <SessionSecurity
      v-if="tab === 'security'"
      id="ss-panel-security"
      role="tabpanel"
      aria-labelledby="ss-tab-security"
      ref="securityRef"
      embedded
    />
    <AccessControl
      v-if="tab === 'access'"
      id="ss-panel-access"
      role="tabpanel"
      aria-labelledby="ss-tab-access"
      ref="accessRef"
      embedded
    />
  </div>
</template>

<script setup lang="ts">
/* 系统设置（2026-11-01）：模型与接入 + 运营中心原「系统运维」三页签合并成一个宿主。
   页签键沿用旧页签名（export / security / access），老深链的含义原样保留；
   首页签用 api 而不是 api-config，因为它只是本页的一格视图，不再是独立场景。
   2026-11-11：运维工具页签下线，事件投递处置并入健康中心；旧的 ?tab=tools 与
   /admin/devtools 在路由层改投 /admin/health-center。
   旧键（/admin/api-config?tab=addons|virtual|security 等）的改投**全部收在路由层**，
   本页只做成员校验——见下方说明。 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTablistKeyboard } from '@/composables/useTablistKeyboard'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import ApiConfig from './ApiConfig.vue'
import DataExportPanel from './DataExportPanel.vue'
import SessionSecurity from './SessionSecurity.vue'
import AccessControl from './AccessControl.vue'
import { liveRefreshSeq } from './live'

/** 页签顺序即渲染顺序：接入配置在前（本页最常来的目的），运维三件在后 */
const SS_TABS = [
  { key: 'api', label: '模型与接入' },
  { key: 'export', label: '数据导出' },
  { key: 'security', label: '会话安全' },
  // 2026-11-11：入站访问控制与注册设置迁出，这一页只剩出站网络策略 → 改名「网络与安全」。
  // 页签键保留 access，老深链 / 书签不受影响。
  { key: 'access', label: '网络与安全' }
] as const

type SsTab = (typeof SS_TABS)[number]['key']
const TAB_KEYS = SS_TABS.map((t) => t.key) as readonly SsTab[]
const DEFAULT_TAB: SsTab = 'api'

const route = useRoute()
const router = useRouter()
const tab = ref<SsTab>(DEFAULT_TAB)

const apiRef = ref<{ refresh?: () => void } | null>(null)
const securityRef = ref<{ refresh?: () => void } | null>(null)
const accessRef = ref<{ reload?: () => void } | null>(null)
/* 模型与接入懒挂载：首次进入才挂载，之后常驻（v-show）以保留未保存的接入配置编辑 */
const apiMounted = ref(false)

const { setTabRef, onTabKeydown } = useTablistKeyboard(TAB_KEYS, tab, switchTab)

/* URL → tab。只做成员校验：不认识的 ?tab= 回落首页签，但**不改写地址栏**——
   与运营中心同款（那里也是静默回落、URL 不追改）。旧键的改投在路由层已完成，
   本页不再持有任何别名表：组件自己删/改 ?tab= 会把宿主当前合法的页签冲掉。 */
watch(
  () => route?.query?.tab,
  (t) => {
    const v = typeof t === 'string' && (TAB_KEYS as readonly string[]).includes(t) ? (t as SsTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== DEFAULT_TAB) tab.value = DEFAULT_TAB
  },
  { immediate: true }
)

/* 懒挂载锁：任一进入路径（点页签 / ?tab= 深链 / 路由改投）到达即永久挂载 */
watch(tab, (t) => { if (t === 'api') apiMounted.value = true }, { immediate: true })

/** 切页签：push 保留后退历史（与运营中心同一判例），幂等去抖 */
function switchTab(t: SsTab) {
  tab.value = t
  if (route && router && route.query.tab !== t) void router.push({ query: { ...route.query, tab: t } })
}

/* 顶栏刷新广播：刷当前页签面板。本页没有页级读数带，所以不重拉任何汇总。 */
const refreshing = ref(false)
watch(liveRefreshSeq, () => { void refreshActive() })
async function refreshActive() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    if (tab.value === 'api') apiRef.value?.refresh?.()
    else if (tab.value === 'security') securityRef.value?.refresh?.()
    else if (tab.value === 'access') accessRef.value?.reload?.()
  } finally {
    refreshing.value = false
  }
}

onMounted(() => {
  /* 页面挂载后把首个 tab 的 ?tab= 对齐一次：直接输 /admin/system-settings 时地址栏没有 tab，
     补上它，之后的后退/前进才有正确的历史锚点。
     **必须确认当前 route 就是本页**（2026-11-02 修）：本组件是由 scene 驱动挂载的，早于
     AdminConsole 那条「scene → URL」push 落定；此刻 route 还停在上一个页面，这里不带 path 的
     replace 会把 ?tab= 写到**那个页面**的地址上，并把在途的 push 顶掉——表现为屏上是系统设置、
     地址栏却停在前一页（如 /admin/people?tab=api），刷新一次就落到别的页面。 */
  void nextTick(() => {
    if (!route || !router) return
    if (route.params.page !== 'system-settings') return
    if (!route.query.tab) void router.replace({ query: { ...route.query, tab: tab.value } })
  })
})

/* 上一条只在挂载那一刻成立；本组件挂载早于 push 落定，那时 route 还不是本页，于是「补锚点」
   那一次被守卫挡掉、之后没人再补。这里在 route 真正落到本页、且地址栏没有 ?tab= 时补一次。
   条件里带 ?tab= 的存在性判断，补完即不再满足，不会自激。 */
watch(
  () => [route?.params.page, route?.query.tab] as const,
  () => {
    if (!route || !router) return
    if (route.params.page !== 'system-settings') return
    if (!route.query.tab) void router.replace({ query: { ...route.query, tab: tab.value } })
  }
)

const pageLabel = computed(() => SS_TABS.find((t) => t.key === tab.value)?.label || '系统设置')
defineExpose({ pageLabel })
</script>

<style scoped>
/* ================= 宿主布局 =================
   三种根节点都要在宿主 flex 列里吃掉剩余高度，各自方式不同：
   ① 带 .mk-page--fill 的（会话安全 / 访问与注册嵌入态）——由它自己的 flex 撑开；
   ② 普通 div 根的（数据导出 .exp-body）——宿主给高度并让它自管内滚；
   ③ 模型与接入（.ac-host 嵌入态）——由它自己的 .ac-tab-body 内滚，宿主只给高度。
   少任何一条，对应面板在高屏下都会退化成整页滚动或直接被裁。 */
.ss-host > .mk-page--fill { flex: 1 1 auto; min-height: 0; }
.ss-host > .exp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* 窄屏：面板内部滚动会缩成一条缝，退回内容高度交给页面滚 */
@media (max-width: 900px) {
  .ss-host > .mk-page--fill,
  .ss-host > .exp-body,
  .ss-host > .acl-host--embedded { flex: none; min-height: 0; overflow: visible; }
}
</style>
