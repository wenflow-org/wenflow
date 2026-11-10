<script setup lang="ts">
/**
 * ChatInput — reusable textarea with send button.
 * Supports Enter-to-send, Shift+Enter newline, IME composition guard,
 * character counter, active state highlight, and auto-resize.
 */
import { ref, computed } from 'vue';

const props = withDefaults(defineProps<{
  placeholder?: string;
  maxlength?: number;
  disabled?: boolean;
  modelValue?: string;
  showHint?: boolean;
}>(), {
  placeholder: '输入消息…',
  maxlength: 800,
  disabled: false,
  modelValue: '',
  showHint: true,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  send: [];
  input: [length: number];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

const charCount = computed(() => props.modelValue.length);
const hasContent = computed(() => props.modelValue.trim().length > 0);
const canSend = computed(() => hasContent.value && !props.disabled);

function onInput() {
  emit('input', props.modelValue.length);
  autoResize();
}

function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function onKeydown(e: KeyboardEvent) {
  // IME composition guard: Chinese pinyin selection Enter should not trigger send
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
}

function doSend() {
  if (!canSend.value) return;
  emit('send');
}

function focus() {
  textareaRef.value?.focus();
}

defineExpose({ focus, textareaRef });
</script>

<template>
  <div class="composer">
    <div class="composer__box" :class="{ 'composer__box--active': hasContent }">
      <textarea
        ref="textareaRef"
        :value="modelValue"
        class="composer__textarea"
        rows="1"
        :maxlength="maxlength"
        :placeholder="placeholder"
        :disabled="disabled"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value); onInput()"
        @keydown="onKeydown"
      ></textarea>
      <span class="composer__count">{{ charCount }} / {{ maxlength }}</span>
      <button
        type="button"
        class="composer__send"
        :class="{ 'composer__send--off': !canSend }"
        :disabled="!canSend"
        aria-label="发送"
        @click="doSend"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
      </button>
    </div>
    <div v-if="showHint" class="composer__hint">
      <span>Enter 发送 · Shift+Enter 换行</span>
      <slot name="hint-right" />
    </div>
  </div>
</template>

<style scoped>
/* 组件自带几何样式：宿主页面的 <style scoped> 只会命中它自己的模板节点，够不到子组件内部
   （data-v 属性不下传），此前本组件只剩浏览器默认的 textarea + 裸按钮。
   尺寸口径对齐「目标规划」会话态输入盒（2026-11-06 审计 §1）：
   外盒 12px 圆角（与上方气泡/方案卡同档）、发送键 36px 高 + 8px 控件圆角（不是全圆胶囊）、
   底部元信息统一 12px；颜色只用令牌，随明暗主题翻转。 */
.composer {
  display: grid;
  gap: 7px;
}
.composer__box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
  min-height: 54px;
  padding: 8px;
  box-sizing: border-box;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--wf-shadow-raised);
}
.composer__box:focus-within {
  border-color: color-mix(in srgb, var(--blue) 55%, transparent);
  box-shadow: var(--mk-focus-ring);
}
.composer__textarea {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  resize: none;
  padding: 10px 0;
  font: inherit;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  background: transparent;
  max-height: 120px;
  align-self: center;
  /* 多行输入自增高超过 120 后的内部滚动：细滑块、无上下箭头（2026-11-06 审计 §6） */
  scrollbar-width: thin;
}
.composer__textarea::-webkit-scrollbar { width: 4px; }
.composer__textarea::-webkit-scrollbar-thumb {
  border-radius: var(--mk-radius-xs);
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}
.composer__count {
  flex: none;
  align-self: flex-end;
  padding-bottom: 4px;
  font-size: 12px;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.composer__send {
  flex: 0 0 auto;
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  /* 8px 控件圆角（审计 §1 同心圆角）；36px 是仓库可点元素的硬下沿 */
  border-radius: var(--mk-radius-md);
  background: var(--blue);
  color: var(--text-on-primary);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
.composer__send:not(:disabled):active { transform: scale(0.98); }
.composer__send--off {
  background: color-mix(in srgb, var(--line) 60%, transparent);
  color: var(--faint);
  cursor: default;
}
.composer__hint {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  font-size: 12px;
  color: var(--faint);
}
</style>
