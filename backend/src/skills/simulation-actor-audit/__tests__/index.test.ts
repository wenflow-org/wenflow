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
    observation: { stage: 'goal', visibleMessages: [{ role: 'learner', content: '公开行为' }], availableActions: ['chat'] }
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

describe('simulation-actor-audit normalization', () => {
  it('过滤无证据发现；悬空证据引用使结论降级为 inconclusive', () => {
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

    // 引用不存在的证据 → integrity 失效、evidenceSufficiency 封顶、verdict=inconclusive。
    expect(output.scores.overall).toBe(76)
    expect(output.verdict).toBe('inconclusive')
    expect(output.integrity?.danglingEvidenceRefs).toEqual(['MISSING'])
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

  it('缺失/非法分数 → inconclusive 且保留诊断', () => {
    const output = normalizeActorAuditOutput({
      scores: {
        personaConsistency: 90, storyConsistency: 90, disclosureDiscipline: 90,
        frictionCalibration: 90, stateContinuity: 90, behaviorPlausibility: 'NaN',
        evidenceSufficiency: 90
      },
      evidence: [], findings: [], recommendations: []
    }, input)

    expect(output.integrity?.valid).toBe(false)
    expect(output.integrity?.missingScores).toContain('behaviorPlausibility')
    expect(output.verdict).toBe('inconclusive')
  })

  it('无证据时高分也不能判定角色可信', () => {
    const output = normalizeActorAuditOutput({
      scores: {
        personaConsistency: 95, storyConsistency: 95, disclosureDiscipline: 95,
        frictionCalibration: 95, stateContinuity: 95, behaviorPlausibility: 95, evidenceSufficiency: 95,
      },
      evidence: [], findings: [], recommendations: [],
    }, input);
    expect(output.verdict).toBe('inconclusive');
    expect(output.integrity?.missingEvidence).toBe(true);
  });

  it('悬空证据引用 → inconclusive', () => {
    const output = normalizeActorAuditOutput({
      scores: {
        personaConsistency: 95, storyConsistency: 95, disclosureDiscipline: 95,
        frictionCalibration: 95, stateContinuity: 95, behaviorPlausibility: 95, evidenceSufficiency: 95
      },
      evidence: [],
      findings: [{ code: 'DANGLING', severity: 'minor', category: 'behavior', title: '无证据', detail: 'x', evidenceIds: ['AE404'] }],
      recommendations: []
    }, input)

    expect(output.integrity?.danglingEvidenceRefs).toContain('AE404')
    expect(output.verdict).toBe('inconclusive')
  })
})
