<template>
  <div class="mk-page mk-page--fill pp-host">
    <!-- 页头（newui/admin pagehead）：页名 + 主操作（新建用户随账号域出现）上移；
         学习者域后端 limit=50 截断提示（live.ts 不动）降为条件状态条，仅在命中时出现 -->
    <MkPageHead title="用户与学习者">
      <template #actions>
        <button v-if="tab === 'account'" type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="usersRef?.openCreate?.()">新建用户</button>
        <button type="button" class="mk-btn mk-btn--sm" @click="refreshActive">刷新</button>
      </template>
    </MkPageHead>
    <div v-if="tab === 'state' && learnerCount >= 50" class="mk-status mk-status--muted">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta" title="学习者快照单次最多加载 50 条">仅加载前 50 位，可按筛选缩小范围</span>
    </div>

    <!-- 页头 KPI 区（2026-09-28 统一形态，同记忆与复习 / 学习会话）：随当前视图切换的域级关键数字。
         视图切换仍由下方 pills 唯一承担——KPI 卡不兼做 tab（会与 pills 语义重叠），也不重复
         pills 的计数（账号域取「真实 / 测试·虚拟」这类 pills 没有的口径，画像域把「需关注」拆成
         趋势 / 疲劳 / 概念三维，宿主此前只有一个总数，看不出从哪下手）。 -->
    <section class="mk-kpi-grid">
      <MkKpi
        v-for="card in kpiCards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :title="card.title"
      />
    </section>

    <!-- 视图切换 pills（唯一的 tab 控件）：各视图计数随 pill 呈现。
         学习状态计数直接读 boot 已拉的 liveLearners（2026-09-29 修复：原靠子视图上报、
         未进过该 tab 就恒显 0，读起来像「没有学习状态」） -->
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
    <Users v-if="tab === 'account'" ref="usersRef" embedded @count="onDomainCount($event)" @stats="accountStats = $event" />
    <!-- 学习状态：LearnerCenter（embedded 不含状态条，计数上报宿主） -->
    <LearnerCenter v-else ref="learnersRef" embedded @stats="learnerStats = $event" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { intent } from './store'
import { liveUsersTotal, liveLearners } from './live'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import Users from './Users.vue'
import type { AccountStats } from './Users.vue'
import LearnerCenter from './LearnerCenter.vue'
import type { LearnerStats } from './LearnerCenter.vue'

type PeopleTab = 'account' | 'state'
const TABS: PeopleTab[] = ['account', 'state']

interface KpiCard {
  label: string
  value: string | number
  hint: string
  title: string
  tone?: 'ok' | 'warn' | 'bad' | ''
}

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

/* ===== 页头 KPI 区（子视图上报 stats；卡内容随视图切换） ===== */
const accountStats = ref<AccountStats | null>(null)
const learnerStats = ref<LearnerStats | null>(null)
const kpiCards = computed<KpiCard[]>(() => {
  if (tab.value === 'state') {
    const s = learnerStats.value
    return [
      { label: '学习画像', value: s ? s.total : '—', hint: '份快照', title: '有学习画像的学习者份数；后端单次最多加载 50 条。与「用户总数」覆盖同一批真实用户，不要相加' },
      { label: '趋势下降', value: s ? s.down : '—', hint: '学习状态走弱', tone: s && s.down > 0 ? 'warn' : '', title: '最近趋势向下的人数——「需关注」的趋势维度' },
      { label: '疲劳中高', value: s ? s.fatigueHigh : '—', hint: '疲劳中 / 高', tone: s && s.fatigueHigh > 0 ? 'warn' : '', title: '疲劳档中或高的人数——「需关注」的疲劳维度' },
      { label: '有风险', value: s ? s.atRisk : '—', hint: '概念挣扎 / 待巩固', tone: s && s.atRisk > 0 ? 'warn' : '', title: '关键概念挣扎或记忆待巩固的人数——「需关注」的概念维度' }
    ]
  }
  const a = accountStats.value
  /* 「真实用户」只在含模拟口径下才有信息量：仅真实口径下它恒等于用户总数，
     并排给出两个相同数字读起来像重复渲染（且与测试·虚拟卡相抵） */
  const cards: KpiCard[] = [
    {
      label: '用户总数',
      value: a ? a.total : '—',
      hint: a && a.includeTest ? '含模拟全量' : '仅真实口径',
      title: '后端全量用户数；是否含模拟账号随表格内「仅真实 / 含模拟」开关'
    }
  ]
  if (a?.includeTest) {
    cards.push({ label: '真实用户', value: a.real, hint: '不含模拟账号', title: '排除虚拟学习者与测试 / 审计账号后的真实账号数' })
  }
  cards.push({
    label: '测试 / 虚拟',
    value: a && a.includeTest ? a.testVirtual : '—',
    hint: a && a.includeTest ? '当前口径已纳入' : '切「含模拟」纳入',
    title: '虚拟学习者 + 测试 / 审计账号；仅在「含模拟」口径下纳入列表与统计'
  })
  cards.push({
    label: '有学习路径',
    value: a ? a.withPaths : '—',
    hint: a && a.total ? `占全部 ${Math.round((a.withPaths / a.total) * 100)}%` : '名下有 ≥1 条路径',
    title: '名下有 ≥1 条学习路径的人数——路径覆盖率，与表格筛选 pill 无关（全量口径）'
  })
  return cards
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
