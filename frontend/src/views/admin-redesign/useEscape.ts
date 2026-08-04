import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Escape 关闭浮层：抽屉 / 右侧面板 / 弹窗统一行为
 * - stopImmediatePropagation：同一时刻只关最上层的一个浮层，
 *   避免命令面板 + 抽屉同时打开时一次 Esc 全关。
 * - stopPropagation：避免穿透到全局快捷键处理器。
 */
export function useEscape(active: () => boolean, close: () => void) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && active()) {
      close()
      e.stopImmediatePropagation()
      e.stopPropagation()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
