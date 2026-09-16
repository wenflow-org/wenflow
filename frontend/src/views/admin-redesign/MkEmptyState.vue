<template>
  <div
    class="mk-empty"
    :class="{ 'mk-empty--min': min, 'mk-empty--compact': compact, 'mk-empty--error': tone === 'error' }"
    :role="tone === 'error' ? 'alert' : undefined"
  >
    <!-- 共用空态：图标块 + 「为什么这里是空的」+ 可执行的下一步。
         统一全站空态的骨架，避免各页自行拼文案导致「空壳化」。
         R3 三态里的「错误态」走 tone="error"：标题转正文色、图标转红系，
         并自带 role="alert"，不需要各页再写 --error 修饰与手拼重试按钮。 -->
    <span v-if="icon || $slots.icon" class="mk-empty__icon" aria-hidden="true">
      <slot name="icon">{{ icon }}</slot>
    </span>
    <strong>{{ title }}</strong>
    <span v-if="description">{{ description }}</span>
    <!-- actionBusy：重试进行中 → 按钮禁用并换成进行中文案（此前各页在 slot 里手拼同一颗按钮） -->
    <button
      v-if="actionText"
      type="button"
      class="mk-empty__action"
      :disabled="actionBusy"
      @click="$emit('action')"
    >
      {{ actionBusy && actionBusyText ? actionBusyText : actionText }}
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
    /** 一句「为什么这里是空的」；错误态下放具体错误信息 */
    description?: string
    /** 有下一步时的按钮文案 */
    actionText?: string
    /** 动作进行中：按钮禁用，并改用 actionBusyText */
    actionBusy?: boolean
    /** 动作进行中的按钮文案（如「重试中…」） */
    actionBusyText?: string
    /** 语义：neutral 中性空态 | error 加载失败等错误态（红系图标 + role=alert） */
    tone?: 'neutral' | 'error'
    /** 稀疏页填满视口并垂直居中（对齐 --mk-empty-min-h 口径） */
    min?: boolean
    /** 卡片内嵌的紧凑空态 */
    compact?: boolean
  }>(),
  {
    icon: '',
    description: '',
    actionText: '',
    actionBusy: false,
    actionBusyText: '',
    tone: 'neutral',
    min: false,
    compact: false
  }
)

defineEmits<{ action: [] }>()
</script>
