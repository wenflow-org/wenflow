<template>
  <!-- 卡头维度下拉（共享原语）：描边胶囊触发器 + 自绘 listbox。
       2026-10-27 用户「这个下拉，完全没有设计」：原生 <select> 的弹层由浏览器绘制，
       option 只能改文字/底色，改不了弹层形状、间距、选中态——展开后就是系统默认的
       蓝底白字菜单。这里改成与 MkCols 同一套弹层的自绘 listbox：
       surface + 1px line + shadow-pop、行内 hover、选中行勾选，并保留 combobox/listbox
       语义与键盘操作（↑↓ / Home / End / Enter / Esc）。 -->
  <div ref="rootEl" class="mk-pillselect-wrap">
    <button
      ref="triggerEl"
      type="button"
      class="mk-pill mk-pillselect"
      :class="{ 'mk-pill--active': active, 'mk-pillselect--open': open }"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      :aria-label="ariaLabel || label"
      :data-value="modelValue"
      :title="currentLabel"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="mk-pillselect__k">{{ label }}</span>
      <span class="mk-pillselect__pick">
        <span class="mk-pillselect__txt" :class="{ mono }" aria-hidden="true">{{ currentLabel }}</span>
        <ChevronDown :size="12" :stroke-width="2" aria-hidden="true" />
      </span>
    </button>
    <ul
      v-show="open"
      :id="menuId"
      ref="menuEl"
      class="mk-pillselect__menu"
      role="listbox"
      :aria-label="ariaLabel || label"
    >
      <li
        v-for="(o, i) in options"
        :id="optionId(i)"
        :key="o.value"
        :data-value="o.value"
        class="mk-pillselect__option"
        :class="{ 'is-active': i === activeIndex, 'is-selected': o.value === modelValue }"
        role="option"
        :aria-selected="o.value === modelValue"
        @mouseenter="activeIndex = i"
        @click="choose(o)"
      >
        <span class="mk-pillselect__label" :title="o.label">{{ o.label }}</span>
        <Check v-if="o.value === modelValue" :size="13" :stroke-width="2.2" aria-hidden="true" />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

/**
 * 卡头维度下拉（共享）：`.mk-pill` 触发器 + 自绘 listbox。
 *
 * 用法：
 *   <MkPillSelect v-model="timeRange" label="时间范围" :options="timeRangeOptions"
 *                 :active="timeRange !== 'today'" />
 *
 * 纪律：
 * - 只在**卡头工具条**里用。表单里的下拉仍走 `.mk-filter__select`（那是录入，不是筛选）。
 * - `active` 必须由调用方按该页的默认值算，不能写死 true/false：语义是
 *   「这一维偏离默认 → 值得高亮」，默认值因页而异。
 * - 值可能很长（节点名/动作名）→ 触发器内 180px 截断 + title 全值；
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

let uid = 0
const menuId = `mk-pillselect-${++uid}-${Math.random().toString(36).slice(2, 7)}`
const optionId = (i: number) => `${menuId}-opt-${i}`

const open = ref(false)
const activeIndex = ref(-1)
const rootEl = ref<HTMLElement | null>(null)
const triggerEl = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)

/** 当前值文案（触发器内 180px 截断 → title 给全值） */
const currentLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? ''
)
const selectedIndex = computed(() => props.options.findIndex((o) => o.value === props.modelValue))

function scrollActiveIntoView() {
  const item = menuEl.value?.children[activeIndex.value] as HTMLElement | undefined
  item?.scrollIntoView({ block: 'nearest' })
}

function openMenu() {
  if (open.value) return
  open.value = true
  activeIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0
  void nextTick(scrollActiveIntoView)
}
function closeMenu() {
  open.value = false
}
function toggleMenu() {
  if (open.value) closeMenu()
  else openMenu()
}
function choose(o: { value: string; label: string }) {
  emit('update:modelValue', o.value)
  closeMenu()
  triggerEl.value?.focus()
}
function move(delta: number) {
  const n = props.options.length
  if (!n) return
  activeIndex.value = (activeIndex.value + delta + n) % n
  void nextTick(scrollActiveIntoView)
}
function onTriggerKeydown(e: KeyboardEvent) {
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      openMenu()
    }
    return
  }
  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      closeMenu()
      break
    case 'ArrowDown':
      e.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      move(-1)
      break
    case 'Home':
      e.preventDefault()
      activeIndex.value = 0
      void nextTick(scrollActiveIntoView)
      break
    case 'End':
      e.preventDefault()
      activeIndex.value = props.options.length - 1
      void nextTick(scrollActiveIntoView)
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      if (activeIndex.value >= 0) {
        const o = props.options[activeIndex.value]
        if (o) choose(o)
      }
      break
    case 'Tab':
      closeMenu()
      break
  }
}

/* 点击组件外部关闭（与 MkCols 同一契约；不再依赖原生 select 的失焦行为） */
function onDocMousedown(e: MouseEvent) {
  if (!open.value) return
  const root = rootEl.value
  if (root && e.target instanceof Node && !root.contains(e.target)) closeMenu()
}
onMounted(() => document.addEventListener('mousedown', onDocMousedown, true))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMousedown, true))
</script>
