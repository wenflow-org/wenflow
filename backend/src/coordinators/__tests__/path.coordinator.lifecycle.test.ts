const mockGenerateLearningPath = jest.fn()
const mockRunBackgroundTask = jest.fn()
const mockIsAccepting = jest.fn(() => true)
const mockResolveExistingPathEvidence = jest.fn()

jest.mock('../../services/learning/learning.service', () => ({
  __esModule: true,
  default: { generateLearningPath: mockGenerateLearningPath }
}))
jest.mock('../../services/background-task-tracker.service', () => ({
  runBackgroundTask: mockRunBackgroundTask,
  backgroundTaskTracker: { isAccepting: mockIsAccepting },
  BackgroundTaskRejectedError: class BackgroundTaskRejectedError extends Error {}
}))
jest.mock('../../services/agentConfig.service', () => ({
  getPathAgentInputConfig: jest.fn()
}))
// #227：既有路径的凭证解析要读 DB（路径行 + 关联目标会话），本文件只测后台任务生命周期，
// 故把解析器桩掉——闸门本身（assertPathGenerationAllowed / 判定口径）保持真实。
jest.mock('../../services/learning/goal-triage-evidence', () => ({
  __esModule: true,
  resolveGoalTriageEvidenceForPathId: (...args: unknown[]) => mockResolveExistingPathEvidence(...args)
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn() }
}))

import { pathCoordinator } from '../path.coordinator'

// #217：generate 是生成路径的唯一动作入口，要求带 goal 层判定凭证。
// 本文件只测后台任务生命周期，给一份可判定的凭证即可（不改变任何断言）。
const GOAL_TRIAGE_EVIDENCE = {
  goalTriage: { understanding: { primary_block_type: 'capability', recurrence: 'recurring' } }
}

describe('PathCoordinator background lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsAccepting.mockReturnValue(true)
    mockResolveExistingPathEvidence.mockResolvedValue(null)
  })

  it('runAsync 将 generation 和 hooks 放入同一个 lazy tracked task', async () => {
    const onSuccess = jest.fn()
    mockGenerateLearningPath.mockResolvedValue({ id: 'path-1' })
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript', ...GOAL_TRIAGE_EVIDENCE }, { onSuccess })

    expect(mockRunBackgroundTask).toHaveBeenCalledTimes(1)
    const [name, task, context] = mockRunBackgroundTask.mock.calls[0]
    expect(name).toBe('learning.path.async-generation')
    expect(context).toEqual({ userId: 'user-1', existingPathId: undefined })
    expect(mockGenerateLearningPath).not.toHaveBeenCalled()

    await task()
    expect(mockGenerateLearningPath).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('generation 失败时等待 onError 并保留原始失败给 Tracker 记录', async () => {
    const onError = jest.fn().mockResolvedValue(undefined)
    mockGenerateLearningPath.mockRejectedValue(new Error('generation failed'))
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript', ...GOAL_TRIAGE_EVIDENCE }, { onError })

    const task = mockRunBackgroundTask.mock.calls[0][1]
    await expect(task()).rejects.toThrow('generation failed')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'generation failed' }))
  })

  it('draining 时不启动 generation，并通知业务 hook 收敛占位状态', async () => {
    mockIsAccepting.mockReturnValue(false)
    const onError = jest.fn().mockResolvedValue(undefined)
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript', ...GOAL_TRIAGE_EVIDENCE }, { onError })

    await Promise.resolve()
    expect(mockRunBackgroundTask).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  // #227 语义订正：此前这一条断言「带 existingPathId 就不需要判定凭证」——那正是
  // 「空壳路径（POST /paths 任意文本）+ rebuild-all」绕过闸门的根据。豁免前提改为
  // 「这条路径自身携带服务端产出的 goal 判定」，因此旧断言按新契约拆成两条：
  // 路径自身有判定产物 → 照常生成；一条都没有 → 闸门拦下、不进入 generation。
  it('既有路径自身携带判定产物（如模板 visibleSummary）→ 照常进入 generation', async () => {
    mockGenerateLearningPath.mockResolvedValue({ id: 'path-1' })
    mockResolveExistingPathEvidence.mockResolvedValue({
      visibleSummary: { platformJudgment: 'judgeable_output', skillNature: 'tool_operation' }
    })
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript', existingPathId: 'path-1' })

    const task = mockRunBackgroundTask.mock.calls[0][1]
    await task()
    expect(mockResolveExistingPathEvidence).toHaveBeenCalledWith(expect.objectContaining({
      pathId: 'path-1',
      userId: 'user-1'
    }))
    expect(mockGenerateLearningPath).toHaveBeenCalledTimes(1)
  })

  it('既有路径没有任何判定产物（空壳路径）→ 闸门拦下，不进入 generation', async () => {
    mockGenerateLearningPath.mockResolvedValue({ id: 'path-1' })
    const onError = jest.fn().mockResolvedValue(undefined)
    mockResolveExistingPathEvidence.mockResolvedValue(null)
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript', existingPathId: 'path-1' }, { onError })

    const task = mockRunBackgroundTask.mock.calls[0][1]
    await expect(task()).rejects.toThrow(/目标判定结论/)
    expect(mockGenerateLearningPath).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('新建路径（无 existingPathId）没有判定凭证时直接失败，且不进入 generation', async () => {
    mockGenerateLearningPath.mockResolvedValue({ id: 'path-1' })
    const onError = jest.fn().mockResolvedValue(undefined)
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript' }, { onError })

    const task = mockRunBackgroundTask.mock.calls[0][1]
    await expect(task()).rejects.toThrow(/目标判定结论/)
    expect(mockGenerateLearningPath).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
