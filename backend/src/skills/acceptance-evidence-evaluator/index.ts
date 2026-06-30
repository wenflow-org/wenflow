/**
 * acceptance-evidence-evaluator Skill
 *
 * 任务完成度评估器。
 * 根据接收标准（acceptanceCriteria）或任务画像（taskProfile/knowledgeType/cognitiveLevel），
 * 评估学生是否提供了足够的学习证据来完成当前任务。
 */

import { SkillDefinition, SkillExecutionResult } from '../protocol'

export const ACCEPTANCE_EVIDENCE_EVALUATOR_PROMPT = ''

export const acceptanceEvidenceEvaluatorDefinition: SkillDefinition = {
  name: 'acceptance-evidence-evaluator',
  displayName: '任务完成度评估器',
  version: '1.0.0',
  category: 'analysis',
  description: '根据接收标准或任务画像评估学生是否提供了足够的学习证据来完成当前任务',
  capabilities: ['task-completion-evaluation', 'evidence-assessment', 'acceptance-criteria-matching'],
  inputSchema: {
    type: 'object',
    properties: {
      messages: { type: 'array', description: '对话消息列表' },
      acceptanceCriteria: { type: 'string', description: '接收标准文本' },
      taskType: { type: 'string', description: '任务类型' },
      knowledgeType: { type: 'string', description: '知识类型: factual/conceptual/procedural/metacognitive' },
      cognitiveLevel: { type: 'string', description: '认知层级: remember/understand/apply/analyze/evaluate/create' },
      knowledgePoints: { type: 'array', description: '知识点列表' },
      mode: { type: 'string', description: '评估模式: criteria / profile / auto' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      matched: { type: 'boolean' },
      decision: { type: 'string' },
      reason: { type: 'string' },
      matchedRatio: { type: 'number' },
      anchorTokens: { type: 'array' },
      matchedTokens: { type: 'array' }
    }
  },
  stats: { callCount: 0, successRate: 1, avgLatency: 0 }
}

export interface AcceptanceEvidenceEvaluatorInput {
  messages: Array<{ role: string; content: string }>
  acceptanceCriteria?: string
  taskType?: string
  knowledgeType?: string
  cognitiveLevel?: string
  knowledgePoints?: Array<{ name: string; status: string }>
  taskProfile?: { knowledgeType?: string; cognitiveLevel?: string; coreConcept?: string }
  mode?: 'auto' | 'criteria' | 'profile'
}

export interface AcceptanceEvidenceEvaluatorOutput {
  hasCriteria: boolean
  matched: boolean
  acceptanceCriteria: string | null
  anchorTokens: string[]
  matchedTokens: string[]
  matchedRatio: number
  learnerEvidenceExcerpt: string
  decision: 'accepted' | 'rejected' | 'no-criteria'
  reason: string
}

function splitAcceptanceCriteriaIntoAnchors(criteria: string): string[] {
  if (!criteria) return []
  const trimmed = criteria.trim()
  const patterns = [
    /[""]([^""]*?)[""]/g,
    /'([^']*?)'/g,
    /`([^`]*?)`/g,
    /【([^】]*?)】/g,
    /《([^》]*?)》/g
  ]
  for (const pattern of patterns) {
    const matches: string[] = []
    let m: RegExpExecArray | null
    while ((m = pattern.exec(trimmed)) !== null) {
      if (m[1] && m[1].trim().length >= 2) matches.push(m[1].trim())
    }
    if (matches.length >= 2) return [...new Set(matches)]
  }
  const words = trimmed.split(/[,.，。\s;；、]+/).map(w => w.trim()).filter(w => w.length >= 3 && /[\u4e00-\u9fa5\w]/.test(w))
  return [...new Set(words)].slice(0, 12)
}

export async function acceptanceEvidenceEvaluator(
  input: AcceptanceEvidenceEvaluatorInput
): Promise<SkillExecutionResult<AcceptanceEvidenceEvaluatorOutput>> {
  const startedAt = Date.now()
  try {
    const mode = input.mode || (input.acceptanceCriteria ? 'criteria' : 'profile')
    const result = mode === 'criteria' && input.acceptanceCriteria
      ? evaluateByCriteria(input)
      : evaluateByProfile(input)
    return { success: true, output: result, duration: Date.now() - startedAt }
  } catch (error: any) {
    return {
      success: false,
      error: { code: 'EVAL_FAILED', message: error?.message || '评估失败' },
      duration: Date.now() - startedAt
    }
  }
}

export function evaluateByCriteria(input: AcceptanceEvidenceEvaluatorInput): AcceptanceEvidenceEvaluatorOutput {
  const criteria = (input.acceptanceCriteria || '').trim()
  if (!criteria) {
    return { hasCriteria: false, matched: false, acceptanceCriteria: null, anchorTokens: [], matchedTokens: [], matchedRatio: 0, learnerEvidenceExcerpt: '', decision: 'no-criteria', reason: '当前任务没有提供 acceptanceCriteria' }
  }
  const learnerEvidence = [...input.messages].reverse().find(m => m.role === 'user')?.content || ''
  const recentMessages = input.messages.slice(-4).map(m => m.content).join('\n')
  const evidencePool = [learnerEvidence, recentMessages].join('\n').toLowerCase()
  const anchorTokens = splitAcceptanceCriteriaIntoAnchors(criteria)
  if (!anchorTokens.length) {
    return { hasCriteria: true, matched: false, acceptanceCriteria: criteria, anchorTokens: [], matchedTokens: [], matchedRatio: 0, learnerEvidenceExcerpt: learnerEvidence.slice(0, 240), decision: 'rejected', reason: '未能提取出稳定的验收锚点' }
  }
  const matchedTokens = anchorTokens.filter(t => evidencePool.includes(t.toLowerCase()))
  const matchedRatio = matchedTokens.length / anchorTokens.length
  const matched = matchedTokens.length > 0 && matchedRatio >= 0.4
  return {
    hasCriteria: true, matched, acceptanceCriteria: criteria, anchorTokens, matchedTokens, matchedRatio,
    learnerEvidenceExcerpt: learnerEvidence.slice(0, 240),
    decision: matched ? 'accepted' : 'rejected',
    reason: matched ? '最近几轮学生表达已覆盖足够比例的验收锚点。' : '最近几轮学生表达还未覆盖足够比例的验收锚点。'
  }
}

export function evaluateByProfile(input: AcceptanceEvidenceEvaluatorInput): AcceptanceEvidenceEvaluatorOutput {
  const knowledgeType = input.knowledgeType || input.taskProfile?.knowledgeType || ''
  const cognitiveLevel = input.cognitiveLevel || input.taskProfile?.cognitiveLevel || ''
  const taskType = input.taskType || ''
  const currentPoint = input.knowledgePoints?.find(p => p.status === 'learning')?.name || input.knowledgePoints?.[0]?.name || input.taskProfile?.coreConcept || ''
  const learnerMessage = [...input.messages].reverse().find(m => m.role === 'user')?.content || ''
  const recentTeacherMessage = [...input.messages].reverse().find(m => m.role === 'assistant')?.content || ''
  const evidencePool = [learnerMessage, recentTeacherMessage, currentPoint].join('\n').toLowerCase()

  let matched = false
  let reason = '未满足任务型收束条件。'

  if (knowledgeType === 'factual') {
    matched = evidencePool.includes((currentPoint || '').toLowerCase()) || evidencePool.includes('知道') || evidencePool.includes('记住')
    reason = matched ? '事实性任务已出现准确识别/复述证据。' : '事实性任务尚未出现足够准确识别/复述证据。'
  } else if (knowledgeType === 'conceptual') {
    matched = evidencePool.includes('因为') || evidencePool.includes('关系') || evidencePool.includes('区别') || evidencePool.includes('联系') || evidencePool.includes('类比')
    reason = matched ? '概念性任务已出现关系解释或对比证据。' : '概念性任务尚未出现足够关系解释或对比证据。'
  } else if (knowledgeType === 'procedural') {
    matched = evidencePool.includes('步骤') || evidencePool.includes('先') || evidencePool.includes('然后') || evidencePool.includes('接着') || evidencePool.includes('最后')
    reason = matched ? '程序性任务已出现分步执行或过程说明证据。' : '程序性任务尚未出现足够分步执行或过程说明证据。'
  } else if (knowledgeType === 'metacognitive') {
    matched = evidencePool.includes('我会') || evidencePool.includes('我先') || evidencePool.includes('策略') || evidencePool.includes('反思') || evidencePool.includes('检查')
    reason = matched ? '元认知任务已出现策略选择或反思证据。' : '元认知任务尚未出现足够策略选择或反思证据。'
  }

  if (!matched && cognitiveLevel === 'remember') { matched = evidencePool.includes('记住') || evidencePool.includes('识别') || evidencePool.includes('知道'); if (matched) reason = '记忆层级任务已出现稳定识别/回忆证据。' }
  if (!matched && cognitiveLevel === 'understand') { matched = evidencePool.includes('解释') || evidencePool.includes('意思') || evidencePool.includes('为什么'); if (matched) reason = '理解层级任务已出现解释证据。' }
  if (!matched && cognitiveLevel === 'apply') { matched = evidencePool.includes('做法') || evidencePool.includes('应用') || evidencePool.includes('例子') || evidencePool.includes('步骤'); if (matched) reason = '应用层级任务已出现可执行证据。' }
  if (!matched && cognitiveLevel === 'analyze') { matched = evidencePool.includes('分析') || evidencePool.includes('区别') || evidencePool.includes('结构') || evidencePool.includes('原因'); if (matched) reason = '分析层级任务已出现结构/原因拆解证据。' }
  if (!matched && cognitiveLevel === 'evaluate') { matched = evidencePool.includes('比较') || evidencePool.includes('判断') || evidencePool.includes('标准') || evidencePool.includes('更好'); if (matched) reason = '评价层级任务已出现比较/判断证据。' }
  if (!matched && cognitiveLevel === 'create') { matched = evidencePool.includes('方案') || evidencePool.includes('设计') || evidencePool.includes('产出') || evidencePool.includes('生成'); if (matched) reason = '创造层级任务已出现方案/产出证据。' }
  if (!matched && taskType === 'quiz') { matched = evidencePool.includes('答案') || evidencePool.includes('选项') || evidencePool.includes('正确'); if (matched) reason = '测验任务已出现作答或判断证据。' }

  return {
    hasCriteria: false, matched, acceptanceCriteria: null,
    anchorTokens: [], matchedTokens: [], matchedRatio: 0,
    learnerEvidenceExcerpt: learnerMessage.slice(0, 240),
    decision: matched ? 'accepted' : 'rejected',
    reason
  }
}
