import { normalizeActorAuditOutput } from '../index'
import type { VirtualLearnerActorAuditInput } from '../../../virtual-lab/contracts'

const input: VirtualLearnerActorAuditInput = {
  actorProfile: {
    profile: { role: '店长' },
    learningGoal: '学会分析周报',
    knownConcepts: [],
    struggleConcepts: ['趋势判断'],
    personalityTraits: { cautious: true }
  },
  story: { hiddenDetails: ['时间紧张'], disclosurePlan: { timing: 'late' } },
  frictionBudget: 'normal',
  learnerPrivateState: { goal: { trust: 0.5 } },
  publicTrace: [{
    timestamp: '2026-07-14T10:00:00.000Z',
    observation: { stage: 'goal', visibleMessages: [], availableActions: ['chat'] }
  }],
  experimentSummary: {
    experimentId: 'exp1', runId: 'run1', virtualSessionId: 'vs1', mode: 'blackbox-api',
    status: 'completed', currentStage: 'completed', terminalReason: 'completed',
    startedAt: null, completedAt: null, durationMs: null,
    goalCompleted: true, taskCompleted: true, runCompleted: true,
    publicTraceCount: 1, refereeTraceCount: 1,
    stageCoverage: { goal: true, path: false, teaching: false, completed: true, error: false },
    inputCoverage: {
      originalPublicTraceCount: 1, includedPublicTraceCount: 1,
      originalRefereeTraceCount: 0, includedRefereeTraceCount: 0, truncated: false
    }
  }
}

describe('virtual-learner-actor-auditor normalization', () => {
  it('由代码重算 overall 和 verdict，并过滤无证据发现', () => {
    const output = normalizeActorAuditOutput({
      scores: {
        overall: 100,
        personaConsistency: 85,
        storyConsistency: 75,
        disclosureDiscipline: 70,
        frictionCalibration: 80,
        stateContinuity: 80,
        behaviorPlausibility: 90,
        evidenceSufficiency: 90
      },
      evidence: [{
        id: 'AE1', source: 'publicTrace', index: 0,
        path: 'observation.visibleMessages', excerpt: '公开行为', interpretation: '行为证据'
      }],
      findings: [
        { code: 'VALID', severity: 'major', category: 'behavior', title: '行为偏差', detail: '偏差', evidenceIds: ['AE1'] },
        { code: 'INVALID', severity: 'critical', category: 'story', title: '无证据', detail: '应过滤', evidenceIds: ['MISSING'] }
      ],
      recommendations: [{ priority: 'P1', action: '调整模拟器', findingCodes: ['VALID', 'INVALID'] }]
    }, input)

    expect(output.scores.overall).toBe(81)
    expect(output.verdict).toBe('credible_with_concerns')
    expect(output.findings.map(item => item.code)).toEqual(['VALID'])
    expect(output.recommendations[0].findingCodes).toEqual(['VALID'])
  })

  it('无 Story 时将故事维度置为 null，证据不足输出 inconclusive', () => {
    const output = normalizeActorAuditOutput({
      scores: {
        personaConsistency: 90, storyConsistency: 90, disclosureDiscipline: 90,
        frictionCalibration: 90, stateContinuity: 90, behaviorPlausibility: 90,
        evidenceSufficiency: 20
      },
      evidence: [], findings: [], recommendations: []
    }, { ...input, story: null })

    expect(output.scores.storyConsistency).toBeNull()
    expect(output.scores.disclosureDiscipline).toBeNull()
    expect(output.verdict).toBe('inconclusive')
  })
})
