<template>
  <div class="mk-page--fill pp-host">
    <!-- 合并宿主页头：标题 + 同域双子视图 tab（用户=账号治理 / 学习者=学习状态）
         子组件保持独立完整页（状态条/列表/详情子页均不变），仅去掉外层壳 -->
    <div class="pp-tabsbar">
      <strong class="pp-title">用户与学习者</strong>
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
      <span class="mk-card__meta" :title="'账号=用户生命周期（角色/注册/删除恢复）；学习状态=画像快照（进度/疲劳/风险）'">
        一个页面两个视图：账号与学习状态
      </span>
    </div>

    <!-- 账号管理：Users（状态条 + 列表 + 新建/编辑弹窗；子页 user 详情不变） -->
    <Users v-if="tab === 'account'" embedded />
    <!-- 学习状态：LearnerCenter（快照列表 + 重算 + 干预；子页 learner 详情不变） -->
    <LearnerCenter v-else embedded />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent } from './store'
import Users from './Users.vue'
import LearnerCenter from './LearnerCenter.vue'

type PeopleTab = 'account' | 'state'
const TABS: PeopleTab[] = ['account', 'state']

const tab = ref<PeopleTab>('account')
const route = useRoute()
const router = useRouter()

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

/* intent 深链：跨页跳转带 tab（总览漏斗「学习者中心」→ state / 命令面板快捷动作强转 account） */
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
/* 命令面板「新建用户」：确保落在账号 tab（Users 挂载后自行消费 quickAction） */
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
.pp-tabsbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}
.pp-title {
  font-size: var(--mk-fs-14);
  font-weight: 800;
  color: var(--mk-ink);
  white-space: nowrap;
}
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度，表格区内滚 */
.pp-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
