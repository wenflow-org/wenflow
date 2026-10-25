/**
 * 插件目录（服务端唯一分组表，2026-10-24）。
 *
 * 插件 = 能力 bundle，成员是运行时 Skill。前端 `capabilityCatalog.ts` 是同一份分组的展示版；
 * 停用插件时由 `executeSkillWithResult` 统一拦截成员 Skill（handlers 不各自判断）。
 * 新增/调整分组时两处同步，成员 id 必须与 `src/skills` 的 handler 名一致。
 */
export type PluginId = 'web' | 'decision' | 'image' | 'mcp';

export interface PluginCatalogEntry {
  id: PluginId;
  name: string;
  skills: readonly string[];
}

export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [
  { id: 'web', name: '联网', skills: ['web-search', 'web-fetch', 'material-collector'] },
  { id: 'decision', name: '决策', skills: ['decision-gate'] },
  { id: 'image', name: '生图', skills: ['text-to-image'] },
  { id: 'mcp', name: 'MCP 工具调用', skills: ['mcp-tool'] },
];

const PLUGIN_BY_SKILL = new Map<string, PluginId>();
for (const group of PLUGIN_CATALOG) {
  for (const skillId of group.skills) PLUGIN_BY_SKILL.set(skillId, group.id);
}

export function pluginIdOfSkill(skillId: string): PluginId | null {
  return PLUGIN_BY_SKILL.get(skillId.replace(/^skill:/, '')) ?? null;
}

export function pluginNameOf(id: PluginId): string {
  return PLUGIN_CATALOG.find((g) => g.id === id)?.name ?? id;
}

export function isKnownPluginId(value: string): value is PluginId {
  return PLUGIN_CATALOG.some((g) => g.id === value);
}
