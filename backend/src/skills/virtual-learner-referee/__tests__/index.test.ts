import { normalizeRefereeOutput } from '../index'
import type { VirtualLearnerRefereeInput } from '../../../virtual-lab/contracts'

const input: VirtualLearnerRefereeInput = {
  publicTrace: [{
    timestamp: '2026-07-14T10:00:00.000Z',
    observation: { stage: 'goal', visibleMessages: [], availableActions: ['chat'] },
    control: {}
  }],
  refereeTrace: [{ timestamp: '2026-07-14T10:00:00.000Z', traceId: 'trace1', diagnostic: { completionCandidate: false } }],
  control: { runCompleted: true, terminalReason: 'completed' },
  experimentSummary: {
    experimentId: 'exp1', runId: 'run1', virtualSessionId: 'vs1', mode: 'blackbox-api',
    status: 'completed', currentStage: 'completed', terminalReason: 'completed',
    startedAt: null, completedAt: null, durationMs: null,
    goalCompleted: true, taskCompleted: true, runCompleted: true,
    publicTraceCount: 1, refereeTraceCount: 1,
    stageCoverage: { goal: true, path: false, learning: false, completed: true, error: false },
    inputCoverage: {
      originalPublicTraceCount: 1, includedPublicTraceCount: 1,
      originalRefereeTraceCount: 1, includedRefereeTraceCount: 1, truncated: false
    }
  }
}

describe('virtual-learner-referee normalization', () => {
  it('由代码根据 critical finding 派生 fail，并将未覆盖阶段置为 null', () => {
    const output = normalizeRefereeOutput({
      verdict: 'pass',
      scores: {
        goalExperience: 95, pathExperience: 95, teachingExperience: 95,
        controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90
      },
      evidence: [{
        id: 'E1', source: 'refereeTrace', index: 0, path: 'diagnostic.completionCandidate',
        traceId: 'trace1', excerpt: 'false', interpretation: '完成信号不一致'
      }],
      findings: [{
        code: 'BOUNDARY_LEAK', severity: 'critical', category: 'boundary',
        title: '边界泄漏', detail: '内部信号泄漏', evidenceIds: ['E1']
      }],
      recommendations: [{ priority: 'P0', action: '修复响应裁剪', rationale: '保护黑盒边界', findingCodes: ['BOUNDARY_LEAK'] }]
    }, input)

    expect(output.verdict).toBe('fail')
    expect(output.scores.pathExperience).toBeNull()
    expect(output.scores.teachingExperience).toBeNull()
    expect(output.findings[0].evidenceIds).toEqual(['E1'])
  })

  it('过滤越界证据并在证据不足时输出 inconclusive', () => {
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 80, controlConsistency: 80, boundaryIntegrity: 80, evidenceSufficiency: 20 },
      evidence: [{ id: 'BAD', source: 'publicTrace', index: 99, path: 'observation' }],
      findings: [{ code: 'BAD_FINDING', severity: 'major', category: 'trace', title: '无效', detail: '无效', evidenceIds: ['BAD'] }],
      recommendations: []
    }, input)

    expect(output.evidence).toEqual([])
    expect(output.findings).toEqual([])
    expect(output.verdict).toBe('inconclusive')
  })
})
