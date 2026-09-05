const mockCallPrompt = jest.fn()

jest.mock('../../../composers/prompt-composer', () => ({ callPrompt: mockCallPrompt }))

import {
  normalizeOutput,
  virtualLearnerLearnTurnSimulator,
  VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED,
  LEARN_STATE_FIELDS,
  LEARN_FEEDBACK_FIELDS,
} from '../index'
import type { LearnLearnerSimulationInput } from '../index'

const input: LearnLearnerSimulationInput = {
  learner: {},
  story: null,
  visibleContext: { history: [], lastTeacherMessage: '' },
  currentPhase: 'trying',
  previousLearnerState: null,
  currentTask: null,
  knowledgeSnapshot: [],
}

describe('virtual-learner-learn-turn-simulator normalize', () => {
  it('部分输出：缺失字段被补齐并记录 normalizedFallback 审计标记', () => {
    const output = normalizeOutput({ reply: '我试试。' }, input)
    expect(output.debug?.normalizedFallback?.fieldCount).toBe(
      LEARN_STATE_FIELDS.length + LEARN_FEEDBACK_FIELDS.length
    )
    expect(output.debug?.normalizedFallback?.learnerState).toContain('taskUnderstanding')
    expect(typeof output.learnerState.taskUnderstanding).toBe('number')
  })
})

describe('virtual-learner-learn-turn-simulator 失败显式传播', () => {
  beforeEach(() => jest.clearAllMocks())

  it('callPrompt 抛错 → success:false（不再产出伪 selfReportedTaskDone）', async () => {
    mockCallPrompt.mockRejectedValue(new Error('boom'))
    const result = await virtualLearnerLearnTurnSimulator(input)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED)
    expect(result.error?.message).toBe('boom')
    expect(result.output).toBeUndefined()
  })

  it('callPrompt success:false → success:false（与 catch 路径统一）', async () => {
    mockCallPrompt.mockResolvedValue({
      success: false,
      error: { code: 'SKILL_X_FAILED', message: 'validation failed' },
      debug: { durationMs: 4 },
    })
    const result = await virtualLearnerLearnTurnSimulator(input)
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe(VIRTUAL_LEARNER_LEARN_TURN_SIMULATION_FAILED)
    expect(result.error?.message).toBe('validation failed')
    expect(result.output).toBeUndefined()
  })
})
