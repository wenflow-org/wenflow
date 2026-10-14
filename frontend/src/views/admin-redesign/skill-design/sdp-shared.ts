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

/** core.yaml 输入声明（试跑默认载荷只读 name/type 两个字段） */
export interface TrialInputDecl {
  name?: string
  type?: string
}

/** 单类型示例值：只求「形状合法」，不编造具体内容 */
function trialExampleValue(type: string): unknown {
  const base = type.replace(/\?$/, '').trim()
  if (/\[\]$/.test(base) || /^array/i.test(base)) return []
  if (/^(object|record|map)$/i.test(base)) return {}
  if (/^(number|integer|float)$/i.test(base)) return 0
  if (/^(boolean|bool)$/i.test(base)) return false
  return ''
}

/**
 * 按 Skill 输入契约（core.yaml inputs）生成试跑默认载荷。
 *
 * 背景（#15）：此前默认载荷硬编码 `{"input": "用一句话介绍你自己"}`，与大多数 Skill 的输入契约
 * 不符（如 stage-designer 要求 `milestone`），点「运行预览」必然以 INVALID_INPUT 失败。
 * 现只收必填（type 不以 `?` 结尾）且有 name 的输入，按其类型给形状示例；无声明时返回 `{}`，
 * 不再塞一个与契约无关的 `input` 键。
 */
export function buildTrialInputFromContract(inputs: ReadonlyArray<TrialInputDecl> | null | undefined): string {
  const payload: Record<string, unknown> = {}
  for (const item of inputs || []) {
    const name = String(item?.name || '').trim()
    if (!name) continue
    const type = String(item?.type || '').trim()
    if (type.endsWith('?')) continue // 可选输入不注入
    payload[name] = trialExampleValue(type)
  }
  return JSON.stringify(payload, null, 2)
}
