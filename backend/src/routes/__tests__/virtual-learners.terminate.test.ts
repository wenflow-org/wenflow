/**
 * POST /sessions/terminate（A1 批量终止：非终态会话统一标记 abandoned，dryRun 默认 true）
 */
const mockVirtualSessionsFindMany = jest.fn()
const mockVirtualSessionsUpdate = jest.fn()
const mockAuditCreate = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: { findMany: mockVirtualSessionsFindMany, update: mockVirtualSessionsUpdate },
    admin_audit_logs: { create: mockAuditCreate }
  }
}))
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))
jest.mock('../../coordinators/simulation.coordinator', () => ({ __esModule: true, default: {} }))
jest.mock('../../gateway', () => ({ getGateway: jest.fn(() => ({})) }))
jest.mock('../../skills/virtual-learner-persona-designer', () => ({ virtualLearnerPersonaDesignerDefinition: {} }))
jest.mock('../../skills/virtual-learner-scenario-designer', () => ({ virtualLearnerScenarioDesignerDefinition: {} }))
jest.mock('../../skills', () => ({ executeSkill: jest.fn() }))
jest.mock('../../services/learning/learning.service', () => ({ __esModule: true, default: {} }))
jest.mock('../../services/ai-teaching/TeachingSessionRepository', () => ({ teachingSessionRepository: {} }))
jest.mock('../../utils/projection-token', () => ({ signProjectionToken: jest.fn() }))
jest.mock('../../virtual-lab/blackbox-runner', () => ({ __esModule: true, default: {} }))
jest.mock('../../virtual-lab/session-mode', () => ({ assertAssistedSessionMode: jest.fn() }))
jest.mock('../../virtual-lab/session-reclaim.service', () => ({
  virtualSessionReclaimService: { getThresholdMs: jest.fn(() => 24 * 3600 * 1000) }
}))

import router from '../admin/virtual-learners'

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

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    virtualProfileId: 'p-1',
    status: 'running',
    currentStage: 'goal',
    stageResults: '{}',
    logs: '[]',
    updatedAt: new Date('2026-08-10T10:00:00.000Z'),
    virtual_learner_profiles: { userId: 'u-1' },
    ...overrides
  }
}

describe('POST /sessions/terminate（批量终止）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('默认 dryRun=true：只报告将终止的会话，不落地状态、不写审计', async () => {
    mockVirtualSessionsFindMany.mockResolvedValue([sessionRow()])
    const handler = getPostHandler('/sessions/terminate')
    const req: any = { body: { sessionIds: ['s-1'] }, user: { userId: 'op-1' } }
    const res = createResponse()

    await handler(req, res)

    expect(mockVirtualSessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.arrayContaining([{ id: { in: ['s-1'] } }]) })
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ dryRun: true, requested: 1, terminated: 1, skippedTerminal: 0 })
    }))
    expect(mockVirtualSessionsUpdate).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it('dryRun=false：非终态会话标记 abandoned + 写审计', async () => {
    mockVirtualSessionsFindMany.mockResolvedValue([sessionRow()])
    const handler = getPostHandler('/sessions/terminate')
    const req: any = { body: { sessionIds: ['s-1'], dryRun: false }, user: { userId: 'op-1', name: '管理员甲' } }
    const res = createResponse()

    await handler(req, res)

    expect(mockVirtualSessionsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's-1' },
      data: expect.objectContaining({ status: 'abandoned', completedAt: expect.any(Date) })
    }))
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'virtual-session-batch-terminate',
        targetId: 's-1',
        adminName: '管理员甲',
        afterJson: expect.stringContaining('operator_batch_terminate')
      })
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ dryRun: false, terminated: 1 })
    }))
  })

  it('profileIds 单独提供：按虚拟人过滤全部非终态会话', async () => {
    mockVirtualSessionsFindMany.mockResolvedValue([sessionRow({ id: 's-2', virtualProfileId: 'p-2' })])
    const handler = getPostHandler('/sessions/terminate')
    const req: any = { body: { profileIds: ['p-2'], dryRun: true }, user: { userId: 'op-1' } }
    const res = createResponse()

    await handler(req, res)

    expect(mockVirtualSessionsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.arrayContaining([{ virtualProfileId: { in: ['p-2'] } }]) })
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('终态会话（completed/failed/abandoned）跳过，不算入 terminated', async () => {
    mockVirtualSessionsFindMany.mockResolvedValue([
      sessionRow(),
      sessionRow({ id: 's-terminal', status: 'failed' }),
      sessionRow({ id: 's-done', status: 'completed' })
    ])
    const handler = getPostHandler('/sessions/terminate')
    const req: any = { body: { sessionIds: ['s-1', 's-terminal', 's-done'], dryRun: false }, user: { userId: 'op-1' } }
    const res = createResponse()

    await handler(req, res)

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ terminated: 1, skippedTerminal: 2 })
    }))
    expect(mockVirtualSessionsUpdate).toHaveBeenCalledTimes(1)
  })

  it('sessionIds 与 profileIds 都为空 → 400', async () => {
    const handler = getPostHandler('/sessions/terminate')
    const req: any = { body: {} }
    const res = createResponse()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })

  it('失败时返回 500 与错误信息', async () => {
    mockVirtualSessionsFindMany.mockRejectedValue(new Error('terminate failed'))
    const handler = getPostHandler('/sessions/terminate')
    const req: any = { body: { sessionIds: ['s-1'] } }
    const res = createResponse()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })
})
