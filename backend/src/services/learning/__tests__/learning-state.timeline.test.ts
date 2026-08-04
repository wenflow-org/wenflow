const mockPrisma = {
  teaching_sessions: {
    findMany: jest.fn()
  },
  learning_metrics: {
    findMany: jest.fn()
  }
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { LearningStateService } from '../learning-state.service'

describe('LearningStateService session timeline', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('只返回属于目标用户的指定 Teaching Session，并标注提交与兜底来源', async () => {
    const service = new LearningStateService()
    mockPrisma.teaching_sessions.findMany.mockResolvedValue([
      {
        id: 'teach-1',
        taskId: 'task-1',
        learningPathId: 'path-1',
        status: 'completed',
        wrapup: JSON.stringify({ summarySource: 'model', evaluationSource: 'model' }),
        startTime: new Date('2026-07-14T10:00:00.000Z'),
        endTime: new Date('2026-07-14T10:10:00.000Z')
      },
      {
        id: 'teach-2',
        taskId: 'task-2',
        learningPathId: 'path-1',
        status: 'completed',
        wrapup: JSON.stringify({
          summarySource: 'fallback',
          evaluationSource: 'ai-fallback',
          stateUpdate: {
            lss: 5.4,
            ktl: 4.8,
            lf: 4.2,
            lsb: 0.6,
            timestamp: '2026-07-14T10:30:00.000Z'
          }
        }),
        startTime: new Date('2026-07-14T10:20:00.000Z'),
        endTime: new Date('2026-07-14T10:30:00.000Z')
      },
      {
        id: 'teach-3',
        taskId: 'task-3',
        learningPathId: 'path-1',
        status: 'active',
        wrapup: null,
        startTime: new Date('2026-07-14T10:40:00.000Z'),
        endTime: null
      }
    ])
    mockPrisma.learning_metrics.findMany.mockResolvedValue([{
      pathId: 'path-1',
      taskId: 'task-1',
      metadata: JSON.stringify({ version: 'state-v2', committed: true, sessionId: 'teach-1' }),
      lss: 4.1,
      ktl: 5.2,
      lf: 3.7,
      lsb: 1.5,
      calculatedAt: new Date('2026-07-14T10:10:00.000Z')
    }])

    const result = await service.getSessionStateTimeline('user-1', [
      'teach-1', 'teach-2', 'teach-3', 'foreign-session', 'teach-1'
    ])

    expect(mockPrisma.teaching_sessions.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'user-1',
        id: { in: ['teach-1', 'teach-2', 'teach-3', 'foreign-session'] }
      }
    }))
    expect(mockPrisma.learning_metrics.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        OR: [
          { metadata: { contains: '"sessionId":"teach-1"' } },
          { metadata: { contains: '"sessionId":"teach-2"' } },
          { metadata: { contains: '"sessionId":"teach-3"' } }
        ]
      })
    }))
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(expect.objectContaining({
      teachingSessionId: 'teach-1',
      source: 'committed-metric',
      evaluationSource: 'model',
      degraded: false,
      metrics: expect.objectContaining({ lss: 4.1, ktl: 5.2, lf: 3.7, lsb: 1.5 })
    }))
    expect(result[1]).toEqual(expect.objectContaining({
      teachingSessionId: 'teach-2',
      source: 'teaching-wrapup',
      evaluationSource: 'ai-fallback',
      degraded: true,
      metrics: expect.objectContaining({ lss: 5.4, ktl: 4.8, lf: 4.2, lsb: 0.6 })
    }))
    expect(result[2]).toEqual(expect.objectContaining({
      teachingSessionId: 'teach-3',
      source: 'missing',
      metrics: null,
      degraded: false
    }))
  })

  it('没有 Teaching Session ID 时不查询数据库', async () => {
    const service = new LearningStateService()

    await expect(service.getSessionStateTimeline('user-1', [])).resolves.toEqual([])

    expect(mockPrisma.teaching_sessions.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.learning_metrics.findMany).not.toHaveBeenCalled()
  })
})
