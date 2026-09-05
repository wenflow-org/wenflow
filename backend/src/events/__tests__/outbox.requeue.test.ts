/**
 * requeueDeadOutboxEvents 单元测试：dead → pending 重置语义
 */
const mockUpdateMany = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    domain_event_outbox: {
      updateMany: mockUpdateMany
    }
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}))

import { requeueDeadOutboxEvents } from '../outbox.worker'

describe('requeueDeadOutboxEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('重置全部死信：status→pending、attemptCount 清零、立即可投递', async () => {
    mockUpdateMany.mockResolvedValue({ count: 3 })

    const requeued = await requeueDeadOutboxEvents()

    expect(requeued).toBe(3)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { status: 'dead' },
      data: {
        status: 'pending',
        attemptCount: 0,
        availableAt: expect.any(Date),
        lockedAt: null,
        lockOwner: null
      }
    })
  })

  it('按 eventType 过滤重置', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })

    const requeued = await requeueDeadOutboxEvents('lesson:completed')

    expect(requeued).toBe(1)
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { status: 'dead', eventType: 'lesson:completed' },
      data: expect.objectContaining({ status: 'pending', attemptCount: 0 })
    })
  })

  it('无死信时返回 0 且不记日志', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const requeued = await requeueDeadOutboxEvents()

    expect(requeued).toBe(0)
  })
})
