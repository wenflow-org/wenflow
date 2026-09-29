<template>
  <header class="mk-pagehead">
    <div class="mk-pagehead__text">
      <h1 class="mk-pagehead__title" :title="hint || undefined">{{ title }}</h1>
      <p v-if="sub" class="mk-pagehead__sub">{{ sub }}</p>
    </div>
    <div v-if="$slots.actions" class="mk-pagehead__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 管理端页头（newui/admin 原型 pagehead 形态）：页标题（h1）+ 一行口径副文 + 右侧动作区。
 * 与顶栏面包屑的分工：面包屑负责「我在哪」（寻路），页头负责「这页是什么 + 主操作」。
 * 状态条（mk-status）继续承载系统/加载状态时，页头只放标题与口径，不重复状态文案。
 * hint：挂在页名上的悬停口径（长口径不宜直接当可见副文时用，如 MemoryReview 的 scope 说明）。
 */
defineProps<{ title: string; sub?: string; hint?: string }>();
</script>

<style scoped>
.mk-pagehead {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 2px 2px 0;
}
.mk-pagehead__text { min-width: 0; }
.mk-pagehead__title {
  margin: 0;
  font-size: var(--mk-fs-20, 20px);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--mk-ink);
  line-height: 1.25;
}
.mk-pagehead__sub {
  margin: 4px 0 0;
  font-size: var(--mk-fs-micro, 12px);
  color: var(--mk-muted);
  max-width: 66ch;
}
.mk-pagehead__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
