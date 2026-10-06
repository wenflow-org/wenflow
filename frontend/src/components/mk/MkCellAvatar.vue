<!--
  表格/卡片行的首字母头像（mk 单元格原语之一）：
  收敛 Users.ul-ava / GoalConversations.gc-ava / MemoryReview.mr__ava 三份同形私有实现。
  tone 语义与全站数据隔离标记一致：default 真实用户（蓝）/ virtual 虚拟学习者（紫）/
  test 测试账号（琥珀）/ muted 未知或已删（灰）。
  注：VirtualLearners 的 vl-avatar 是「身份哈希 8 色」，属另一套刻意设计，不并入本原语。
-->
<template>
  <i class="mk-ava" :class="`mk-ava--${tone}`" :style="size ? { width: size + 'px', height: size + 'px' } : undefined" aria-hidden="true">{{ initial }}</i>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 取首字母；空名回落「用」 */
  name?: string | null
  tone?: 'default' | 'virtual' | 'test' | 'muted'
  /** 边长 px，默认 28 */
  size?: number
}>()

const initial = computed(() => (props.name || '用').trim().charAt(0) || '用')
</script>

<style scoped>
.mk-ava {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  font-style: normal;
  /* 走文本三档的微字档（2026-10-06 审核 §主题 6）：原为硬编码 12px，
     在各档位（1440→12.5 / 1920→13 / 2800→15.5）下不成档，是全站「档外字号」
     量测的长尾来源之一。 */
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  background: color-mix(in srgb, var(--mk-blue) 12%, transparent);
  color: var(--mk-accent-deep);
}
.mk-ava--virtual { background: color-mix(in srgb, var(--mk-purple) 14%, transparent); color: var(--mk-purple); }
.mk-ava--test { background: color-mix(in srgb, var(--mk-amber) 14%, transparent); color: var(--mk-amber); }
.mk-ava--muted { background: var(--mk-surface-2); color: var(--mk-faint); }
html[data-theme='dark'] .mk-ava { color: var(--mk-ink); }
html[data-theme='dark'] .mk-ava--muted { color: var(--mk-faint); }
</style>
