const mockCallPrompt = jest.fn();

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }));

import { normalizeOutput, GOAL_STATE_FIELDS, virtualLearnerGoalDialogueSimulator, VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATION_FAILED } from '../index'
import type { GoalLearnerSimulationInput } from '../index'

const input: GoalLearnerSimulationInput = {
  learner: { nameHint: '测试学习者' },
  story: null,
  visibleContext: { history: [{ role: 'learner', content: '我最近总被消息打断' }] },
  currentPhase: 'understanding',
  previousLearnerState: null,
}

describe('virtual-learner-goal-dialogue-simulator normalize', () => {
  it('完整输出：normalizedFallback 为 0，字段透传', () => {
    const parsed = {
      reply: '我其实最怕的是中途又要被打断。',
      emotion: 'slightly_frustrated',
      learnerState: {
        phaseFocus: 'understanding',
        feltUnderstood: 0.7,
        problemClarity: 0.6,
        proposalFit: 0.5,
        taskRelevance: 0.6,
        executionConcern: 0.4,
        willingToTry: true,
        readyToProceed: false,
        wantsClarification: true,
        readyToAdvance: false,
        goalReadiness: 0.55,
        remainingUnknowns: ['执行环境不确定'],
      },
      debug: { visibleSignal: 'x', stateChangeReason: 'y' },
    }
    const output = normalizeOutput(parsed, input)
    expect(output.reply).toBe('我其实最怕的是中途又要被打断。')
    expect(output.learnerState.feltUnderstood).toBe(0.7)
    expect(output.debug?.normalizedFallback).toEqual({ fieldCount: 0, fields: [] })
  })

  it('部分输出：缺失字段被 fallback 补齐并记录 normalizedFallback', () => {
    const output = normalizeOutput({
      reply: '嗯，我大概明白了。',
      learnerState: { phaseFocus: 'proposal_evaluation', feltUnderstood: 0.8 },
    }, input)

    expect(output.reply).toBe('嗯，我大概明白了。')
    const fallback = output.debug?.normalizedFallback
    expect(fallback?.fieldCount).toBeGreaterThan(0)
    expect(fallback?.fields.length).toBeGreaterThan(0)
    expect(fallback?.fields).not.toContain('feltUnderstood')
    expect(fallback?.fields).not.toContain('phaseFocus')
    expect(fallback?.fields).toContain('problemClarity')
    // 补齐后的状态字段仍完整可消费
    expect(typeof output.learnerState.proposalFit).toBe('number')
    expect(typeof output.learnerState.goalReadiness).toBe('number')
    expect(GOAL_STATE_FIELDS.length).toBe(12)
  })

  it('完全没有 learnerState 时回退 buildFallback 语义', () => {
    const output = normalizeOutput({ reply: '' }, input)
    expect(output.reply.length).toBeGreaterThan(0)
    expect(output.debug?.normalizedFallback?.fieldCount).toBe(GOAL_STATE_FIELDS.length)
    expect(output.learnerState.remainingUnknowns.length).toBeGreaterThan(0)
  })
})

describe('virtual-learner-goal-dialogue-simulator 失败显式传播', () => {
  beforeEach(() => jest.clearAllMocks())

  it('callPrompt 抛错 → success:false（不再产出伪 learnerState）', async () => {
    mockCallPrompt.mockRejectedValue(new Error('boom'))
    const result = await virtualLearnerGoalDialogueSimulator(input)
    expect(result.success).toBe(false)
    expect(result.error).toEqual({ code: VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATION_FAILED, message: 'boom' })
    expect(result.output).toBeUndefined()
  })

  it('callPrompt success:false → success:false（错误信息透传，无 fallback 输出）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'SKILL_X_FAILED', message: 'validation failed' },
      debug: { durationMs: 7 },
    })
    const result = await virtualLearnerGoalDialogueSimulator(input)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(VIRTUAL_LEARNER_GOAL_DIALOGUE_SIMULATION_FAILED)
    expect(result.error?.message).toBe('validation failed')
    expect(result.output).toBeUndefined()
  })
})
