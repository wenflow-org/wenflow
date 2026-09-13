import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'

/**
 * 响应式窄屏断点（移动端）。
 * 用途：表格在窄屏隐藏非关键列（名称/状态/操作保留），避免 7+ 列全部挤进横向滚动。
 */
export function useIsNarrow(maxWidth = 720): Ref<boolean> {
  const isNarrow = ref(false)
  let mq: MediaQueryList | null = null
  const update = () => { isNarrow.value = !!mq && mq.matches }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    update()
    mq.addEventListener('change', update)
  })
  onBeforeUnmount(() => {
    mq?.removeEventListener('change', update)
  })

  return isNarrow
}
