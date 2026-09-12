<template>
  <!-- 复用全局 .mk-pills/.mk-pill：与卡头筛选 pills 同一视觉（原 .ds-toggle 自成一套、
       高度/圆角/字号都不同，同一条工具栏里出现两种分段控件）。 -->
  <div class="mk-pills" role="group" aria-label="数据范围切换">
    <button
      type="button"
      class="mk-pill"
      :class="{ 'mk-pill--active': !modelValue }"
      :aria-pressed="!modelValue"
      title="仅真实用户（不含模拟账号）"
      @click="emit('update:modelValue', false)"
    >
      仅真实
    </button>
    <button
      type="button"
      class="mk-pill"
      :class="{ 'mk-pill--active': modelValue }"
      :aria-pressed="modelValue"
      title="含模拟账号（虚拟学习者与测试账号），行内带标记"
      @click="emit('update:modelValue', true)"
    >
      含模拟
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
