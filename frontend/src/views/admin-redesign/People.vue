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

    <!-- 账号 KPI（2026-10-05 用户纠偏升 MkKpi 卡带；2026-10-10 统一两档卡型；
         2026-10-11 用户拍板换读数：测试视角「真实用户」结构性恒 0 → 换「运行中仿真」，
         两档「30 分钟在线」→「近 7 天活跃」，真实视角管理员卡并入真实卡 hint。
         MkBuckets 构成带已退役（与教学组卡带两套视觉语言） -->
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

    <Users ref="usersRef" embedded />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import DataScopeToggle from './DataScopeToggle.vue'
import Users from './Users.vue'
import { liveUsers, liveUsersTotal, liveIncludeVirtual, liveSetIncludeVirtual } from './live'
import { isRealAccountUser } from './learner-profile'

const usersRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)

/* 账号构成桶（2026-10-04 教学组统一 buckets）：真实 / 虚拟 / 测试 = 同一整体的互斥构成
   （徽章同款互斥判据：虚拟 > 测试 > 其余真实）；管理员数作真实用户桶 foot（角色属真实域细分）。
   管理员数是运营要看的角色分布，不单独立桶（角色与账号性质非同一整体，混桶=假比例）。
   D18：默认「仅真实」口径下后端已把虚拟/测试排除，三分桶会结构性恒 100/0/0（两桶死档）——
   审核 #7（2026-10-06）：默认档不出构成带（下方 return []，原页内单桶分支是死代码：
   卡带 gate 为 length > 1，且 D18 明确「单桶假构成不再渲染」）；未纳入口径由 KPI hint
   「虚拟 / 测试账号未纳入」承载，切到「含测试」后才展示三桶互斥构成。 */
/* 账号 KPI（2026-10-05 统一面板设计；2026-10-11 用户拍板换读数；2026-10-21 用户拍板剔除虚拟）：
   真实视角 4 张：真实用户（管理员数在 title）/ 近 7 天活跃 / 近 7 日新增 / 从未登录；
   测试视角 4 张：同一组读数，但集合是测试/审计账号（标题改用「测试账号」）。
   虚拟学习者不在本页任何一档——它没有凭据、没有登录（角色/最后登录列对它无意义），
   教与学在「虚拟学习者」域看；2026-10-21 用户走查：测试档里的虚拟行点进去是账号+学习档案，
   与虚拟学习者详情是两个页，同一实体两处细节。
   口径：活跃 = lastLoginAt 在 7 天内，按各档自己的集合算；数据 = live 域已加载行
   （后端总数在 liveUsersTotal，超上限截断时 title 注明）。
   走查 F1-1（2026-10-07）：判据统一收口到 learner-profile.ts 单点——本页 KPI 与
   下方 Users 列表 pill 计数同一口径。 */
type PpKpiTile = { label: string; value: number; hint?: string; tone: '' | 'ok' | 'warn' | 'bad'; title: string }
/** 近 7 天活跃：lastLoginAt 在 7 天内（7 天窗口是运营常态读数，原 30 分钟窗口恒 0 无区分度） */
const active7dOf = (rows: Array<{ lastLoginAt: string | null }>) =>
  rows.filter((u) => !!u.lastLoginAt && Date.now() - new Date(u.lastLoginAt).getTime() < 7 * 86400000).length
const ppKpi = computed<PpKpiTile[]>(() => {
  const rows = liveUsers.value
  if (!rows.length) return []
  const scope = `当前显示 ${rows.length} 个账号 · 全部共 ${liveUsersTotal.value} 个`
  if (liveIncludeVirtual.value) {
    return [
      { label: '测试账号', value: rows.length, tone: '', title: scope },
      { label: '近 7 天活跃', value: active7dOf(rows), tone: '', title: scope },
      {
        label: '近 7 日新增',
        value: rows.filter((u) => !!u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 7 * 86400000).length,
        tone: '',
        title: `${scope}。按创建时间`,
      },
      {
        label: '从未登录',
        value: rows.filter((u) => !u.lastLoginAt).length,
        tone: '',
        title: `${scope}。按最后登录判断`,
      },
    ]
  }
  const realRows = rows.filter(isRealAccountUser)
  const admins = realRows.filter((u) => u.isAdmin).length
  return [
    {
      label: '真实用户',
      value: realRows.length,
      tone: '',
      title: `${scope}${realRows.length ? ` · 管理员 ${admins}` : ''}`,
    },
    {
      label: '近 7 天活跃',
      value: active7dOf(realRows),
      tone: '',
      title: scope,
    },
    {
      label: '近 7 日新增',
      value: realRows.filter((u) => !!u.createdAt && Date.now() - new Date(u.createdAt).getTime() < 7 * 86400000).length,
      tone: '',
      title: `${scope}。按创建时间`,
    },
    {
      label: '从未登录',
      value: realRows.filter((u) => !u.lastLoginAt).length,
      tone: '',
      title: `${scope}。按最后登录判断`,
    },
  ]
})

/* 账号构成桶（MkBuckets）已退役：两档各自 4 张 MkKpi，读数同构、集合随视角走。
   历史沿革：2026-10-04 三分桶（真实/虚拟/测试构成）；10-05 KPI 升卡带；
   10-10 收敛单带、统一卡型；10-11 测试档换虚拟域读数（运行中仿真/虚拟学习者）；
   2026-10-21 拍板剔除虚拟——测试档回到「测试/审计账号」本义，虚拟学习者的
   运行读数归虚拟学习者页，本页不再跨域取数。 */

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
/* 窄屏：KPI 竖排后剩余高度不足以容纳列表卡，host 与子页一起退回内容高度、由页面滚动 */
@media (max-width: 900px) {
  .pp-host > .mk-page--fill { flex: none; height: auto; overflow: visible; }
}
</style>
