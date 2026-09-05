<template>
  <div class="mk-page mk-page--fill ms-host">
    <!-- 页面级状态条：场景名 + 两域计数徽章（点击直达对应视图）。
         徽章计数由激活子视图上报（域计数徽章方案，对齐学习会话/用户与学习者宿主） -->
    <div class="mk-status" :class="`mk-status--${dashTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">通知与公告</strong>
      <span class="mk-status__sep"></span>
      <button
        type="button"
        class="ms-count-link"
        :class="{ 'ms-count-link--on': tab === 'announce' }"
        title="点击切换到「公告」视图"
        @click="switchTab('announce')"
      >公告 {{ domainCount.announce }}</button>
      <button
        type="button"
        class="ms-count-link"
        :class="{ 'ms-count-link--on': tab === 'inapp' }"
        title="点击切换到「站内通知」视图"
        @click="switchTab('inapp')"
      >通知 {{ domainCount.inapp }}</button>
      <span class="mk-status__meta" title="公告=全站横幅；站内通知=按用户推送">共 {{ domainTotal }} 条</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" @click="refreshActive">刷新</button>
      </span>
    </div>

    <!-- 视图切换 pills（次级切换，紧随状态条；对齐观测组执行日志 tab 形态） -->
    <div class="mk-pills ms-tabs">
      <button
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': tab === 'announce' }"
        @click="switchTab('announce')"
      >公告</button>
      <button
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': tab === 'inapp' }"
        @click="switchTab('inapp')"
      >站内通知</button>
    </div>

    <!-- 公告：Announcements（embedded 不含状态条，新建入口在卡头；计数上报宿主） -->
    <Announcements v-if="tab === 'announce'" ref="announceRef" embedded @count="onDomainCount('announce', $event)" />
    <!-- 站内通知：Notifications（embedded 不含状态条，发送入口在卡头；计数上报宿主） -->
    <Notifications v-else ref="notifRef" embedded @count="onDomainCount('inapp', $event)" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent } from './store'
import Announcements from './Announcements.vue'
import Notifications from './Notifications.vue'

type MessagesTab = 'announce' | 'inapp'
const TABS: MessagesTab[] = ['announce', 'inapp']

const tab = ref<MessagesTab>('announce')
const route = useRoute()
const router = useRouter()

/* ===== 宿主状态条（通知与公告：两域计数徽章 + 切视图；域计数徽章方案） ===== */
const domainCount = ref<{ announce: number; inapp: number }>({ announce: 0, inapp: 0 })
const domainTotal = computed(() => domainCount.value.announce + domainCount.value.inapp)
const dashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() =>
  domainTotal.value > 0 ? 'ok' : 'muted'
)
function onDomainCount(domain: 'announce' | 'inapp', n: number) {
  domainCount.value[domain] = n
}
const announceRef = ref<{ refresh?: () => void } | null>(null)
const notifRef = ref<{ reload?: () => void } | null>(null)
function refreshActive() {
  if (tab.value === 'announce') announceRef.value?.refresh?.()
  else notifRef.value?.reload?.()
}

/* URL ↔ tab 双向同步：?tab=announce|inapp（深链/刷新/前进后退可寻址，合并页统一约定） */
watch(
  () => route.query.tab,
  (t) => {
    const v = typeof t === 'string' && TABS.includes(t as MessagesTab) ? (t as MessagesTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'announce') tab.value = 'announce'
  },
  { immediate: true }
)
function switchTab(t: MessagesTab) {
  tab.value = t
  if (route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}

/* intent 深链：跨页跳转带 tab（运营中心「公告 →」→ announce / intent 快捷动作「新建公告」强转 announce） */
watch(
  () => intent.tab,
  (t) => {
    if (t === 'announce' || t === 'inapp') {
      tab.value = t
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
</script>

<style scoped>
/* 宿主为应用式布局容器：自身铺满、内滚由子组件接管 */
.ms-host {
  padding: var(--mk-space-3) var(--mk-space-4) var(--mk-space-4);
}
.ms-tabs { width: fit-content; }
/* 页头计数锚点（与学习会话 gc-count-link / 用户与学习者 pp-count-link 同形态） */
.ms-count-link {
  border: 0; background: transparent; padding: 2px 6px;
  font: inherit; font-size: var(--mk-fs-12_5); font-weight: 700;
  color: var(--mk-muted); cursor: pointer; border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.ms-count-link:hover { color: var(--mk-blue); background: rgba(44, 99, 208, 0.08); }
.ms-count-link--on { color: var(--mk-blue); background: rgba(44, 99, 208, 0.12); }
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度 */
.ms-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
