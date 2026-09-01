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
      <span
        class="composer__send"
        :class="{ 'composer__send--off': !canSend }"
        @click="doSend"
      >
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
      </span>
    </div>
    <div v-if="showHint" class="composer__hint">
      <span>Enter 发送 · Shift+Enter 换行</span>
      <slot name="hint-right" />
    </div>
  </div>
</template>

<style scoped>
/* Styles inherit from parent .v2-page scope — uses the same .composer* class names */
</style>
