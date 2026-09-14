<template>
  <div class="mk-empty" :class="{ 'mk-empty--min': min, 'mk-empty--compact': compact }">
    <!-- 共用空态：图标块 + 「为什么这里是空的」+ 可执行的下一步。
         统一全站空态的骨架，避免各页自行拼文案导致「空壳化」。 -->
    <span v-if="icon || $slots.icon" class="mk-empty__icon" aria-hidden="true">
      <slot name="icon">{{ icon }}</slot>
    </span>
    <strong>{{ title }}</strong>
    <span v-if="description">{{ description }}</span>
    <button v-if="actionText" type="button" class="mk-empty__action" @click="$emit('action')">
      {{ actionText }}
    </button>
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 图标字符（简单场景）；复杂 SVG 用 #icon 具名插槽 */
    icon?: string
    title: string
    /** 一句「为什么这里是空的」 */
    description?: string
    /** 有下一步时的按钮文案 */
    actionText?: string
    /** 稀疏页填满视口并垂直居中（对齐 --mk-empty-min-h 口径） */
    min?: boolean
    /** 卡片内嵌的紧凑空态 */
    compact?: boolean
  }>(),
  { icon: '', description: '', actionText: '', min: false, compact: false }
)

defineEmits<{ action: [] }>()
</script>
