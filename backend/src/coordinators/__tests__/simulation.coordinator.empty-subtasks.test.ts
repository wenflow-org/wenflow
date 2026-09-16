/**
 * startLearningPhase —— 「里程碑无可用子任务」的正规处置（防退化）
 *
 * 背景：子任务由「阶段设计」异步产出（generateLearningPath 里 stage-enrichment 走
 * runBackgroundTask 且不 await），所以刚生成完的 Path 常见「里程碑已建、子任务未落库」。
 * 曾经的做法是 `restartPathPhase`（删 Path 重建）——既重启同一竞态，又在 learning_paths.delete
 * 后留下孤儿里程碑。本用例锁定正确处置：按生成状态交给 retryPathEnrichment，且**绝不删路径**。
 */
const mockVirtualSessionFindUnique = jest.fn()
const mockVirtualSessionUpdate = jest.fn()
const mockPathFindUnique = jest.fn()
const mockPathDelete = jest.fn()
const mockRetryPathEnrichment = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: mockVirtualSessionFindUnique,
      update: mockVirtualSessionUpdate
    },
    learning_paths: {
      findUnique: mockPathFindUnique,
      delete: mockPathDelete
    }
  }
}))
jest.mock('../../services/learning/goal-conversation.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { retryPathEnrichment: mockRetryPathEnrichment }
}))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/AITeachingCoordinator', () => ({
  __esModule: true,
  default: { resetSession: jest.fn(async () => ({})) }
}))
jest.mock('../../services/agentConfig.service', () => ({ getSimulationAgentConfig: jest.fn() }))
jest.mock('../../skills', () => ({
  executeSkill: jest.fn(),
  virtualLearnerGoalDialogueSimulatorDefinition: {},
  virtualLearnerPathEvaluatorDefinition: {},
  virtualLearnerLearnTurnSimulatorDefinition: {}
}))
jest.mock('../../skills/virtual-learner-shared', () => ({
  normalizeFrictionBudget: (value: string) => value || 'normal'
}))
jest.mock('../../skills/session-wrapup', () => ({ sessionWrapupAgent: { generate: jest.fn() } }))
jest.mock('../../services/learning/goal-path-visible-summary', () => ({
  buildGoalPathVisibleSummary: jest.fn()
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { SimulationOrchestrator } from '../simulation.coordinator'

describe('startLearningPhase：里程碑无可用子任务时不删路径', () => {
  let coordinator: SimulationOrchestrator

  beforeEach(() => {
    jest.clearAllMocks()
    coordinator = new SimulationOrchestrator()

    // 会话：running + 已绑定 path
    mockVirtualSessionFindUnique.mockImplementation(async ({ select }: { select?: { logs?: boolean } }) => {
      if (select?.logs) return { logs: '[]' } // addSessionLog 只取 logs 列
      return {
        id: 'sim-1',
        userId: 'user-1',
        status: 'running',
        currentStage: 'path',
        learningPathId: 'path-1',
        stageResults: JSON.stringify({}),
        logs: '[]',
        virtual_learner_profiles: { id: 'profile-1', profile: '{}' }
      }
    })
    mockVirtualSessionUpdate.mockResolvedValue({})

    // Path：里程碑存在，但**没有任何子任务**
    mockPathFindUnique.mockResolvedValue({
      id: 'path-1',
      status: 'active',
      userId: 'user-1',
      milestones: [{ id: 'm-1', stageNumber: 1, title: '阶段1', subtasks: [] }]
    })
  })

  it('阶段设计仍在生成中 → 如实上报未就绪，不删路径、不伪造重生成', async () => {
    mockRetryPathEnrichment.mockRejectedValue(new Error('阶段任务仍在生成中，请稍后查看'))

    const result = await coordinator.startLearningPhase('sim-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/阶段设计未就绪/)
    expect(mockRetryPathEnrichment).toHaveBeenCalledWith('path-1', 'user-1')
    // 关键回归：绝不能删路径重建（那会烧掉竞态与证据链）
    expect(mockPathDelete).not.toHaveBeenCalled()
  })

  it('阶段设计已失败/超时 → 触发官方阶段设计重试（不删路径）', async () => {
    mockRetryPathEnrichment.mockResolvedValue({ accepted: true, retryType: 'stageDesign', retryCount: 2, runId: 'run-2' })

    const result = await coordinator.startLearningPhase('sim-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/已触发阶段设计重试 #2/)
    expect(mockRetryPathEnrichment).toHaveBeenCalledWith('path-1', 'user-1')
    expect(mockPathDelete).not.toHaveBeenCalled()
  })

  it('追加式补齐（已有课堂证据的空白阶段）→ 文案标明追加，仍不删路径', async () => {
    mockRetryPathEnrichment.mockResolvedValue({
      accepted: true, retryType: 'stageDesign', mode: 'append', retryCount: 1, runId: 'run-3', emptyMilestoneCount: 2
    })

    const result = await coordinator.startLearningPhase('sim-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/已触发追加空白阶段任务 #1/)
    expect(mockPathDelete).not.toHaveBeenCalled()
  })
})
