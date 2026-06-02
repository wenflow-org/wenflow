export const PLATFORM_CHAIN_SKILLS = [
  'path-scene-framing',
  'stage-designer',
  'virtual-learner-persona-designer',
  'virtual-learner-scenario-designer',
  'virtual-learner-goal-dialogue-simulator',
  'virtual-learner-path-evaluator',
  'virtual-learner-learn-turn-simulator',
  'adaptive-guidance-copy',
  'goal-profile-inference',
  'learning-pattern-distiller',
  'session-knowledge-distiller',
  'dialogue-concept-extractor',
  'label-generator',
] as const

export const EXTRA_CAPABILITY_SKILLS = [
  'text-structure-analyzer',
  'retrieval',
  'web-extractor',
  'image-analyzer',
  'memory-search',
  'smart-search',
] as const

export const PLATFORM_NODE_SKILLS = new Set<string>([
  ...PLATFORM_CHAIN_SKILLS,
])

export const EXTRA_COMPONENT_VISIBLE_SKILLS = new Set<string>([
  ...EXTRA_CAPABILITY_SKILLS,
])
