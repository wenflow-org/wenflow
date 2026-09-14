/**
 * GET /agents/logs 服务端排序：白名单 + 方向校验 + 稳定次级键（时间倒序 + id）。
 *
 * 说明：token 列不参与服务端排序（前端「输入/输出」是同 trace 网关行合并后的口径），
 * 故白名单仅 calledAt / durationMs。
 */

export {}

type RouteHandler = (...args: any[]) => any

const findMany = jest.fn()
const count = jest.fn()
const groupBy = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: { findMany, count, groupBy },
    users: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  },
}))
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}))
jest.mock('../../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }))
jest.mock('../../../middleware/audit-context', () => ({
  setAuditAction: jest.fn(),
  setAuditBefore: jest.fn(),
  setAuditAfter: jest.fn(),
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../services/learning/goal-conversation.service', () => ({
  generateLearningPathFromConversation: jest.fn(),
}))

import platformRouter from '../platform'

function getRouteHandler(router: any, path: string, method: string): RouteHandler {
  const layer = router.stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.[method]
  )
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createResponse() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = jest.fn((code: number) => {
    res.statusCode = code
    return res
  })
  res.json = (payload: any) => {
    res.body = payload
    return res
  }
  return res
}

async function run(handler: RouteHandler, req: any): Promise<any> {
  const res = createResponse()
  await handler(req, res, jest.fn())
  return res
}

const handler = () => getRouteHandler(platformRouter, '/agents/logs', 'get')

beforeEach(() => {
  jest.clearAllMocks()
  findMany.mockResolvedValue([])
  count.mockResolvedValue(0)
  groupBy.mockResolvedValue([])
})

describe('执行日志服务端排序', () => {
  it('默认：时间倒序 + id 稳定次级键', async () => {
    const res = await run(handler(), { query: {} })
    expect(res.statusCode).toBe(200)
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ calledAt: 'desc' }, { id: 'desc' }])
  })

  it('sort=durationMs&order=asc：按耗时升序，时间倒序 + id 兜底', async () => {
    const res = await run(handler(), { query: { sort: 'durationMs', order: 'asc' } })
    expect(res.statusCode).toBe(200)
    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { durationMs: 'asc' },
      { calledAt: 'desc' },
      { id: 'desc' },
    ])
  })

  it('sort=calledAt&order=asc：按时间升序 + id 兜底', async () => {
    const res = await run(handler(), { query: { sort: 'calledAt', order: 'asc' } })
    expect(res.statusCode).toBe(200)
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ calledAt: 'asc' }, { id: 'desc' }])
  })

  it('非法 sort → 400，且不查库', async () => {
    const res = await run(handler(), { query: { sort: 'password' } })
    expect(res.statusCode).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('非法 order → 400，且不查库', async () => {
    const res = await run(handler(), { query: { sort: 'durationMs', order: 'sideways' } })
    expect(res.statusCode).toBe(400)
    expect(findMany).not.toHaveBeenCalled()
  })
})
