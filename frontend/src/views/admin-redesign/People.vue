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
import { liveUsers, liveUsersTotal, liveIncludeVirtual, liveSetIncludeVirtual, liveVirtuals } from './live'
import { isRealAccountUser, isVirtualLearnerAccount } from './learner-profile'

const usersRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)

/* 账号构成桶（2026-10-04 教学组统一 buckets）：真实 / 虚拟 / 测试 = 同一整体的互斥构成
   （徽章同款互斥判据：虚拟 > 测试 > 其余真实）；管理员数作真实用户桶 foot（角色属真实域细分）。
   管理员数是运营要看的角色分布，不单独立桶（角色与账号性质非同一整体，混桶=假比例）。
   D18：默认「仅真实」口径下后端已把虚拟/测试排除，三分桶会结构性恒 100/0/0（两桶死档）——
   审核 #7（2026-10-06）：默认档不出构成带（下方 return []，原页内单桶分支是死代码：
   卡带 gate 为 length > 1，且 D18 明确「单桶假构成不再渲染」）；未纳入口径由 KPI hint
   「虚拟 / 测试账号未纳入」承载，切到「含测试」后才展示三桶互斥构成。 */
/* 账号 KPI（2026-10-05 统一面板设计；2026-10-11 用户拍板换读数）：
   真实视角 2 张：真实用户（管理员数在 hint）/ 近 7 天活跃；
   测试视角 4 张：运行中仿真 / 虚拟学习者 / 测试账号 / 近 7 天活跃
   （「真实用户」在测试视角结构性恒 0，换虚拟域的「运行中仿真」）。
   口径：真实用户 = 非虚拟且非测试（两口径开关下都不变）；活跃 = lastLoginAt 在 7 天内，
   按各档自己的集合算（真实档 realRows / 测试档 = 已加载行）；数据 = live 域已加载行
   （后端总数在 liveUsersTotal，超上限截断时 title 注明）。
   走查 F1-1（2026-10-07）：判据统一收口到 learner-profile.ts 单点——本页 KPI 与
   下方 Users 列表 pill 计数同一口径。 */
type PpKpiTile = { label: string; value: number; hint: string; tone: '' | 'ok' | 'warn' | 'bad'; title: string }
/** 近 7 天活跃：lastLoginAt 在 7 天内（7 天窗口是运营常态读数，原 30 分钟窗口恒 0 无区分度） */
const active7dOf = (rows: Array<{ lastLoginAt: string | null }>) =>
  rows.filter((u) => !!u.lastLoginAt && Date.now() - new Date(u.lastLoginAt).getTime() < 7 * 86400000).length
/** 运行中仿真：仿真会话数 ≥1 的虚拟学习者账号（virtuals 域 boot 后台加载，runningCount 后端全量聚合） */
const runningSims = computed(() => liveVirtuals.value.filter((v) => v.runningCount > 0).length)
const ppKpi = computed<PpKpiTile[]>(() => {
  const rows = liveUsers.value
  if (!rows.length) return []
  const realRows = rows.filter(isRealAccountUser)
  const admins = realRows.filter((u) => u.isAdmin).length
  const scope = `当前显示 ${rows.length} 个账号 · 全部共 ${liveUsersTotal.value} 个`
  const adminsHint = realRows.length ? `其中管理员 ${admins}` : '—'
  /* 两档统一 MkKpi 卡带（2026-10-10 统一卡型；2026-10-11 换读数）：
     测试 4 张（运行中仿真/虚拟/测试/活跃）——「真实用户」在测试视角恒 0，换虚拟域读数；
     仅真实 2 张（真实/活跃）——管理员数并入真实卡 hint，不再单独立卡 */
  if (liveIncludeVirtual.value) {
    const virtual = rows.filter(isVirtualLearnerAccount).length
    const test = rows.length - realRows.length - virtual
    return [
      {
        label: '运行中仿真',
        value: runningSims.value,
        hint: '正在运行仿真会话的账号',
        tone: '',
        title: '仿真会话数 ≥ 1 的虚拟学习者账号（随虚拟学习者数据刷新）',
      },
      {
        label: '虚拟学习者',
        value: virtual,
        hint: '模拟数据账号',
        tone: '',
        title: `${scope}；系统生成的模拟学习账号`,
      },
      {
        label: '测试账号',
        value: test,
        // 2026-10-14（KPI 审计）：原 hint「默认统计不含，切「测试」后计入」在测试视角自相矛盾——
        // 这张卡本来就只在切到「测试」后才渲染，等于叫用户做一件已经做完的事。改为只描述账号类别；
        // 「默认统计不含」那句说明留在「真实用户」卡（真实视角）的 title 里。
        hint: '用于测试与审计的账号',
        tone: '',
        title: scope,
      },
      {
        label: '近 7 天活跃',
        value: active7dOf(rows),
        hint: '最后登录在 7 天内',
        tone: '',
        title: `${scope}；统计当前显示的账号（虚拟学习者与测试账号）`,
      },
    ]
  }
  return [
    {
      label: '真实用户',
      value: realRows.length,
      hint: `不含虚拟 / 测试账号 · ${adminsHint}`,
      tone: '',
      title: `${scope}；切换页头「测试」后计入虚拟 / 测试账号`,
    },
    {
      label: '近 7 天活跃',
      value: active7dOf(realRows),
      hint: '最后登录在 7 天内',
      tone: '',
      title: `${scope}；仅统计真实用户（不含虚拟 / 测试账号）`,
    },
  ]
})

/* 账号构成桶（MkBuckets）已退役（2026-10-10 用户反馈「这个面板和学习组其他面板设计都不一样」）：
   含测试档的三分构成改为 MkKpi 卡带 4 张（运行中仿真/虚拟学习者/测试账号/近 7 天活跃），
   与教学组各页同款面板。
   历史沿革：2026-10-04 教学组统一 buckets 引入三分桶（真实/虚拟/测试互斥构成，
   徽章同款判据：虚拟 > 测试 > 其余真实，判据单点 learner-profile.ts 不变）；
   2026-10-05 KPI 升卡带后与 buckets 上下双面板；10-10 先收敛单带、再统一卡型；
   10-11 换读数（真实用户死卡 → 运行中仿真；30 分钟在线 → 近 7 天活跃；管理员并 hint）。
   占比条（32%/59%/9%）随退役消失——管理场景读的是绝对数与口径，不是构成比例。 */

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
