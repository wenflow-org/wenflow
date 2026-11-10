/**
 * goal-understanding-composer Skill
 *
 * 目标对话阶段的理解数据管理。
 * 处理多轮理解数据的合并、去重、净化，以及 proposal 完整性检查。
 */

import { SkillDefinition } from '../protocol'

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
      action: { type: 'string', description: '操作类型: merge / sanitize / buildCollected' }
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
  const topLevelKeys = ['surface_goal', 'real_problem', 'motivation', 'urgency', 'pain_points', 'background_experience', 'learning_signal', 'goal_orientation', 'cognitive_bandwidth', 'primary_block_type', 'recurrence', 'block_type_evidence', 'support_need']
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
    emotional_profile: { ...(understanding.emotional_profile || {}), ...(nextUnderstanding.emotional_profile || {}) },
    // canonical 容器是硬必填的读取来源（available_resources.time_budget/time_horizon、
    // success_criteria.observable_result 等）。本轮只输出子集时若整包覆盖，上一轮兄弟键会丢，
    // 阶段被从 proposing 压回 understanding。此处与 delta 路径（mergeStateDelta 的"缺席=不变"）对齐。
    available_resources: { ...(understanding.available_resources || {}), ...(nextUnderstanding.available_resources || {}) },
    success_criteria: { ...(understanding.success_criteria || {}), ...(nextUnderstanding.success_criteria || {}) },
    current_baseline: { ...(understanding.current_baseline || {}), ...(nextUnderstanding.current_baseline || {}) },
    time_dimensions: { ...(understanding.time_dimensions || {}), ...(nextUnderstanding.time_dimensions || {}) },
    // 同为「静默累积」的对象容器，且都有下游读取方：
    // - sdt_needs（prompts/core/goal-conversation.yaml:175 明写「静默累积」）供 proposal 设计参考；
    // - school_anchor（:96 明写「静默累积」）由 path.coordinator 读进 schoolAnchor（path.coordinator.ts:395）。
    // 上面 `...nextUnderstanding` 会整包覆盖这两个容器：本轮只补其中一项时兄弟项丢失
    //（只给 competence 则 autonomy 消失、只给 examScope 则 textbook 消失）。
    sdt_needs: { ...(understanding.sdt_needs || {}), ...(nextUnderstanding.sdt_needs || {}) },
    school_anchor: { ...(understanding.school_anchor || {}), ...(nextUnderstanding.school_anchor || {}) }
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
