<template>
  <div class="mk-page mk-page--fill pp-host">
    <!-- 页头（newui pageTitle 复刻）：页名 + 副题 + 主操作。
         2026-10-04 用户拍板：学习状态 tab 拆出独立页 /admin/learner-state（同教学三页拆页先例），
         本页回归单视图（用户账号管理），旧 ?tab=state 深链在下方 watch 重定向兼容 -->
    <MkPageHead
      title="用户与学习者"
      sub="管理用户账号、角色与登录状态"
    >
      <template #actions>
        <!-- 整组统一口径开关（2026-10-04 用户拍板：撤页头刷新钮，学习组六页同一位、同一状态）；
             数据域重拉由内嵌 Users 的 watch 承担 -->
        <DataScopeToggle :model-value="liveIncludeVirtual" @update:model-value="liveSetIncludeVirtual" />
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="usersRef?.openCreate?.()">新建用户</button>
      </template>
    </MkPageHead>

    <!-- 账号 KPI（2026-10-05 用户纠偏「用户与学习者也没做 kpi 版，只做了一个」）：
         三口径升 MkKpi 卡带（全站统一面板设计，hint 可见短口径 + title 长释）；
         构成带只在「含测试」档出现（D18：仅真实档三分桶结构性恒 100/0/0，
         单桶假构成不再渲染——它的信息由 KPI hint 承载） -->
    <section v-if="ppKpi.length" class="mk-kpi-grid" aria-label="账号概览">
      <MkKpi
        v-for="k in ppKpi"
        :key="k.label"
        :label="k.label"
        :value="k.value"
        :hint="k.hint"
        :tone="k.tone"
        :title="k.title"
      />
    </section>
    <MkBuckets v-if="ppBuckets.length > 1" label="账号构成" :items="ppBuckets" />

    <Users ref="usersRef" embedded />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkBuckets from '@/components/mk/MkBuckets.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import Users from './Users.vue'
import { liveUsers, liveUsersTotal, liveIncludeVirtual, liveSetIncludeVirtual } from './live'
import { isRealAccountUser, isVirtualLearnerAccount } from './learner-profile'

const usersRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)

/* 账号构成桶（2026-10-04 教学组统一 buckets）：真实 / 虚拟 / 测试 = 同一整体的互斥构成
   （徽章同款互斥判据：虚拟 > 测试 > 其余真实）；管理员数作真实用户桶 foot（角色属真实域细分）。
   管理员数是运营要看的角色分布，不单独立桶（角色与账号性质非同一整体，混桶=假比例）。
   D18：默认「仅真实」口径下后端已把虚拟/测试排除，三分桶会结构性恒 100/0/0（两桶死档）——
   审核 #7（2026-10-06）：默认档不出构成带（下方 return []，原页内单桶分支是死代码：
   卡带 gate 为 length > 1，且 D18 明确「单桶假构成不再渲染」）；未纳入口径由 KPI hint
   「虚拟 / 测试账号未纳入」承载，切到「含测试」后才展示三桶互斥构成。 */
/* 账号 KPI（2026-10-05 统一面板设计）：真实用户 / 管理员 / 30 分钟在线。
   口径：真实用户 = 非虚拟且非测试（两口径开关下都不变）；管理员 = 真实域细分（与旧桶 foot 同源）；
   在线 = 最后登录在 30 分钟内（审核 #9，2026-10-06：与同面板真实用户同域取 realRows，
   不再把含测试档下的虚拟/测试行算进在线）；数据 = live 域已加载行（后端总数在 liveUsersTotal，
   超上限截断时 title 注明）。
   走查 F1-1（2026-10-07）：判据统一收口到 learner-profile.ts 单点——本页 KPI / 构成带与
   下方 Users 列表 pill 计数必须同一口径（此前本页用 payload 标记、列表用命名约定正则，
   含测试档下普通用户 pill 比本卡多 10）。 */
type PpKpiTile = { label: string; value: number; hint: string; tone: '' | 'ok' | 'warn' | 'bad'; title: string }
const ppKpi = computed<PpKpiTile[]>(() => {
  const rows = liveUsers.value
  if (!rows.length) return []
  const realRows = rows.filter(isRealAccountUser)
  const admins = realRows.filter((u) => u.isAdmin).length
  const online = realRows.filter((u) => !!u.lastLoginAt && Date.now() - new Date(u.lastLoginAt).getTime() < 30 * 60000).length
  const scope = `按已加载 ${rows.length} 行统计（后端共 ${liveUsersTotal.value}）`
  return [
    {
      label: '真实用户',
      value: realRows.length,
      hint: liveIncludeVirtual.value ? '不含虚拟 / 测试' : '虚拟 / 测试账号未纳入',
      tone: '',
      title: `${scope}；切换页头「含测试」后下方出现完整账号构成带`,
    },
    {
      label: '管理员',
      value: admins,
      hint: realRows.length ? `占真实用户 ${Math.round((admins / realRows.length) * 100)}%` : '—',
      tone: '',
      title: '真实用户中的管理员数（角色属真实域细分，不与虚拟/测试混算）',
    },
    {
      label: '30 分钟在线',
      value: online,
      hint: '最后登录在 30 分钟内',
      tone: '',
      title: `${scope}；真实域口径（不含虚拟 / 测试账号），与「真实用户」同集合`,
    },
  ]
})

const ppBuckets = computed(() => {
  const rows = liveUsers.value
  const total = rows.length
  if (!total) return []
  // 审核 #7（2026-10-06）：默认「仅真实」档不出构成带——后端已排除虚拟/测试，三分桶结构性
  // 恒 100/0/0，单桶 100% 是假构成（D18）。未纳入口径由 KPI hint 承载，故此处直接空数组。
  if (!liveIncludeVirtual.value) return []
  const virtual = rows.filter(isVirtualLearnerAccount).length
  const test = rows.filter((u) => !isVirtualLearnerAccount(u) && !isRealAccountUser(u)).length
  const realRows = rows.filter(isRealAccountUser)
  const real = realRows.length
  const admins = realRows.filter((u) => u.isAdmin).length
  const pct = (v: number) => Math.round((v / total) * 100)
  const scopeNote = `按已加载 ${total} 行统计（后端共 ${liveUsersTotal.value}）`
  const realBucket = {
    value: real,
    label: '真实用户',
    pct: pct(real),
    tone: 'var(--mk-blue)',
    foots: [{ text: `其中管理员 ${admins}` }],
  }
  const calibre = `${scopeNote}；三分桶为同一整体（已加载账号）的互斥构成`
  return [
    { ...realBucket, valueTitle: calibre },
    { value: virtual, label: '虚拟学习者', pct: pct(virtual), tone: 'var(--mk-amber)', valueTitle: calibre, foots: [{ text: '模拟数据账号' }] },
    { value: test, label: '测试账号', pct: pct(test), tone: 'var(--mk-faint)', valueTitle: calibre, foots: [{ text: '统计口径默认排除' }] }
  ]
})

const route = useRoute()
const router = useRouter()
/* 旧深链兼容：/admin/people?tab=state → 学习状态独立页（拆页 2026-10-04）；
   其余 query（tab=account 等）就地归零，不再有第二视图 */
watch(
  () => route.query.tab,
  (t) => {
    if (t === 'state') void router.replace({ path: '/admin/learner-state' })
  },
  { immediate: true }
)
</script>

<style scoped>
/* 宿主为应用式布局容器：自身铺满、内滚由子组件表格接管 */
/* 宿主容器沿用 .mk-page 的响应式内边距（不再用静态 token 覆盖）：
   原覆盖在 ≥1440px 档位与 .mk-page 的 px 内边距脱节，导致本页状态条起始位置/宽度
   与单页容器（如虚拟学习者）不一致。子组件自行承担内容间距。 */
/* 子组件根节点（.mk-page--fill + 父级 scope 属性）：占满剩余高度，表格区内滚 */
.pp-host > .mk-page--fill {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
