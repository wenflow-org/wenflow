import { toWrapupArtifact } from '../index'

const input: any = {
  messages: [],
  knowledgePoints: [],
  sessionInfo: {
    subject: '测试',
    topic: '测试主题',
    durationMinutes: 10,
    userMessageCount: 1,
    assistantMessageCount: 1,
    taskType: 'practice'
  }
}

const summary: any = {
  topicSummary: '总结',
  knowledgeSummary: '知识总结',
  practiceAdvice: '建议',
  learningEvaluation: '评价',
  knowledgeItems: [],
  keyTakeaways: [],
  actionPlan: [],
  evaluationHighlights: { strengths: [], improvements: [] },
  metricInterpretation: { session: '', longTerm: '' },
  summaryVersion: 'v2'
}

describe('toWrapupArtifact', () => {
  it('失败来源的保守评估只作为内部降级结果，不暴露为完整评估', () => {
    const artifact = toWrapupArtifact({
      summary,
      evaluation: {
        sessionLss: 5,
        sessionKtl: 5,
        sessionLf: 5,
        confidence: 0.2
      },
      summarySource: 'fallback',
      evaluationSource: 'failed'
    } as any, input)

    expect(artifact.status).toBe('summary-only')
    expect(artifact.evaluation).toBeNull()
    expect(artifact.sources.evaluation).toBe('failed')
  })

  it('模型或 AI fallback 评估保持可展示', () => {
    const evaluation = {
      sessionLss: 4,
      sessionKtl: 7,
      sessionLf: 3,
      confidence: 0.8
    }
    const artifact = toWrapupArtifact({
      summary,
      evaluation,
      summarySource: 'model',
      evaluationSource: 'ai-fallback'
    } as any, input)

    expect(artifact.status).toBe('complete')
    expect(artifact.evaluation).toEqual(evaluation)
  })
})
