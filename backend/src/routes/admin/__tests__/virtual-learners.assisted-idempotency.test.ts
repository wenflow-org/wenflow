/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #173-3（方案 B）：assisted 最贵入口的幂等键。
 *
 * 缺陷：teaching-step / step / auto-learning 没有幂等键——网关超时后客户端重试会真多推一个回合
 * （多一轮 LLM + 多写一回合历史）。
 *
 * 契约（沿用黑盒 `Idempotency-Key` header 约定）：
 *  - 同 key + 同请求体 → 只执行一次，第二次回放上次结果（`reused: true`），不再跑协调器；
 *  - 不同 key → 各执行一次；
 *  - 不带 key → 保持旧行为（直通，响应体不变，不出现 `reused` 字段）；
 *  - 账本有 TTL（30 分钟）与容量上限，过期后同 key 重新执行。
 */
const mockExecuteLearningStep = jest.fn()
const mockExecuteAutoLearning = jest.fn()
const mockFindSessionById = jest.fn()
const mockFindProfileJsonById = jest.fn()

jest.mock('../../../coordinators/simulation.coordinator', () => ({
  __esModule: true,
  default: {
    runLeasedExclusive: async (_sessionId: string, work: (assertLeaseOwned: () => Promise<void>) => Promise<any>) =>
      work(async () => undefined),
    executeLearningStep: (...args: any[]) => mockExecuteLearningStep(...args),
    executeAutoLearning: (...args: any[]) => mockExecuteAutoLearning(...args),
  },
}))
jest.mock('../../../services/virtual-lab/virtual-session.repo', () => ({
  __esModule: true,
  findSessionById: (...args: any[]) => mockFindSessionById(...args),
}))
jest.mock('../../../services/virtual-lab/virtual-learner-profile.repo', () => ({
  __esModule: true,
  findProfileJsonById: (...args: any[]) => mockFindProfileJsonById(...args),
}))
jest.mock('../../../services/virtual-lab-settings.service', () => {
  const actual = jest.requireActual('../../../services/virtual-lab-settings.service')
  return {
    ...actual,
    getVirtualLabSettings: jest.fn(async () => ({
      ...actual.DEFAULT_VIRTUAL_LAB_SETTINGS,
      dateSimulation: { ...actual.DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation, enabled: false },
    })),
  }
})
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import express from 'express'
import { registerAssistedTeachingRoutes } from '../virtual-learners.assisted-teaching'
import { resetAssistedIdempotencyStore } from '../virtual-learners.assisted-shared'

function buildRouter() {
  const router = express.Router()
  registerAssistedTeachingRoutes(router)
  return router
}

function getPostHandler(path: string) {
  const layer = (buildRouter() as any).stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.post
  )
  if (!layer) throw new Error(`Route not found: ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createRequest(body: Record<string, unknown>, idempotencyKey?: string) {
  return {
    params: { sessionId: 'session-1' },
    body,
    get: (name: string) => (name.toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined),
  } as any
}

function createResponse() {
  const res: any = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

beforeEach(() => {
  jest.clearAllMocks()
  resetAssistedIdempotencyStore()
  mockFindSessionById.mockResolvedValue({
    id: 'session-1',
    userId: 'user-1',
    virtualProfileId: 'profile-1',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    stageResults: '{}',
  })
  mockFindProfileJsonById.mockResolvedValue({ profile: '{}' })
  mockExecuteLearningStep.mockResolvedValue({ success: true, userMessage: 'u', aiResponse: 'a' })
  mockExecuteAutoLearning.mockResolvedValue({ success: true, totalSteps: 3 })
})

describe('#173-3 assisted 入口幂等（同一 Idempotency-Key 重发只推进一个回合）', () => {
  it('teaching-step：同 key 重发只执行一次，第二次回放结果', async () => {
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')

    const res1 = createResponse()
    await handler(createRequest({}, 'key-teaching-1'), res1)
    const res2 = createResponse()
    await handler(createRequest({}, 'key-teaching-1'), res2)

    expect(mockExecuteLearningStep).toHaveBeenCalledTimes(1)
    expect(res1.json).toHaveBeenCalledWith({
      success: true,
      data: { success: true, userMessage: 'u', aiResponse: 'a' },
      error: undefined,
      reused: false,
    })
    expect(res2.json).toHaveBeenCalledWith({
      success: true,
      data: { success: true, userMessage: 'u', aiResponse: 'a' },
      error: undefined,
      reused: true,
    })
  })

  it('teaching-step：不同 key 各自执行（正常推进不受影响）', async () => {
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')

    await handler(createRequest({}, 'key-a'), createResponse())
    await handler(createRequest({}, 'key-b'), createResponse())

    expect(mockExecuteLearningStep).toHaveBeenCalledTimes(2)
  })

  it('teaching-step：不带 key → 直通执行，响应体保持旧形状（无 reused 字段）', async () => {
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')

    const res = createResponse()
    await handler(createRequest({}), res)
    await handler(createRequest({}), res)

    expect(mockExecuteLearningStep).toHaveBeenCalledTimes(2)
    expect(res.json.mock.calls[0][0]).toEqual({
      success: true,
      data: { success: true, userMessage: 'u', aiResponse: 'a' },
      error: undefined,
    })
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('reused')
  })

  it('auto-learning：同 key 重发只执行一次（长事务不重跑）', async () => {
    const handler = getPostHandler('/sessions/:sessionId/auto-learning')

    await handler(createRequest({ maxMilestones: 4 }, 'key-auto-1'), createResponse())
    const res2 = createResponse()
    await handler(createRequest({ maxMilestones: 4 }, 'key-auto-1'), res2)

    expect(mockExecuteAutoLearning).toHaveBeenCalledTimes(1)
    expect(mockExecuteAutoLearning).toHaveBeenCalledWith('session-1', { maxMilestones: 4, maxTurns: 40 })
    expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ reused: true }))
  })

  it('auto-learning：同 key 不同参数 → 409 幂等键复用（不静默回放别的一次结果）', async () => {
    const handler = getPostHandler('/sessions/:sessionId/auto-learning')

    await handler(createRequest({ maxMilestones: 4 }, 'key-auto-2'), createResponse())
    const res2 = createResponse()
    await handler(createRequest({ maxMilestones: 5 }, 'key-auto-2'), res2)

    expect(mockExecuteAutoLearning).toHaveBeenCalledTimes(1)
    expect(res2.status).toHaveBeenCalledWith(409)
    expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'ASSISTED_IDEMPOTENCY_KEY_REUSED',
    }))
  })

  it('失败结果不入账：同 key 可重试并真正重跑', async () => {
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')
    mockExecuteLearningStep
      .mockResolvedValueOnce({ success: false, error: 'LLM_TIMEOUT' })
      .mockResolvedValueOnce({ success: true, userMessage: 'u', aiResponse: 'a' })

    await handler(createRequest({}, 'key-retry'), createResponse())
    await handler(createRequest({}, 'key-retry'), createResponse())

    expect(mockExecuteLearningStep).toHaveBeenCalledTimes(2)
  })

  it('账本 TTL 生效：超过 30 分钟后同 key 重新执行', async () => {
    const handler = getPostHandler('/sessions/:sessionId/teaching-step')
    const nowSpy = jest.spyOn(Date, 'now')
    const base = 1_800_000_000_000

    nowSpy.mockReturnValue(base)
    await handler(createRequest({}, 'key-ttl'), createResponse())
    nowSpy.mockReturnValue(base + 29 * 60 * 1000)
    await handler(createRequest({}, 'key-ttl'), createResponse())
    expect(mockExecuteLearningStep).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(base + 31 * 60 * 1000)
    await handler(createRequest({}, 'key-ttl'), createResponse())
    expect(mockExecuteLearningStep).toHaveBeenCalledTimes(2)
    nowSpy.mockRestore()
  })
})
