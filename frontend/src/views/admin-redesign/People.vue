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
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="usersRef?.openCreate?.()">新建用户</button>
        <button type="button" class="mk-btn mk-btn--sm" @click="usersRef?.refresh?.()">刷新</button>
      </template>
    </MkPageHead>

    <!-- 账号构成带（2026-10-04 用户拍板教学组统一 buckets 形态）：真实用户 / 虚拟学习者 / 测试账号
         三桶 = 同一整体（已加载账号）的互斥构成，份额条按占比；口径在值悬停披露。
         数据 = live 域已加载行（后端总数在 liveUsersTotal，超上限截断时口径里注明） -->
    <MkBuckets v-if="ppBuckets.length" label="账号构成" :items="ppBuckets" />

    <Users ref="usersRef" embedded />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkBuckets from '@/components/mk/MkBuckets.vue'
import Users from './Users.vue'
import { liveUsers, liveUsersTotal } from './live'

const usersRef = ref<{ refresh?: () => void; openCreate?: () => void } | null>(null)

/* 账号构成桶（2026-10-04 教学组统一 buckets）：真实 / 虚拟 / 测试 = 同一整体的互斥构成
   （徽章同款互斥判据：虚拟 > 测试 > 其余真实）；管理员数作真实用户桶 foot（角色属真实域细分）。
   管理员数是运营要看的角色分布，不单独立桶（角色与账号性质非同一整体，混桶=假比例）。 */
const ppBuckets = computed(() => {
  const rows = liveUsers.value
  const total = rows.length
  if (!total) return []
  const virtual = rows.filter((u) => u.isVirtualLearner).length
  const test = rows.filter((u) => !u.isVirtualLearner && u.isTestAccount).length
  const realRows = rows.filter((u) => !u.isVirtualLearner && !u.isTestAccount)
  const real = realRows.length
  const admins = realRows.filter((u) => u.isAdmin).length
  const pct = (v: number) => Math.round((v / total) * 100)
  const calibre = `按已加载 ${total} 行统计（后端共 ${liveUsersTotal.value}）；虚拟 / 测试账号默认不入教学统计口径`
  return [
    { value: real, label: '真实用户', pct: pct(real), tone: 'var(--mk-blue)', valueTitle: calibre, foots: [{ text: `其中管理员 ${admins}` }] },
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
