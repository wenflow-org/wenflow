import { onBeforeUnmount, onMounted } from 'vue'

/** Escape 关闭浮层：抽屉 / 右侧面板 / 弹窗统一行为 */
export function useEscape(active: () => boolean, close: () => void) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && active()) close()
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
