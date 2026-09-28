<!--
  行式列表容器（mk 行级原语之一）：
  把各页自造的行容器（ud-list / ld-sesslist / mr 用户行容器…）收敛为一份：
  发丝线分隔、统一 hover/focus、空态与加载态内建。

  用法：
    <MkRowList :empty="!rows.length" empty-text="暂无教学会话" empty-hint="上课后出现">
      <MkRow v-for="s in rows" :key="s.id" clickable :title="s.topic" :sub="…" :time="s.startAgo" @click="…">
        <template #lead><span class="mk-badge">…</span></template>
      </MkRow>
    </MkRowList>
-->
<template>
  <div class="mk-rows">
    <slot />
    <p v-if="empty && !loading" class="mk-rows__empty">
      {{ emptyText || '暂无记录' }}
      <span v-if="emptyHint" class="mk-rows__hint">{{ emptyHint }}</span>
    </p>
    <div v-else-if="loading" class="mk-rows__loading">
      <MkLoading inline min :text="loadingText || '加载中…'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import MkLoading from './MkLoading.vue'

defineProps<{
  /** 列表为空（且非加载中）时渲染空态行 */
  empty?: boolean
  /** 加载中：优先于空态渲染 */
  loading?: boolean
  emptyText?: string
  emptyHint?: string
  loadingText?: string
}>()
</script>

<style scoped>
.mk-rows { display: grid; }
.mk-rows__empty {
  margin: 0;
  padding: 18px 16px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
}
.mk-rows__hint { display: block; margin-top: 2px; color: var(--mk-faint); }
.mk-rows__loading { padding: 14px 16px; }
</style>
