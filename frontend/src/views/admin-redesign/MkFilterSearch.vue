<template>
  <span class="mk-search">
    <input
      v-bind="$attrs"
      class="mk-filter__input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button
      v-if="modelValue"
      type="button"
      class="mk-search__clear"
      aria-label="清空搜索"
      @click="emit('update:modelValue', '')"
    >✕</button>
  </span>
</template>

<script setup lang="ts">
/**
 * 统一搜索框：`.mk-filter__input` + 有值时显示的清空 ×。
 * 透传 attrs（type / title / @keydown.enter / style 等）到内部 input，可平替原 `<input class="mk-filter__input">`。
 */
defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{ modelValue: string; placeholder?: string }>(), { placeholder: '搜索' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
