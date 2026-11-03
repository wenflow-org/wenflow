/**
 * SkillDesignPage 拆分后的共享小件：
 * - coreEditorState：协议编辑器脏态（页面主组件守卫 + 协议子组件共享的路由级单例）
 * - 纯函数工具（shortHash/fmtMs/errText 等），供各 tab 子组件复用
 */
import { reactive } from 'vue'
import { humanizeHttpError, errorCodeLabel } from '../terms'
import { errorCategoryText } from '../statusText'

/** 协议编辑器脏态（仅设计页路由级实例存在，跨组件共享给路由守卫使用） */
export const coreEditorState = reactive({
  dirty: false
})

/**
 * 短哈希展示：**超过 n 位才截断加省略号**。
 * 2026-11-02 评审：工程页的文件哈希（base36，可能只有 6 位）与版本页的核心哈希
 * 一个裸截断、一个带省略号，同一类读数两种写法。六个字符的短哈希贴个省略号，
 * 又会被读成「后面还有没显示的内容」，所以统一成「够长才截」。
 */
export const shortHash = (v?: string | null, n = 12) => (v ? (v.length > n ? `${v.slice(0, n)}…` : v) : '—')
export const coreShortHash = (hash?: string | null, n = 10) => (hash ? (hash.length > n ? `${hash.slice(0, n)}…` : hash) : '—')
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

/**
 * 失败行的人话标题（判例 SkillDetail.recentRowText）：错误类别人话优先，其次错误码字典，
 * 最后兜底「执行失败」——原始错误码不直出给运营。
 *
 * 2026-11-02 评审：同一条失败调用在试跑页显示原始错误码
 * （TEACHING_TURN_REPLY_COMPLETION_MISMATCH）、在运行时页显示「执行失败 · 系统内部错误」，
 * 同一事实两个说法。两页共用这一份。
 */
export function failureText(category?: string | null, code?: string | null): string {
  // 兜底类别 'error' 的字典值是「失败」：与前缀重复，按无类别处理（不渲染「执行失败 · 失败」）
  const cat = errorCategoryText(category)
  if (cat && cat !== '失败') return `执行失败 · ${cat}`
  const label = errorCodeLabel(code || undefined)
  return label ? `执行失败 · ${label}` : '执行失败'
}

/**
 * 调用发生时间：同日只给时:分，跨天带月-日（等宽数字，避免行内抖动）。
 *
 * 2026-11-02 评审：同一条记录在试跑页写「1 天前」、在运行时页写「11-01 13:22」——
 * 一处相对、一处绝对。现在两页共用这一份，完整时刻走 callTimeFull 进悬停。
 */
export function callTimeLabel(ts: number): string {
  if (!ts || Number.isNaN(ts)) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hm : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
}
export function callTimeFull(ts: number): string {
  if (!ts || Number.isNaN(ts)) return ''
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
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

/**
 * 生成参数的来源码（后端 resolve-llm-call-params 的 LlmParamSource 枚举）→ 人话。
 * 这些码只在接口里存在：直接渲染会露出 active-prompt / route-fallback 这类黑话
 * （2026-10-19 走查实测：胶囊里就写着 active-prompt、topP 那格写着 none）。
 * 未知码原样返回（宁可露码，也不把来源藏掉）。
 */
const CALL_PARAM_SOURCES: Record<string, string> = {
  'runtime-override': '调用时指定',
  'skill-override': '本 Skill 覆盖',
  'active-prompt': 'Prompt 文件声明',
  'code-defaults': '代码默认',
  'route-fallback': '路由表',
  none: '未设',
  // 契约服务（skill-runtime-contract）的同族码，走同一张表免得再漏
  route: '路由表',
  'agent-or-platform': 'Agent / 平台默认',
  'platform-default': '平台默认',
  unresolved: '未解析'
}

export const callParamSourceLabel = (raw?: string | null): string =>
  raw ? CALL_PARAM_SOURCES[raw] ?? raw : '—'

/**
 * 思考配置与模型能力的冲突提示（2026-10-24）。
 *
 * 能力声明是唯一事实源（llm-providers.json 的 supportsThinking / supportsReasoningEffort）：
 * 网关按能力裁剪请求体，不支持思考的模型不会收到 thinking / reasoning_effort 字段。
 * 但裁剪是静默的——页面写「开启」、上游没收到，运营无从判断。这里把冲突说在配置处。
 * cap 为 null = 模型不在目录（自定义通道/历史值），不猜，也不提示。
 */
export interface ThinkingCapability { thinking: boolean; reasoning: boolean }
export function thinkingCapabilityNotice(
  intent: { thinkingMode?: string | null; reasoningEffort?: string | null },
  cap: ThinkingCapability | null | undefined
): string {
  if (!cap) return ''
  const mode = String(intent.thinkingMode || 'default')
  const effort = String(intent.reasoningEffort || 'default')
  if (mode === 'enabled' && !cap.thinking) {
    return '当前模型不支持思考，开启后不会发送思考参数'
  }
  if (mode !== 'disabled' && effort !== 'default' && !cap.reasoning) {
    return '当前模型不支持推理强度，该档位不会发送'
  }
  return ''
}

/** core.yaml 输入声明（试跑默认载荷只读 name/type 两个字段） */
export interface TrialInputDecl {
  name?: string
  type?: string
}

/**
 * 协议页「表单视图」的输出字段形状。
 * enumValues / properties 表单不编辑，但必须随行透传：否则「无编辑保存」时后端语义等价守卫
 * （coreFileSemanticallyEqual）会判不等，走到全量序列化把嵌套子字段 schema 静默删掉（#9）。
 */
export interface CoreFormField {
  name: string
  baseType: string
  optional: boolean
  desc: string
  turn: boolean
  enumValues?: string[]
  properties?: CoreFormField[]
}

/** CoreFile 字段 → 表单字段（递归；编辑位映射，enumValues/properties 原样透传） */
export function toFormField(f: unknown): CoreFormField {
  const item = (f || {}) as Record<string, unknown>
  const rawType = String(item.type || 'string')
  const out: CoreFormField = {
    name: String(item.name || ''),
    baseType: rawType.replace(/\?$/, ''),
    optional: rawType.endsWith('?'),
    desc: String(item.desc || ''),
    turn: item.turn === true
  }
  if (Array.isArray(item.enumValues) && item.enumValues.length) {
    out.enumValues = item.enumValues.map((v) => String(v))
  }
  if (Array.isArray(item.properties) && item.properties.length) {
    out.properties = item.properties.map(toFormField)
  }
  return out
}

/** 表单字段 → core 载荷字段（递归）：与 toFormField 成对，保证装载→回写往返不丢字段（#9） */
export function toCoreFieldPayload(item: CoreFormField): Record<string, unknown> {
  return {
    name: item.name,
    type: `${item.baseType}${item.optional ? '?' : ''}`,
    desc: item.desc,
    turn: item.turn,
    ...(item.enumValues && item.enumValues.length ? { enumValues: item.enumValues } : {}),
    ...(item.properties && item.properties.length
      ? { properties: item.properties.map(toCoreFieldPayload) }
      : {})
  }
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
