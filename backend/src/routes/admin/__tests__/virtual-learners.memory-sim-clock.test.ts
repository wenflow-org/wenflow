/**
 * 回归：管理端记忆池 GET /api/admin/virtual-learners/:id/memory 的模拟钟口径（2026-10-29 审计 M-16）
 *
 * 背景：管理端 HTTP 请求没有模拟钟 AsyncLocalStorage 上下文，memory-trace 的
 * simulatedNowOr() 恒回落真实墙钟 → 模拟钟场景下 counts.dueReview 恒 0。
 * 修复：路由按写侧同链路（会话级 clock > 画像级 clock > 全局 settings）解析实例当前
 * 模拟时刻，显式作为 options.now 下传 buildLearnerMemorySnapshot，并同步遗忘曲线 asOf。
 * 本文件锁定：启用时 now/asOf 用模拟钟；未启用时不下发 now（现行为零变化）。
 */

export {}

import { Router } from 'express'

const profilesFindUnique = jest.fn()
const sessionsFindFirst = jest.fn()
const tracesFindMany = jest.fn()
const buildLearnerMemorySnapshot = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: { findUnique: profilesFindUnique },
    virtual_sessions: { findFirst: sessionsFindFirst },
    memory_traces: { findMany: tracesFindMany },
  },
}))
jest.mock('../../../services/virtual-lab-settings.service', () => ({
  getVirtualLabSettings: jest.fn(),
  DEFAULT_VIRTUAL_LAB_SETTINGS: {
    dateSimulation: {
      enabled: false,
      timezone: 'Asia/Shanghai',
      defaultPaceDaysPerAdvance: 1,
      maxSimulatedDays: 90,
      pauseOnIntervention: false,
      autoAdvanceEnabled: false,
      courseWeekdays: [1, 2, 3, 4, 5],
      lessonsPerDay: 1,
    },
  },
}))
jest.mock('../../../virtual-lab/learner-memory', () => ({
  buildLearnerMemorySnapshot: (userId: string, options: unknown) => buildLearnerMemorySnapshot(userId, options),
}))
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}))

import { registerProjectionRoutes } from '../virtual-learners.projections'
import { getVirtualLabSettings } from '../../../services/virtual-lab-settings.service'

interface RouteLayer {
  route?: { path?: string; methods?: Record<string, boolean | undefined>; stack: Array<{ handle: (req: unknown, res: unknown, next: unknown) => unknown }> }
}

function getRouteHandler(router: { stack: RouteLayer[] }, path: string, method: string) {
  const layer = router.stack.find(
    (item) => item.route?.path === path && item.route?.methods?.[method]
  )
  if (!layer || !layer.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

interface MockResponse {
  statusCode: number
  body: { data?: { asOf?: string; counts?: Record<string, number> } } | undefined
  status: (code: number) => MockResponse
  json: (payload: unknown) => void
}

function createResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    status: () => res,
    json: (payload) => {
      res.body = payload as MockResponse['body']
    },
  }
  return res
}

async function run(handler: ReturnType<typeof getRouteHandler>, req: unknown): Promise<MockResponse> {
  const res = createResponse()
  await handler(req, res, jest.fn())
  return res
}

const SIMULATED_NOW = '2026-10-23T15:59:59.999Z'

const disabledSettings = {
  dateSimulation: {
    enabled: false,
    timezone: 'Asia/Shanghai',
    defaultPaceDaysPerAdvance: 1,
    maxSimulatedDays: 90,
    pauseOnIntervention: false,
    autoAdvanceEnabled: false,
    courseWeekdays: [1, 2, 3, 4, 5],
    lessonsPerDay: 1,
  },
}

function profileRow(profileData: Record<string, unknown>) {
  return {
    id: 'vp-sim-1',
    userId: 'u-sim-1',
    profile: JSON.stringify(profileData),
    createdAt: new Date('2026-10-20T10:00:00Z'),
    updatedAt: new Date('2026-10-23T12:00:00Z'),
  }
}

/** 会话级时钟：advance-day 推进后落在 stageResults.simulationClock 的形态 */
function sessionRow(stageClock: Record<string, unknown> | null) {
  return {
    id: 'vs-1',
    stageResults: stageClock ? JSON.stringify({ simulationClock: stageClock }) : JSON.stringify({}),
    createdAt: new Date('2026-10-20T10:00:00Z'),
  }
}

const emptyMemory = {
  mastered: [],
  dueReview: [{ name: '指针算术', status: 'review', progress: 40 }],
  struggling: [],
  recentCompleted: [],
  recentTaskTitles: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  buildLearnerMemorySnapshot.mockResolvedValue(emptyMemory)
  tracesFindMany.mockResolvedValue([])
  ;(getVirtualLabSettings as jest.Mock).mockResolvedValue(disabledSettings)
})

describe('GET /:id/memory 的实例模拟钟口径（M-16）', () => {
  it('会话级模拟钟启用 → options.now 与响应 asOf 用 clock.simulatedNow（不再读真实墙钟）', async () => {
    profilesFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }))
    sessionsFindFirst.mockResolvedValue(sessionRow({
      enabled: true,
      baseDate: '2026-10-20',
      dayIndex: 3,
      simulatedNow: SIMULATED_NOW,
      timezone: 'Asia/Shanghai',
    }))

    const router = Router()
    registerProjectionRoutes(router)
    const res = await run(getRouteHandler(router, '/:id/memory', 'get'), { params: { id: 'vp-sim-1' } })

    expect(res.statusCode).toBe(200)
    expect(sessionsFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { virtualProfileId: 'vp-sim-1' } }))
    // 记忆读取拿到实例模拟钟时刻 → dueReview 不再按真实墙钟判 0
    expect(buildLearnerMemorySnapshot).toHaveBeenCalledWith('u-sim-1', { limit: 12, now: new Date(SIMULATED_NOW) })
    expect(res.body?.data?.asOf).toBe(SIMULATED_NOW)
    expect(res.body?.data?.counts?.dueReview).toBe(1)
  })

  it('实例无模拟钟（会话/画像级未启用 + 全局默认关）→ 不下发 now，现行为不变', async () => {
    profilesFindUnique.mockResolvedValue(profileRow({ knownConcepts: [], struggleConcepts: [] }))
    sessionsFindFirst.mockResolvedValue(sessionRow(null))

    const router = Router()
    registerProjectionRoutes(router)
    const res = await run(getRouteHandler(router, '/:id/memory', 'get'), { params: { id: 'vp-sim-1' } })

    expect(res.statusCode).toBe(200)
    const call = buildLearnerMemorySnapshot.mock.calls[0] as [string, { limit?: number; now?: Date }]
    expect(call[0]).toBe('u-sim-1')
    expect(call[1].limit).toBe(12)
    expect(call[1].now).toBeUndefined()
    // asOf 回落真实墙钟（ISO 可解析即视为现行为）
    expect(Number.isNaN(new Date(res.body?.data?.asOf).getTime())).toBe(false)
  })

  it('会话无钟但画像级 clock 启用 → 画像级生效（session > profile > settings 链路）', async () => {
    profilesFindUnique.mockResolvedValue(profileRow({
      knownConcepts: [],
      struggleConcepts: [],
      simulationClock: { enabled: true, startDate: '2026-10-20' },
    }))
    sessionsFindFirst.mockResolvedValue(sessionRow(null))

    const router = Router()
    registerProjectionRoutes(router)
    const res = await run(getRouteHandler(router, '/:id/memory', 'get'), { params: { id: 'vp-sim-1' } })

    expect(res.statusCode).toBe(200)
    expect(buildLearnerMemorySnapshot).toHaveBeenCalledWith('u-sim-1', expect.objectContaining({ now: expect.any(Date) }))
    // dayIndex=0 → 模拟时刻 = baseDate 当日窗口末端（Asia/Shanghai 23:59:59.999 = 15:59:59.999Z）
    expect(res.body?.data?.asOf).toBe('2026-10-20T15:59:59.999Z')
  })
})
