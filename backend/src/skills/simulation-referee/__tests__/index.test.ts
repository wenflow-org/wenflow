import { normalizeRefereeOutput } from '../index'
import type { VirtualLearnerRefereeInput } from '../../../virtual-lab/contracts'

const input: VirtualLearnerRefereeInput = {
  publicTrace: [{
    timestamp: '2026-07-14T10:00:00.000Z',
    observation: { stage: 'goal', visibleMessages: [{ role: 'platform', content: '你想解决什么？' }], availableActions: ['chat'] },
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
    stageCoverage: { goal: true, path: false, teaching: false, completed: true, error: false },
    inputCoverage: {
      originalPublicTraceCount: 1, includedPublicTraceCount: 1,
      originalRefereeTraceCount: 1, includedRefereeTraceCount: 1, truncated: false
    }
  }
}

describe('simulation-referee normalization', () => {
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
      }, {
        // goalExperience 计分必须有对应阶段的实质证据（2026-11-22 P1.4 逐维门）
        id: 'E2', source: 'publicTrace', index: 0, path: 'observation.visibleMessages',
        excerpt: '你想解决什么？', interpretation: 'Goal 开场对话'
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

  it('无故事基准时 goalUnderstanding 输出 null，有 realProblem 时参与总分', () => {
    const withoutStory = normalizeRefereeOutput({
      scores: { goalExperience: 90, controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      evidence: [], findings: [], recommendations: []
    }, input)

    expect(withoutStory.scores.goalUnderstanding).toBeNull()

    const withStory: VirtualLearnerRefereeInput = {
      ...input,
      storyMeta: {
        personaSummary: '销售主管',
        storyId: 's1',
        storyTitle: '被临时消息打断',
        surfaceGoal: '学会时间管理',
        realProblem: '任务被碎片化消息打断无法进入深度工作',
        triggerEvent: '周五复盘被中断',
        demandText: '我最近总被消息打断，想学时间管理',
        demandSource: 'story.visibleOpening'
      }
    }
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 90, goalUnderstanding: 70, controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      evidence: [], findings: [], recommendations: []
    }, withStory)

    expect(output.scores.goalUnderstanding).toBe(70)
    expect(output.scores.overall).toBeGreaterThan(0)
    expect(output.scores.overall).toBeLessThan(100)
  })

  it('保留 data 类 finding（数据完整性缺口不再被静默归到 trace）', () => {
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 80, controlConsistency: 80, boundaryIntegrity: 80, evidenceSufficiency: 40 },
      evidence: [{
        id: 'E1', source: 'publicTrace', index: 0, path: 'observation.stage',
        excerpt: 'teaching', interpretation: '跑过教学但没有指标产出'
      }],
      findings: [{
        code: 'DATA_GAP', severity: 'major', category: 'data',
        title: '教学指标缺失', detail: '跑过教学阶段但 metrics/wrapup 均为空', evidenceIds: ['E1']
      }],
      recommendations: []
    }, input)

    expect(output.findings[0]?.category).toBe('data')
  })

  it('storyMeta / metricCompleteness 可作为证据来源，但不能带 index', () => {
    const withMeta: VirtualLearnerRefereeInput = {
      ...input,
      storyMeta: { personaSummary: null, storyId: 's1', storyTitle: null, surfaceGoal: 'X', realProblem: 'Y', triggerEvent: null, demandText: 'X', demandSource: 'story.goalSeed.surfaceGoal' },
      metricCompleteness: { available: true, teachingSessions: 1, wrapupPresent: 0, metricsPresent: 0, lssPresent: 0, degraded: true, error: null }
    }
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 80, controlConsistency: 80, boundaryIntegrity: 80, evidenceSufficiency: 70 },
      evidence: [
        { id: 'E1', source: 'storyMeta', index: null, path: 'storyMeta.realProblem', excerpt: 'Y', interpretation: '真实问题' },
        { id: 'E2', source: 'metricCompleteness', path: 'metricCompleteness.wrapupPresent', excerpt: '0', interpretation: '无 wrapup' }
      ],
      findings: [{
        code: 'DATA_GAP', severity: 'major', category: 'completion',
        title: '数据缺失', detail: '缺少指标', evidenceIds: ['E2']
      }],
      recommendations: []
    }, withMeta)

    expect(output.evidence.map((item) => item.source)).toEqual(['storyMeta', 'metricCompleteness'])
    expect(output.findings[0].evidenceIds).toEqual(['E2'])
  })

  it('数据契约门禁：跑过教学却无指标/wrapup 时 evidenceSufficiency 被封顶', () => {
    const withTeachingGap: VirtualLearnerRefereeInput = {
      ...input,
      metricCompleteness: { available: true, teachingSessions: 2, wrapupPresent: 0, metricsPresent: 0, lssPresent: 0, degraded: false, error: null }
    }
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 90, controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      evidence: [], findings: [], recommendations: []
    }, withTeachingGap)

    expect(output.scores.evidenceSufficiency).toBe(45)
    expect(output.verdict).toBe('inconclusive')
  })

  it('仅引用 observation.stage（纯元数据）不能通过：goalExperience 缺实质证据 → inconclusive（外部评审 P1.4）', () => {
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 90, controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      evidence: [{ id: 'E1', source: 'publicTrace', index: 0, path: 'observation.stage' }], findings: [], recommendations: []
    }, input)

    expect(output.integrity?.missingDimensionEvidence).toContain('goalExperience')
    expect(output.integrity?.valid).toBe(false)
    expect(output.scores.evidenceSufficiency).toBeLessThanOrEqual(45)
    expect(output.verdict).toBe('inconclusive')
  })

  it('引用对应阶段的实质内容（observation 非 stage 字段）→ 逐维覆盖满足，正常判 pass', () => {
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 90, controlConsistency: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      evidence: [{ id: 'E1', source: 'publicTrace', index: 0, path: 'observation.visibleMessages' }], findings: [], recommendations: []
    }, input)

    expect(output.integrity?.missingDimensionEvidence).toEqual([])
    expect(output.integrity?.valid).toBe(true)
    expect(output.verdict).toBe('pass')
  })

  it('缺失/非法分数 → inconclusive，并在 integrity.missingScores 留痕', () => {
    const missing = normalizeRefereeOutput({
      scores: { goalExperience: 90, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      evidence: [], findings: [], recommendations: []
    }, input)
    expect(missing.integrity?.valid).toBe(false)
    expect(missing.integrity?.missingScores).toContain('controlConsistency')
    expect(missing.verdict).toBe('inconclusive')

    const invalid = normalizeRefereeOutput({
      scores: { goalExperience: 90, controlConsistency: 140, boundaryIntegrity: 90, evidenceSufficiency: 90 },
      evidence: [], findings: [], recommendations: []
    }, input)
    expect(invalid.integrity?.missingScores).toContain('controlConsistency')
    expect(invalid.verdict).toBe('inconclusive')
  })

  it('悬空证据引用 → inconclusive（即使分数很高）', () => {
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 95, controlConsistency: 95, boundaryIntegrity: 95, evidenceSufficiency: 95 },
      evidence: [],
      findings: [{
        code: 'DANGLING', severity: 'minor', category: 'trace',
        title: '引用了不存在的证据', detail: 'x', evidenceIds: ['E404']
      }],
      recommendations: []
    }, input)

    expect(output.findings).toEqual([])
    expect(output.integrity?.danglingEvidenceRefs).toContain('E404')
    expect(output.verdict).toBe('inconclusive')
  })

  it.each([
    { evidence: [] },
    { evidence: [{ source: 'publicTrace', index: 0, path: 'observation.nonexistent' }] },
  ])('没有可定位证据时不能凭高分通过 %#', ({ evidence }) => {
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 95, controlConsistency: 95, boundaryIntegrity: 95, evidenceSufficiency: 95 },
      evidence, findings: [], recommendations: [],
    }, input);
    expect(output.verdict).toBe('inconclusive');
    expect(output.integrity?.missingEvidence).toBe(true);
  });

  it('合法低分仍按 fail 上报，不被当成证据不足', () => {
    const output = normalizeRefereeOutput({
      scores: { goalExperience: 30, controlConsistency: 30, boundaryIntegrity: 30, evidenceSufficiency: 70 },
      evidence: [{ source: 'publicTrace', index: 0, path: 'observation.visibleMessages' }], findings: [], recommendations: []
    }, input)

    expect(output.integrity?.valid).toBe(true)
    expect(output.integrity?.missingDimensionEvidence).toEqual([])
    expect(output.verdict).toBe('fail')
  })
})
