/**
 * SkillDesignPage 拆分后的共享小件：
 * - coreEditorState：协议编辑器脏态（页面主组件守卫 + 协议子组件共享的路由级单例）
 * - 纯函数工具（shortHash/fmtMs/errText 等），供各 tab 子组件复用
 */
import { reactive } from 'vue'

/** 协议编辑器脏态（仅设计页路由级实例存在，跨组件共享给路由守卫使用） */
export const coreEditorState = reactive({
  dirty: false
})

export const shortHash = (v?: string | null) => (v ? v.slice(0, 12) : '—')
export const coreShortHash = (hash?: string | null) => (hash ? `${hash.slice(0, 10)}…` : '—')
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
export const errText = (e: unknown) => {
  const r = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string }
  const d = r?.response?.data?.error
  return typeof d === 'string' ? d : d?.message || r?.message || '未知错误'
}
