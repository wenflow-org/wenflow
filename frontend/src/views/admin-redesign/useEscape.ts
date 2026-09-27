import { onBeforeUnmount, onMounted, watch } from 'vue'

/**
 * Escape 关闭浮层：抽屉 / 右侧面板 / 弹窗统一行为
 * - 模块级 LIFO 栈 + 单一全局监听：Esc 只关「栈顶激活中」的浮层，
 *   stopImmediatePropagation/stopPropagation 拦住其余 window 监听（全局快捷键等）。
 *   旧实现各浮层各自监听 window keydown，触发序=挂载序：先挂载的底层浮层先关、
 *   盖在上面的反而后关，一次 Esc 关错层，顺序与直觉相反。
 * - 栈序按「激活时间」而非「挂载时间」：App 启动即挂载的全局 Confirm 平时沉在栈底，
 *   每次打开（active 变 true）时重新置顶，保证视觉上盖在最上面的浮层先响应 Esc。
 */
interface EscapeEntry {
  active: () => boolean
  close: () => void
}

const escapeStack: EscapeEntry[] = []

function onEscapeKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // 从栈顶向下找第一个激活中的浮层：中间可能夹着已关闭未卸载的层，跳过；
  // 一层 Esc 只关一个，剩余层留给下一次按键
  for (let i = escapeStack.length - 1; i >= 0; i--) {
    if (!escapeStack[i].active()) continue
    escapeStack[i].close()
    e.stopImmediatePropagation()
    e.stopPropagation()
    return
  }
}

let listenerBound = false
function ensureGlobalListener() {
  if (listenerBound) return
  listenerBound = true
  window.addEventListener('keydown', onEscapeKey)
}

export function useEscape(active: () => boolean, close: () => void) {
  const entry: EscapeEntry = { active, close }
  // 激活即置顶：常驻挂载的全局 Confirm 每次打开都盖到栈顶（否则挂载序在底，Esc 会先关它上面的抽屉）
  watch(active, (on) => {
    if (!on) return
    const i = escapeStack.indexOf(entry)
    if (i > -1) escapeStack.splice(i, 1)
    escapeStack.push(entry)
  })
  onMounted(() => {
    escapeStack.push(entry)
    ensureGlobalListener()
  })
  onBeforeUnmount(() => {
    const i = escapeStack.indexOf(entry)
    if (i >= 0) escapeStack.splice(i, 1)
  })
}
