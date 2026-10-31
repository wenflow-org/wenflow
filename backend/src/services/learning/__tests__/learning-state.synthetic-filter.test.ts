const mockPrisma = {
  users: { findUnique: jest.fn() },
  learning_metrics: { findFirst: jest.fn(), findMany: jest.fn() },
  teaching_sessions: { findMany: jest.fn() },
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { LearningStateService } from '../learning-state.service'

/**
 * #71 P-46：合成占位行（synthetic）此前只在写入侧打标，读侧没人消费。
 * 这里钉住三条读路径：当前状态快照 / devtools 最近行 / lssHistory 继承，都必须排除占位行。
 * 2026-10-24 架构优化批 2a：排除条件从 metadata 字符串 LIKE 换为实列过滤（迁移已回填）。
 */
describe('学习状态读侧排除合成占位行（#71，2a 列化后口径）', () => {
  const service = new LearningStateService()

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.learning_metrics.findMany.mockResolvedValue([])
    mockPrisma.learning_metrics.findFirst.mockResolvedValue(null)
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([])
  })

  it('getCurrentStateSnapshot 的已提交行查询走实列（committed/metricVersion/synthetic 排除）', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ learningStateRevision: 1 })

    await service.getCurrentStateSnapshot('u1')

    expect(mockPrisma.learning_metrics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metricType: 'learning_state',
          committed: true,
          metricVersion: 'state-v2',
          synthetic: false,
        }),
      })
    )
    // 不再出现 metadata LIKE（2a 的目标）
    const call = mockPrisma.learning_metrics.findMany.mock.calls[0][0]
    expect(JSON.stringify(call.where)).not.toContain('contains')
  })

  it('getLatestMetricRecord 只取学习状态行且跳过占位行', async () => {
    await service.getLatestMetricRecord('u1')

    expect(mockPrisma.learning_metrics.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metricType: 'learning_state',
          synthetic: false,
        }),
      })
    )
  })

  it('带 pathId 的查询仍保留维度与排除条件', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ learningStateRevision: 1 })

    await service.getCurrentStateSnapshot('u1', { pathId: 'p1' })

    const call = mockPrisma.learning_metrics.findMany.mock.calls[0][0]
    expect(call.where.pathId).toBe('p1')
    expect(call.where.committed).toBe(true)
    expect(call.where.synthetic).toBe(false)
  })
})
