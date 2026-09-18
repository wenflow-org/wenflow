/**
 * assisted 链路检查点消费测试（2026-09）。
 *
 * 修复的缺口：`executeLearningStep`（`POST /advance-day` 的 `runTasks:true`，即
 * simulation.coordinator）此前从不读取 `getSessionDetail` 暴露的 `pendingCheckpoint`、
 * 也从不调用 `submitCheckpoint`。结果平台一旦出题，待答检查点永远挂着，
 * `learner_evidence(type='checkpoint:result')`（成功带传感器）一条也不写。
 *
 * 覆盖：
 *  - 纯决策 `resolveCheckpointSubmitAction`：有待答检查点 + 模拟器作答 → submit（id/payload 正确）；
 *    无检查点 / 无作答 / 非法选项 → 退回聊天回合；
 *  - `runTeachingTurn`：喂入 `getSessionDetail` 返回的 pendingCheckpoint 与模拟器返回的
 *    checkpointAnswer → 调用 `submitCheckpoint`（正确 id/payload/revision），不再走聊天回合；
 *    无检查点 → 不调用 `submitCheckpoint`，走 `processStudentMessage`；提交失败 → 记警告并回退。
 *
 * 说明：悬空 getSessionDetail→pendingCheckpoint 的读取发生在 `executeLearningStep` 内联处，
 * 此处直接以「该读取的产物」驱动 `runTeachingTurn`，等价覆盖决策与提交。
 */
const mockSessionFindUnique = jest.fn()
const mockSessionUpdate = jest.fn()
const mockExecuteSkill = jest.fn()
const mockGetSessionDetail = jest.fn()
const mockProcessStudentMessage = jest.fn()
const mockSubmitCheckpoint = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      virtual_sessions: {
        findUnique: mockSessionFindUnique,
        update: mockSessionUpdate
      }
    }),
    virtual_sessions: {
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate
    }
  }
}))

jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: {
    getSessionDetail: (...args: unknown[]) => mockGetSessionDetail(...args),
    processStudentMessage: (...args: unknown[]) => mockProcessStudentMessage(...args),
    submitCheckpoint: (...args: unknown[]) => mockSubmitCheckpoint(...args)
  }
}))

jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({ buildGoalPathVisibleSummary: jest.fn() }))
jest.mock('../../virtual-lab/learner-memory', () => ({
  buildLearnerMemorySnapshot: jest.fn(async () => null),
  recordCompletedArtifact: jest.fn(),
  writeProfileConceptsAfterLesson: jest.fn()
}))
jest.mock('../../skills', () => ({
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
  virtualLearnerGoalDialogueSimulatorDefinition: { id: 'goal-simulator' },
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: { id: 'learn-simulator' },
  virtualLearnerEpistemicGroundingDefinition: { id: 'epistemic-grounding' }
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: { generate: jest.fn() } }))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import {
  SimulationOrchestrator,
  resolveCheckpointSubmitAction,
  normalizeCheckpointSubmitTurn
} from '../simulation.coordinator'
import { logger } from '../../utils/logger'

describe('resolveCheckpointSubmitAction（纯决策）', () => {
  const checkpoint = {
    id: 'cp-1',
    type: 'single_choice' as const,
    question: '下列哪个是函数？',
    options: [
      { id: 'A', text: 'y = x' },
      { id: 'B', text: 'x + 1' }
    ]
  }

  it('有待答检查点 + 合法选项作答 → submit（正确 id / payload）', () => {
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: checkpoint,
      checkpointAnswer: { selectedOptionIds: ['A'] }
    })).toEqual({
      kind: 'submit',
      checkpointId: 'cp-1',
      payload: { selectedOptionIds: ['A'] }
    })
  })

  it('无待答检查点 → 退回聊天回合（即使模拟器给了作答）', () => {
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: null,
      checkpointAnswer: { selectedOptionIds: ['A'] }
    })).toEqual({ kind: 'process-message' })
  })

  it('有检查点但模拟器未给出作答 → 退回聊天回合', () => {
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: checkpoint,
      checkpointAnswer: null
    })).toEqual({ kind: 'process-message' })
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: checkpoint,
      checkpointAnswer: {}
    })).toEqual({ kind: 'process-message' })
  })

  it('选择题：非法选项 id 被丢弃；单选题多于一个只取首个', () => {
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: checkpoint,
      checkpointAnswer: { selectedOptionIds: ['Z', 'B', 'A'] }
    })).toEqual({
      kind: 'submit',
      checkpointId: 'cp-1',
      payload: { selectedOptionIds: ['B'] }
    })
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: { ...checkpoint, type: 'multi_choice' },
      checkpointAnswer: { selectedOptionIds: ['B', 'A'] }
    })).toEqual({
      kind: 'submit',
      checkpointId: 'cp-1',
      payload: { selectedOptionIds: ['B', 'A'] }
    })
  })

  it('简答题：只认 answerText（选项不作数）', () => {
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: { id: 'cp-2', type: 'short_answer', question: '解释闭包' },
      checkpointAnswer: { answerText: '  函数记住外部作用域  ' }
    })).toEqual({
      kind: 'submit',
      checkpointId: 'cp-2',
      payload: { answerText: '函数记住外部作用域' }
    })
    expect(resolveCheckpointSubmitAction({
      pendingCheckpoint: { id: 'cp-2', type: 'short_answer', question: '解释闭包' },
      checkpointAnswer: { selectedOptionIds: ['A'] }
    })).toEqual({ kind: 'process-message' })
  })
})

describe('normalizeCheckpointSubmitTurn（结果映射）', () => {
  it('把 submit 结果映射为教学回合形状，且不伪造教师收束信号', () => {
    const normalized = normalizeCheckpointSubmitTurn({
      passed: true,
      feedback: '很好，理解正确。',
      hint: undefined,
      nextAction: 'continue',
      revision: 12
    })
    expect(normalized).toMatchObject({
      aiResponse: '很好，理解正确。',
      revision: 12,
      isCompletion: false,
      autoEnded: false,
      knowledgePoints: [],
      closureSignal: { isCompletion: false, autoEnded: false }
    })
  })
})

describe('SimulationOrchestrator.runTeachingTurn 检查点消费', () => {
  let coordinator: SimulationOrchestrator

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()
    mockSessionFindUnique.mockResolvedValue(undefined)
    mockSessionUpdate.mockResolvedValue(undefined)
  })

  it('getSessionDetail 有待答检查点 + 模拟器给出作答 → submitCheckpoint 正确调用，不再走聊天回合', async () => {
    // getSessionDetail 的产物（答案键已剥离）
    const pendingCheckpoint = {
      id: 'cp-1',
      type: 'single_choice',
      question: 'Q?',
      options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }]
    }
    mockGetSessionDetail.mockResolvedValue({ id: 'teach-1', revision: 7, pendingCheckpoint })
    mockSubmitCheckpoint.mockResolvedValue({
      passed: true,
      feedback: '答对了',
      nextAction: 'continue',
      revision: 42
    })

    const result = await (coordinator as unknown as {
      runTeachingTurn: (input: Record<string, unknown>) => Promise<{ aiResponse: string; revision: number }>
    }).runTeachingTurn({
      sessionId: 'sim-1',
      teachingSessionId: 'teach-1',
      learnerMessage: '我认为是 B',
      teachingRevision: 7,
      pendingCheckpoint,
      checkpointAnswer: { selectedOptionIds: ['B'] }
    })

    expect(mockSubmitCheckpoint).toHaveBeenCalledTimes(1)
    expect(mockSubmitCheckpoint).toHaveBeenCalledWith('teach-1', 'cp-1', { selectedOptionIds: ['B'] }, 7)
    expect(mockProcessStudentMessage).not.toHaveBeenCalled()
    expect(result).toMatchObject({ aiResponse: '答对了', revision: 42 })
  })

  it('无待答检查点 → 不调用 submitCheckpoint，走 processStudentMessage', async () => {
    mockGetSessionDetail.mockResolvedValue({ id: 'teach-1', revision: 7, pendingCheckpoint: null })
    mockProcessStudentMessage.mockResolvedValue({
      aiResponse: '我们继续讲下一点',
      revision: 8,
      knowledgePoints: [],
      isCompletion: false,
      strategies: []
    })

    const result = await (coordinator as unknown as {
      runTeachingTurn: (input: Record<string, unknown>) => Promise<{ aiResponse: string; revision: number }>
    }).runTeachingTurn({
      sessionId: 'sim-1',
      teachingSessionId: 'teach-1',
      learnerMessage: '老师我有个疑问',
      teachingRevision: 7,
      pendingCheckpoint: null,
      checkpointAnswer: null
    })

    expect(mockSubmitCheckpoint).not.toHaveBeenCalled()
    expect(mockProcessStudentMessage).toHaveBeenCalledWith(
      'teach-1',
      '老师我有个疑问',
      { expectedRevision: 7 }
    )
    expect(result).toMatchObject({ aiResponse: '我们继续讲下一点', revision: 8 })
  })

  it('submitCheckpoint 失败 → 记警告并回退到 processStudentMessage（不阻断循环）', async () => {
    const pendingCheckpoint = { id: 'cp-1', type: 'single_choice', options: [{ id: 'A', text: 'a' }] }
    mockGetSessionDetail.mockResolvedValue({ id: 'teach-1', revision: 7, pendingCheckpoint })
    mockSubmitCheckpoint.mockRejectedValue(new Error('理解检查不存在或已处理'))
    mockProcessStudentMessage.mockResolvedValue({
      aiResponse: '没关系，我们再看一遍',
      revision: 9,
      knowledgePoints: [],
      isCompletion: false,
      strategies: []
    })

    const result = await (coordinator as unknown as {
      runTeachingTurn: (input: Record<string, unknown>) => Promise<{ aiResponse: string; revision: number }>
    }).runTeachingTurn({
      sessionId: 'sim-1',
      teachingSessionId: 'teach-1',
      learnerMessage: '我的回答',
      teachingRevision: 7,
      pendingCheckpoint,
      checkpointAnswer: { selectedOptionIds: ['A'] }
    })

    expect(mockSubmitCheckpoint).toHaveBeenCalledTimes(1)
    expect(mockProcessStudentMessage).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ aiResponse: '没关系，我们再看一遍', revision: 9 })
    expect(logger.warn).toHaveBeenCalledWith(
      '[simulation-coordinator] 提交理解检查点失败，回退到普通教学回合',
      expect.objectContaining({ checkpointId: 'cp-1' })
    )
  })
})
