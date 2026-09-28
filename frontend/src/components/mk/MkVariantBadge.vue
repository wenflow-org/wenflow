<!--
  数据隔离变体徽章（mk 单元格原语之一）：
  收敛各页手写的「虚拟 / 测试账号」徽章（Users/GoalConversations/TeachingSessions/
  MemoryReview… 文案与 title 各不相同：虚拟 vs 测试 vs 测试账号）。
  徽章色走全局 mk-badge--virtual / --warn，本组件只统一文案与口径。
-->
<template>
  <span
    v-if="kind === 'virtual'"
    class="mk-badge mk-badge--sm mk-badge--virtual"
    title="虚拟学习者（仿真数据，可再生成）"
  >虚拟</span>
  <span
    v-else-if="kind === 'test'"
    class="mk-badge mk-badge--sm mk-badge--warn"
    title="测试/审计账号（不计入真实统计口径）"
  >测试账号</span>
</template>

<script setup lang="ts">
defineProps<{ kind: 'virtual' | 'test' }>()
</script>
