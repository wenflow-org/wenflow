<template>
  <!-- 胶囊内嵌下拉（共享原语 .mk-pillselect 的组件壳，2026-10-26）：
       卡头里的维度下拉统一走这里——外壳描边胶囊、内里透明原生 select。
       「已偏离默认值」时整枚转 .mk-pill--active，一眼看出这一维筛过。
       active 由调用方给（默认值因页而异：执行日志默认「今天」、审计日志默认「全部」）。 -->
  <label class="mk-pill mk-pillselect" :class="{ 'mk-pill--active': active }">
    <span class="mk-pillselect__k">{{ label }}</span>
    <span class="mk-pillselect__pick">
      <!-- 可见文本层：宽度只由「当前值」决定。原生 select 的固有宽度取最长 option
           （节点名最长 24 字符 → 胶囊被撑到 200px，而当前值是「全部」时右侧全是空白），
           所以 select 做成透明覆盖层，视觉由这一层承担。 -->
      <span class="mk-pillselect__txt" :class="{ mono }" aria-hidden="true">{{ currentLabel }}</span>
      <select
        class="mk-pillselect__v"
        :value="modelValue"
        :aria-label="ariaLabel || label"
        :title="currentLabel"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <ChevronDown :size="12" :stroke-width="2" aria-hidden="true" />
    </span>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

/**
 * 卡头维度下拉（共享）：`.mk-pill` + 透明原生 select。
 *
 * 用法：
 *   <MkPillSelect v-model="timeRange" label="时间范围" :options="timeRangeOptions"
 *                 :active="timeRange !== 'today'" />
 *
 * 纪律：
 * - 只在**卡头工具条**里用。表单里的下拉仍走 `.mk-filter__select`（那是录入，不是筛选）。
 * - `active` 必须由调用方按该页的默认值算，不能写死 true/false：语义是
 *   「这一维偏离默认 → 值得高亮」，默认值因页而异。
 * - 值可能很长（节点名/动作名）→ `.mk-pillselect__v` 自带 200px 截断 + 原生 title；
 *   `mono` 给机器串（节点 id、动作 key）用等宽。
 */
const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  /** 该维是否偏离默认值（→ 浅蓝激活态） */
  active?: boolean
  /** 可访问名；缺省回落 label */
  ariaLabel?: string
  /** 值是否机器串（等宽） */
  mono?: boolean
}>(), { active: false, ariaLabel: '', mono: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** 当前值文案（select 内文本会被 200px 截断 → title 给全值） */
const currentLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? ''
)
</script>
