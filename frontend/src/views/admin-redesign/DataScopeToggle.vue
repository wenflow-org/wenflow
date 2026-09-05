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
  gap: 3px;
  padding: 3px;
  border-radius: 8px;
  background: #eef2fa;
  white-space: nowrap;
  flex-shrink: 0;
}
.ds-toggle__btn {
  padding: 3px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mk-muted);
  font: inherit;
  font-size: var(--mk-fs-12);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.ds-toggle__btn:hover { color: var(--mk-blue); }
.ds-toggle__btn--on {
  background: #fff;
  color: var(--mk-blue);
  font-weight: 700;
  box-shadow: 0 0 0 1px rgba(44, 99, 208, 0.4), 0 1px 2px rgba(23, 32, 51, 0.08);
}

/* 暗色模式（D1）：对齐 mk-pill--active 深色等价物 */
html[data-theme='dark'] .ds-toggle { background: #1d2739; }
html[data-theme='dark'] .ds-toggle__btn--on {
  background: rgba(91, 141, 239, 0.22);
  color: #9db8f5;
  box-shadow: 0 0 0 1px rgba(91, 141, 239, 0.45);
}
</style>
