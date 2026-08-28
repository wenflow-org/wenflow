<template>
  <div class="mk-pagination">
    <span v-if="showTotal" class="mk-pagination__total">共 {{ total }} 条</span>
    <select
      v-if="!hideSize"
      class="mk-pagination__size mono"
      :value="pageSize"
      :disabled="loading"
      aria-label="每页条数"
      @change="onSizeChange"
    >
      <option v-for="s in sizes" :key="s" :value="s">{{ s }}条/页</option>
    </select>
    <div class="mk-pagination__nav">
      <button
        type="button"
        class="mk-pagination__btn"
        :disabled="page <= 1 || loading"
        @click="$emit('update:page', page - 1)"
      >
        上一页
      </button>
      <span class="mk-pagination__page">第 {{ page }} / {{ totalPages }} 页</span>
      <button
        type="button"
        class="mk-pagination__btn"
        :disabled="page >= totalPages || loading"
        @click="$emit('update:page', page + 1)"
      >
        下一页
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { totalPagesOf } from './live'

const props = withDefaults(
  defineProps<{
    page: number
    total: number
    pageSize: number
    loading?: boolean
    showTotal?: boolean
    /** 固定每页行数场景（如字段路由表 15 行/页）：隐藏每页条数下拉，页码器形态不变 */
    hideSize?: boolean
    sizes?: number[]
  }>(),
  {
    loading: false,
    showTotal: false,
    hideSize: false,
    sizes: () => [15, 30, 50, 100]
  }
)

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [size: number]
}>()

const totalPages = computed(() => totalPagesOf(props.total, props.pageSize))

function onSizeChange(e: Event) {
  emit('update:pageSize', Number((e.target as HTMLSelectElement).value))
}

/* 自动收敛越界页码：自动刷新/数据变化导致 total 缩小、当前页超出总页数时，
   回落到最后一页（父组件收到 update:page 后重查），避免停在「第 5 / 3 页」 */
watch(
  () => [props.page, props.total, props.pageSize],
  () => {
    const real = totalPagesOf(props.total, props.pageSize)
    if (props.page > real) emit('update:page', real)
  },
  { immediate: true }
)
</script>

<style scoped>
.mk-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 14px 12px;
  border-top: 1px dashed var(--mk-line);
  font-size: 12px;
  color: var(--mk-muted);
}
.mk-pagination__total {
  color: var(--mk-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mk-pagination__size {
  padding: 5px 8px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  color: var(--mk-ink);
  font-size: 11.5px;
  cursor: pointer;
}
.mk-pagination__nav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mk-pagination__btn {
  padding: 5px 12px;
  border: 1px solid var(--mk-line);
  border-radius: 8px;
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.mk-pagination__btn:hover:not(:disabled) {
  border-color: rgba(44, 99, 208, 0.4);
  color: var(--mk-blue);
}
.mk-pagination__btn:disabled {
  color: var(--mk-faint);
  cursor: not-allowed;
  background: #f8fafc;
}
.mk-pagination__page {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 大屏/4K 适配（全站 mk 体系档位） */
@media (min-width: 2000px) {
  .mk-pagination { font-size: 13px; gap: 12px; padding: 12px 18px 14px; }
  .mk-pagination__total { font-size: 13px; }
  .mk-pagination__size { font-size: 13px; padding: 6px 10px; border-radius: 10px; }
  .mk-pagination__btn { font-size: 13px; padding: 6px 14px; }
}
@media (min-width: 3600px) {
  .mk-pagination { font-size: 15.5px; }
  .mk-pagination__total { font-size: 15.5px; }
  .mk-pagination__size { font-size: 15.5px; }
  .mk-pagination__btn { font-size: 15.5px; }
}
</style>
