<script setup lang="ts">
import { computed } from 'vue';
import { useIsDark } from '@/composables/useIsDark';
/**
 * TypingIndicator — three bouncing dots showing AI is processing.
 * Reusable across all chat contexts.
 */
const props = withDefaults(defineProps<{
  show?: boolean;
  avatar?: string;
  label?: string;
}>(), {
  show: true,
  label: '问流',
});

// 未显式传 avatar 时按主题取品牌 mark（暗色用浅色版，避免深墨 mark 在深底不可见）
const isDark = useIsDark();
const resolvedAvatar = computed(() => props.avatar || (isDark.value ? '/favicon-dark.png' : '/favicon.png'));
</script>

<template>
  <Transition name="typing-fade">
    <div v-if="show" class="msg msg--ai typing-indicator">
      <span class="msg__avatar"><img :src="resolvedAvatar" :alt="label" /></span>
      <div class="msg__bubble msg__bubble--typing"><i></i><i></i><i></i></div>
    </div>
  </Transition>
</template>

<style scoped>
.typing-fade-enter-active { transition: opacity 0.2s ease; }
.typing-fade-leave-active { transition: opacity 0.12s ease; }
.typing-fade-enter-from,
.typing-fade-leave-to { opacity: 0; }
</style>
