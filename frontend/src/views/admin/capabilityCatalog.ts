// 原「额外能力」组件已随后端 skill 退役（2026-07）清空。
// 集合保留为空以维持引用点兼容。
export const EXTRA_CAPABILITY_SKILLS: readonly string[] = []

export const EXTRA_COMPONENT_VISIBLE_SKILLS = new Set<string>([
  ...EXTRA_CAPABILITY_SKILLS,
])
