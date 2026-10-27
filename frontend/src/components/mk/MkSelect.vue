<template>
  <!-- 表单/工具栏单选下拉（共享原语）：原生 <select> 的替代品。
       闭合态是设计系统的描边框（不是胶囊），展开后与 MkPillSelect 共用同一套
       自绘 listbox（`.mk-listbox-pop`），不再弹系统蓝底菜单。
       两种形态：
       - 默认（md）：32px，用于 `.mk-filter` 工具条，替代 `.mk-filter__select`；
       - `size="sm"`：30px，用于分页器「每页条数」这类紧凑位置；
       - `block`：撑满父容器，用于 `.mk-field` 表单（替代 `.mk-field__select`）。 -->
  <div
    ref="rootEl"
    class="mk-select"
    :class="{
      'mk-select--open': open,
      'mk-select--sm': size === 'sm',
      'mk-select--block': block,
      'mk-select--disabled': disabled
    }"
  >
    <button
      ref="triggerEl"
      v-bind="$attrs"
      type="button"
      class="mk-select__trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      :disabled="disabled"
      :data-value="keyOf(modelValue)"
      :title="currentLabel || placeholder"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="mk-select__value" :class="{ mono, 'is-empty': !currentLabel }">
        {{ currentLabel || placeholder }}
      </span>
      <ChevronDown :size="12" :stroke-width="2" aria-hidden="true" />
    </button>
    <ul
      v-show="open"
      :id="menuId"
      ref="menuEl"
      class="mk-listbox-pop mk-select__menu"
      role="listbox"
    >
      <li
        v-for="(o, i) in options"
        :id="optionId(i)"
        :key="keyOf(o.value)"
        :data-value="keyOf(o.value)"
        class="mk-listbox-opt"
        :class="{ 'is-active': i === activeIndex, 'is-selected': isSelected(o) }"
        role="option"
        :aria-selected="isSelected(o)"
        @mouseenter="activeIndex = i"
        @click="choose(o)"
      >
        <span class="mk-listbox-opt__label" :title="o.label">{{ o.label }}</span>
        <Check v-if="isSelected(o)" :size="13" :stroke-width="2.2" aria-hidden="true" />
      </li>
      <!-- 无选项（如学习者没有学习路径）：弹层里给一行占位，而不是展开一个空框 -->
      <li
        v-if="!options.length"
        class="mk-listbox-opt mk-select__empty"
        role="presentation"
      >{{ placeholder }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts" generic="T extends SelectValue">
import { computed } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { useListbox, type SelectValue } from './useListbox'

/**
 * MkSelect：原生 `<select>` 的自绘替代（表单/工具栏形态）。
 *
 * 用法（与原生 select 基本一致，迁移时只换标签）：
 *   <MkSelect v-model="pageSize" aria-label="每页条数" :options="sizeOptions" size="sm" />
 *   <MkSelect v-model="roleFilter" :options="roleOptions" @change="onRoleChange" />
 *
 * 行为：
 * - `v-model` 保留原值类型（string / number / boolean / null / undefined），不做字符串化；
 * - 选中后同时发 `update:modelValue` 与 `change`，原生 `@change` 的调用方可以只换标签；
 * - `$attrs`（id / class / aria-label / data-*）落在触发器 button 上，不再落在包裹层。
 *
 * 纪律：`mk-` 外壳样式只在本组件与 `mk-primitives.css` 定义；页面不要另写
 * `.mk-select__*` 覆盖（design:check 规则 1）。
 *
 * 泛型 `T` 让 `v-model` 保留原值类型（boolean 三态、number 页码、string 枚举），
 * 迁移处不必在模板里写 cast。
 */
const props = withDefaults(defineProps<{
  modelValue?: T
  options: ReadonlyArray<{ value: T; label: string }>
  /** 无值时触发器显示的占位文本 */
  placeholder?: string
  disabled?: boolean
  /** md = 32px（工具条）；sm = 30px（分页器等紧凑位置） */
  size?: 'md' | 'sm'
  /** 值是否机器串（等宽） */
  mono?: boolean
  /** 撑满父容器（表单字段） */
  block?: boolean
}>(), {
  placeholder: '请选择',
  disabled: false,
  size: 'md',
  mono: false,
  block: false
})
const emit = defineEmits<{
  'update:modelValue': [value: T]
  change: [value: T]
}>()

defineOptions({ inheritAttrs: false })

/** option 的稳定 key：`undefined` 与空串必须能区分（用户日志的状态三态筛选） */
function keyOf(v: T | undefined): string {
  return v === undefined ? '__undefined' : v === null ? '__null' : String(v)
}
function isSelected(o: { value: T; label: string }): boolean {
  return Object.is(o.value, props.modelValue)
}

const currentLabel = computed(
  () => props.options.find(isSelected)?.label ?? ''
)

const {
  open,
  activeIndex,
  rootEl,
  triggerEl,
  menuEl,
  menuId,
  optionId,
  toggleMenu,
  choose: pick,
  onTriggerKeydown
} = useListbox(() => props.options, isSelected, (o) => {
  emit('update:modelValue', o.value)
  emit('change', o.value)
})

/** 包一层：把选中的 option 对象交给 listbox 的选中/关闭/焦点归还流程 */
function choose(o: { value: T; label: string }) {
  pick(o)
}
</script>
