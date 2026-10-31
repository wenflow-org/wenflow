/**
 * 复制到剪贴板（管理端共用）：
 * navigator.clipboard 在 http 非安全上下文不存在或被权限拒绝——先走 Clipboard API，
 * 失败回退 execCommand('copy')，两者都失败返回 false 由调用方明示（绝不静默失败，
 * 用户至少能拿到原文手动复制）。判例同 ExecLogs 的 trace 复制。
 */
export function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 落到 execCommand 兜底 */
  }
  return legacyCopy(text)
}
