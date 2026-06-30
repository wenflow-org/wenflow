<template>
  <div class="ai-typing" :class="['ai-typing--' + variant, { 'ai-typing--inline': inline }]" role="status" :aria-label="ariaLabel">
    <span class="ai-typing__dot"></span>
    <span class="ai-typing__dot"></span>
    <span class="ai-typing__dot"></span>
    <span v-if="label" class="ai-typing__label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    variant?: 'soft' | 'card' | 'minimal'
    inline?: boolean
    ariaLabel?: string
  }>(),
  {
    label: '',
    variant: 'soft',
    inline: false,
    ariaLabel: 'AI 正在生成回复'
  }
)
</script>

<style scoped>
.ai-typing {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted, #66758d);
}

.ai-typing--inline {
  padding: 0;
}

.ai-typing--soft {
  padding: 10px 16px;
  border-radius: 999px;
  background: rgba(52, 120, 246, 0.06);
  border: 1px solid rgba(52, 120, 246, 0.12);
}

.ai-typing--card {
  padding: 12px 18px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
  backdrop-filter: blur(8px);
}

.ai-typing--minimal {
  padding: 0;
  background: transparent;
  border: none;
}

.ai-typing__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary, #3478f6);
  opacity: 0.45;
  animation: ai-typing-bounce 1.4s ease-in-out infinite;
}

.ai-typing__dot:nth-child(2) {
  animation-delay: 0.18s;
}

.ai-typing__dot:nth-child(3) {
  animation-delay: 0.36s;
  margin-right: 2px;
}

.ai-typing__label {
  margin-left: 4px;
  font-weight: 500;
}

@keyframes ai-typing-bounce {
  0%, 60%, 100% {
    transform: translateY(0) scale(0.85);
    opacity: 0.45;
  }
  30% {
    transform: translateY(-3px) scale(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-typing__dot {
    animation: ai-typing-fade 1.4s ease-in-out infinite;
  }

  @keyframes ai-typing-fade {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
}

[data-theme='dark'] .ai-typing--soft {
  background: rgba(52, 120, 246, 0.12);
  border-color: rgba(52, 120, 246, 0.2);
}

[data-theme='dark'] .ai-typing--card {
  background: rgba(28, 36, 52, 0.85);
  border-color: rgba(255, 255, 255, 0.08);
}
</style>
