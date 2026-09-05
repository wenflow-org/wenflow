import { computed, ref, watch, type ComputedRef } from 'vue'

/**
 * 「加载更多」分页：长列表只渲染前 N 条，滚动/点击加载下一批。
 * source 变化（筛选/刷新）时自动重置回首屏条数。
 */
export function useLoadMore<T>(source: ComputedRef<T[]>, batchSize = 15) {
  const visible = ref(batchSize)
  watch(source, () => {
    visible.value = batchSize
  })
  const shown = computed(() => source.value.slice(0, visible.value))
  const canMore = computed(() => visible.value < source.value.length)
  const loadMore = () => {
    visible.value = Math.min(source.value.length, visible.value + batchSize)
  }
  return { shown, canMore, loadMore }
}
