// 管理端状态机守卫（2026-10-10 权限批，MIMOSA C2/C3 运行时实锤后补）：
// 公告重复发布/非发布态下线 → 409；路径重复下线/非下线态恢复 → 409。
export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      use: jest.fn(),
      get: jest.fn(),
      post: (path: string, ...handlers: RouteHandler[]) => { routes[`POST ${path}`] = handlers },
      put: (path: string, ...handlers: RouteHandler[]) => { routes[`PUT ${path}`] = handlers },
      delete: jest.fn(),
      patch: jest.fn(),
    }),
  },
}))

const findAnnouncementById = jest.fn()
const updateAnnouncement = jest.fn()
jest.mock('../../services/admin/announcement.repo', () => ({
  listAnnouncements: jest.fn(),
  createAnnouncement: jest.fn(),
  updateAnnouncement: (...a: any[]) => updateAnnouncement(...a),
  findAnnouncementById: (...a: any[]) => findAnnouncementById(...a),
  deleteAnnouncement: jest.fn(),
}))

const checkIsAdmin = jest.fn().mockResolvedValue(true)
jest.mock('../../services/admin-access.service', () => ({
  checkIsAdmin: (...a: any[]) => checkIsAdmin(...a),
}))

const findLearningPathById = jest.fn()
const archiveLearningPath = jest.fn()
const restoreLearningPath = jest.fn()
jest.mock('../../services/admin/learning-content.repo', () => ({
  findLearningPathsForAdmin: jest.fn(),
  countLearningPathsWhere: jest.fn(),
  findLearningPathDetail: jest.fn(),
  findLearningPathById: (...a: any[]) => findLearningPathById(...a),
  archiveLearningPath: (...a: any[]) => archiveLearningPath(...a),
  restoreLearningPath: (...a: any[]) => restoreLearningPath(...a),
  findLearningPathWithMilestoneCount: jest.fn(),
  deleteLearningPath: jest.fn(),
  getLearningContentStats: jest.fn(),
}))

jest.mock('../../middleware/auth.middleware', () => ({ authMiddleware: jest.fn() }))
jest.mock('../../middleware/audit-context', () => ({
  setAuditAction: jest.fn(),
  setAuditBefore: jest.fn(),
  setAuditAfter: jest.fn(),
}))
jest.mock('../../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))
jest.mock('../../utils/test-account', () => ({ buildRealUserWhere: jest.fn().mockResolvedValue({}) }))

require('../admin/announcements')
require('../admin/learning-content')

function createResponse() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { res.statusCode = code; return res },
    json(payload: any) { res.body = payload; return res },
  }
  return res
}

async function run(key: string, params: Record<string, unknown> = {}) {
  const stack = routes[key]
  if (!stack) throw new Error(`route not registered: ${key}`)
  const handler = stack[stack.length - 1]
  const req: any = { params, body: {}, user: { userId: 'admin_test' }, query: {} }
  const res = createResponse()
  await handler(req, res)
  return res
}

beforeEach(() => jest.clearAllMocks())

describe('公告状态机守卫（C2）', () => {
  it('重复发布（已 published）→ 409，且不触发更新', async () => {
    findAnnouncementById.mockResolvedValue({ id: 'a1', status: 'published' })
    const res = await run('PUT /:id/publish', { id: 'a1' })
    expect(res.statusCode).toBe(409)
    expect(updateAnnouncement).not.toHaveBeenCalled()
  })

  it('草稿发布 → 200 且写入 published', async () => {
    findAnnouncementById.mockResolvedValue({ id: 'a1', status: 'draft' })
    updateAnnouncement.mockResolvedValue({ id: 'a1', status: 'published' })
    const res = await run('PUT /:id/publish', { id: 'a1' })
    expect(res.statusCode).toBe(200)
    expect(updateAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published' }) }))
  })

  it('已下线公告重发 → 200（重发是有意流程）', async () => {
    findAnnouncementById.mockResolvedValue({ id: 'a1', status: 'archived' })
    updateAnnouncement.mockResolvedValue({ id: 'a1', status: 'published' })
    const res = await run('PUT /:id/publish', { id: 'a1' })
    expect(res.statusCode).toBe(200)
  })

  it('不存在 → 404（此前会落 Prisma P2025 → 500）', async () => {
    findAnnouncementById.mockResolvedValue(null)
    const res = await run('PUT /:id/publish', { id: 'nope' })
    expect(res.statusCode).toBe(404)
    expect(updateAnnouncement).not.toHaveBeenCalled()
  })

  it('非发布态下线（草稿/已下线）→ 409', async () => {
    findAnnouncementById.mockResolvedValue({ id: 'a1', status: 'draft' })
    const res = await run('PUT /:id/archive', { id: 'a1' })
    expect(res.statusCode).toBe(409)
    expect(updateAnnouncement).not.toHaveBeenCalled()
  })

  it('发布中下线 → 200', async () => {
    findAnnouncementById.mockResolvedValue({ id: 'a1', status: 'published' })
    updateAnnouncement.mockResolvedValue({ id: 'a1', status: 'archived' })
    const res = await run('PUT /:id/archive', { id: 'a1' })
    expect(res.statusCode).toBe(200)
  })
})

describe('路径归档/恢复状态机守卫（C3）', () => {
  it('重复归档（已 archived）→ 409，且不触发归档', async () => {
    findLearningPathById.mockResolvedValue({ id: 'p1', status: 'archived', title: 't' })
    const res = await run('POST /paths/:id/archive', { id: 'p1' })
    expect(res.statusCode).toBe(409)
    expect(archiveLearningPath).not.toHaveBeenCalled()
  })

  it('active 归档 → 200', async () => {
    findLearningPathById.mockResolvedValue({ id: 'p1', status: 'active', title: 't' })
    archiveLearningPath.mockResolvedValue(undefined)
    const res = await run('POST /paths/:id/archive', { id: 'p1' })
    expect(res.statusCode).toBe(200)
    expect(archiveLearningPath).toHaveBeenCalledWith('p1')
  })

  it('非 archived 恢复 → 409', async () => {
    findLearningPathById.mockResolvedValue({ id: 'p1', status: 'active', title: 't' })
    const res = await run('POST /paths/:id/restore', { id: 'p1' })
    expect(res.statusCode).toBe(409)
    expect(restoreLearningPath).not.toHaveBeenCalled()
  })

  it('archived 恢复 → 200', async () => {
    findLearningPathById.mockResolvedValue({ id: 'p1', status: 'archived', title: 't' })
    restoreLearningPath.mockResolvedValue(undefined)
    const res = await run('POST /paths/:id/restore', { id: 'p1' })
    expect(res.statusCode).toBe(200)
  })
})
