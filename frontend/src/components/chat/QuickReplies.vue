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
/* 组件自带几何样式：宿主页面的 <style scoped> 只会命中它自己的模板节点，
   够不到子组件内部（scoped 的 data-v 属性不会下传），此前本组件只剩裸 button。
   取值与「目标规划」页的 .replies/.reply 完全一致（蓝 5% 底 + 28% 描边 + blue-deep 文字 +
   6px 前置圆点），保证同一套快选在两处渲染同形。 */
.replies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.replies__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  /* 移动端整行横滑时的原生滚动槽降噪（2026-11-06 审计 §6）：
     细滑块 + 去上下三角箭头，不用 Windows 的 15px 经典槽 */
  scrollbar-width: thin;
}
.replies__row::-webkit-scrollbar { height: 4px; }
.replies__row::-webkit-scrollbar-thumb {
  border-radius: var(--mk-radius-xs);
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}
.replies__row::-webkit-scrollbar-track { background: transparent; }
.reply {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: auto;
  max-width: 100%;
  min-height: 38px;
  padding: 8px 14px;
  border-radius: var(--mk-radius-pill);
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--blue) 28%, transparent);
  background: color-mix(in srgb, var(--blue) 5%, transparent);
  color: var(--blue-deep);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.45;
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.reply::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--blue) 55%, transparent);
}
.reply:hover {
  background: color-mix(in srgb, var(--blue) 11%, transparent);
  border-color: color-mix(in srgb, var(--blue) 46%, transparent);
}
</style>
