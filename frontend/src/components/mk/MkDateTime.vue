<template>
  <span class="mdt">
    <!-- 时间是只读回显 + 选择钮：原生 datetime-local 在中文环境里把空态渲染成
         「年 /月/日 --:--」（字间空格不均、斜杠位置也怪），深色下还常与系统配色打架。
         这里用统一的回显文案代替它的内联占位符，点回显或日历钮都唤起原生选择器
         （值仍是本地无时区串，交给宿主转 ISO，时区漂移口径不变）。 -->
    <input
      class="mk-field__input mdt__text"
      :value="display"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      readonly
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
    />
    <button type="button" class="mdt__btn" :aria-label="`选择${label}`" @click="openPicker">
      <CalendarDays :size="14" :stroke-width="1.8" aria-hidden="true" />
    </button>
    <input
      ref="nativeEl"
      class="mdt__native"
      type="datetime-local"
      :value="modelValue"
      tabindex="-1"
      aria-hidden="true"
      @change="onPick"
    />
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarDays } from 'lucide-vue-next'

/** 值：datetime-local 的本地串（YYYY-MM-DDTHH:mm），空串 = 未选 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string
    placeholder?: string
  }>(),
  { label: '时间', placeholder: '未设置' }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const nativeEl = ref<HTMLInputElement | null>(null)

const ariaLabel = computed(() => props.label)

/** YYYY-MM-DDTHH:mm → YYYY-MM-DD HH:mm（与全站时间戳同形，不出现斜杠/中文量词） */
const display = computed(() => (props.modelValue || '').replace('T', ' '))

function openPicker(): void {
  const el = nativeEl.value
  if (!el) return
  /* showPicker 需要元素已渲染且非 disabled；浏览器过旧时退回 click（Chrome 早期版本只在钮上开） */
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker()
      return
    } catch {
      /* 用户手势丢失等情况：落到 click 兜底 */
    }
  }
  el.click()
}

function onPick(e: Event): void {
  const v = (e.target as HTMLInputElement).value
  emit('update:modelValue', v || '')
}
</script>

<style scoped>
.mdt { position: relative; display: flex; align-items: center; }
.mdt__text { width: 100%; padding-right: 38px; cursor: pointer; }
.mdt__text::placeholder { color: var(--mk-faint); }
.mdt__btn {
  position: absolute;
  right: 1px;
  top: 1px;
  bottom: 1px;
  width: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-left: 1px solid var(--mk-line);
  border-radius: 0 var(--mk-radius-sm) var(--mk-radius-sm) 0;
  background: transparent;
  color: var(--mk-muted);
  cursor: pointer;
}
.mdt__btn:hover { color: var(--mk-ink); background: var(--mk-hover-surface); }
.mdt__btn:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: -2px; }
/* 原生控件只负责弹面板：留 1px 渲染占位（display:none 会让 showPicker 抛错） */
.mdt__native {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  border: 0;
  padding: 0;
}
</style>
