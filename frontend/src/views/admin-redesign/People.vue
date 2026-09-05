<template>
  <div class="mk-page mk-page--fill pp-host">
    <!-- 页面级状态条：场景名 + 两域计数徽章（点击直达对应视图）。
         徽章计数由激活子视图上报（域计数徽章方案，对齐学习会话宿主） -->
    <div class="mk-status" :class="`mk-status--${dashTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">用户与学习者</strong>
      <span class="mk-status__sep"></span>
      <button
        type="button"
        class="pp-count-link"
        :class="{ 'pp-count-link--on': tab === 'account' }"
        title="点击切换到「账号管理」视图"
        @click="switchTab('account')"
      >用户 {{ domainCount.users }}</button>
      <button
        type="button"
        class="pp-count-link"
        :class="{ 'pp-count-link--on': tab === 'state' }"
        title="点击切换到「学习状态」视图"
        @click="switchTab('state')"
      >学习者 {{ domainCount.learners }}</button>
      <span class="mk-status__meta" title="账号=用户生命周期；学习状态=画像快照（均为仅真实口径）">共 {{ domainTotal }} 人</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" @click="refreshActive">刷新</button>
      </span>
    </div>

    <!-- 视图切换 pills（次级切换，紧随状态条；对齐观测组执行日志 tab 形态） -->
    <div class="mk-pills pp-tabs">
      <button
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': tab === 'account' }"
        @click="switchTab('account')"
      >账号管理</button>
      <button
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': tab === 'state' }"
        @click="switchTab('state')"
      >学习状态</button>
    </div>

    <!-- 账号管理：Users（embedded 不含状态条，计数上报宿主；新建用户入口在卡头） -->
    <Users v-if="tab === 'account'" ref="usersRef" embedded @count="onDomainCount('users', $event)" />
    <!-- 学习状态：LearnerCenter（embedded 不含状态条，计数上报宿主） -->
    <LearnerCenter v-else ref="learnersRef" embedded @count="onDomainCount('learners', $event)" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent } from './store'
import Users from './Users.vue'
import LearnerCenter from './LearnerCenter.vue'

type PeopleTab = 'account' | 'state'
const TABS: PeopleTab[] = ['account', 'state']

const tab = ref<PeopleTab>('account')
const route = useRoute()
const router = useRouter()

/* ===== 宿主状态条（用户与学习者：两域计数徽章 + 切视图） ===== */
/** 两域计数（由激活子视图上报；域计数徽章方案，对齐学习会话宿主） */
const domainCount = ref<{ users: number; learners: number }>({ users: 0, learners: 0 })
const domainTotal = computed(() => domainCount.value.users + domainCount.value.learners)
const dashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() =>
  domainTotal.value > 0 ? 'ok' : 'muted'
)
function onDomainCount(domain: 'users' | 'learners', n: number) {
  domainCount.value[domain] = n
}
const usersRef = ref<{ refresh?: () => void } | null>(null)
const learnersRef = ref<{ refresh?: () => void } | null>(null)
function refreshActive() {
  if (tab.value === 'account') usersRef.value?.refresh?.()
  else learnersRef.value?.refresh?.()
}

/* URL ↔ tab 双向同步：?tab=account|state（深链/刷新/前进后退可寻址，合并页统一约定） */
watch(
  () => route.query.tab,
  (t) => {
    const v = typeof t === 'string' && TABS.includes(t as PeopleTab) ? (t as PeopleTab) : null
    if (v && v !== tab.value) tab.value = v
    else if (!v && tab.value !== 'account') tab.value = 'account'
  },
  { immediate: true }
)
function switchTab(t: PeopleTab) {
  tab.value = t
  if (route.query.tab !== t) void router.replace({ query: { ...route.query, tab: t } })
}

/* intent 深链：跨页跳转带 tab（总览漏斗「学习者中心」→ state / intent 快捷动作强转 account） */
watch(
  () => intent.tab,
  (t) => {
    if (t === 'account' || t === 'state') {
      tab.value = t
      intent.tab = ''
    }
  },
  { immediate: true }
)
/* intent 快捷动作「新建用户」：确保落在账号 tab（Users 挂载后自行消费 quickAction） */
watch(
  () => intent.quickAction,
  (a) => {
    if (a === 'create-user' && tab.value !== 'account') tab.value = 'account'
  },
  { immediate: true }
)
</script>

<style scoped>
/* 宿主为应用式布局容器：自身铺满、内滚由子组件表格接管 */
.pp-host {
  padding: var(--mk-space-3) var(--mk-space-4) var(--mk-space-4);
}
.pp-tabs { width: fit-content; }
/* 页头计数锚点（与学习会话宿主 gc-count-link 同形态）：用户/学习者可点击切视图 */
.pp-count-link {
  border: 0; background: transparent; padding: 2px 6px;
  font: inherit; font-size: var(--mk-fs-12_5); font-weight: 700;
  color: var(--mk-muted); cursor: pointer; border-radius: 6px;
  transition: color 0.12s ease, background 0.12s ease;
}
.pp-count-link:hover { color: var(--mk-blue); background: rgba(44, 99, 208, 0.08); }
.pp-count-link--on { color: var(--mk-blue); background: rgba(44, 99, 208, 0.12); }
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度，表格区内滚 */
.pp-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
