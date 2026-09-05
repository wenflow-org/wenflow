/**
 * SkillDesignPage 拆分后的共享小件：
 * - coreEditorState：协议编辑器脏态（页面主组件守卫 + 协议子组件共享的路由级单例）
 * - 纯函数工具（shortHash/fmtMs/errText 等），供各 tab 子组件复用
 */
import { reactive } from 'vue'
import { humanizeHttpError } from '../terms'

/** 协议编辑器脏态（仅设计页路由级实例存在，跨组件共享给路由守卫使用） */
export const coreEditorState = reactive({
  dirty: false
})

export const shortHash = (v?: string | null) => (v ? v.slice(0, 12) : '—')
export const coreShortHash = (hash?: string | null) => (hash ? `${hash.slice(0, 10)}…` : '—')
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
/**
 * 错误提取 + 网关黑话人话化（terms.ts 单源）：
 * - 429 →「请求过于频繁，请稍后重试」
 * - "API request failed with status 404"（网关原文）→「上游服务异常（HTTP 404）」
 */
export const errText = (e: unknown) => {
  const r = e as { response?: { data?: { error?: { message?: string } | string }; status?: number }; message?: string }
  const d = r?.response?.data?.error
  const message = typeof d === 'string' ? d : d?.message || r?.message || ''
  return humanizeHttpError(message, r?.response?.status) || message || '未知错误'
}
