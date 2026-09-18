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

describe('virtual-learner-learn-turn-simulator · 检查点作答（P1-3）', () => {
  const withCheckpoint: LearnLearnerSimulationInput = {
    ...input,
    pendingCheckpoint: {
      id: 'cp1',
      type: 'single_choice',
      question: '哪个是条件类型？',
      options: [{ id: 'A', text: 'T extends U' }, { id: 'B', text: 'Array<T>' }],
      allowSkip: true,
    },
  }

  it('选择题：保留真实存在的选项 id，丢弃编造的 id', () => {
    const output = normalizeOutput(
      { reply: '我选 B。', checkpointAnswer: { selectedOptionIds: ['B', 'ZZZ'], confidence: 0.7 } },
      withCheckpoint,
    )
    expect(output.checkpointAnswer).toEqual({ selectedOptionIds: ['B'], confidence: 0.7 })
  })

  it('简答题：保留 answerText', () => {
    const shortInput: LearnLearnerSimulationInput = {
      ...input,
      pendingCheckpoint: { id: 'cp2', type: 'short_answer', question: '说说为什么' },
    }
    const output = normalizeOutput({ reply: '因为擦除。', checkpointAnswer: { answerText: '  因为类型擦除  ' } }, shortInput)
    expect(output.checkpointAnswer).toEqual({ answerText: '因为类型擦除' })
  })

  it('没有待答检查点时，不产出 checkpointAnswer', () => {
    const output = normalizeOutput({ reply: '继续吧。', checkpointAnswer: { selectedOptionIds: ['A'] } }, input)
    expect(output.checkpointAnswer).toBeUndefined()
  })

  it('草案无效（选项 id 全不存在）→ 不产出，交给 runner 兜底', () => {
    const output = normalizeOutput({ reply: '……', checkpointAnswer: { selectedOptionIds: ['ZZZ'] } }, withCheckpoint)
    expect(output.checkpointAnswer).toBeUndefined()
  })
})
