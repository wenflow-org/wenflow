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
 * #71 P-46：合成占位行（metadata.synthetic=true）此前只在写入侧打标，读侧没人消费。
 * 这里钉住三条读路径：当前状态快照 / devtools 最近行 / lssHistory 继承，都必须排除占位行。
 */
describe('学习状态读侧排除合成占位行（#71）', () => {
  const service = new LearningStateService()
  const SYNTHETIC_NOT = { metadata: { contains: '"synthetic":true' } }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.learning_metrics.findMany.mockResolvedValue([])
    mockPrisma.learning_metrics.findFirst.mockResolvedValue(null)
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([])
  })

  it('getCurrentStateSnapshot 的已提交行查询带 synthetic 排除条件', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ learningStateRevision: 1 })

    await service.getCurrentStateSnapshot('u1')

    expect(mockPrisma.learning_metrics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metricType: 'learning_state',
          AND: expect.arrayContaining([{ NOT: SYNTHETIC_NOT }]),
        }),
      })
    )
  })

  it('getLatestMetricRecord 只取学习状态行且跳过占位行', async () => {
    await service.getLatestMetricRecord('u1')

    expect(mockPrisma.learning_metrics.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          metricType: 'learning_state',
          NOT: SYNTHETIC_NOT,
        }),
      })
    )
  })

  it('带 pathId 的查询仍保留维度与排除条件', async () => {
    mockPrisma.users.findUnique.mockResolvedValue({ learningStateRevision: 1 })

    await service.getCurrentStateSnapshot('u1', { pathId: 'p1' })

    const call = mockPrisma.learning_metrics.findMany.mock.calls[0][0]
    expect(call.where.pathId).toBe('p1')
    expect(call.where.AND).toEqual(expect.arrayContaining([{ NOT: SYNTHETIC_NOT }]))
  })
})
