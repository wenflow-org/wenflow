<script setup lang="ts">
/**
 * QuickReplies — quick reply button list.
 * Two modes:
 *   'send'   — clicking emits select(text) for the parent to send directly.
 *   'append' — clicking emits select(text) for the parent to append to input.
 */
withDefaults(defineProps<{
  replies: string[];
  disabled?: boolean;
  mode?: 'send' | 'append';
}>(), {
  disabled: false,
  mode: 'send',
});

const emit = defineEmits<{
  select: [text: string];
}>();

function pick(text: string) {
  emit('select', text);
}
</script>

<template>
  <div v-if="replies.length && !disabled" class="replies">
    <div class="replies__row">
      <button
        v-for="q in replies"
        :key="q"
        type="button"
        class="reply"
        :class="{ 'reply--append': mode === 'append' }"
        @click="pick(q)"
      >{{ q }}</button>
    </div>
  </div>
</template>

<style scoped>
/* Styles inherit from parent .v2-page scope — uses the same .replies/.reply class names */
</style>
