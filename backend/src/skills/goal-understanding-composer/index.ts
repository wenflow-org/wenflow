/**
 * goal-understanding-composer Skill
 *
 * 目标对话阶段的理解数据管理。
 * 处理多轮理解数据的合并、去重、净化，以及 proposal 完整性检查。
 */

import { SkillDefinition, SkillExecutionResult } from '../protocol'

export const GOAL_UNDERSTANDING_COMPOSER_PROMPT = ''

export const goalUnderstandingComposerDefinition: SkillDefinition = {
  name: 'goal-understanding-composer',
  displayName: '目标理解编排器',
  version: '1.0.0',
  category: 'analysis',
  description: '管理目标对话阶段的理解数据：合并多轮理解、去重净化、proposal 完整性检查',
  capabilities: ['understanding-merge', 'data-sanitization', 'proposal-validation'],
  inputSchema: {
    type: 'object',
    properties: {
      previousUnderstanding: { type: 'object', description: '上一轮累积的理解数据' },
      parsedJson: { type: 'object', description: '本轮 AI 返回的解析结果' },
      action: { type: 'string', description: '操作类型: merge / sanitize / buildCollected / checkThin' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      result: { type: 'object', description: '操作结果' }
    }
  },
  stats: { callCount: 0, successRate: 1, avgLatency: 0 }
}

export interface GoalUnderstandingComposerInput {
  previousUnderstanding?: any
  parsedJson?: any
  action: 'merge' | 'sanitize' | 'buildCollected' | 'checkThin'
}

export interface GoalUnderstandingComposerOutput {
  result: any
}

export function isPlaceholderValue(value: any): boolean {
  if (value === null || value === undefined) return true
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return true
  const placeholderPatterns = [
    /^待确认$/,
    /^待收集$/,
    /^未知$/,
    /^未明确$/,
    /^未确定$/,
    /^null$/i,
    /^undefined$/i,
    /尚未/,
    /不明确/,
    /未.*表达/,
    /可能是/,
    /初步判断/,
    /需要厘清/,
    /待补充/
  ]
  return placeholderPatterns.some((pattern) => pattern.test(text))
}

export function sanitizeUnderstanding(understanding: any): any {
  if (!understanding || typeof understanding !== 'object') return {}
  const sanitized = {
    ...understanding,
    background: { ...(understanding.background || {}) },
    learning_style: { ...(understanding.learning_style || {}) },
    cognitive_profile: { ...(understanding.cognitive_profile || {}) },
    emotional_profile: { ...(understanding.emotional_profile || {}) }
  }
  const topLevelKeys = ['surface_goal', 'real_problem', 'motivation', 'urgency', 'pain_points', 'background_experience', 'learning_signal', 'goal_orientation', 'cognitive_bandwidth']
  topLevelKeys.forEach((key) => {
    if (isPlaceholderValue(sanitized[key])) { delete sanitized[key] }
  })
  Object.keys(sanitized.background).forEach((key) => {
    if (isPlaceholderValue(sanitized.background[key])) { delete sanitized.background[key] }
  })
  // 嵌套容器子字段同样清理空串/占位（模型会输出 "" 或"未明确"：time_horizon=""/sdt_needs.autonomy=""）
  const cleanContainer = (container: any) => {
    if (!container || typeof container !== 'object') return
    Object.keys(container).forEach((key) => {
      if (isPlaceholderValue(container[key])) { delete container[key] }
    })
  }
  cleanContainer(sanitized.available_resources)
  cleanContainer(sanitized.sdt_needs)
  return sanitized
}

export function mergeUnderstanding(previousUnderstanding: any, parsedJson: any): any {
  const understanding = { ...(previousUnderstanding || {}) }
  const nextUnderstanding = parsedJson?.understanding || {}
  if (parsedJson?.real_problem && !nextUnderstanding.real_problem) nextUnderstanding.real_problem = parsedJson.real_problem
  if (parsedJson?.motivation && !nextUnderstanding.motivation) nextUnderstanding.motivation = parsedJson.motivation
  if (parsedJson?.urgency && !nextUnderstanding.urgency) nextUnderstanding.urgency = parsedJson.urgency
  if (parsedJson?.pain_points && !nextUnderstanding.pain_points) nextUnderstanding.pain_points = parsedJson.pain_points
  if (parsedJson?.background) {
    nextUnderstanding.background = { ...(nextUnderstanding.background || {}), ...parsedJson.background }
  }
  return {
    ...understanding, ...nextUnderstanding,
    background: { ...(understanding.background || {}), ...(nextUnderstanding.background || {}) },
    learning_style: { ...(understanding.learning_style || {}), ...(nextUnderstanding.learning_style || {}) },
    cognitive_profile: { ...(understanding.cognitive_profile || {}), ...(nextUnderstanding.cognitive_profile || {}) },
    emotional_profile: { ...(understanding.emotional_profile || {}), ...(nextUnderstanding.emotional_profile || {}) }
  }
}

export function buildCollected(understanding: any, parsedJson: any): any {
  // level/timePerDay/expected_time 优先读主契约路径（current_baseline / available_resources），
  // legacy background.* 仅作旧数据兜底
  return {
    surface_goal: understanding.surface_goal || null,
    real_problem: understanding.real_problem || null,
    background_experience: understanding.background_experience || null,
    learning_signal: understanding.learning_signal || null,
    motivation: understanding.motivation || null,
    urgency: understanding.urgency || null,
    pain_points: understanding.pain_points || null,
    background: understanding.background || {},
    learning_style: understanding.learning_style || {},
    goal: understanding.real_problem || understanding.surface_goal || null,
    level: understanding.current_baseline?.level || understanding.background?.current_level || null,
    timePerDay: understanding.available_resources?.time_budget || understanding.background?.available_time || understanding.background?.expected_time || null,
    expected_time: understanding.available_resources?.time_horizon || understanding.background?.expected_time || null,
    questions_to_ask: parsedJson?.nextQuestions || parsedJson?.next_questions || []
  }
}

export async function goalUnderstandingComposer(
  input: GoalUnderstandingComposerInput
): Promise<SkillExecutionResult<GoalUnderstandingComposerOutput>> {
  const startedAt = Date.now()
  try {
    let result: any = {}
    switch (input.action) {
      case 'merge':
        result = mergeUnderstanding(input.previousUnderstanding, input.parsedJson)
        break
      case 'sanitize':
        result = sanitizeUnderstanding(input.previousUnderstanding || {})
        break
      case 'buildCollected':
        result = buildCollected(input.previousUnderstanding || {}, input.parsedJson || {})
        break
      case 'checkThin':
        result = {} // thin check 由 skill:goal-conversation 内的 hasThinProposalPayload 处理（涉及 routing 表）
        break
    }
    return { success: true, output: { result }, duration: Date.now() - startedAt }
  } catch (error: any) {
    return { success: false, error: { code: 'COMPOSER_FAILED', message: error?.message || '编排失败' }, duration: Date.now() - startedAt }
  }
}
