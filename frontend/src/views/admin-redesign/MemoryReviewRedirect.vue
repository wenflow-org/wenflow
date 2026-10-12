<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/** /admin/memory-review 退役重定向（2026-10-12 用户拍板「合并过去，保留详情页一个」）：
 *  记忆调度与治理（温故计划/归并审计/散键清理/回滚）已并入学习者详情「记忆与复习」页签；
 *  旧深链/收藏按 userId 落到对应学习者，无 userId（原列表态）回学习状态列表。 */
const route = useRoute()
const router = useRouter()

onMounted(() => {
  const userId = typeof route.query.userId === 'string' ? route.query.userId : ''
  if (userId) {
    // 旧链上的其余参数（includeTest 等）原样透传，学习详情页按自身口径消费
    const { userId: _drop, ...rest } = route.query
    router.replace({ path: '/admin/learner-state', query: { ...rest, view: 'learner', id: userId, tab: 'memory' } })
  } else {
    router.replace({ path: '/admin/learner-state' })
  }
})
</script>

<template>
  <div class="mk-page" aria-busy="true">
    <p class="mk-na">「记忆与复习」已并入学习者详情的「记忆与复习」页签，正在跳转…</p>
  </div>
</template>
