/**
 * 批量实验调度器 lifecycle 挂接单测：
 *  - start 幂等（重复调用只有一个 30s interval）；
 *  - draining 期跳过 tick（同 log-retention 等维护调度器口径）；
 *  - stop 后不再 tick；
 *  - 不传 lifecycle（脚本/路由直连）照常可用。
 */
const mockRunsFindMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    batch_experiment_runs: { findMany: mockRunsFindMany },
    batch_experiments: {},
  }
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../../coordinators/simulation.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../../virtual-lab/session-factory', () => ({
  createSessionForProfile: jest.fn(),
  getStoryPool: jest.fn(async () => [])
}))
jest.mock('../../../virtual-lab/learner-provisioning', () => ({
  provisionVirtualProfile: jest.fn(),
  generateAndApplyPersona: jest.fn(),
  generateAndApplyStory: jest.fn()
}))
jest.mock('../../learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: {}
}))
jest.mock('../../memory/memory-trace.service', () => ({ memoryTraceService: {} }))
jest.mock('../../../gateway/api-gateway/context', () => ({
  runWithContext: jest.fn(async (_ctx: unknown, fn: () => unknown) => fn())
}))

import { startBatchExperimentScheduler, stopBatchExperimentScheduler } from '../batch-experiment.service'

function makeLifecycle(isDraining: boolean) {
  return { isDraining: jest.fn(() => isDraining) }
}

describe('startBatchExperimentScheduler lifecycle 挂接', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockRunsFindMany.mockResolvedValue([])
    stopBatchExperimentScheduler()
  })
  afterEach(() => {
    stopBatchExperimentScheduler()
    jest.useRealTimers()
  })

  it('不传 lifecycle（脚本/路由直连）照常 tick', async () => {
    startBatchExperimentScheduler()
    await jest.advanceTimersByTimeAsync(30_000)
    expect(mockRunsFindMany).toHaveBeenCalledTimes(1)
    expect(mockRunsFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'active' }, take: 20 }))
  })

  it('重复 start 幂等：仍只有一个 interval', async () => {
    startBatchExperimentScheduler(makeLifecycle(false))
    startBatchExperimentScheduler()
    startBatchExperimentScheduler(makeLifecycle(false))
    await jest.advanceTimersByTimeAsync(30_000)
    expect(mockRunsFindMany).toHaveBeenCalledTimes(1)
  })

  it('draining 期跳过 tick，恢复 ready 后继续推进', async () => {
    const lifecycle = { isDraining: jest.fn(() => true) }
    startBatchExperimentScheduler(lifecycle)
    await jest.advanceTimersByTimeAsync(30_000)
    expect(mockRunsFindMany).not.toHaveBeenCalled()

    lifecycle.isDraining.mockImplementation(() => false)
    await jest.advanceTimersByTimeAsync(30_000)
    expect(mockRunsFindMany).toHaveBeenCalledTimes(1)
  })

  it('stop 后不再 tick', async () => {
    startBatchExperimentScheduler(makeLifecycle(false))
    await jest.advanceTimersByTimeAsync(30_000)
    expect(mockRunsFindMany).toHaveBeenCalledTimes(1)

    stopBatchExperimentScheduler()
    await jest.advanceTimersByTimeAsync(90_000)
    expect(mockRunsFindMany).toHaveBeenCalledTimes(1)
  })
})
