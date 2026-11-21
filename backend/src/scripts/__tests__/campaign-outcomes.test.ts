/* eslint-disable @typescript-eslint/no-var-requires */
const outcomes = require('../../../scripts/campaign-outcomes.cjs')

describe('campaign-outcomes · canonical outcome', () => {
  it('run 与 report 共用：观察上限不是平台失败', () => {
    expect(outcomes.classifyCampaignOutcome({
      result: 'failed',
      findings: [{ code: 'max-days-reached' }],
      round: 7,
      maxDays: 7,
    })).toBe('observation-exhausted')
    expect(outcomes.classifyCampaignOutcome({
      result: 'failed',
      findings: [{ code: 'goal-ended-without-path' }],
      expectNoPath: false,
    })).toBe('failed')
    expect(outcomes.classifyCampaignOutcome({
      result: 'completed',
      findings: [{ code: 'goal-ended-without-path' }],
      expectNoPath: true,
    })).toBe('expected-no-path')
  })

  it('最后一个观察日内完成仍计作完成', () => {
    expect(outcomes.classifyCampaignOutcome({ result: 'completed', round: 7, maxDays: 7 })).toBe('completed')
  })

  it('state.json 的 outcome 优先；信号退出 → interrupted', () => {
    expect(outcomes.classifyCampaignOutcome({
      stateOutcome: 'observation-exhausted',
      result: 'failed',
    })).toBe('observation-exhausted')
    expect(outcomes.classifyCampaignOutcome({ interrupted: true, result: 'completed' })).toBe('interrupted')
    expect(outcomes.classifyCampaignOutcome({ findings: [{ code: 'retry-exhausted' }] })).toBe('retry-exhausted')
  })
})

describe('campaign-outcomes · 阶段范围与功能证据', () => {
  it('no-path 只声明 goal；未覆盖阶段留空但保留解释', () => {
    const scope = outcomes.normalizeStageScope({ expectNoPath: true, observationDays: 3 })
    expect(scope).toEqual({ expectedTerminal: 'no-path', stages: ['goal'], observationDays: 3 })

    const evidence = outcomes.buildFunctionalEvidence({
      scope: outcomes.normalizeStageScope({}),
      outcome: 'observation-exhausted',
      stagesReached: ['goal', 'path'],
      rounds: 5,
      maxDays: 5,
      findings: [{ code: 'max-days-reached' }],
      stateVersion: 1,
      dataComplete: true,
      stageData: { goal: true, path: true, teaching: false, completion: false },
    })
    expect(evidence.scoreIndependent).toBe(true)
    expect(evidence.stages.find((item: any) => item.stage === 'teaching')?.missing)
      .toEqual(expect.arrayContaining(['stage-not-observed']))
    expect(evidence.checks.find((item: any) => item.code === 'declared-terminal-reached')?.ok).toBe(false)
  })
})

describe('campaign-outcomes · attempt preservation', () => {
  it('新尝试追加而不覆盖历史', () => {
    const prior = {
      attempt: 2,
      startedAt: '2026-11-01T00:00:00.000Z',
      finishedAt: '2026-11-01T01:00:00.000Z',
      outcome: 'failed',
      round: 1,
      findings: [{ code: 'x', detail: 'old' }],
    }
    const attempts = outcomes.appendAttempt(prior, {
      attempt: 3,
      outcome: 'completed',
      round: 7,
      findings: [],
    })
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({ attempt: 2, outcome: 'failed', round: 1 })
    expect(attempts[1]).toMatchObject({ attempt: 3, outcome: 'completed', round: 7 })
  })

  it('旧 result 没有 attempts[] 时保留当前 attempt', () => {
    const attempts = outcomes.appendAttempt({ attempt: 1, exitCode: 1, round: 2, findings: [] }, {
      attempt: 2,
      outcome: 'interrupted',
      round: 2,
      findings: [],
    })
    expect(attempts.map((item: any) => item.attempt)).toEqual([1, 2])
  })
})
