export const EXTRA_CAPABILITY_SKILLS = [
  'text-structure-analyzer',
  'retrieval',
  'web-extractor',
  'image-analyzer',
  'memory-search',
  'smart-search',
] as const;

const EXTRA_CAPABILITY_SKILL_SET = new Set<string>(EXTRA_CAPABILITY_SKILLS);

export function isExtraCapabilitySkill(skillId: string): boolean {
  return EXTRA_CAPABILITY_SKILL_SET.has(skillId);
}
