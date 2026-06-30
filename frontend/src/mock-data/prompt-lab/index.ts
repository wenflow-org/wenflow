import { GOAL_CONVERSATION_CONTRACT, GOAL_CONVERSATION_BUSINESS_RULES } from './goal-conversation'
import { PATH_PLANNING_CONTRACT, PATH_PLANNING_BUSINESS_RULES } from './path-planning'

export const MOCK_SKILLS = [
  { id: 'goal-conversation', name: '目标对话', archetype: 'conversational' },
  { id: 'path-planning', name: '路径规划', archetype: 'generator' },
]

export const MOCK_CONTRACTS: Record<string, any> = {
  'goal-conversation': GOAL_CONVERSATION_CONTRACT,
  'path-planning': PATH_PLANNING_CONTRACT,
}

export const MOCK_BUSINESS_RULES: Record<string, any> = {
  'goal-conversation': GOAL_CONVERSATION_BUSINESS_RULES,
  'path-planning': PATH_PLANNING_BUSINESS_RULES,
}

export * from './goal-conversation'
export * from './path-planning'
