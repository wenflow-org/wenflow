<template>
  <div class="mk-page mk-page--fill pp-host">
    <!-- 页头（newui pageTitle 复刻）：页名 + 副题（随视图切换，原型 renderPeople 同款文案）+ 主操作 -->
    <MkPageHead
      title="用户与学习者"
      :sub="tab === 'state' ? '学习者学习状态分布与风险跟踪' : '管理学习者档案、学习状态与路径进度'"
    >
      <template #actions>
        <button v-if="tab === 'account'" type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="usersRef?.openCreate?.()">新建用户</button>
        <button type="button" class="mk-btn mk-btn--sm" @click="refreshActive">刷新</button>
      </template>
    </MkPageHead>
    <div v-if="tab === 'state' && learnerCount >= 50" class="mk-status mk-status--muted">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta" title="学习者快照单次最多加载 50 条">仅加载前 50 位，可按筛选缩小范围</span>
    </div>

    <!-- 账号管理：Users / 学习状态：LearnerCenter（页签按原型渲染在各自卡内顶部，状态在宿主） -->
    <Users v-if="tab === 'account'" ref="usersRef" embedded :tab="tab" @switch="switchTab($event)" />
    <LearnerCenter v-else ref="learnersRef" embedded :tab="tab" @switch="switchTab($event)" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent } from './store'
import { liveLearners } from './live'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import Users from './Users.vue'
import LearnerCenter from './LearnerCenter.vue'

type PeopleTab = 'account' | 'state'
const TABS: PeopleTab[] = ['account', 'state']

const tab = ref<PeopleTab>('account')
const route = useRoute()
const router = useRouter()

/* ===== 宿主页头 ===== */
/** 学习状态计数：live 全局单源（boot 即拉 learners 域），供「仅加载前 50 位」截断提示判定 */
const learnerCount = computed(() => liveLearners.value.length)

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
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度，表格区内滚 */
.pp-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
