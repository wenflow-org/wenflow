import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  /** 危险操作：确认按钮红色；默认 true */
  danger?: boolean
  /** 输入模式：替代 window.prompt，返回输入内容（取消返回 null） */
  input?: { label: string; placeholder?: string }
}

export interface ConfirmState {
  open: boolean
  title: string
  message: string
  confirmText: string
  danger: boolean
  input: { label: string; placeholder?: string } | null
  inputValue: string
  resolve: ((v: boolean | string | null) => void) | null
}

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  message: '',
  confirmText: '确定',
  danger: true,
  input: null,
  inputValue: '',
  resolve: null
})

/** 全局确认对话框：替代 window.confirm / window.prompt，与设计系统一致 */
export function askConfirm(opts: ConfirmOptions): Promise<boolean | string | null> {
  state.title = opts.title
  state.message = opts.message
  state.confirmText = opts.confirmText || '确定'
  state.danger = opts.danger !== false
  state.input = opts.input || null
  state.inputValue = ''
  state.open = true
  return new Promise((resolve) => {
    state.resolve = resolve
  })
}

export function settleConfirm(v: boolean | string | null) {
  state.open = false
  state.resolve?.(v)
  state.resolve = null
}

export const confirmState = state
