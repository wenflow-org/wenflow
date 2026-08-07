// 外挂能力白名单（Addons「外挂能力」页展示口径）。
// 原「额外能力」组件（text-structure-analyzer / retrieval / web-extractor /
// image-analyzer / memory-search / smart-search）经调用调查确认生产零调用，
// 已于 2026-07 退役删除；集合按新定位恢复——后续接入的新能力（如生图、网页搜索，
// 无论以 MCP 工具还是能力 Skill 形态注册）在此登记，管理台自动列出。
// 当前仅 mcp-tool（MCP 工具调用通道）为真实可用项，其余为未来能力占位。
export const EXTRA_CAPABILITY_SKILLS: readonly string[] = [
  'mcp-tool',
  'text-to-image',
  'web-search',
] as const;

const EXTRA_CAPABILITY_SKILL_SET = new Set<string>(EXTRA_CAPABILITY_SKILLS);

export function isExtraCapabilitySkill(skillId: string): boolean {
  return EXTRA_CAPABILITY_SKILL_SET.has(skillId);
}
