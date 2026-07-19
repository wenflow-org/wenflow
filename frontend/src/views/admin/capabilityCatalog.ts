export const EXTRA_CAPABILITY_SKILLS = [
  'text-structure-analyzer',
  'retrieval',
  'web-extractor',
  'image-analyzer',
  'memory-search',
  'smart-search',
] as const

export const EXTRA_COMPONENT_VISIBLE_SKILLS = new Set<string>([
  ...EXTRA_CAPABILITY_SKILLS,
])
