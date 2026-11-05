/**
 * 推理强度挡位（前端唯一事实源，2026-11-05 二稿）。
 *
 * 一稿把 minimal/low/medium/high/max 五档写成了界面上的固定勾选，等于让平台替
 * 上游定义词表——用户当场指出「写死了五档，但是后面的请求能对上吗，应该放开允许填写挡位，
 * 和具体请求参数」。
 *
 * 现在的模型是：**注册表里填的每个词，就是请求体里 `reasoning_effort` 的取值**，
 * 原样发出，平台不翻译也不改写成自己的词。各家上游词表并不一致（OpenAI 系
 * minimal/low/medium/high，有的只认 low/high，有的用自家 xhigh / dynamic），
 * 所以「这台模型认哪些词」只能由运营在模型设置里逐条填。
 *
 * 本模块只做三件事：
 * - 提供**常见值**（COMMON_REASONING_EFFORTS）用于占位提示与旧数据折算，不作为白名单；
 * - 形态校验（不带空白、短词），拦掉必然发不出去的值；
 * - 把词渲染成人能读的标签（常见词给中文名，其余原样显示）。
 */
export const COMMON_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'max'] as const
export type CommonReasoningEffort = (typeof COMMON_REASONING_EFFORTS)[number]

/** 挡位词形态（与后端 models.config.ts 的 REASONING_EFFORT_PATTERN 同一口径） */
export const REASONING_EFFORT_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,31}$/i

/** 历史三档 = 旧布尔声明（supportsReasoningEffort: true）折算出的挡位 */
export const LEGACY_REASONING_EFFORTS: readonly string[] = ['low', 'high', 'max']

/** 常见词的中文名（只用于展示；不在表里的自定义词原样上屏） */
const COMMON_TEXT: Record<CommonReasoningEffort, { long: string; short: string }> = {
  minimal: { long: '最低（minimal）', short: '最低' },
  low: { long: '低（low）', short: '低' },
  medium: { long: '中（medium）', short: '中' },
  high: { long: '高（high）', short: '高' },
  max: { long: '最高（max）', short: '最高' }
}

function commonOf(token: string): CommonReasoningEffort | null {
  const lowered = token.trim().toLowerCase()
  return (COMMON_REASONING_EFFORTS as readonly string[]).includes(lowered)
    ? (lowered as CommonReasoningEffort)
    : null
}

export function isEffortToken(value: unknown): value is string {
  return typeof value === 'string' && REASONING_EFFORT_PATTERN.test(value.trim())
}

/**
 * 挡位数组归一：去空白、去空项、小写、去重（保上传顺序）。
 * **不过滤未知词**——自定义词正是这个字段存在的理由。
 * 小写与后端 normalizeEffortToken 同一口径：存进去的值要和请求里发出去的是同一个。
 */
export function normalizeEfforts(raw: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const token = item.trim().toLowerCase()
    if (!token || !REASONING_EFFORT_PATTERN.test(token)) continue
    if (!out.includes(token)) out.push(token)
  }
  return out
}

export function effortShortText(token: string): string {
  const common = commonOf(token)
  return common ? COMMON_TEXT[common].short : token
}

export function effortLongText(token: string): string {
  const common = commonOf(token)
  return common ? COMMON_TEXT[common].long : token
}

/** 下拉选项：`defaultLabel` 给「跟随默认」那一项，其余按模型声明顺序展开 */
export function effortOptions(
  levels: readonly string[],
  defaultLabel = '跟随默认'
): Array<{ value: string; label: string }> {
  return [
    { value: 'default', label: defaultLabel },
    ...levels.map((level) => ({ value: level, label: effortLongText(level) }))
  ]
}
