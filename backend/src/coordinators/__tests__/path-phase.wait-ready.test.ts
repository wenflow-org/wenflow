/**
 * waitForPathReady：等待预算的「续期 + 诚实文案」（2026-11-09 运营流程核查）
 *
 * 实测背景（隔离实例 3015）：路径核心结构先落库，阶段设计（subtasks）随后富化，
 * 本例 18:03 里程碑落库 → 18:14:42 才写完任务，于是固定 10 分钟的硬截止在
 * 「就绪前 1.5 分钟」把生成判死，文案却是「10 分钟无进展」——运营照提示去查
 * 路径生成任务，那里一切正常。本文件钉住三条：
 *   ① 生成仍在推进 → 窗口续期（不是直接失败）；
 *   ② 生成明确失败 → 立即失败并带真实原因（不空等、不写「无进展」）；
 *   ③ 真超时 → reason 带最后观察到的生成进度（慢 vs 坏一眼可分）。
 */
const mockMilestonesCount = jest.fn()
const mockSubtasksFindFirst = jest.fn()
const mockPathFindUnique = jest.fn()
const mockGetVirtualSession = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    milestones: { count: (...a: unknown[]) => mockMilestonesCount(...a) },
    subtasks: { findFirst: (...a: unknown[]) => mockSubtasksFindFirst(...a) },
    learning_paths: { findUnique: (...a: unknown[]) => mockPathFindUnique(...a) }
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../skills', () => ({ executeSkill: jest.fn(), virtualLearnerPathEvaluatorDefinition: {} }))
jest.mock('../path.coordinator', () => ({ __esModule: true, default: {} }))

import { waitForPathReady } from '../simulation.path-phase'
import { logger } from '../../utils/logger'

const ctx = { getVirtualSession: (...a: unknown[]) => mockGetVirtualSession(...a) } as never

/** 生成状态落库形态：learning_paths.aiPromptTemplate 里的 _generation */
const pathRow = (overrides: {
  status?: string
  core?: string
  stageDesign?: string
  taskCount?: number
  updatedAt?: string | null
  lastError?: string | null
}) => ({
  status: overrides.status ?? 'active',
  aiPromptTemplate: JSON.stringify({
    _generation: {
      core: overrides.core ?? 'succeeded',
      coreStep: 'completed',
      stageDesign: overrides.stageDesign ?? 'processing',
      lastError: overrides.lastError ?? null,
      updatedAt: overrides.updatedAt ?? '2026-11-09T10:00:00.000Z',
      scene: { milestoneCount: 5, taskCount: overrides.taskCount ?? 0 }
    }
  })
})

async function tick(ms: number) {
  await jest.advanceTimersByTimeAsync(ms)
}

describe('waitForPathReady：续期与文案', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    mockGetVirtualSession.mockResolvedValue({ learningPathId: 'lp-1' })
    mockSubtasksFindFirst.mockResolvedValue(null)
    mockMilestonesCount.mockResolvedValue(5)
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('生成仍在推进 → 续期而不是判失败（本轮实测：就绪比硬截止晚 1.5 分钟）', async () => {
    // 第 1 轮：阶段设计 processing，任务 0；第 2 轮：状态推进（updatedAt 变）；随后任务落库
    mockPathFindUnique
      .mockResolvedValueOnce(pathRow({ stageDesign: 'processing', taskCount: 0, updatedAt: '2026-11-09T10:05:00.000Z' }))
      .mockResolvedValueOnce(pathRow({ stageDesign: 'processing', taskCount: 3, updatedAt: '2026-11-09T10:06:00.000Z' }))
      .mockResolvedValue(pathRow({ stageDesign: 'succeeded', taskCount: 6, updatedAt: '2026-11-09T10:07:00.000Z' }))

    const pending = waitForPathReady(ctx, 's1', 'lp-1', 6000)
    await tick(12000) // 越过首个截止：应续期
    expect(logger.warn).toHaveBeenCalledWith(
      '[simulation-coordinator] 路径仍在生成，等待窗口续期',
      expect.objectContaining({ sessionId: 's1', extension: 1 })
    )
    mockSubtasksFindFirst.mockResolvedValue({ id: 'task-1' })
    await tick(6000)
    await expect(pending).resolves.toEqual({ ready: true })
  })

  it('生成明确失败 → 立即返回真实原因，不写「无进展」、不空等', async () => {
    mockPathFindUnique.mockResolvedValue(
      pathRow({ stageDesign: 'failed', lastError: '阶段设计 LLM 连续失败', updatedAt: '2026-11-09T10:05:00.000Z' })
    )

    const pending = waitForPathReady(ctx, 's1', 'lp-1', 600_000)
    await tick(10_000)
    const result = await pending
    expect(result.ready).toBe(false)
    expect(result.reason).toContain('路径生成失败')
    expect(result.reason).toContain('阶段设计 LLM 连续失败')
    expect(result.reason).not.toContain('无进展')
  })

  it('进度不再推进 → 不续期，超时文案带最后观察到的进度（慢/坏可分）', async () => {
    // 状态恒定：signature 不变 → 到点即失败，reason 说明「阶段设计 processing · 任务 0 · 更新于 …」
    mockPathFindUnique.mockResolvedValue(
      pathRow({ stageDesign: 'processing', taskCount: 0, updatedAt: '2026-11-09T10:05:00.000Z' })
    )

    const pending = waitForPathReady(ctx, 's1', 'lp-1', 6000)
    await tick(12_000)
    const result = await pending
    expect(result.ready).toBe(false)
    expect(result.reason).toContain('等待路径生成超时')
    expect(result.reason).toContain('阶段设计 processing')
    expect(result.reason).toContain('任务 0')
    // 未续期过：文案里写明续期次数 0
    expect(result.reason).toContain('已续期 0 次')
  })

  it('没有生成状态记录时保持旧文案（不假装知道进度）', async () => {
    mockPathFindUnique.mockResolvedValue({ status: 'active', aiPromptTemplate: null })

    const pending = waitForPathReady(ctx, 's1', 'lp-1', 6000)
    await tick(12_000)
    const result = await pending
    expect(result.ready).toBe(false)
    expect(result.reason).toBe('等待路径生成超时，请检查路径生成任务')
  })

  it('path 已终结（非 active/generating）仍立即拒绝，优先于进度判读', async () => {
    mockPathFindUnique.mockResolvedValue(pathRow({ status: 'failed' }))

    const pending = waitForPathReady(ctx, 's1', 'lp-1', 600_000)
    await tick(10_000)
    await expect(pending).resolves.toEqual({
      ready: false,
      reason: '路径生成未产出里程碑（path status=failed）'
    })
  })
})
