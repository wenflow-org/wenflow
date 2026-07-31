const mockPrisma: any = {
  teaching_sessions: { findUnique: jest.fn() },
  content_feedback: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn()
  }
}

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import {
  FeedbackCollectionError,
  FeedbackCollectionService
} from '../feedback-collection.service'

describe('FeedbackCollectionService', () => {
  const service = new FeedbackCollectionService()

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      taskId: 'task-1',
      messages: JSON.stringify([
        { role: 'user', content: '问题' },
        { role: 'assistant', content: '回答', strategies: ['scaffold'] }
      ])
    })
    mockPrisma.content_feedback.upsert.mockImplementation(async ({ create, update }: any) => ({
      ...create,
      ...update,
      id: 'feedback-1',
      createdAt: new Date('2026-07-19T00:00:00.000Z'),
      updatedAt: new Date('2026-07-19T00:00:00.000Z')
    }))
  })

  it('验证会话归属后将 API taskId 显式映射为 subtaskId 并原子 upsert', async () => {
    const result = await service.submitFeedback({
      userId: 'user-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      rating: 2,
      difficultyFit: 'too_hard',
      reasonCodes: ['UNCLEAR_EXPLANATION']
    })

    expect(mockPrisma.content_feedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { feedbackKey: 'user-1:session-1' },
      create: expect.objectContaining({
        userId: 'user-1',
        sessionId: 'session-1',
        subtaskId: 'task-1',
        agentId: 'learning-agent',
        strategy: 'scaffold',
        uiType: 'session-report-v1'
      }),
      update: expect.objectContaining({
        subtaskId: 'task-1',
        status: 'new'
      })
    }))
    const prismaInput = mockPrisma.content_feedback.upsert.mock.calls[0][0]
    expect(prismaInput.create).not.toHaveProperty('taskId')
    expect(result.taskId).toBe('task-1')
    expect(result.reasonCodes).toEqual(['UNCLEAR_EXPLANATION'])
  })

  it('拒绝给其他用户的课堂提交反馈', async () => {
    mockPrisma.teaching_sessions.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-2',
      taskId: 'task-1',
      messages: '[]'
    })

    await expect(service.submitFeedback({
      userId: 'user-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      rating: 5
    })).rejects.toEqual(expect.objectContaining<Partial<FeedbackCollectionError>>({
      status: 403,
      code: 'FEEDBACK_FORBIDDEN'
    }))
    expect(mockPrisma.content_feedback.upsert).not.toHaveBeenCalled()
  })

  it('拒绝 session 与 task 不一致的反馈', async () => {
    await expect(service.submitFeedback({
      userId: 'user-1',
      sessionId: 'session-1',
      taskId: 'task-2',
      rating: 5
    })).rejects.toEqual(expect.objectContaining<Partial<FeedbackCollectionError>>({
      status: 409,
      code: 'FEEDBACK_TASK_MISMATCH'
    }))
  })

  it('用户反馈历史使用真实 skip、take 和 count', async () => {
    mockPrisma.content_feedback.findMany.mockResolvedValue([])
    mockPrisma.content_feedback.count.mockResolvedValue(121)

    const result = await service.getUserFeedback('user-1', 3, 20)

    expect(mockPrisma.content_feedback.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      skip: 40,
      take: 20
    }))
    expect(result).toEqual({ items: [], total: 121 })
  })
})
