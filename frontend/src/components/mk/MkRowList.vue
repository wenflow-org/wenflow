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
    <!-- 行内空态走规范指定的共享类（2026-10-06 审核）：此前自搓 .mk-rows__empty，
         与 .mk-empty--line 并存 → 同屏两种内联空态（左边距/字号/色阶都不同），
         新页面不知道该跟哪一套。ADMIN_VISUAL_LAYER_SPEC §6 指定「筛选后 0 行的
         卡内列表用 .mk-empty--line」。 -->
    <p v-if="empty && !loading" class="mk-empty mk-empty--line">
      {{ emptyText || '暂无记录' }}
      <span v-if="emptyHint" class="mk-rows__hint">{{ emptyHint }}</span>
    </p>
    <div v-else-if="loading" class="mk-rows__loading">
      <MkLoading inline :text="loadingText || '加载中…'" />
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
/* .mk-rows__empty 私有样式已删（2026-10-06 审核）：空态改用共享 .mk-empty--line。
   .mk-rows__hint 保留——它是本原语的空态副行，共享类没有对应钩子。 */
.mk-rows__hint { display: block; margin-top: 2px; color: var(--mk-faint); }
.mk-rows__loading { padding: 14px 16px; }
</style>
