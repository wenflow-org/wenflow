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

    <!-- 视图切换 pills（唯一的 tab 控件）：各视图计数随 pill 呈现。原型无页头 KPI 带（2026-10-01
         用户拍板撤除）；域级关键数字由 pills 计数 + 各子视图内指标承载。 -->
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
      >学习状态<span class="mk-pill__count">{{ learnerCount }}</span></button>
    </div>

    <!-- 账号管理：Users（embedded 不含状态条，计数上报宿主；新建用户入口在卡头） -->
    <Users v-if="tab === 'account'" ref="usersRef" embedded @count="onDomainCount($event)" />
    <!-- 学习状态：LearnerCenter（embedded 不含状态条） -->
    <LearnerCenter v-else ref="learnersRef" embedded />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent } from './store'
import { liveUsersTotal, liveLearners } from './live'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import Users from './Users.vue'
import LearnerCenter from './LearnerCenter.vue'

type PeopleTab = 'account' | 'state'
const TABS: PeopleTab[] = ['account', 'state']

const tab = ref<PeopleTab>('account')
const route = useRoute()
const router = useRouter()

/* ===== 宿主页头（用户与学习者：两域计数随 pills 呈现 + 切视图） ===== */
/** 账号域计数（Users 上报，兜底用） */
const domainCount = ref<{ users: number }>({ users: 0 })
/**
 * 账号总数以全局 live 单源为准：Users 只在「账号管理」Tab 挂载，
 * 若沿用子视图 emit，切到「学习状态」后 users 会停留在旧值、深链直连则取不到。
 * 口径说明：该数跟随当前「含模拟」开关（切换后后端按新口径返回 total），
 * 状态条 tooltip 用固定表述，不再断言「不含测试/虚拟」以免与实际口径漂移。
 */
const userCount = computed(() => liveUsersTotal.value || domainCount.value.users)
/** 学习状态计数：live 全局单源（boot 即拉 learners 域，与是否进过该 tab 无关——
 *  2026-09-29 修复：原靠 LearnerCenter 挂载后上报，没点进过「学习状态」就恒显 0，
 *  读起来像「这个域没有数据」） */
const learnerCount = computed(() => liveLearners.value.length)
function onDomainCount(n: number) {
  domainCount.value.users = n
}

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
