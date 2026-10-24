<template>
  <span class="mk-search" :class="{ 'mk-search--filled': !!modelValue }">
    <input
      v-bind="$attrs"
      class="mk-filter__input"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
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
import { computed, useAttrs } from 'vue'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string }>(), { placeholder: '搜索' })
/* 可访问名：调用方没给 aria-label 时回落到 placeholder——只有 placeholder 的输入框
   在部分读屏里没有名字（2026-10-23 UI 审查：8 个列表页搜索框均无 aria-label）。 */
const attrs = useAttrs()
const ariaLabel = computed(() => (attrs['aria-label'] as string) || props.placeholder)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
