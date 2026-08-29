import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  /** 危险操作：确认按钮红色；默认 true */
  danger?: boolean
  /** 输入模式：替代 window.prompt，返回输入内容（取消返回 null） */
  input?: { label: string; placeholder?: string }
  /** 确认后自动进入 busy 态（按钮禁用 + 文案「处理中…」），由业务在结束后调用 done() 关闭 */
  busy?: boolean
}

export interface ConfirmState {
  open: boolean
  title: string
  message: string
  confirmText: string
  danger: boolean
  input: { label: string; placeholder?: string } | null
  inputValue: string
  /** busy 模式：确认后按钮禁用并显示「处理中…」，业务完成后调用 done() 关闭 */
  busy: boolean
  busyMode: boolean
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
  busy: false,
  busyMode: false,
  resolve: null
})

/**
 * 全局确认对话框：替代 window.confirm / window.prompt，与设计系统一致。
 *
 * 两种用法：
 * 1. 普通模式（默认）：确认/取消立即 settle，调用方 await 结果后自行处理
 * 2. busy 模式（opts.busy = true）：点确认后弹窗进入 busy 态（防重复提交），
 *    业务完成后调用 done() 关闭；弹窗关闭前调用方不应自行清理
 */
export function askConfirm(opts: ConfirmOptions): Promise<boolean | string | null> {
  state.title = opts.title
  state.message = opts.message
  state.confirmText = opts.confirmText || '确定'
  state.danger = opts.danger !== false
  state.input = opts.input || null
  state.inputValue = ''
  state.busyMode = opts.busy === true
  state.busy = false
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

/** busy 模式专用：业务完成后关闭弹窗并 resolve true */
export function doneConfirm() {
  settleConfirm(true)
}

/** busy 模式专用：业务失败后关闭弹窗并 resolve false（调用方自行 toast） */
export function failConfirm() {
  settleConfirm(false)
}

export const confirmState = state
