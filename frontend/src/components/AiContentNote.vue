<template>
  <span class="ai-note" role="note">
    <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM11 10h2v7h-2v-7z"/>
    </svg>
    <span>{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * AiContentNote — AI 生成内容提示
 * 用于所有 AI 生成/整理内容的展示位置，保持全站统一措辞。
 */
withDefaults(defineProps<{ text?: string }>(), {
  text: '内容由 AI 生成，仅供参考，请仔细甄别'
});
</script>

<style scoped>
.ai-note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--faint, #8492ab);
  font-weight: 500;
}
.ai-note svg {
  flex: 0 0 auto;
  opacity: 0.8;
}
</style>
