/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #172-5 回归：模拟日注入旧值 + 黑盒轨边界未声明
 *
 * 病灶：`advance-day` 的当天学习在 `runWithSimulatedClock(dayWindow.asOf)` 内跑，
 * 但推进后的 simulationClock 是在运行块**之后**才 mergeSessionStageResults 落库的；
 * 课堂里的 `getTemporalContext(session)` 若只读库内 clock，注入的是「推进前」的 dayIndex。
 *
 * 本文件同时钉住：
 * (a) 运行块内注入 dayIndex = 当天推进后的值（不是前一天）；未绑模拟钟时默认行为不变。
 * (b) 「黑盒会话 + 日期模拟」在 simulation-config / advance-day 入口被显式拒绝（可读报错）。
 */
const mockFindSessionById = jest.fn()
const mockUpdateSessionStageResults = jest.fn()
const mockFindProfileJsonById = jest.fn()
const mockRunAssistedSessionMutation = jest.fn()
const mockRunDayLearning = jest.fn()
const mockMergeSessionStageResults = jest.fn()
const mockGetVirtualLabSettings = jest.fn()

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))
jest.mock('../../../services/virtual-lab/virtual-session.repo', () => ({
  __esModule: true,
  findSessionById: (...args: unknown[]) => mockFindSessionById(...args),
  updateSessionStageResults: (...args: unknown[]) => mockUpdateSessionStageResults(...args),
}))
jest.mock('../../../services/virtual-lab/virtual-learner-profile.repo', () => ({
  __esModule: true,
  findProfileJsonById: (...args: unknown[]) => mockFindProfileJsonById(...args),
}))
// 路由层依赖的共享 helper：本次只测入口护栏，不给它拖整条学习链
jest.mock('../virtual-learners.assisted-shared', () => ({
  __esModule: true,
  runAssistedSessionMutation: (...args: unknown[]) => mockRunAssistedSessionMutation(...args),
  runDayLearning: (...args: unknown[]) => mockRunDayLearning(...args),
  mergeSessionStageResults: (...args: unknown[]) => mockMergeSessionStageResults(...args),
}))
// session-factory 会拉起 blackbox-runner 等重模块；这里只需 parseJson / 预算枚举
jest.mock('../../../virtual-lab/session-factory', () => ({
  __esModule: true,
  SIMULATION_FRICTION_BUDGETS: ['none', 'low', 'normal', 'high', 'stress_test'],
  parseJson: (raw: unknown, fallback: unknown) => {
    try { return typeof raw === 'string' && raw ? JSON.parse(raw) : fallback } catch { return fallback }
  },
}))
// 只替换读库的设置读取，其余（DEFAULT_VIRTUAL_LAB_SETTINGS 等）用真实实现
jest.mock('../../../services/virtual-lab-settings.service', () => {
  const actual = jest.requireActual('../../../services/virtual-lab-settings.service')
  return { ...actual, getVirtualLabSettings: (...args: unknown[]) => mockGetVirtualLabSettings(...args) }
})

import { registerAssistedSimulationRoutes } from '../virtual-learners.assisted-simulation'
import simulatedDayService, {
  resolveDayWindow,
  temporalContextFromClock,
  resolveSimulationClock,
} from '../../../services/virtual-lab/simulated-day.service'
import { runWithSimulatedClock, getSimulatedAsOf } from '../../../services/virtual-lab/simulation-clock-context'
import { DEFAULT_VIRTUAL_LAB_SETTINGS } from '../../../services/virtual-lab-settings.service'

const BASE_DATE = '2026-09-14' // 周一
const SETTINGS = {
  ...DEFAULT_VIRTUAL_LAB_SETTINGS,
  dateSimulation: {
    ...DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation,
    enabled: false,
    timezone: 'Asia/Shanghai',
    courseWeekdays: [1, 2, 3, 4, 5],
    maxSimulatedDays: 90,
  },
}

/** 库内仍是「推进前」的时钟（dayIndex=2）；本次推进目标是第 3 天 */
function staleSession() {
  return {
    createdAt: new Date('2026-09-14T00:00:00Z'),
    stageResults: JSON.stringify({
      simulationClock: { enabled: true, baseDate: BASE_DATE, dayIndex: 2, timezone: 'Asia/Shanghai' },
    }),
    virtual_learner_profiles: { profile: JSON.stringify({}) },
  }
}

interface FakeResponse {
  statusCode: number
  body: any
  status: (code: number) => FakeResponse
  json: (payload: unknown) => FakeResponse
}

function createResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    body: undefined,
    status: function (this: FakeResponse, code: number) { this.statusCode = code; return this },
    json: function (this: FakeResponse, payload: unknown) { this.body = payload; return this },
  }
  return res
}

function routeHandlers() {
  const handlers = new Map<string, (req: any, res: any) => Promise<unknown>>()
  const router: any = {
    put: (path: string, handle: any) => handlers.set(`PUT ${path}`, handle),
    post: (path: string, handle: any) => handlers.set(`POST ${path}`, handle),
  }
  registerAssistedSimulationRoutes(router)
  return handlers
}

async function call(handler: (req: any, res: any) => Promise<unknown>, req: unknown) {
  const res = createResponse()
  await handler(req as any, res)
  return res
}

beforeEach(() => {
  jest.restoreAllMocks()
  jest.clearAllMocks()
  mockGetVirtualLabSettings.mockResolvedValue(SETTINGS)
  mockFindProfileJsonById.mockResolvedValue(null)
  mockRunAssistedSessionMutation.mockImplementation(async (_id: string, work: any) => work(
    { id: 's1', stageResults: '{}', createdAt: new Date() },
    async () => {},
  ))
})

describe('#172-5 (a) 模拟日内注入的 dayIndex 必须是推进后的值', () => {
  it('runWithSimulatedClock(第 3 天窗口) 内 getTemporalContext 读到 dayIndex=3（不是库内的 2）', async () => {
    const session = staleSession()
    const dayWindow = resolveDayWindow(BASE_DATE, 3, 'Asia/Shanghai')
    expect(dayWindow.simulatedDay).toBe('2026-09-17')

    // 还原 advance-day runTasks 的真实调用形态：运行块绑当天 asOf，库内 clock 仍旧
    const injected = await runWithSimulatedClock(dayWindow.asOf, () =>
      simulatedDayService.getTemporalContext(session),
    )

    expect(injected).not.toBeNull()
    expect(injected?.dayIndex).toBe(3)
    expect(injected?.simulatedDay).toBe('2026-09-17')
    expect(injected?.simulatedNow).toBe(dayWindow.asOf.toISOString())
    expect(injected?.sinceLastSessionDays).toBe(1) // 周四 ← 周三
    // 库内时钟确实没动（推进仍发生在运行块之后）
    expect(JSON.parse(session.stageResults).simulationClock.dayIndex).toBe(2)
  })

  it('端到端（advance-day 路由 → runWithSimulatedClock → getTemporalContext）：当天课堂读到推进后的 dayIndex', async () => {
    // 库内 clock 停在 dayIndex=2；本次按课表推进到第 3 天（周四）
    const sessionRow = {
      id: 's1',
      virtualProfileId: 'vp1',
      userId: 'u1',
      createdAt: new Date('2026-09-14T00:00:00Z'),
      stageResults: JSON.stringify({
        simulationClock: { enabled: true, baseDate: BASE_DATE, dayIndex: 2, timezone: 'Asia/Shanghai' },
      }),
    }
    mockFindSessionById.mockResolvedValue(sessionRow)
    mockRunAssistedSessionMutation.mockImplementation(async (_id: string, work: any) =>
      work(sessionRow, async () => {}),
    )
    jest.spyOn(simulatedDayService, 'getSimulationClock').mockResolvedValue(null)

    let injected: Awaited<ReturnType<typeof simulatedDayService.getTemporalContext>> = null
    let boundAsOf: Date | null = null
    mockRunDayLearning.mockImplementation(async () => {
      boundAsOf = getSimulatedAsOf()
      // 还原 learn-phase 的注入点：模拟日上下文内、用库内（未落库推进）的 session 派生
      injected = await simulatedDayService.getTemporalContext(sessionRow)
      return { started: true, chunks: 1 }
    })

    const handler = routeHandlers().get('POST /sessions/:sessionId/advance-day')!
    const res = await call(handler, {
      params: { sessionId: 's1' },
      body: { days: 1, runTasks: true },
    })

    expect(res.statusCode).toBe(200)
    expect(res.body?.data?.advancedDayIndexes).toEqual([3])
    expect(res.body?.data?.simulatedDay).toBe('2026-09-17')
    expect(boundAsOf?.toISOString()).toBe(resolveDayWindow(BASE_DATE, 3, 'Asia/Shanghai').asOf.toISOString())
    // 核心断言：注入的不是推进前的 2，而是当天的 3
    expect(injected?.dayIndex).toBe(3)
    expect(injected?.simulatedDay).toBe('2026-09-17')
    expect(injected?.sinceLastSessionDays).toBe(1)
    expect(mockMergeSessionStageResults).toHaveBeenCalledWith('s1', expect.objectContaining({
      simulationClock: expect.objectContaining({ dayIndex: 3 }),
    }))
  })

  it('对照 2：模拟钟上下文绑定的是库内当日（step/auto/autopilot 路径）→ dayIndex 不变', async () => {
    // 非 advance-day 入口用 clock.simulatedNow（= 当前 dayIndex 的日窗口末端）绑钟，
    // 读侧仍应给出同一个 dayIndex，不能因本次修复而漂移。
    const session = staleSession()
    const currentDayAsOf = resolveDayWindow(BASE_DATE, 2, 'Asia/Shanghai').asOf
    const ctx = await runWithSimulatedClock(currentDayAsOf, () =>
      simulatedDayService.getTemporalContext(session),
    )
    expect(ctx?.dayIndex).toBe(2)
    expect(ctx?.simulatedDay).toBe('2026-09-16')
  })

  it('对照：未绑定模拟钟上下文时仍按库内 clock 派生（默认行为不变）', async () => {
    const ctx = await simulatedDayService.getTemporalContext(staleSession())
    expect(ctx?.dayIndex).toBe(2)
    expect(ctx?.simulatedDay).toBe('2026-09-16')
  })

  it('显式 override.asOf 也能给出推进后的值，且纯函数口径一致', async () => {
    const dayWindow = resolveDayWindow(BASE_DATE, 3, 'Asia/Shanghai')
    const viaService = await simulatedDayService.getTemporalContext(staleSession(), { asOf: dayWindow.asOf })
    const clock = resolveSimulationClock({
      stageResultsClock: { enabled: true, baseDate: BASE_DATE, dayIndex: 2 },
      settings: SETTINGS.dateSimulation,
      sessionCreatedAt: new Date('2026-09-14T00:00:00Z'),
    })
    const viaPure = temporalContextFromClock(clock, { asOf: dayWindow.asOf })
    expect(viaService?.dayIndex).toBe(3)
    expect(viaPure?.dayIndex).toBe(3)
    expect(viaPure?.simulatedDay).toBe('2026-09-17')
    // 只允许向前：更早的 asOf 不得把注入倒退回库内进度之前
    const earlier = resolveDayWindow(BASE_DATE, 1, 'Asia/Shanghai')
    expect(temporalContextFromClock(clock, { asOf: earlier.asOf })?.dayIndex).toBe(2)
  })
})

describe('#172-5 (b) 黑盒会话 + 日期模拟在入口显式拒绝', () => {
  const blackbox = {
    id: 's1',
    createdAt: new Date('2026-09-14T00:00:00Z'),
    stageResults: JSON.stringify({ experiment: { mode: 'blackbox-api', experimentId: 'e1', runId: 'r1' } }),
  }

  it('PUT simulation-config 给黑盒会话开启日期模拟 → 409 + 可读错误，且不落库', async () => {
    mockFindSessionById.mockResolvedValue(blackbox)
    const handler = routeHandlers().get('PUT /sessions/:sessionId/simulation-config')!
    expect(handler).toBeDefined()

    const res = await call(handler, {
      params: { sessionId: 's1' },
      body: { simulationClock: { enabled: true, baseDate: BASE_DATE } },
    })

    expect(res.statusCode).toBe(409)
    expect(res.body.success).toBe(false)
    expect(String(res.body.error)).toContain('不支持日期模拟')
    expect(String(res.body.error)).toContain('真实墙钟')
    expect(res.body.code).toBe('SIM_DATE_BLACKBOX_UNSUPPORTED')
    expect(mockRunAssistedSessionMutation).not.toHaveBeenCalled()
    expect(mockUpdateSessionStageResults).not.toHaveBeenCalled()
  })

  it('POST advance-day 对黑盒会话 → 409 + 可读错误，不进入推进/跑课', async () => {
    mockFindSessionById.mockResolvedValue(blackbox)
    const handler = routeHandlers().get('POST /sessions/:sessionId/advance-day')!
    expect(handler).toBeDefined()

    const res = await call(handler, {
      params: { sessionId: 's1' },
      body: { days: 1, runTasks: true },
    })

    expect(res.statusCode).toBe(409)
    expect(res.body.success).toBe(false)
    expect(String(res.body.error)).toContain('不支持日期模拟')
    expect(mockRunAssistedSessionMutation).not.toHaveBeenCalled()
    expect(mockRunDayLearning).not.toHaveBeenCalled()
  })

  it('边界不误伤：assisted 会话开启日期模拟仍照旧走 mutation；黑盒关闭日期模拟不触发本护栏', async () => {
    const assisted = {
      id: 's1',
      createdAt: new Date('2026-09-14T00:00:00Z'),
      stageResults: JSON.stringify({}),
    }
    mockFindSessionById.mockResolvedValue(assisted)
    mockRunAssistedSessionMutation.mockResolvedValue({ simulationConfig: {}, simulationClock: null })
    const handler = routeHandlers().get('PUT /sessions/:sessionId/simulation-config')!

    const res = await call(handler, {
      params: { sessionId: 's1' },
      body: { simulationClock: { enabled: true, baseDate: BASE_DATE } },
    })
    expect(res.statusCode).toBe(200)
    expect(mockRunAssistedSessionMutation).toHaveBeenCalledTimes(1)

    // enabled=false（清理历史脏配置）不触发护栏
    mockFindSessionById.mockResolvedValue(blackbox)
    const offRes = await call(handler, {
      params: { sessionId: 's1' },
      body: { simulationClock: { enabled: false } },
    })
    expect(offRes.statusCode).toBe(200)
    expect(mockRunAssistedSessionMutation).toHaveBeenCalledTimes(2)
  })
})
