<template>
  <div class="ds-toggle" role="group" aria-label="数据范围切换">
    <button
      type="button"
      class="ds-toggle__btn"
      :class="{ 'ds-toggle__btn--on': !modelValue }"
      :aria-pressed="!modelValue"
      title="仅真实用户（不含模拟账号）"
      @click="emit('update:modelValue', false)"
    >
      仅真实
    </button>
    <button
      type="button"
      class="ds-toggle__btn"
      :class="{ 'ds-toggle__btn--on': modelValue }"
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
.ds-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: #eef1f6;
  white-space: nowrap;
  flex-shrink: 0;
}
.ds-toggle__btn {
  padding: 3px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--mk-muted);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.ds-toggle__btn:hover { color: var(--mk-blue); }
.ds-toggle__btn--on {
  background: #fff;
  color: var(--mk-blue);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}

/* 暗色模式（D1）：选中态深蓝底 + 浅字，容器深色 */
html[data-theme='dark'] .ds-toggle { background: #1d2739; }
html[data-theme='dark'] .ds-toggle__btn--on {
  background: rgba(91, 141, 239, 0.24);
  color: #9db8f5;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
</style>
