<script setup lang="ts">
/**
 * TypingIndicator — three bouncing dots showing AI is processing.
 * Reusable across all chat contexts.
 */
withDefaults(defineProps<{
  show?: boolean;
  avatar?: string;
  label?: string;
}>(), {
  show: true,
  avatar: '/favicon.png',
  label: '问流',
});
</script>

<template>
  <Transition name="typing-fade">
    <div v-if="show" class="msg msg--ai typing-indicator">
      <span class="msg__avatar"><img :src="avatar" :alt="label" /></span>
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
