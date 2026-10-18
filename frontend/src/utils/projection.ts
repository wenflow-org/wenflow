/**
 * 投影凭据（管理端签名后以学习者身份浏览）的本地存放：**sessionStorage**。
 *
 * 为何不用 localStorage（#97 安全项）：
 * - 投影 token 等价于一张 30 分钟有效的用户身份凭据，落在 localStorage 会跨页签、
 *   跨浏览器重启长期残留，任何同源脚本/残留页面都能取用；
 * - sessionStorage 随标签页会话销毁（关页签即失效），且浏览器在 window.open / target=_blank
 *   打开新页签时会把 opener 的 sessionStorage 复制过去，
 *   「管理端签发 → 新页签以用户身份浏览」的既有链路照常工作。
 *
 * 兼容旧版：老实现写在 localStorage 的同名键（token + context）不迁移、只清除——
 * 迁移会把旧残留继续带下去，与本次收紧的目标相反。
 */
const PROJECTION_TOKEN_KEY = 'projection_token'
const PROJECTION_CONTEXT_KEY = 'projection_context'

/** 清除旧版留在 localStorage 的投影键（幂等；隐私模式取不到存储则跳过） */
const purgeLegacyLocalStorageKeys = () => {
  try {
    localStorage.removeItem(PROJECTION_TOKEN_KEY)
    localStorage.removeItem(PROJECTION_CONTEXT_KEY)
  } catch {
    /* 存储被禁用：无残留可清 */
  }
}

export const getProjectionToken = (): string | null => {
  purgeLegacyLocalStorageKeys()
  return sessionStorage.getItem(PROJECTION_TOKEN_KEY)
}

export const setProjectionToken = (token: string, context?: unknown) => {
  purgeLegacyLocalStorageKeys()
  sessionStorage.setItem(PROJECTION_TOKEN_KEY, token)
  if (context) {
    sessionStorage.setItem(PROJECTION_CONTEXT_KEY, JSON.stringify(context))
  }
}

export const clearProjectionToken = () => {
  sessionStorage.removeItem(PROJECTION_TOKEN_KEY)
  sessionStorage.removeItem(PROJECTION_CONTEXT_KEY)
  purgeLegacyLocalStorageKeys()
}

export const getProjectionContext = () => {
  const raw = sessionStorage.getItem(PROJECTION_CONTEXT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const isProjectionMode = () => Boolean(getProjectionToken())
