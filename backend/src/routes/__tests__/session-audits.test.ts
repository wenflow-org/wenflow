/**
 * 会话评审（裁判）独立面路由测试 — 2026-09-27 从 virtual-learners 迁出
 *
 * 端点行为与原 /blackbox-evaluations 等价：共享租约（runLeasedExclusive）内串行跑
 * referee + actorAudit 双评估；租约错误走共享类型化响应（状态码/code/retryable）。
 */

const mockRunLeasedExclusive = jest.fn()
const mockReferee = jest.fn()
const mockActorAudit = jest.fn()

jest.mock('../../virtual-lab/blackbox-runner', () => ({
  __esModule: true,
  default: {
    runLeasedExclusive: mockRunLeasedExclusive,
    referee: mockReferee,
    actorAudit: mockActorAudit
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import router from '../admin/session-audits'

function getPostHandler(path: string) {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.post)
  if (!layer) throw new Error(`Route not found: ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

describe('session-audits 独立评审面', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('双评估在共享租约内串行执行，返回 platform + actor 两份报告', async () => {
    mockRunLeasedExclusive.mockImplementation(async (_sessionId: string, work: () => Promise<any>) => work())
    mockReferee.mockResolvedValue({ id: 'report-1', reused: false })
    mockActorAudit.mockResolvedValue({ id: 'audit-1', reused: false })

    const handler = getPostHandler('/sessions/:sessionId/evaluations')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, user: { userId: 'admin-1' } }, res)

    expect(mockRunLeasedExclusive).toHaveBeenCalledWith('session-1', expect.any(Function))
    expect(mockReferee).toHaveBeenCalledWith('session-1', 'admin-1')
    expect(mockActorAudit).toHaveBeenCalledWith('session-1', 'admin-1')
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { platform: { id: 'report-1', reused: false }, actor: { id: 'audit-1', reused: false } }
    })
  })

  it('租约错误走共享类型化响应（状态码/code/retryable）', async () => {
    mockRunLeasedExclusive.mockRejectedValue(Object.assign(
      new Error('租约数据库暂时繁忙，请稍后重试'),
      { code: 'DB_BUSY', statusCode: 503, retryable: true }
    ))

    const handler = getPostHandler('/sessions/:sessionId/evaluations')
    const res = createResponse()

    await handler({ params: { sessionId: 'session-1' }, user: { userId: 'admin-1' } }, res)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: '租约数据库暂时繁忙，请稍后重试',
      code: 'DB_BUSY',
      retryable: true
    })
  })
})
