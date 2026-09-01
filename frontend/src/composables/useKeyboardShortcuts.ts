import { onMounted, onUnmounted } from 'vue'

interface ShortcutConfig {
  /** Key name (case-insensitive comparison) */
  key: string
  /** Require Ctrl (or Meta on Mac) */
  ctrl?: boolean
  /** Require Shift */
  shift?: boolean
  /** Require Alt */
  alt?: boolean
  handler: () => void
  /** Human-readable description for help overlays */
  description: string
}

/**
 * Registers global keyboard shortcuts for a Vue component.
 * Automatically cleans up on unmount.
 *
 * Usage:
 * ```ts
 * useKeyboardShortcuts([
 *   { key: 'Escape', handler: () => stopStreaming(), description: '停止生成' },
 *   { key: 'k', ctrl: true, handler: () => focusSearch(), description: '搜索' },
 * ])
 * ```
 */
export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  function handleKeydown(e: KeyboardEvent) {
    // Ignore events inside input/textarea/select unless explicitly handled
    const tag = (e.target as HTMLElement)?.tagName

    for (const s of shortcuts) {
      const ctrlMatch = s.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
      const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey
      const altMatch = s.alt ? e.altKey : !e.altKey

      if (
        e.key.toLowerCase() === s.key.toLowerCase() &&
        ctrlMatch &&
        shiftMatch &&
        altMatch
      ) {
        e.preventDefault()
        s.handler()
        return
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
}
