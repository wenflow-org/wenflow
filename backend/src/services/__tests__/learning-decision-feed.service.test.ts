import { LearningDecisionFeedService } from '../learner/LearningDecisionFeedService'

const service = new LearningDecisionFeedService()

const baseInput = () => ({
  paths: [] as any[],
  sessions: [] as any[],
  learnerSnapshot: null as any,
  summary: null as any
})

describe('LearningDecisionFeedService', () => {
  it('advisory.shouldSuggest 时产出 path-adjust 卡，捕获点来自 wrapup.progress', () => {
    const input = baseInput()
    input.sessions = [{
      endTime: new Date('2026-07-26T09:00:00Z'),
      advisory: JSON.stringify({
        shouldSuggest: true,
        priority: 'high',
        rationale: '当前阶段仍有关键知识点不够稳定。',
        ui: { title: '建议先调整下一阶段安排' }
      }),
      wrapup: JSON.stringify({
        progress: { stillLearning: ['变量赋值'], movedToReview: ['for循环'] }
      })
    }]

    const cards = service.build(input)
    expect(cards).toHaveLength(1)
    expect(cards[0].kind).toBe('path-adjust')
    expect(cards[0].priority).toBe('high')
    expect(cards[0].captured).toContain('变量赋值')
    expect(cards[0].captured).toContain('for循环')
    expect(cards[0].judgment).toContain('不够稳定')
    expect(cards[0].action).toBe('建议先调整下一阶段安排')
    expect(cards[0].at).toBe('2026-07-26T09:00:00.000Z')
  })

  it('路径有 replanReason 时产出 path-replanned 卡', () => {
    const input = baseInput()
    input.paths = [{
      id: 'p1',
      title: 'Excel 自动化',
      replanReason: '掌握证据显示前置缺口',
      updatedAt: new Date('2026-07-25T10:00:00Z')
    }]

    const cards = service.build(input)
    const card = cards.find((c) => c.kind === 'path-replanned')
    expect(card).toBeDefined()
    expect(card!.judgment).toBe('掌握证据显示前置缺口')
    expect(card!.action).toContain('新的路径版本')
  })

  it('学习者快照有脆弱概念时产出 concept-watch 卡', () => {
    const input = baseInput()
    input.learnerSnapshot = {
      knowledgeMemory: {
        globalSignals: { fragileConcepts: ['列表索引'], strugglingConcepts: ['循环边界'] }
      }
    }

    const cards = service.build(input)
    const card = cards.find((c) => c.kind === 'concept-watch')
    expect(card).toBeDefined()
    expect(card!.captured).toContain('列表索引')
    expect(card!.captured).toContain('循环边界')
    expect(card!.priority).toBe('info')
  })

  it('无 advisory 但最近课程有未掌握点时产出 kp-carryover 卡', () => {
    const input = baseInput()
    input.sessions = [{
      endTime: new Date('2026-07-26T08:00:00Z'),
      advisory: null,
      wrapup: JSON.stringify({ progress: { stillLearning: ['函数定义'] } })
    }]

    const cards = service.build(input)
    const card = cards.find((c) => c.kind === 'kp-carryover')
    expect(card).toBeDefined()
    expect(card!.captured).toContain('函数定义')
    expect(card!.action).toContain('优先巩固')
  })

  it('有 path-adjust 时不再重复产出 kp-carryover', () => {
    const input = baseInput()
    input.sessions = [{
      endTime: new Date('2026-07-26T09:00:00Z'),
      advisory: JSON.stringify({
        shouldSuggest: true, priority: 'low', rationale: 'r', ui: { title: 't' }
      }),
      wrapup: JSON.stringify({ progress: { stillLearning: ['函数定义'] } })
    }]

    const cards = service.build(input)
    expect(cards.some((c) => c.kind === 'path-adjust')).toBe(true)
    expect(cards.some((c) => c.kind === 'kp-carryover')).toBe(false)
  })

  it('状态需要恢复时产出 pace 卡', () => {
    const input = baseInput()
    input.summary = {
      global: { stateLevel: 'recover', warningLevel: 'warning', hasWarnings: true }
    }

    const cards = service.build(input)
    expect(cards.some((c) => c.kind === 'pace')).toBe(true)
  })

  it('无信号时返回空数组', () => {
    expect(service.build(baseInput())).toEqual([])
  })
})
