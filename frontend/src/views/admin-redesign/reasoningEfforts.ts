/**
 * 推理强度挡位词表（前端唯一事实源，2026-11-05）。
 *
 * 为什么是「逐模型一组挡位」而不是一个布尔：挡位词表本来就是上游的——OpenAI 系是
 * minimal/low/medium/high，有的模型只认 low/high，有的连 `reasoning_effort` 这个字段都没有。
 * 平台此前把 low/high/max 三档写死在界面与校验里，勾一个「支持推理强度」就等于宣称这三档
 * 都可用，而其中可能有上游根本不认的档位（用户 2026-11-05「不同模型强度挡位也不一样啊」）。
 *
 * 现在注册表逐模型声明 `reasoningEfforts`，界面只呈现这台模型声明过的那几档：
 * 模型编辑弹层勾挡位、生成参数的下拉、Skill 运行时的下拉都从这里取值。
 * 顺序即上屏顺序（与后端 REASONING_EFFORT_LEVELS 一致）。
 */
export const REASONING_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'max'] as const
export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number]

/** 档位文案：长版给下拉（带上游原词，运维看得懂请求里发的是哪个），短版给勾选标签 */
const EFFORT_TEXT: Record<ReasoningEffortLevel, { long: string; short: string }> = {
  minimal: { long: '最低（minimal）', short: '最低' },
  low: { long: '低（low）', short: '低' },
  medium: { long: '中（medium）', short: '中' },
  high: { long: '高（high）', short: '高' },
  max: { long: '最高（max）', short: '最高' }
}

/** 历史三档 = 旧布尔声明折算出的挡位（与后端 LEGACY_REASONING_EFFORTS 对齐） */
export const LEGACY_REASONING_EFFORTS: readonly ReasoningEffortLevel[] = ['low', 'high', 'max']

export function isEffortLevel(value: unknown): value is ReasoningEffortLevel {
  return typeof value === 'string' && (REASONING_EFFORT_LEVELS as readonly string[]).includes(value)
}

/** 把任意来源的挡位数组归一：只留词表内的词、按词表顺序、去重 */
export function normalizeEfforts(raw: readonly unknown[] | null | undefined): ReasoningEffortLevel[] {
  if (!Array.isArray(raw)) return []
  return REASONING_EFFORT_LEVELS.filter((level) => raw.includes(level))
}

export function effortShortText(level: string): string {
  return isEffortLevel(level) ? EFFORT_TEXT[level].short : level
}

export function effortLongText(level: string): string {
  return isEffortLevel(level) ? EFFORT_TEXT[level].long : level
}

/** 下拉选项：`defaultLabel` 给「跟随默认」那一项，其余按模型声明顺序展开 */
export function effortOptions(
  levels: readonly ReasoningEffortLevel[],
  defaultLabel = '跟随默认'
): Array<{ value: ReasoningEffortLevel | 'default'; label: string }> {
  return [
    { value: 'default', label: defaultLabel },
    ...levels.map((level) => ({ value: level, label: EFFORT_TEXT[level].long }))
  ]
}
