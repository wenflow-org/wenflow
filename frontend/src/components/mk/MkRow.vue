<!--
  行（mk 行级原语之一）：
  统一「徽章 + 主标/副行 + 右列时间/操作」这一站内最高发行式结构
  （原 ud-row / ld-sessrow / mr 用户行各写一份）。结构契约：
    lead slot  → 左列徽章/头像（不截断）
    默认 slot  → 主区自定义内容；不传则按 title/sub 渲染（标题+副行，均省略号截断）
    trail slot → 右列时间/操作（不换行）
  clickable=true 渲染 <button>（hover/focus 反馈 + 键盘可达），否则渲染 <div>。
-->
<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="mk-row"
    :class="{ 'mk-row--static': !clickable }"
    @click="clickable && $emit('click', $event)"
  >
    <slot name="lead" />
    <span v-if="$slots.default || title || sub" class="mk-row__main">
      <strong v-if="title || $slots.default" class="mk-row__title" :title="title || undefined">
        <slot>{{ title }}</slot>
      </strong>
      <span v-if="sub" class="mk-row__sub" :title="sub">{{ sub }}</span>
    </span>
    <span v-if="time || $slots.trail" class="mk-row__trail">
      <slot name="trail">{{ time }}</slot>
    </span>
  </component>
</template>

<script setup lang="ts">
defineProps<{
  /** 主标题（不传自定义默认 slot） */
  title?: string
  /** 副行 */
  sub?: string
  /** 右列时间/简文案（自定义走 trail slot） */
  time?: string
  /** 可点行（button 语义，键盘可达） */
  clickable?: boolean
}>()
defineEmits<{ (e: 'click', ev: MouseEvent): void }>()
</script>

<style scoped>
.mk-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border: none;
  border-bottom: 1px solid var(--mk-line, #e6ebf4);
  background: transparent;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.mk-row:last-child { border-bottom: none; }
.mk-row--static { cursor: default; }
.mk-row:hover { background: var(--mk-surface-2, rgba(15, 23, 42, 0.03)); }
.mk-row--static:hover { background: transparent; }
.mk-row:focus-visible { outline: none; box-shadow: var(--mk-focus-ring, inset 0 0 0 2px var(--mk-blue)); }

.mk-row__main { display: grid; gap: 2px; min-width: 0; flex: 1; }
.mk-row__title {
  color: var(--mk-ink);
  font-size: var(--mk-fs-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mk-row__sub {
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mk-row__trail {
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  flex: none;
}
</style>
