<template>
  <div class="mk-page mk-page--fill pp-host">
    <!-- 页面级状态条：场景名 + 两域计数徽章（点击直达对应视图）。
         徽章计数由激活子视图上报（域计数徽章方案，对齐学习会话宿主） -->
    <div class="mk-status" :class="`mk-status--${dashTone}`">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">用户与学习者</strong>
      <span class="mk-status__sep"></span>
      <span
        class="mk-status__meta"
        :title="tab === 'state' ? '账号数与学习画像份数覆盖同一批真实用户，合计不重复计人' : '平台真实用户数（不含测试/虚拟）'"
      >共 {{ userCount }} 人<template v-if="tab === 'state'"> · {{ domainCount.learners }} 份学习画像</template></span>
      <span class="mk-status__actions">
        <button v-if="tab === 'account'" type="button" class="mk-status__action mk-status__action--primary" @click="usersRef?.openCreate?.()">新建用户</button>
        <button type="button" class="mk-status__action" @click="refreshActive">刷新</button>
      </span>
    </div>

    <!-- 视图切换 pills（唯一的 tab 控件）：各视图计数随 pill 呈现，状态条不再放同义可点计数 -->
    <div class="mk-pills pp-tabs">
      <button
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': tab === 'account' }"
        @click="switchTab('account')"
      >账号管理<span class="mk-pill__count">{{ userCount }}</span></button>
      <button
        type="button"
        class="mk-pill"
        :class="{ 'mk-pill--active': tab === 'state' }"
        @click="switchTab('state')"
      >学习状态<span class="mk-pill__count">{{ domainCount.learners }}</span></button>
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
import { liveUsersTotal } from './live'
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
/**
 * 账号总数以全局 live 单源为准：Users 只在「账号管理」Tab 挂载，
 * 若沿用子视图 emit，切到「学习状态」后 users 会停留在旧值、深链直连则取不到。
 */
const userCount = computed(() => liveUsersTotal.value || domainCount.value.users)
const dashTone = computed<'ok' | 'warn' | 'bad' | 'muted'>(() =>
  userCount.value > 0 ? 'ok' : 'muted'
)
function onDomainCount(domain: 'users' | 'learners', n: number) {
  domainCount.value[domain] = n
}
/* 学习画像与账号是同一批人：离开「学习状态」即清零，
   避免「用户 19 + 学习者 19 = 共 38 人」的重复计数误读 */
watch(tab, (t) => {
  if (t !== 'state') domainCount.value.learners = 0
})
const usersRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)
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
/* 宿主容器沿用 .mk-page 的响应式内边距（不再用静态 token 覆盖）：
   原覆盖在 ≥1440px 档位与 .mk-page 的 px 内边距脱节，导致本页状态条起始位置/宽度
   与单页容器（如虚拟学习者）不一致。子页签与嵌入页自行承担内容间距。 */
.pp-tabs { width: fit-content; }
/* 页头计数锚点改用全局 .mk-status__meta-link（见 shared.css:136）：
   原先每页复制一份 pp-/lc-/ts-/gc-/oc-/ms- 私有实现，视觉细节互相漂移。 */
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度，表格区内滚 */
.pp-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
