import {
  decideFrictionTrigger,
  getFrictionGuidance,
  normalizeFrictionBudget,
  DEFAULT_FRICTION_BUDGET,
} from '../schemas'

describe('virtual-learner friction budget', () => {
  it('none 永不触发，guidance 为完全合作文本', () => {
    const decision = decideFrictionTrigger('none', () => 0)
    expect(decision.triggered).toBe(false)
    expect(decision.budget).toBe('none')
    expect(decision.guidance).toContain('保持完全合作')
  })

  it('normal(0.3) 按注入 rng 采样：rng < 0.3 触发，否则不触发', () => {
    const triggered = decideFrictionTrigger('normal', () => 0.299)
    expect(triggered.triggered).toBe(true)
    expect(triggered.guidance).toContain('触发轮')

    const calm = decideFrictionTrigger('normal', () => 0.301)
    expect(calm.triggered).toBe(false)
    expect(calm.guidance).toContain('平稳轮')
  })

  it('stress_test(0.85) 高概率触发且边界正确', () => {
    expect(decideFrictionTrigger('stress_test', () => 0.849).triggered).toBe(true)
    expect(decideFrictionTrigger('stress_test', () => 0.851).triggered).toBe(false)
  })

  it('未知 budget 回退默认档 normal', () => {
    const decision = decideFrictionTrigger('unknown-budget' as any, () => 0)
    expect(decision.budget).toBe(DEFAULT_FRICTION_BUDGET)
    expect(decision.triggered).toBe(true) // rng=0 < 0.3
  })

  it('不注入 rng 时使用 Math.random（结果在合法枚举内）', () => {
    for (let i = 0; i < 20; i += 1) {
      const decision = decideFrictionTrigger('high')
      expect(['low', 'normal', 'high', 'stress_test'].includes(decision.budget)).toBe(true)
      expect(typeof decision.triggered).toBe('boolean')
      expect(decision.guidance.length).toBeGreaterThan(0)
    }
  })

  it('legacy getFrictionGuidance / normalizeFrictionBudget 保持兼容', () => {
    expect(normalizeFrictionBudget('high')).toBe('high')
    expect(normalizeFrictionBudget('bogus')).toBe(DEFAULT_FRICTION_BUDGET)
    expect(getFrictionGuidance('normal').triggerProbability).toBe(0.3)
    expect(getFrictionGuidance('normal').promptHint.length).toBeGreaterThan(0)
  })

  it('每档 guidance 都区分触发轮/平稳轮，且 none 两文本一致', () => {
    for (const budget of ['none', 'low', 'normal', 'high', 'stress_test'] as const) {
      const guidance = getFrictionGuidance(budget)
      expect(guidance.triggerGuidance.length).toBeGreaterThan(0)
      expect(guidance.calmGuidance.length).toBeGreaterThan(0)
      if (budget === 'none') {
        expect(guidance.triggerGuidance).toBe(guidance.calmGuidance)
      } else {
        expect(guidance.triggerGuidance).not.toBe(guidance.calmGuidance)
      }
    }
  })
})
