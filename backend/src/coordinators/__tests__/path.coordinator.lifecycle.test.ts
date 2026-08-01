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

describe('PathCoordinator background lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsAccepting.mockReturnValue(true)
  })

  it('runAsync 将 generation 和 hooks 放入同一个 lazy tracked task', async () => {
    const onSuccess = jest.fn()
    mockGenerateLearningPath.mockResolvedValue({ id: 'path-1' })
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript' }, { onSuccess })

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
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript' }, { onError })

    const task = mockRunBackgroundTask.mock.calls[0][1]
    await expect(task()).rejects.toThrow('generation failed')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'generation failed' }))
  })

  it('draining 时不启动 generation，并通知业务 hook 收敛占位状态', async () => {
    mockIsAccepting.mockReturnValue(false)
    const onError = jest.fn().mockResolvedValue(undefined)
    pathCoordinator.runAsync({ userId: 'user-1', description: '学习 TypeScript' }, { onError })

    await Promise.resolve()
    expect(mockRunBackgroundTask).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})
