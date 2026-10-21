// 内容抽检路由测试：抽样读侧 / 标注写侧（与 CLI 同表同键）/ 参数校验
export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler[]> = {}
const sessionsFindMany = jest.fn()
const sessionsFindUnique = jest.fn()
const messagesFindMany = jest.fn()
const messagesFindUnique = jest.fn()
const evidenceFindMany = jest.fn()
const evidenceUpsert = jest.fn()

const mockRouter = () => ({
  get: (path: string, ...handlers: RouteHandler[]) => { routes[`GET ${path}`] = handlers },
  post: (path: string, ...handlers: RouteHandler[]) => { routes[`POST ${path}`] = handlers },
  put: () => {},
  patch: () => {},
  delete: () => {}
})

jest.mock('express', () => ({
  __esModule: true,
  default: { Router: mockRouter },
  Router: mockRouter
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: { findMany: sessionsFindMany, findUnique: sessionsFindUnique },
    teaching_session_messages: { findMany: messagesFindMany, findUnique: messagesFindUnique },
    learner_evidence: { findMany: evidenceFindMany, upsert: evidenceUpsert }
  }
}))

jest.mock('../../services/ai-teaching/content-correctness', () => {
  const actual = jest.requireActual('../../services/ai-teaching/content-correctness')
  return { ...actual, collectSampledTurns: jest.fn() }
})

const contentCorrectness = require('../../services/ai-teaching/content-correctness')
const collectSampledTurns = contentCorrectness.collectSampledTurns as jest.Mock

require('../admin/content-review')

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

function httpReq(query: Record<string, unknown> = {}, body: Record<string, unknown> = {}, user?: { userId: string }) {
  return { query, body, headers: {}, params: {}, user } as any
}

async function run(method: string, path: string, req: any) {
  const res = createResponse()
  const handlers = routes[`${method} ${path}`]
  const next = jest.fn()
  await handlers[handlers.length - 1](req, res, next)
  return { res, next }
}

beforeEach(() => {
  jest.clearAllMocks()
  sessionsFindMany.mockResolvedValue([])
  messagesFindMany.mockResolvedValue([])
  evidenceFindMany.mockResolvedValue([])
})

describe('GET /', () => {
  it('抽样结果按消息 id 合并已标注记录，并返回覆盖率/错误率', async () => {
    collectSampledTurns.mockReturnValue({
      sampled: [
        { messageId: 11, sessionId: 's-1', userId: 'u-1', content: '第一条' },
        { messageId: 12, sessionId: 's-1', userId: 'u-1', content: '第二条' }
      ],
      scannedSessions: 3,
      realSessions: 2,
      virtualSessions: 1
    })
    evidenceFindMany.mockResolvedValue([
      {
        eventId: 'msg:11',
        payload: JSON.stringify({ messageId: 11, verdict: 'incorrect', labeledAt: '2026-10-21T10:00:00.000Z' })
      }
    ])

    const { res } = await run('GET', '/', httpReq({ days: '7', rate: '0.05' }))

    expect(res.statusCode).toBe(200)
    expect(res.body.data.scannedSessions).toBe(3)
    expect(res.body.data.items).toHaveLength(2)
    expect(res.body.data.items[0].label.verdict).toBe('incorrect')
    expect(res.body.data.items[1].label).toBeNull()
    expect(res.body.data.labeled).toBe(1)
    expect(res.body.data.errorRate).toBe(1)
    // 查询键与 CLI 一致：eventId=msg:<id>
    expect(evidenceFindMany.mock.calls[0][0].where.eventId.in).toEqual(['msg:11', 'msg:12'])
  })
})

describe('POST /label', () => {
  it('messageId 非法 → 400', async () => {
    const { res } = await run('POST', '/label', httpReq({}, { verdict: 'correct' }))
    expect(res.statusCode).toBe(400)
    expect(evidenceUpsert).not.toHaveBeenCalled()
  })

  it('verdict 不在枚举内 → 400', async () => {
    const { res } = await run('POST', '/label', httpReq({}, { messageId: 11, verdict: 'maybe' }))
    expect(res.statusCode).toBe(400)
    expect(evidenceUpsert).not.toHaveBeenCalled()
  })

  it('消息不存在 → 404（只认侧表 id）', async () => {
    messagesFindUnique.mockResolvedValue(null)
    const { res } = await run('POST', '/label', httpReq({}, { messageId: 99, verdict: 'correct' }))
    expect(res.statusCode).toBe(404)
    expect(evidenceUpsert).not.toHaveBeenCalled()
  })

  it('学员消息 → 400（抽检只标注教师回合）', async () => {
    messagesFindUnique.mockResolvedValue({
      id: 12,
      sessionId: 's-1',
      payload: JSON.stringify({ role: 'user', content: '我的回答' })
    })
    const { res } = await run('POST', '/label', httpReq({}, { messageId: 12, verdict: 'correct' }))
    expect(res.statusCode).toBe(400)
    expect(evidenceUpsert).not.toHaveBeenCalled()
  })

  it('成功标注：写入与 CLI 同键的 learner_evidence，并记录评审管理员', async () => {
    messagesFindUnique.mockResolvedValue({
      id: 11,
      sessionId: 's-1',
      payload: JSON.stringify({ role: 'assistant', content: '教师回复' })
    })
    sessionsFindUnique.mockResolvedValue({ userId: 'u-1', taskId: 't-1', learningPathId: 'lp-1' })
    evidenceUpsert.mockResolvedValue({})

    const { res } = await run(
      'POST',
      '/label',
      httpReq({}, { messageId: 11, verdict: 'incorrect', note: '  答案与题干冲突  ' }, { userId: 'admin-1' })
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.data.label).toMatchObject({
      messageId: 11,
      verdict: 'incorrect',
      note: '答案与题干冲突',
      reviewerUserId: 'admin-1'
    })
    const args = evidenceUpsert.mock.calls[0][0]
    expect(args.where.eventId_evidenceKey).toEqual({
      eventId: 'msg:11',
      evidenceKey: contentCorrectness.CONTENT_REVIEW_EVIDENCE_KEY
    })
    expect(args.create).toMatchObject({
      eventId: 'msg:11',
      userId: 'u-1',
      pathId: 'lp-1',
      taskId: 't-1',
      sessionId: 's-1',
      evidenceType: contentCorrectness.CONTENT_REVIEW_EVIDENCE_TYPE
    })
  })
})
