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
    <!-- 图标底盘是空态的固定构件（2026-11-06 用户「有的空态是这样有的空态又是图二这样」）：
         此前只有少数页面传 icon，同页就会出现「有盘 / 无盘」两种；compact 档（卡内小槽位）
         不占盘。图形统一走这里的收件箱（错误态由 .mk-empty--error 换成红系）——
         原 `icon` 属性传的是字符（◌ / ! / ⚠），在 66px 盘里读成一个细环，
         与同页其它空态不是一种图形，已整体删除；要换图形请用 #icon 具名插槽传 SVG。 -->
    <span v-if="!compact" class="mk-empty__icon" aria-hidden="true">
      <slot name="icon">
        <CloudOff v-if="tone === 'error'" :size="24" :stroke-width="1.5" />
        <Inbox v-else :size="24" :stroke-width="1.5" />
      </slot>
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
import { CloudOff, Inbox } from 'lucide-vue-next'

withDefaults(
  defineProps<{
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
