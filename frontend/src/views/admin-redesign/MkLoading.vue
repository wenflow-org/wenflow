<template>
  <!-- 共用加载态：spinner + 文案。样式在 shared.css 的 .mk-loading（与 .mk-empty 同约定）。
       根节点用 <span>（而非 div）：这样它既能作块级容器，也能合法地放进 <button> 内
       承载按钮的忙碌态（例：<button><MkLoading inline text="刷新中…" /></button>）。 -->
  <span
    class="mk-loading"
    :class="{ 'mk-loading--inline': inline, 'mk-loading--min': min }"
    role="status"
    aria-live="polite"
  >
    <span class="mk-spinner" aria-hidden="true"></span>
    <span v-if="text" class="mk-loading__text">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 加载文案，默认「加载中…」；只想显示转圈时传空串 */
    text?: string
    /** 局部加载（抽屉/表格行内/**按钮忙碌态**）：行内排布、左对齐、更紧凑 */
    inline?: boolean
    /** 填满视口并垂直居中（整页加载） */
    min?: boolean
  }>(),
  { text: '加载中…', inline: false, min: false }
)
</script>
