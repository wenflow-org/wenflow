/**
 * teaching-strategy-selector Skill
 *
 * 教学策略选择器。
 * 根据知识类型映射推荐教学策略，处理策略别名标准化，
 * 并构建教学策略引导 prompt。
 */

import { SkillDefinition, SkillExecutionResult } from '../protocol'

export const LEARNING_STRATEGY_SELECTOR_PROMPT = ''

const ALLOWED_PEDAGOGY_STRATEGIES = ['explain', 'demonstrate', 'scaffold', 'drill', 'diagnose', 'feedback', 'motivate', 'reflect'] as const
type AllowedPedagogyStrategy = typeof ALLOWED_PEDAGOGY_STRATEGIES[number]

const STRATEGY_ALIAS_CONFIG: Record<string, string> = {
  explanation: 'explain', explaination: 'explain',
  example: 'demonstrate', examples: 'demonstrate', workexample: 'demonstrate', 'worked-example': 'demonstrate',
  scaffolding: 'scaffold', scaffolded: 'scaffold', coaching: 'scaffold',
  practice: 'drill', retrieval: 'drill', 'retrieval-practice': 'drill',
  diagnosis: 'diagnose', diagnostic: 'diagnose',
  correction: 'feedback',
  encourage: 'motivate', encouragement: 'motivate',
  reflection: 'reflect', reflective: 'reflect',
}

const FALLBACK_STRATEGY_CONFIG: Record<string, string[]> = {
  factual: ['explain', 'drill'],
  conceptual: ['explain', 'scaffold'],
  procedural: ['demonstrate', 'scaffold'],
  metacognitive: ['reflect', 'diagnose'],
  default: ['explain'],
}

export interface LearningStrategyGuidance {
  knowledgeType?: string
  cognitiveLevel?: string
  explanationStyle?: string
  interactionPattern?: string
  targetDepth?: string
  coreConcept?: string
  objectiveFocus?: string[]
  preferredStrategies?: string[]
  responseConstraints?: string[]
}

export const teachingStrategySelectorDefinition: SkillDefinition = {
  name: 'teaching-strategy-selector',
  displayName: '教学策略选择器',
  version: '1.0.0',
  category: 'analysis',
  description: '根据知识类型映射推荐教学策略，处理策略别名标准化，构建教学策略引导 prompt',
  capabilities: ['strategy-selection', 'pedagogy-mapping', 'strategy-normalization'],
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeType: { type: 'string', description: '知识类型: factual/conceptual/procedural/metacognitive' },
      strategyValue: { type: 'string', description: '待标准化的策略值' },
      guidance: { type: 'object', description: '策略引导配置' },
      action: { type: 'string', description: '操作: getFallback / normalize / buildGuidance' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      strategies: { type: 'array', description: '推荐的策略列表' },
      normalized: { type: 'string', description: '归一化后的策略值' },
      promptText: { type: 'string', description: '策略引导 prompt 文本' }
    }
  },
  stats: { callCount: 0, successRate: 1, avgLatency: 0 }
}

export interface LearningStrategySelectorInput {
  knowledgeType?: string
  strategyValue?: string
  guidance?: LearningStrategyGuidance
  action: 'getFallback' | 'normalize' | 'buildGuidance'
}

export interface LearningStrategySelectorOutput {
  strategies?: string[]
  normalized?: string | null
  promptText?: string
}

export async function teachingStrategySelector(
  input: LearningStrategySelectorInput
): Promise<SkillExecutionResult<LearningStrategySelectorOutput>> {
  const startedAt = Date.now()
  try {
    let result: LearningStrategySelectorOutput = {}
    switch (input.action) {
      case 'getFallback':
        result = { strategies: getFallbackStrategies(input.knowledgeType) }
        break
      case 'normalize':
        result = { normalized: normalizeStrategy(input.strategyValue) }
        break
      case 'buildGuidance':
        result = { promptText: buildGuidancePrompt(input.guidance) }
        break
    }
    return { success: true, output: result, duration: Date.now() - startedAt }
  } catch (error: any) {
    return { success: false, error: { code: 'SELECTOR_FAILED', message: error?.message || '策略选择失败' }, duration: Date.now() - startedAt }
  }
}

export function getFallbackStrategies(knowledgeType?: string): string[] {
  if (knowledgeType && FALLBACK_STRATEGY_CONFIG[knowledgeType]) {
    return FALLBACK_STRATEGY_CONFIG[knowledgeType]
  }
  return FALLBACK_STRATEGY_CONFIG.default
}

export function normalizeStrategy(value?: string): AllowedPedagogyStrategy | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (STRATEGY_ALIAS_CONFIG[normalized]) return STRATEGY_ALIAS_CONFIG[normalized] as AllowedPedagogyStrategy
  return (ALLOWED_PEDAGOGY_STRATEGIES as readonly string[]).includes(normalized)
    ? normalized as AllowedPedagogyStrategy
    : null
}

export function buildGuidancePrompt(guidance?: LearningStrategyGuidance): string | null {
  if (!guidance) return null
  const lines = [
    '以下是本轮教学策略显式约束，优先级高于一般风格偏好：',
    `- knowledgeType: ${guidance.knowledgeType || 'unknown'}`,
    `- cognitiveLevel: ${guidance.cognitiveLevel || 'unknown'}`,
    `- explanationStyle: ${guidance.explanationStyle}`,
    `- interactionPattern: ${guidance.interactionPattern}`,
    `- targetDepth: ${guidance.targetDepth}`,
    `- coreConcept: ${guidance.coreConcept || 'none'}`,
    `- objectiveFocus: ${(guidance.objectiveFocus || []).join(' | ') || 'none'}`,
    `- preferredStrategies: ${(guidance.preferredStrategies || []).join(' | ') || 'none'}`,
    `- responseConstraints: ${(guidance.responseConstraints || []).join(' | ') || 'none'}`,
    '',
    '策略映射要求：',
    '- preferredStrategies 仅作为语义参考，不得原样输出到 pedagogy.strategies。',
    '- 只能从允许枚举中选择：explain, demonstrate, scaffold, drill, diagnose, feedback, motivate, reflect。',
    '- 如果 preferredStrategies 中出现类似 retrieval-practice、definition-check、worked-example、self-explanation 等表达，请映射到最接近的允许枚举，不要复述原词。',
  ]
  return lines.join('\n')
}
