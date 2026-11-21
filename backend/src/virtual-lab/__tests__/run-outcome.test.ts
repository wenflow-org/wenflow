import {
  buildFunctionalEvidence,
  classifyRunTerminal,
  computeStageCoverage,
  expectedTerminalMatches,
  normalizeStageScope,
} from '../run-outcome'

describe('run-outcome · 终态分类', () => {
  it('观察天数用尽不等于平台失败', () => {
    expect(classifyRunTerminal({ result: 'exhausted', findings: [{ code: 'max-days-reached' }] }))
      .toBe('observation-exhausted')
    expect(classifyRunTerminal({ result: 'failed', findings: [{ code: 'max-days-reached' }] }))
      .toBe('observation-exhausted')
    expect(classifyRunTerminal({ result: 'failed', findings: [{ code: 'advance-day-fatal' }] }))
      .toBe('failed')
  })

  it('最后一个观察日内完成仍计作完成', () => {
    expect(classifyRunTerminal({ result: 'completed', round: 7, maxDays: 7 })).toBe('completed')
  })

  it('主动结束 / 预期不排课 / 中断 / 重试耗尽分列', () => {
    expect(classifyRunTerminal({ result: 'failed', goalOutcome: 'learner-left', expectNoPath: false }))
      .toBe('learner-ended')
    expect(classifyRunTerminal({ result: 'completed', goalOutcome: 'no-path', expectNoPath: true }))
      .toBe('expected-no-path')
    expect(classifyRunTerminal({ interrupted: true })).toBe('interrupted')
    expect(classifyRunTerminal({ findings: [{ code: 'retry-exhausted' }] })).toBe('retry-exhausted')
  })

  it('state.json 里已算好的 outcome 优先（run 与 report 共用）', () => {
    expect(classifyRunTerminal({
      stateOutcome: 'observation-exhausted',
      result: 'failed',
      findings: [{ code: 'advance-day-fatal' }],
    })).toBe('observation-exhausted')
  })
})

describe('run-outcome · 阶段范围', () => {
  it('no-path 默认只声明 goal，path 默认声明四阶段', () => {
    expect(normalizeStageScope({ expectNoPath: true }).stages).toEqual(['goal'])
    expect(normalizeStageScope({}).stages).toEqual(['goal', 'path', 'teaching', 'completion'])
  })

  it('别名归一且显式 stages 覆盖默认值', () => {
    expect(normalizeStageScope({ stages: ['classroom', 'settlement', 'retention'], expectedTerminal: 'observation-exhausted' }))
      .toEqual({ expectedTerminal: 'observation-exhausted', stages: ['teaching', 'completion', 'review'], observationDays: null })
  })
})

describe('run-outcome · 阶段覆盖（必须在截断前计算）', () => {
  it('从完整轨迹统计，且接受 {observation.stage} 与 {stage}', () => {
    const trace = [
      { observation: { stage: 'goal' } },
      { stage: 'path' },
      { observation: { stage: 'path' } },
      { observation: { stage: 'teaching' } },
      { observation: { stage: 'completed' } },
      { observation: { stage: 'not-a-stage' } },
    ]
    const result = computeStageCoverage(trace)
    expect(result.stageCoverage).toEqual({ goal: true, path: true, teaching: true, completed: true, error: false })
    expect(result.observedCounts).toEqual({ goal: 1, path: 2, teaching: 1, completed: 1, error: 0 })
    expect(result.traceCount).toBe(6)
    expect(result.coverageSource).toBe('full-trace')
  })

  it('空/非法输入不冒充覆盖', () => {
    expect(computeStageCoverage([]).stageCoverage.error).toBe(false)
    expect(computeStageCoverage([null, {}, { observation: {} }]).traceCount).toBe(3)
  })
})

describe('run-outcome · 功能证据与效果分无关', () => {
  const scope = normalizeStageScope({ stages: ['goal', 'path', 'teaching', 'completion'], observationDays: 7 })

  it('未覆盖阶段留空并写 missing，不排除样本', () => {
    const evidence = buildFunctionalEvidence({
      scope,
      terminal: 'observation-exhausted',
      stagesReached: ['goal', 'path'],
      rounds: 7,
      maxDays: 7,
      findings: [{ code: 'max-days-reached', detail: '7 天' }],
      stateVersion: 1,
      dataComplete: true,
      stageData: { goal: true, path: true, teaching: false, completion: false },
    })

    expect(evidence.scoreIndependent).toBe(true)
    expect(evidence.declared.stages).toEqual(['goal', 'path', 'teaching', 'completion'])
    expect(evidence.actual.terminal).toBe('observation-exhausted')
    expect(evidence.stages.find((item) => item.stage === 'teaching')?.missing)
      .toEqual(expect.arrayContaining(['stage-not-observed', 'stage-data-missing']))
    expect(evidence.checks.find((item) => item.code === 'declared-terminal-reached')?.ok).toBe(false)
    expect(evidence.checks.find((item) => item.code === 'stage:path:coverage')?.ok).toBe(true)
  })

  it('版本/数据缺失只让对应检查失败，证据仍保留', () => {
    const evidence = buildFunctionalEvidence({
      scope: normalizeStageScope({ expectNoPath: true }),
      terminal: 'expected-no-path',
      stagesReached: ['goal'],
      rounds: 0,
      stateVersion: 2,
      dataComplete: false,
    })
    expect(evidence.declared.expectedTerminal).toBe('no-path')
    expect(expectedTerminalMatches('no-path', 'expected-no-path')).toBe(true)
    expect(evidence.checks.find((item) => item.code === 'state-version-valid')?.ok).toBe(false)
    expect(evidence.checks.find((item) => item.code === 'data-complete')?.ok).toBe(false)
    expect(evidence.checks.find((item) => item.code === 'declared-terminal-reached')?.ok).toBe(true)
  })
})
