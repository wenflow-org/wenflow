// 原「额外能力」组件（text-structure-analyzer / retrieval / web-extractor /
// image-analyzer / memory-search / smart-search）经调用调查确认生产零调用，
// 已于 2026-07 退役删除。集合保留为空以维持 isExtraCapabilitySkill 调用点兼容。
export const EXTRA_CAPABILITY_SKILLS: readonly string[] = [] as const;

const EXTRA_CAPABILITY_SKILL_SET = new Set<string>(EXTRA_CAPABILITY_SKILLS);

export function isExtraCapabilitySkill(skillId: string): boolean {
  return EXTRA_CAPABILITY_SKILL_SET.has(skillId);
}
