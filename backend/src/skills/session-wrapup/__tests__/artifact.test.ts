import {
  sessionWrapupAgent,
  sessionWrapupAgentHandler,
  toWrapupArtifact,
  toWrapupSkillOutcome,
  validateSessionWrapupParsedOutput,
} from '../index'

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
  it('primary raw output requires both a complete summary and evaluation', () => {
    const evaluation = {
      sessionLss: 4,
      sessionKtl: 7,
      sessionLf: 3,
      confidence: 0.8,
      reasoning: '学生能够结合例子说明本节关键概念。'
    }

    expect(validateSessionWrapupParsedOutput({ summary, evaluation })).toEqual({ valid: true })
    expect(validateSessionWrapupParsedOutput({ summary })).toEqual({
      valid: false,
      failureReason: 'SESSION_WRAPUP_EVALUATION_INVALID'
    })
    expect(validateSessionWrapupParsedOutput({ evaluation })).toEqual({
      valid: false,
      failureReason: 'SESSION_WRAPUP_SUMMARY_INVALID'
    })
  })

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

  it('unavailable 来源（evaluation 缺失，纯重试+明确失败）→ summary-only 且 evaluation=null', () => {
    const artifact = toWrapupArtifact({
      summary,
      evaluation: null,
      summarySource: 'model',
      evaluationSource: 'unavailable'
    } as any, input)

    expect(artifact.status).toBe('summary-only')
    expect(artifact.evaluation).toBeNull()
    expect(artifact.sources.evaluation).toBe('unavailable')

    const outcome = toWrapupSkillOutcome({
      summary,
      evaluation: null,
      summarySource: 'model',
      evaluationSource: 'unavailable'
    } as any, input)
    expect(outcome.meta.quality).toBe('partial')
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

  it('toWrapupSkillOutcome 产出 skill-outcome/v1 且不改变 artifact 语义', () => {
    const evaluation = {
      sessionLss: 4,
      sessionKtl: 7,
      sessionLf: 3,
      confidence: 0.8,
      reasoning: 'ok',
    }
    const result = {
      summary,
      evaluation,
      summarySource: 'model' as const,
      evaluationSource: 'model' as const,
    }
    const outcome = toWrapupSkillOutcome(result as any, input)

    expect(outcome.schemaVersion).toBe('skill-outcome/v1')
    expect(outcome.meta.skillId).toBe('skill:session-wrapup')
    expect(outcome.meta.quality).toBe('model')
    expect(outcome.artifact.status).toBe('complete')
    expect(outcome.transition).toBeNull()
  })

  it('仅在 legacy internal sidecar 附加 canonical outcome，不改变 agent-output-v1 展示字段', async () => {
    const evaluation = {
      sessionLss: 4,
      sessionKtl: 7,
      sessionLf: 3,
      confidence: 0.8,
      reasoning: 'ok',
    }
    const generate = jest.spyOn(sessionWrapupAgent, 'generate').mockResolvedValue({
      summary,
      evaluation,
      summarySource: 'model',
      evaluationSource: 'model',
    })

    try {
      const output = await sessionWrapupAgentHandler(input, {})

      expect(output).toMatchObject({
        success: true,
        userVisible: summary.topicSummary,
        schemaVersion: 'agent-output-v1',
        renderHints: { component: 'session-wrapup' },
      })
      expect(output.internal.ext.sessionWrapup).toEqual(expect.objectContaining({
        result: expect.objectContaining({ summary, evaluation }),
        artifact: expect.objectContaining({ status: 'complete' }),
        skillOutcome: expect.objectContaining({
          schemaVersion: 'skill-outcome/v1',
          transition: null,
        }),
      }))
    } finally {
      generate.mockRestore()
    }
  })
})
