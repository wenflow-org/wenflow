const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }))

import {
  normalizeOutput,
  virtualLearnerPathEvaluator,
  VIRTUAL_LEARNER_PATH_EVALUATION_FAILED,
} from '../index'
import type { VirtualLearnerPathEvaluatorInput } from '../index'

const input: VirtualLearnerPathEvaluatorInput = {
  learner: {},
  story: null,
  pathProposal: {},
  goalState: null,
  previousReaction: null,
  learnerState: null,
}

describe('virtual-learner-path-evaluator normalize', () => {
  it('完整输出：normalizedFallback 为 0，字段透传', () => {
    const output = normalizeOutput({
      reaction: '这版方案基本贴我。',
      visibleRequestedChanges: ['减少任务量'],
      debug: { internalDecision: 'modify', internalConfidence: 0.6 },
    }, input)

    expect(output.reaction).toBe('这版方案基本贴我。')
    expect(output.debug?.internalDecision).toBe('modify')
    expect(output.debug?.internalConfidence).toBe(0.6)
    expect(output.debug?.normalizedFallback).toEqual({ fieldCount: 0, fields: [] })
  })

  it('部分输出：缺失字段被补齐并记录 normalizedFallback 审计标记', () => {
    const output = normalizeOutput({ debug: {} }, input)

    expect(output.debug?.normalizedFallback?.fieldCount).toBeGreaterThan(0)
    expect(output.debug?.normalizedFallback?.fields).toEqual(
      expect.arrayContaining(['reaction', 'internalDecision', 'internalConfidence'])
    )
    expect(output.reaction.length).toBeGreaterThan(0)
    expect(output.debug?.internalDecision).toBe('accept')
  })
})

describe('virtual-learner-path-evaluator 失败显式传播', () => {
  beforeEach(() => jest.clearAllMocks())

  it('callPrompt 抛错 → success:false（不再产出伪 decision/confidence）', async () => {
    mockCallPrompt.mockRejectedValue(new Error('boom'))
    const result = await virtualLearnerPathEvaluator(input)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(VIRTUAL_LEARNER_PATH_EVALUATION_FAILED)
    expect(result.error?.message).toBe('boom')
    expect(result.output).toBeUndefined()
  })

  it('callPrompt success:false → success:false（错误信息透传）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'SKILL_X_FAILED', message: 'validation failed' },
      debug: { durationMs: 3 },
    })
    const result = await virtualLearnerPathEvaluator(input)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(VIRTUAL_LEARNER_PATH_EVALUATION_FAILED)
    expect(result.error?.message).toBe('validation failed')
    expect(result.output).toBeUndefined()
  })
})
