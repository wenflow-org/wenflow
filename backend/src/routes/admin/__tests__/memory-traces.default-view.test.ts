/**
 * 回归：管理端「记忆痕迹」GET /memory-traces 默认视图
 *
 * 背景：memory_traces 只有 userId 字符串列、没有 user 关系字段，
 * 历史实现 where: { user: { isVirtualLearner: false } } 是非法查询 → Prisma 抛错 → 默认视图必然 500。
 * 修复后：默认视图改为「先查虚拟学习者 id 集合，再 userId.notIn」，与指定 userId 用 AND 组合。
 */

export {}

type RouteHandler = (...args: any[]) => any

const usersFindUnique = jest.fn()
const usersFindMany = jest.fn()
const tracesFindMany = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    users: { findUnique: usersFindUnique, findMany: usersFindMany },
    memory_traces: { findMany: tracesFindMany },
  },
}))

jest.mock('../../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}))

import memoryTracesRouter from '../memory-traces'

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

const admin = { user: { userId: 'admin-1' } }

beforeEach(() => {
  jest.clearAllMocks()
  usersFindUnique.mockResolvedValue({ isAdmin: true })
  usersFindMany.mockResolvedValue([{ id: 'v-1' }, { id: 'v-2' }])
  // 若查询里出现 user 关系键，模拟 Prisma 的非法调用抛错（旧实现的失败形态）
  tracesFindMany.mockImplementation((args: any) => {
    const where = args?.where ?? {}
    const flat = [where, ...(Array.isArray(where.AND) ? where.AND : [])]
    if (flat.some((clause: any) => clause && typeof clause === 'object' && 'user' in clause)) {
      throw new Error('Invalid prisma.memory_traces.findMany() invocation')
    }
    return Promise.resolve([])
  })
})

describe('记忆痕迹默认视图（回归）', () => {
  it('默认视图不查 user 关系，改用 userId.notIn，返回 200', async () => {
    const res = await run(getRouteHandler(memoryTracesRouter, '/', 'get'), { ...admin, query: {} })

    expect(res.statusCode).toBe(200)
    expect(res.body?.success).toBe(true)
    expect(tracesFindMany).toHaveBeenCalledTimes(1)
    expect(tracesFindMany.mock.calls[0][0].where.AND).toContainEqual({
      userId: { notIn: ['v-1', 'v-2'] },
    })
  })

  it('includeVirtual=true 时不查虚拟集合，也不加排除条件', async () => {
    const res = await run(getRouteHandler(memoryTracesRouter, '/', 'get'), {
      ...admin,
      query: { includeVirtual: 'true' },
    })

    expect(res.statusCode).toBe(200)
    expect(usersFindMany).not.toHaveBeenCalled()
    expect(tracesFindMany.mock.calls[0][0].where.AND).toEqual([])
  })

  it('指定 userId + 默认排除虚拟：AND 同时含 userId 与 notIn（不互相覆盖）', async () => {
    const res = await run(getRouteHandler(memoryTracesRouter, '/', 'get'), {
      ...admin,
      query: { userId: 'u-1' },
    })

    expect(res.statusCode).toBe(200)
    const and = tracesFindMany.mock.calls[0][0].where.AND
    expect(and).toContainEqual({ userId: 'u-1' })
    expect(and).toContainEqual({ userId: { notIn: ['v-1', 'v-2'] } })
  })
})
