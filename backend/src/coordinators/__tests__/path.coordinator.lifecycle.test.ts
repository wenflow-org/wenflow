const mockGenerateLearningPath = jest.fn()
const mockRunBackgroundTask = jest.fn()
const mockIsAccepting = jest.fn(() => true)

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

  // #217 的闸门只应约束「新建」：既有路径的重新生成 / 重建 / 重试手上没有 goal 层产物，
  // 若一并要求凭证，这些旧数据兜底入口会稳定抛 GOAL_TRIAGE_REQUIRED 并被记成失败。
  it('既有路径的重建（带 existingPathId）不需要判定凭证，照常进入 generation', async () => {
    mockGenerateLearningPath.mockResolvedValue({ id: 'path-1' })
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript', existingPathId: 'path-1' })

    const task = mockRunBackgroundTask.mock.calls[0][1]
    await task()
    expect(mockGenerateLearningPath).toHaveBeenCalledTimes(1)
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
