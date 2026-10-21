// 插件白名单（与后端 skill-component-catalog.ts 同步）。
//
// 2026-10-20 用户拍板：用户可见的「外挂能力」统一叫「插件」。插件是能力 bundle，
// 成员是运行时 Skill；启停插件不改变主流程结构——下面每组的 fallback 写的是
// 后端真实兜底，不是产品愿望：
//   - 联网：material-collector 检索/抓取失败显式返回 not_found，不用模型记忆冒充资料；
//     path.coordinator 的 resolveMaterialPacks 对采集失败 fail-open。
//   - 决策：material-quality-gate 在 DECISION_DISABLED / 调用异常时返回 null，按放行处理。
//   - 生图：teaching-visual.service 捕获生成失败后返回 null，不阻断课堂。
//   - MCP：executeMcpTool 对停用服务返回 MCP_TOOL_DISABLED，调用方按各自失败策略继续。
export type PluginId = 'web' | 'decision' | 'image' | 'mcp'

export interface PluginMember {
  id: string
  name: string
}

export interface PluginGroup {
  id: PluginId
  name: string
  glyph: string
  description: string
  members: readonly PluginMember[]
  /** 能力不可用时主流程怎么走（后端实际兜底） */
  fallback: string
  /** 详情/配置抽屉与日志的默认入口 */
  primary: string
}

export const PLUGIN_GROUPS: readonly PluginGroup[] = [
  {
    id: 'web',
    name: '联网',
    glyph: '联',
    description: '在目标对话与资料采集时检索、抓取外部网页。',
    members: [
      { id: 'web-search', name: '网页搜索' },
      { id: 'web-fetch', name: '网页抓取' },
      { id: 'material-collector', name: '资料采集' },
    ],
    fallback: '检索或抓取失败时资料包标为未找到，不用模型记忆冒充资料。路径按无外部资料继续生成。',
    primary: 'web-search',
  },
  {
    id: 'decision',
    name: '决策',
    glyph: '决',
    description: '对资料质量等边界判断做结构化打分。',
    members: [{ id: 'decision-gate', name: '决策判断' }],
    fallback: '决策不可用时资料质量闸门按放行处理，不阻塞路径生成。',
    primary: 'decision-gate',
  },
  {
    id: 'image',
    name: '生图',
    glyph: '图',
    description: '为课堂与课程材料生成配图。',
    members: [{ id: 'text-to-image', name: '文生图' }],
    fallback: '生成失败时该图留空，课堂继续，不阻断教学。',
    primary: 'text-to-image',
  },
  {
    id: 'mcp',
    name: 'MCP 工具调用',
    glyph: 'M',
    description: '通过 MCP 协议调用平台登记的外部服务。',
    members: [{ id: 'mcp-tool', name: 'MCP 工具调用' }],
    fallback: '停用的服务不参与调用。依赖它的插件收到不可用错误，按各自失败策略继续。',
    primary: 'mcp-tool',
  },
]

/** 插件成员 Skill（健康中心 / Skill 目录 / 运行时统计共用同一集合） */
export const EXTRA_CAPABILITY_SKILLS: readonly string[] = PLUGIN_GROUPS.flatMap(
  (group) => group.members.map((member) => member.id),
)

/** 能力展示名与类型（Addons 页使用，单一来源） */
export const EXTRA_CAPABILITY_META = Object.fromEntries(
  PLUGIN_GROUPS.flatMap((group) =>
    group.members.map((member) => [
      member.id,
      {
        name: member.name,
        type: group.id === 'mcp' ? ('mcp' as const) : ('capability' as const),
      },
    ]),
  ),
) as Record<string, { name: string; type: 'mcp' | 'capability' }>

export const EXTRA_COMPONENT_VISIBLE_SKILLS = new Set<string>(EXTRA_CAPABILITY_SKILLS)
