<template>
  <!-- 复用全局 .mk-pills/.mk-pill：与卡头筛选 pills 同一视觉（原 .ds-toggle 自成一套、
       高度/圆角/字号都不同，同一条工具栏里出现两种分段控件）。
       `.ds-toggle` 仅保留为稳定选择器/测试钩子，不承载样式。 -->
  <!-- 语义重制（2026-10-10 用户拍板「真实/测试」两个互斥视角；
       2026-10-21 用户拍板教学组剔除虚拟学习者）：教学组六页的「测试」= 测试/审计账号
       （wire 层 testOnly + qaOnly）；虚拟学习者不进教学口径，它有自己的域
       （虚拟学习者列表 / 详情控制台 / 会话座舱）。
       成本分析是唯一例外：仿真花费是真实支出，那一档仍含虚拟学习者，
       用 testLabel 把档位名改成「虚拟与测试」以免同名不同义。
       持久化键不变（live.ts 的 wf_include_virtual 是历史命名，值语义已随本开关）。 -->
  <div class="mk-pills ds-toggle" role="group" aria-label="数据视角切换">
    <button
      type="button"
      class="mk-pill"
      :class="{ 'mk-pill--active': !modelValue }"
      :aria-pressed="!modelValue"
      @click="emit('update:modelValue', false)"
    >
      真实
    </button>
    <button
      type="button"
      class="mk-pill"
      :class="{ 'mk-pill--active': modelValue }"
      :aria-pressed="modelValue"
      @click="emit('update:modelValue', true)"
    >
      {{ testLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ modelValue: boolean; testLabel?: string }>(), { testLabel: '测试' })
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<style scoped>
/* 无自有样式：全部走全局 .mk-pills / .mk-pill（含暗色） */
</style>
