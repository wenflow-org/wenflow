// 手作确认弹窗状态（替代 ElMessageBox，v2 视觉语言）
import { reactive } from 'vue'

export interface ConfirmState {
  visible: boolean
  title: string
  message: string
  confirmText: string
  danger: boolean
  busy: boolean
  onConfirm: (() => Promise<void> | void) | null
  cancel: () => void
  confirm: () => Promise<void> | void
}

export function useUcConfirm() {
  const state = reactive<ConfirmState>({
    visible: false,
    title: '',
    message: '',
    confirmText: '确认',
    danger: false,
    busy: false,
    onConfirm: null,
    cancel: () => {},
    confirm: () => {}
  })

  function openConfirm(
    title: string,
    message: string,
    onConfirm: () => Promise<void> | void,
    options: { confirmText?: string; danger?: boolean } = {}
  ) {
    state.title = title
    state.message = message
    state.confirmText = options.confirmText || '确认'
    state.danger = options.danger ?? false
    state.busy = false
    state.onConfirm = onConfirm
    state.visible = true
  }

  function close() {
    if (state.busy) return
    state.visible = false
  }

  async function confirm() {
    if (!state.onConfirm || state.busy) return
    state.busy = true
    try {
      await state.onConfirm()
      state.visible = false
    } finally {
      state.busy = false
    }
  }

  state.cancel = close
  state.confirm = confirm

  return { state, openConfirm, close }
}
