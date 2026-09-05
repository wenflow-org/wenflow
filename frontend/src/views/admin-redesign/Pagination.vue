<template>
  <div class="mk-pagination">
    <span class="mk-pagination__total">
      <template v-if="showTotal">共 {{ total }} 条 · </template>第 <strong>{{ page }}</strong> / {{ totalPages }} 页
    </span>
    <span class="mk-pagination__right">
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
        <template v-for="(n, i) in pageItems" :key="i">
          <span v-if="n === '…'" class="mk-pagination__ellipsis" aria-hidden="true">…</span>
          <button
            v-else
            type="button"
            class="mk-pagination__num"
            :class="{ 'mk-pagination__num--active': n === page }"
            :disabled="loading || n === page"
            :aria-current="n === page ? 'page' : undefined"
            :aria-label="`第 ${n} 页`"
            @click="$emit('update:page', n)"
          >
            {{ n }}
          </button>
        </template>
        <button
          type="button"
          class="mk-pagination__btn"
          :disabled="page >= totalPages || loading"
          @click="$emit('update:page', page + 1)"
        >
          下一页
        </button>
      </div>
    </span>
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

/* 页码按钮序列（AntD 风格折叠）：≤7 页全显；>7 页显示 1 … p-1 p p+1 … N */
const pageItems = computed<(number | '…')[]>(() => {
  const n = totalPages.value
  const p = props.page
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  const around = [p - 1, p, p + 1].filter((x) => x > 1 && x < n)
  const items: (number | '…')[] = [1]
  if (around[0] > 2) items.push('…')
  items.push(...around)
  if (around[around.length - 1] < n - 1) items.push('…')
  items.push(n)
  return items
})

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
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 9px 14px 11px;
  border-top: 1px solid var(--mk-line);
  font-size: var(--mk-fs-12_5);
  color: var(--mk-muted);
}
.mk-pagination__total {
  color: var(--mk-faint);
  font-size: var(--mk-fs-12_5);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.mk-pagination__total strong {
  color: var(--mk-ink);
  font-weight: 700;
}
.mk-pagination__right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.mk-pagination__size {
  padding: 4px 8px;
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: var(--mk-surface);
  color: var(--mk-muted);
  font-size: var(--mk-fs-12);
  cursor: pointer;
  transition: border-color 0.12s;
}
.mk-pagination__size:hover { border-color: rgba(44, 99, 208, 0.4); }
.mk-pagination__nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mk-pagination__btn,
.mk-pagination__num {
  min-width: 30px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--mk-line);
  border-radius: 6px;
  background: var(--mk-surface);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-12_5);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.mk-pagination__btn:hover:not(:disabled),
.mk-pagination__num:hover:not(:disabled):not(.mk-pagination__num--active) {
  border-color: rgba(44, 99, 208, 0.55);
  color: var(--mk-blue);
  background: var(--mk-blue-bg);
}
.mk-pagination__btn:disabled {
  color: var(--mk-faint);
  cursor: not-allowed;
  background: transparent;
}
/* 当前页码：实心蓝（AntD Pagination active 形态） */
.mk-pagination__num--active {
  background: var(--mk-blue);
  border-color: var(--mk-blue);
  color: #fff;
  cursor: default;
  font-weight: 700;
}
.mk-pagination__ellipsis {
  min-width: 22px;
  text-align: center;
  color: var(--mk-faint);
  user-select: none;
}

/* 大屏/4K 适配（全站 mk 体系档位） */
@media (min-width: 2000px) {
  .mk-pagination { font-size: 13px; gap: 12px; padding: 11px 18px 13px; }
  .mk-pagination__total { font-size: 13px; }
  .mk-pagination__size { font-size: 13px; padding: 5px 10px; border-radius: 7px; }
  .mk-pagination__btn, .mk-pagination__num { font-size: 13px; min-width: 32px; height: 32px; padding: 0 10px; }
}
@media (min-width: 3600px) {
  .mk-pagination { font-size: 15.5px; }
  .mk-pagination__total { font-size: 15.5px; }
  .mk-pagination__size { font-size: 15.5px; }
  .mk-pagination__btn { font-size: 15.5px; }
}
</style>
