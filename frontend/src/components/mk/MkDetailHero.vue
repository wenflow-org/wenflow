<template>
  <header class="mk-hero">
    <span v-if="avatar" class="mk-hero__avatar" aria-hidden="true">{{ avatar }}</span>
    <div class="mk-hero__meta">
      <h1 class="mk-hero__title">{{ title }}</h1>
      <p v-if="sub" class="mk-hero__sub">{{ sub }}</p>
      <!-- 功能简介：一句「这个实体做什么」。与 sub 分开两档——
           sub 是身份标签行（谁 · 属于谁 · 哪类），desc 是正文，换行时不该混成一段 -->
      <p v-if="desc" class="mk-hero__desc">{{ desc }}</p>
      <div v-if="$slots.pills" class="mk-hero__pills">
        <slot name="pills" />
      </div>
    </div>
    <div v-if="$slots.actions" class="mk-hero__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 管理端详情页头（newui/admin 原型 hero 形态）：52px 品牌色头像盘 + 页名（h1）+
 * 一行副文 + 可选功能简介 + pills 行（状态/标签）+ 右侧动作区。
 * 分工：顶栏面包屑管寻路（返回钮也在顶栏），本组件是详情页自身的身份区与动作区。
 * 分区切换（二级页签）用 MkSubTabs，置于本组件之下。
 *
 * sub 与 desc 的分工（2026-10-25）：sub 是身份标签（「中文别名 · 归属 · 类别」，一行读完），
 * desc 是功能简介（这个实体做什么，可换行）。列表页只放身份，简介收进详情。
 */
defineProps<{ avatar?: string; title: string; sub?: string; desc?: string }>();
</script>

<style scoped>
.mk-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 2px 2px 0;
}
.mk-hero__avatar {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 20px;
  font-weight: 700;
  /* 饱和实心底上的文字，全主题同值（main.css --mk-on-fill 语义） */
  color: var(--mk-on-fill);
  background: var(--mk-blue);
  flex: none;
}
.mk-hero__meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.mk-hero__title {
  margin: 0;
  /* 与 MkPageHead 同一档（24px = 原型 .hero__meta h1），字重 700 */
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--mk-ink);
  line-height: 1.25;
}
.mk-hero__sub {
  margin: 0;
  font-size: var(--mk-fs-micro, 12px);
  color: var(--mk-muted);
  overflow-wrap: anywhere;
}
/* 功能简介：比身份行重一档（正文色、正文级字号），换行不截断——
   简介被截成一行就只能读个开头，等于没写 */
.mk-hero__desc {
  margin: 0;
  max-width: 78ch;
  font-size: var(--mk-fs-body, 13px);
  color: var(--mk-ink);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.mk-hero__pills {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.mk-hero__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
