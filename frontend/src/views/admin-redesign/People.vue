<template>
  <div class="mk-page mk-page--fill pp-host">
    <!-- 页头（newui pageTitle 复刻）：页名 + 主操作。
         2026-10-04 用户拍板：学习状态 tab 拆出独立页 /admin/learner-state（同教学三页拆页先例），
         本页回归单视图（用户账号管理），旧 ?tab=state 深链在下方 watch 重定向兼容 -->
    <MkPageHead title="用户账号">
      <template #actions>
        <!-- 口径开关已退役（2026-10-21 用户拍板「没有测试，测试只是备注」）：
             列表 = 全部非虚拟账号，测试/审计账号行内备注；虚拟学习者归自己的域 -->
        <!-- 注册设置迁到用户页（2026-11-11）：它决定「能不能自助建号」，与「新建用户」是同一个
             账号入口的两条来路，放在同一处才讲得通（原在系统设置 → 访问与注册） -->
        <button type="button" class="mk-btn mk-btn--sm" @click="registrationOpen = true">注册设置</button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="usersRef?.openCreate?.()">新建用户</button>
      </template>
    </MkPageHead>

    <Users ref="usersRef" embedded />
    <RegistrationSettingsDialog v-model:open="registrationOpen" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import Users from './Users.vue'
import RegistrationSettingsDialog from './RegistrationSettingsDialog.vue'

const usersRef = ref<{ refresh?: () => void; openCreate?: () => void; setPill?: (p: string) => void } | null>(null)
/** 注册设置（2026-11-11 从系统设置迁入）：自助注册开关与单 IP 配额 */
const registrationOpen = ref(false)

const route = useRoute()
const router = useRouter()
/* 旧深链兼容：/admin/people?tab=state → 学习状态独立页（拆页 2026-10-04）；
   其余 query（tab=account 等）就地归零，不再有第二视图 */
/* 平台总览「用户活跃」卡带 ?pill=online 深链：此前 query 被静默丢弃，点了两数无法对照。
   2026-11-11（困惑测试 #12）：把档位交给内嵌列表。 */
watch(
  () => route.query.pill,
  (p) => {
    if (typeof p === 'string' && p) void nextTick(() => usersRef.value?.setPill?.(p))
  },
  { immediate: true }
)

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
