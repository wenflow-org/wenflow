// 外挂能力白名单（与后端 skill-component-catalog.ts 同步）。
// 新增能力（生图 / 网页搜索等，MCP 或能力 Skill 形态）在此登记，
// Addons「外挂能力」页自动列出；未注册的项显示「待配置」占位。
export const EXTRA_CAPABILITY_SKILLS: readonly string[] = [
  'mcp-tool',
  'text-to-image',
  'web-search',
] as const

/** 能力展示名与类型（Addons 页使用，单一来源） */
export const EXTRA_CAPABILITY_META: Record<string, { name: string; type: 'mcp' | 'capability' }> = {
  'mcp-tool': { name: 'MCP 工具调用', type: 'mcp' },
  'text-to-image': { name: '生图', type: 'capability' },
  'web-search': { name: '网页搜索', type: 'capability' }
}

export const EXTRA_COMPONENT_VISIBLE_SKILLS = new Set<string>([
  ...EXTRA_CAPABILITY_SKILLS,
])
