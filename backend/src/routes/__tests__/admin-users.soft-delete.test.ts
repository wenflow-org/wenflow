// 管理员用户软删除（Phase 1）行为测试：DELETE /:id 与 POST /batch-delete 只做标记、
// 列表/详情默认隐藏已删账号、行数据仍保留在库中。
export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}

const usersFindUnique = jest.fn()
const usersFindFirst = jest.fn()
const usersFindMany = jest.fn()
const usersCount = jest.fn()
const usersUpdate = jest.fn()
const usersUpdateMany = jest.fn()
const usersDelete = jest.fn()
const usersDeleteMany = jest.fn()
const virtualProfilesFindMany = jest.fn()
const loggerInfo = jest.fn()

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      use: jest.fn(),
      get: (path: string, ...handlers: RouteHandler[]) => { routes[`GET ${path}`] = handlers },
      post: (path: string, ...handlers: RouteHandler[]) => { routes[`POST ${path}`] = handlers },
      patch: (path: string, ...handlers: RouteHandler[]) => { routes[`PATCH ${path}`] = handlers },
      delete: (path: string, ...handlers: RouteHandler[]) => { routes[`DELETE ${path}`] = handlers }
    })
  }
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    users: {
      findUnique: usersFindUnique,
      findFirst: usersFindFirst,
      findMany: usersFindMany,
      count: usersCount,
      update: usersUpdate,
      updateMany: usersUpdateMany,
      delete: usersDelete,
      deleteMany: usersDeleteMany
    },
    virtual_learner_profiles: {
      findMany: virtualProfilesFindMany
    }
  }
}))

jest.mock('../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }))
jest.mock('../../utils/logger', () => ({ logger: { info: loggerInfo, error: jest.fn(), warn: jest.fn() } }))

require('../admin/users')

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    }
  }
}

/** 操作者鉴权通过：ensureAdmin 走 users.findUnique */
function mockOperatorAdmin() {
  usersFindUnique.mockImplementationOnce(() => Promise.resolve({ isAdmin: true }))
}

function runHandler(route: string, req: any): Promise<any> {
  const res = createResponse()
  const handlers = routes[route]
  return handlers[handlers.length - 1](req, res, jest.fn()).then(() => res)
}

describe('DELETE /admin/users/:id 软删除', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('删除改为标记 deletedAt/deletedBy，行数据保留（不调用物理删除）', async () => {
    mockOperatorAdmin()
    usersFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: 'u2', isAdmin: false, deletedAt: null })
    )
    usersUpdate.mockResolvedValue({ id: 'u2' })

    const res = await runHandler('DELETE /:id', { user: { userId: 'admin-1' }, params: { id: 'u2' } })

    expect(res.statusCode).toBe(200)
    expect(usersUpdate).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: {
        deletedAt: expect.any(Date),
        deletedBy: 'admin-1',
        updatedAt: expect.any(Date)
      }
    })
    expect(usersDelete).not.toHaveBeenCalled()
    expect(usersDeleteMany).not.toHaveBeenCalled()
    expect(loggerInfo).toHaveBeenCalledWith('用户已软删除', { userId: 'u2', deletedBy: 'admin-1' })
  })

  it('已软删账号重复删除返回 409 ALREADY_DELETED', async () => {
    mockOperatorAdmin()
    usersFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: 'u2', isAdmin: false, deletedAt: new Date() })
    )

    const res = await runHandler('DELETE /:id', { user: { userId: 'admin-1' }, params: { id: 'u2' } })

    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_DELETED')
    expect(usersUpdate).not.toHaveBeenCalled()
  })

  it('不能删除当前登录管理员（前置保护保留）', async () => {
    mockOperatorAdmin()

    const res = await runHandler('DELETE /:id', { user: { userId: 'admin-1' }, params: { id: 'admin-1' } })

    expect(res.statusCode).toBe(400)
    expect(usersUpdate).not.toHaveBeenCalled()
  })

  it('最后管理员保护保留：最后一个管理员不可删除', async () => {
    mockOperatorAdmin()
    usersFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ id: 'admin-2', isAdmin: true, deletedAt: null })
    )
    usersCount.mockResolvedValue(2)

    const res = await runHandler('DELETE /:id', { user: { userId: 'admin-1' }, params: { id: 'admin-2' } })

    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('LAST_ADMIN_PROTECTED')
    expect(usersUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /admin/users/batch-delete 批量软删除', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('updateMany 仅标记未删账号并返回删除计数，保持响应形状', async () => {
    mockOperatorAdmin()
    virtualProfilesFindMany.mockResolvedValue([])
    usersFindMany.mockResolvedValue([])
    usersUpdateMany.mockResolvedValue({ count: 2 })

    const res = await runHandler('POST /batch-delete', {
      user: { userId: 'admin-1' },
      body: { ids: ['u2', 'u3'] }
    })

    expect(res.statusCode).toBe(200)
    expect(res.body.data.deletedCount).toBe(2)
    expect(usersUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['u2', 'u3'] }, deletedAt: null },
      data: {
        deletedAt: expect.any(Date),
        deletedBy: 'admin-1',
        updatedAt: expect.any(Date)
      }
    })
    expect(usersDeleteMany).not.toHaveBeenCalled()
  })

  it('虚拟学习者保护保留（virtual_learner_profiles 命中时 409）', async () => {
    mockOperatorAdmin()
    virtualProfilesFindMany.mockResolvedValue([{ userId: 'u2' }])

    const res = await runHandler('POST /batch-delete', {
      user: { userId: 'admin-1' },
      body: { ids: ['u2', 'u3'] }
    })

    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('VIRTUAL_LEARNER_PROTECTED')
    expect(usersUpdateMany).not.toHaveBeenCalled()
  })
})

describe('GET /admin/users 列表默认隐藏已删账号', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('列表与总数查询均带 deletedAt: null', async () => {
    usersFindMany.mockResolvedValue([])
    usersCount.mockResolvedValue(0)

    const res = await runHandler('GET /', { query: {} })

    expect(res.statusCode).toBe(200)
    expect(usersFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) })
    )
    expect(usersCount).toHaveBeenCalledWith({ where: expect.objectContaining({ deletedAt: null }) })
  })

  it('详情接口对已删账号返回 404（默认隐藏）', async () => {
    usersFindFirst.mockResolvedValue(null)

    const res = await runHandler('GET /:id', { params: { id: 'u2' } })

    expect(res.statusCode).toBe(404)
    expect(usersFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u2', deletedAt: null } })
    )
  })
})
