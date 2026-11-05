/**
 * #225 回归：agent-logs 详情必须与列表共用同一条折叠管线。
 *
 * 只共享 where 不够：列表的去重是**跨会话**的（dedupeKey=traceId|agentId|秒，无 traceId 时
 * 同秒同 agent 跨会话互撞），模型名还要从**不带会话 id** 的网关行补。详情若只按会话反查
 * 再单独折叠，同一条折叠行的 groupCount / groupItems / model 就会漂移。
 * 本用例用真实路由 handler + 真实折叠实现 + 假 prisma 行，逐项比对两个端点。
 */

export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler> = {}

const USER_ID = 'user-1'
const USER_LISTED = ['skill:goal-conversation', 'skill:path-planning', 'path-agent', 'skill:teaching-turn']

const listUserAgentLogsForGrouping = jest.fn()
const listUserAgentLogsForExport = jest.fn()
const listAgentLogModelRowsByTraceIds = jest.fn()
const listAgentLogModelRowsByPathIds = jest.fn()
const findUserAgentLogById = jest.fn()

function makeRow(id: string, agentId: string, calledAt: string, metadata: Record<string, any>, traceId?: string) {
  return {
    id,
    userId: USER_ID,
    agentId,
    sourceEntry: 'test',
    traceId: traceId ?? null,
    callerAgent: null,
    success: true,
    durationMs: 10,
    tokensUsed: 1,
    error: null,
    errorCode: null,
    calledAt: new Date(calledAt),
    metadata: JSON.stringify(metadata),
  }
}

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      get: (path: string, handler: RouteHandler) => { routes[`GET ${path}`] = handler },
      put: (path: string, handler: RouteHandler) => { routes[`PUT ${path}`] = handler },
      post: (path: string, handler: RouteHandler) => { routes[`POST ${path}`] = handler },
      delete: (path: string, handler: RouteHandler) => { routes[`DELETE ${path}`] = handler },
    }),
  },
}))

jest.mock('../../services/users/user.repo', () => ({
  __esModule: true,
  findCurrentUserProfile: jest.fn(),
  findActivePathIdByUpdatedAt: jest.fn(),
  updateUser: jest.fn(),
  findUserForDeactivation: jest.fn(),
  listUserAchievements: jest.fn(),
  listUserTeachingSessions: jest.fn(),
  countUserTeachingSessions: jest.fn(),
  findSubtasksByIds: jest.fn(),
  listUserAgentLogsForGrouping,
  listUserAgentLogsForExport,
  listAgentLogModelRowsByTraceIds,
  listAgentLogModelRowsByPathIds,
  findUserAgentLogById,
  markOnboardingCompleted: jest.fn(),
}))

jest.mock('../../middleware/projection-access.middleware', () => ({
  __esModule: true,
  rejectProjectionAccess: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}))

jest.mock('../../services/learner/LearnerSnapshotRefreshService', () => ({
  __esModule: true,
  learnerSnapshotRefreshService: { refresh: jest.fn() },
}))

jest.mock('../../services/learner/level.util', () => ({
  __esModule: true,
  getLevelFromXp: jest.fn(() => 1),
}))

jest.mock('../../services/learning/learning.helpers', () => ({
  __esModule: true,
  normalizeSessionDurationMinutes: jest.fn((v: any) => v),
}))

jest.mock('../../services/agent-manifest.service', () => ({
  __esModule: true,
  listUserListedAgentIds: jest.fn(() => USER_LISTED),
  listAgentManifest: jest.fn(() => [
    { id: 'skill:goal-conversation', monitoringGroup: 'Goal' },
    { id: 'skill:path-planning', monitoringGroup: 'Path' },
    { id: 'path-agent', monitoringGroup: 'Path' },
  ]),
}))

jest.mock('../../services/ai-teaching/teaching-session-message-store', () => ({
  __esModule: true,
  loadTeachingMessagesForIds: jest.fn(async () => []),
}))

require('../users')

/** 假 prisma：按 buildAgentLogWhere 的产物筛行（agentId 白名单/单值、success、日期区间、userId） */
function matchesScope(row: any, scope: any): boolean {
  if (!scope || typeof scope !== 'object') return true
  if (scope.userId && row.userId !== scope.userId) return false
  if (scope.agentId) {
    if (typeof scope.agentId === 'string') {
      if (row.agentId !== scope.agentId) return false
    } else if (Array.isArray(scope.agentId.in) && !scope.agentId.in.includes(row.agentId)) {
      return false
    }
  }
  if (typeof scope.success === 'boolean' && row.success !== scope.success) return false
  if (scope.calledAt) {
    const at = (row.calledAt as Date).getTime()
    if (scope.calledAt.gte && at < scope.calledAt.gte.getTime()) return false
    if (scope.calledAt.lte && at > scope.calledAt.lte.getTime()) return false
  }
  return true
}

const descByCalledAt = (a: any, b: any) => b.calledAt.getTime() - a.calledAt.getTime()

/** 让列表/详情共用同一批行（与真实 repo 一样按 where 过滤、按时间倒序返回） */
function useRows(rows: any[]) {
  listUserAgentLogsForGrouping.mockImplementation(async (where: any) =>
    rows.filter((row) => matchesScope(row, where)).slice().sort(descByCalledAt))
  // #230：模型补数行按「已选 traceId + api-gateway」取，不受默认口径白名单约束
  // （网关行不在 USER_LISTED 里，默认取数集不含它，模型名只能靠这次补数回来）。
  listAgentLogModelRowsByTraceIds.mockImplementation(async (userId: string, traceIds: string[]) =>
    rows.filter((row) => row.userId === userId
      && row.agentId === 'api-gateway'
      && traceIds.includes(String(row.traceId ?? ''))))
  // #248：path: 组的代表行无 traceId，补数键换成 metadata.pathId（网关行的 pathId 存在）
  listAgentLogModelRowsByPathIds.mockImplementation(async (userId: string, pathIds: string[]) =>
    rows.filter((row) => {
      if (row.userId !== userId || row.agentId !== 'api-gateway') return false
      let metadata: any = {}
      try { metadata = JSON.parse(row.metadata || '{}') } catch { metadata = {} }
      return pathIds.includes(String(metadata.pathId ?? ''))
    }))
}

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
    },
  }
}

async function callList(query: any) {
  const res = createResponse()
  const next = jest.fn()
  await routes['GET /me/agent-logs']({ user: { userId: USER_ID }, query }, res, next)
  expect(next).not.toHaveBeenCalled()
  return res
}

async function callDetail(logId: string, query: any) {
  const res = createResponse()
  const next = jest.fn()
  await routes['GET /me/agent-logs/:logId'](
    { user: { userId: USER_ID }, params: { logId }, query },
    res,
    next
  )
  expect(next).not.toHaveBeenCalled()
  return res
}

const CONVERSION_AGENTS_FIXTURE = [
  makeRow('acl_p1', 'skill:path-planning', '2026-10-01T10:00:00.000Z', { conversationId: 'conv-path-1' }, 'tr-p1'),
  makeRow('acl_p2', 'skill:path-planning', '2026-10-01T10:05:00.000Z', { conversationId: 'conv-path-1' }, 'tr-p2'),
  makeRow('acl_k1', 'skill:kc-mapper', '2026-10-01T10:06:00.000Z', { conversationId: 'conv-path-1' }, 'tr-k1'),
  makeRow('acl_s1', 'skill:stage-designer', '2026-10-01T10:07:00.000Z', { conversationId: 'conv-path-1' }, 'tr-s1'),
  // 真实网关行不带 conversationId —— 详情不能靠会话预筛把它们丢掉，否则模型名补不回来
  makeRow('acl_gw', 'api-gateway', '2026-10-01T10:00:01.000Z', { model: 'claude-x' }, 'tr-p1'),
]

describe('#225 agent-logs 详情与列表共用折叠管线', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    listUserAgentLogsForExport.mockResolvedValue([])
    listAgentLogModelRowsByTraceIds.mockResolvedValue([])
    listAgentLogModelRowsByPathIds.mockResolvedValue([])
    findUserAgentLogById.mockResolvedValue(null)
  })

  it('默认口径：同一条折叠行的 groupCount / groupItems / model 与列表一致，且不漏出内部 skill', async () => {
    useRows(CONVERSION_AGENTS_FIXTURE)
    const listRes = await callList({})
    const listRow = listRes.body.data.logs.find((log: any) => log.id === 'path:conv-path-1')
    expect(listRow).toBeTruthy()
    expect(listRow.groupCount).toBe(2)
    expect(listRow.groupItems.map((item: any) => item.agentId)).toEqual(['skill:path-planning', 'skill:path-planning'])
    // #230：模型名只写在 api-gateway 行（不在默认白名单里、不在本次取数集内），
    // 默认口径也必须按已选 traceId 把它补回来，否则「模型」列恒为 null。
    expect(listRow.model).toBe('claude-x')

    const detailRes = await callDetail('path:conv-path-1', {})
    expect(detailRes.statusCode).toBe(200)
    const detail = detailRes.body.data
    expect(detail.groupCount).toBe(listRow.groupCount)
    expect(detail.groupItems).toHaveLength(listRow.groupItems.length)
    expect(detail.groupItems.map((item: any) => item.id)).toEqual(listRow.groupItems.map((item: any) => item.id))
    expect(detail.groupItems.map((item: any) => item.agentId))
      .toEqual(['skill:path-planning', 'skill:path-planning'])
    expect(detail.model).toBe(listRow.model)

    // 两处对 DB 用的是同一个 where（不是各拼一份）
    const whereArgs = listUserAgentLogsForGrouping.mock.calls.map((call: any[]) => call[0])
    expect(whereArgs).toHaveLength(2)
    expect(whereArgs[1]).toEqual(whereArgs[0])
  })

  it('includeSystem=true：网关行不带会话 id，详情仍能补回同一个模型名', async () => {
    useRows(CONVERSION_AGENTS_FIXTURE)
    const listRes = await callList({ includeSystem: 'true' })
    const listRow = listRes.body.data.logs.find((log: any) => log.id === 'path:conv-path-1')
    expect(listRow.groupCount).toBe(4)
    expect(listRow.model).toBe('claude-x')

    const detailRes = await callDetail('path:conv-path-1', { includeSystem: 'true' })
    const detail = detailRes.body.data
    expect(detail.groupCount).toBe(listRow.groupCount)
    expect(detail.model).toBe('claude-x')
    expect(detail.model).toBe(listRow.model)
  })

  it('跨会话去重碰撞：详情沿用列表的全局去重，不因只看本会话而多出条目', async () => {
    // 无 traceId 的 path-agent 同秒行：conv-b 的 b1 先入，conv-a 的 a1 被去重掉（列表一直如此）。
    // 详情若按「会话候选行」单独去重，a1 会复活，groupCount 从 2 变 3。
    useRows([
      makeRow('b1', 'path-agent', '2026-10-02T10:00:05.900Z', { sourceConversationId: 'conv-b' }),
      makeRow('a1', 'path-agent', '2026-10-02T10:00:05.100Z', { sourceConversationId: 'conv-a' }),
      makeRow('a2', 'path-agent', '2026-10-02T10:00:06.000Z', { sourceConversationId: 'conv-a' }),
      makeRow('a3', 'path-agent', '2026-10-02T10:00:07.000Z', { sourceConversationId: 'conv-a' }),
    ])

    const listRes = await callList({})
    const listRow = listRes.body.data.logs.find((log: any) => log.id === 'path:conv-a')
    expect(listRow).toBeTruthy()
    expect(listRow.groupCount).toBe(2)

    const detailRes = await callDetail('path:conv-a', {})
    const detail = detailRes.body.data
    expect(detail.groupCount).toBe(listRow.groupCount)
    expect(detail.groupItems.map((item: any) => item.id))
      .toEqual(listRow.groupItems.map((item: any) => item.id))
    expect(detail.groupItems.map((item: any) => item.id)).not.toContain('a1')
  })

  it('详情带上与列表相同的 agentId 筛选时同样收敛', async () => {
    useRows(CONVERSION_AGENTS_FIXTURE)
    const query = { agentId: 'skill:path-planning' }
    const listRes = await callList(query)
    const listRow = listRes.body.data.logs.find((log: any) => log.id === 'path:conv-path-1')

    const detailRes = await callDetail('path:conv-path-1', query)
    expect(detailRes.body.data.groupCount).toBe(listRow.groupCount)
    expect(detailRes.body.data.groupCount).toBe(2)
  })

  it('列表没给出的组键（如只剩单行、或筛选后排空）返回 404，不伪造组详情', async () => {
    useRows([makeRow('only', 'path-agent', '2026-10-03T10:00:00.000Z', { sourceConversationId: 'conv-solo' })])
    const res = await callDetail('path:conv-solo', {})
    expect(res.statusCode).toBe(404)
    expect(res.body.success).toBe(false)
  })

  it('未折叠的普通主键仍按主键查单条（不整批折叠），但走同一可见口径', async () => {
    findUserAgentLogById.mockResolvedValue({ id: 'acl_plain', agentId: 'skill:teaching-turn' })
    const res = await callDetail('acl_plain', {})
    expect(res.body.data.id).toBe('acl_plain')
    expect(listUserAgentLogsForGrouping).not.toHaveBeenCalled()
    // #245：主键分支也必须带上列表的 where（此前详情整段忽略筛选，任何 id 都能取到）
    expect(findUserAgentLogById).toHaveBeenCalledWith('acl_plain', USER_ID, expect.anything())
  })

  it('#245：acl_* 真实主键行的详情 model 与列表相等（行本身无 model，靠 traceId 关联网关行）', async () => {
    // 生产形态：业务行 model 列恒为 null（全库 acl% 4223 行 model 非空 0 行），
    // 模型名只写在同 trace 的 api-gateway 行 metadata 上，而网关行不在默认白名单里。
    // 详情若原样返回 findFirst 的原始行，这里就会是 null —— 与列表/导出不一致。
    // 选一个**未折叠**的业务行（skill:teaching-turn 不参与会话分组），即 UI 经 repLogId 走的路径。
    useRows([
      makeRow('acl_turn', 'skill:teaching-turn', '2026-10-04T10:00:00.000Z', {}, 'tr-turn'),
      makeRow('acl_gw_turn', 'api-gateway', '2026-10-04T10:00:01.000Z', { model: 'deepseek-v4.1-flash' }, 'tr-turn'),
    ])
    findUserAgentLogById.mockImplementation(async (logId: string, userId: string) =>
      userId === USER_ID ? { ...makeRow(logId, 'skill:teaching-turn', '2026-10-04T10:00:00.000Z', {}, 'tr-turn') } : null)

    const listRes = await callList({})
    const listRow = listRes.body.data.logs.find((log: { id: string; model?: string | null }) =>
      log.id === 'acl_turn')
    expect(listRow).toBeTruthy()
    expect(listRow.model).toBe('deepseek-v4.1-flash')

    const detailRes = await callDetail('acl_turn', {})
    expect(detailRes.statusCode).toBe(200)
    expect(detailRes.body.data.id).toBe('acl_turn')
    // 核心断言：同一个 id，列表与详情的 model 必须逐字段相等
    expect(detailRes.body.data.model).toBe(listRow.model)
    // 且不是靠原始行自带 model 蒙对的——原始行没有 model 列值
    expect(detailRes.body.data.model).toBe('deepseek-v4.1-flash')
  })

  // #248：path: 折叠组的代表行是无 traceId 的 path-agent 阶段流水（写侧不写 traceId，
  // metadata 里也没有 model）；模型名只写在同 pathId 的 api-gateway 行上，而网关行不在
  // 默认白名单、不在本次取数集内。此前补数只认 traceId，键在这批行上结构性不存在，
  // 于是 path 组的 model 恒为 null（includeSystem=true 也救不了）。修复：改用 metadata.pathId。
  it('#248 整组无 traceId 的 path: 组按 metadata.pathId 补回模型名', async () => {
    useRows([
      makeRow('acl_pa1', 'path-agent', '2026-10-05T10:00:00.000Z', {
        sourceConversationId: 'conv-flow', phase: 'core', status: 'succeeded', pathId: 'lp_flow_1',
      }),
      makeRow('acl_pa2', 'path-agent', '2026-10-05T10:00:05.000Z', {
        sourceConversationId: 'conv-flow', phase: 'stageDesign', status: 'started', pathId: 'lp_flow_1',
      }),
      // 网关行：api-gateway 不在默认白名单，listUserAgentLogsForGrouping 不会返回它
      makeRow('acl_gw_flow', 'api-gateway', '2026-10-05T10:00:01.000Z', {
        pathId: 'lp_flow_1', model: 'm-path',
      }, 'tr-flow'),
    ])

    const listRes = await callList({})
    const listRow = listRes.body.data.logs.find((log: any) => log.id === 'path:conv-flow')
    expect(listRow).toBeTruthy()
    expect(listRow.groupCount).toBe(2)
    // 修复前这里恒为 null（整组没有 traceId，补数键不存在）
    expect(listRow.model).toBe('m-path')
    // 补数确实走了 pathId 键，而不是碰巧从取数集里看到网关行
    expect(listAgentLogModelRowsByPathIds)
      .toHaveBeenCalledWith(USER_ID, expect.arrayContaining(['lp_flow_1']))

    const detailRes = await callDetail('path:conv-flow', {})
    expect(detailRes.body.data.model).toBe(listRow.model)
  })

  it('#248 没修过头：非 path 组仍按 traceId 取模型，无 traceId 无 pathId 仍为 null', async () => {
    useRows([
      makeRow('acl_goal1', 'skill:goal-conversation', '2026-10-06T10:00:00.000Z', { conversationId: 'gc_m' }, 'tr-goal'),
      makeRow('acl_goal2', 'skill:goal-conversation', '2026-10-06T10:01:00.000Z', { conversationId: 'gc_m' }, 'tr-goal'),
      makeRow('acl_gw_goal', 'api-gateway', '2026-10-06T10:00:01.000Z', { model: 'm-goal' }, 'tr-goal'),
      // 无 traceId、无 pathId：修复前后都必须保持 null
      makeRow('acl_plain', 'skill:teaching-turn', '2026-10-06T10:02:00.000Z', {}),
    ])

    const listRes = await callList({})
    const goal = listRes.body.data.logs.find((log: any) => log.id === 'goal:gc_m')
    expect(goal.model).toBe('m-goal')
    const plain = listRes.body.data.logs.find((log: any) => log.id === 'acl_plain')
    expect(plain.model).toBeNull()
  })
})
