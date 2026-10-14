<template>
  <!-- 复用全局 .mk-pills/.mk-pill：与卡头筛选 pills 同一视觉（原 .ds-toggle 自成一套、
       高度/圆角/字号都不同，同一条工具栏里出现两种分段控件）。
       `.ds-toggle` 仅保留为稳定选择器/测试钩子，不承载样式。 -->
  <!-- 语义重制（2026-10-10 用户拍板）：教学组口径开关从「仅真实/含测试（混合灰标）」
       改为「真实 / 测试」两个互斥视角——真实=只看真人；测试=只看虚拟学习者与测试账号。
       wire 层仍走 includeTest（+testOnly），历史持久化键不变。 -->
  <div class="mk-pills ds-toggle" role="group" aria-label="数据视角切换">
    <button
      type="button"
      class="mk-pill"
      :class="{ 'mk-pill--active': !modelValue }"
      :aria-pressed="!modelValue"
      title="真实视角：只看真实用户的账号与数据（不含虚拟学习者 / 测试账号）"
      @click="emit('update:modelValue', false)"
    >
      真实
    </button>
    <button
      type="button"
      class="mk-pill"
      :class="{ 'mk-pill--active': modelValue }"
      :aria-pressed="modelValue"
      title="测试视角：只看虚拟学习者与测试账号（真实用户不出现）"
      @click="emit('update:modelValue', true)"
    >
      测试
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<style scoped>
/* 无自有样式：全部走全局 .mk-pills / .mk-pill（含暗色） */
</style>
