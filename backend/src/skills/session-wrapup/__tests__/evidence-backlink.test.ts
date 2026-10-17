import { verifyKnowledgeEvidence } from '../index'
import type { SessionWrapupSummary } from '../index'

/**
 * #52 第④例：knowledgeItems.evidence 必须能回链到学员原话。
 * 找不到 → 标 evidenceUnverified，mastered 降为 learning、进度封顶 79。
 */
function summaryWith(items: Array<{ name: string; status: 'mastered' | 'learning'; progress: number; evidence: string }>): SessionWrapupSummary {
  return {
    topicSummary: '本节围绕蒸发与凝结。',
    knowledgeSummary: '讲了两个概念。',
    learningEvaluation: '完成度良好。',
    knowledgeItems: items,
    keyTakeaways: [],
    practiceAdvice: '继续复习。',
    actionPlan: [],
    evaluationHighlights: { strengths: [], improvements: [] },
    metricInterpretation: { session: '', longTerm: '' },
  } as unknown as SessionWrapupSummary
}

const messages = [
  { role: 'user', content: '蒸发是水变成水蒸气的过程' },
  { role: 'user', content: '凝结就是水蒸气变回水滴' },
]

describe('verifyKnowledgeEvidence', () => {
  it('证据能在学员原话里找到 → 原样保留', () => {
    const summary = summaryWith([
      { name: '蒸发', status: 'mastered', progress: 100, evidence: '蒸发是水变成水蒸气的过程' },
    ])
    const result = verifyKnowledgeEvidence(summary, messages)
    expect(result.unverified).toBe(0)
    expect(result.summary.knowledgeItems[0]).toMatchObject({ status: 'mastered', progress: 100 })
  })

  it('证据编造（学员没说过）→ 标记并降级', () => {
    const summary = summaryWith([
      { name: '蒸发', status: 'mastered', progress: 100, evidence: '学生完整复述了热力学第一定律' },
    ])
    const result = verifyKnowledgeEvidence(summary, messages)
    expect(result.unverified).toBe(1)
    expect(result.summary.knowledgeItems[0]).toMatchObject({
      status: 'learning', progress: 79, evidenceUnverified: true,
    })
  })

  it('学员消息少于 2 条时不判（证据不足不反过来惩罚学生）', () => {
    const summary = summaryWith([
      { name: '蒸发', status: 'mastered', progress: 100, evidence: '学生完整复述了热力学第一定律' },
    ])
    const result = verifyKnowledgeEvidence(summary, [messages[0]])
    expect(result.unverified).toBe(0)
    expect(result.summary).toBe(summary)
  })

  it('短证据（<6 字）不参与回链，避免误杀', () => {
    const summary = summaryWith([
      { name: '蒸发', status: 'mastered', progress: 100, evidence: '答对' },
    ])
    expect(verifyKnowledgeEvidence(summary, messages).unverified).toBe(0)
  })
})
