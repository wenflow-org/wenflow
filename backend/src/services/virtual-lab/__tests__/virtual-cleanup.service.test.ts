/**
 * 虚拟学习者级联删除服务单测（R3）：级联清单、真实用户保护、审计留痕。
 */

const mockProfileFindUnique = jest.fn()
const mockSessionFindMany = jest.fn()
const mockSessionDeleteMany = jest.fn()
const mockProfileDelete = jest.fn()
const mockUserDelete = jest.fn()
const mockTransaction = jest.fn()
const mockAuditCreate = jest.fn()
const mockDeleteMany = (table: string) => jest.fn()

const db: Record<string, { deleteMany: jest.Mock }> = {}
const tables = [
  'teaching_sessions',
  'learning_paths',
  'goal_conversations',
  'learning_goals',
  'learning_metrics',
  'achievements',
  'content_feedback',
  'projection_access_grants',
  'learner_evidence',
  'learner_projections',
  'memory_traces',
  'virtual_quick_learn_runs',
  'goal_scheduling_ledger',
  'domain_event_outbox',
  'agent_call_logs',
  'prompt_call_logs',
  'llm_execution_attempts'
]
for (const table of tables) {
  db[table] = { deleteMany: mockDeleteMany(table) }
}

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_learner_profiles: { findUnique: mockProfileFindUnique, delete: mockProfileDelete },
    virtual_sessions: { findMany: mockSessionFindMany, deleteMany: mockSessionDeleteMany },
    users: { delete: mockUserDelete },
    admin_audit_logs: { create: mockAuditCreate },
    ...Object.fromEntries(Object.entries(db)),
    $transaction: mockTransaction
  }
}))

import { VirtualCleanupService, VirtualCleanupError } from '../virtual-cleanup.service'

const service = new VirtualCleanupService()

function makeTx() {
  return {
    virtual_learner_profiles: { findUnique: mockProfileFindUnique, delete: mockProfileDelete },
    virtual_sessions: { findMany: mockSessionFindMany, deleteMany: mockSessionDeleteMany },
    users: { delete: mockUserDelete },
    admin_audit_logs: { create: mockAuditCreate },
    ...Object.fromEntries(Object.entries(db))
  }
}

describe('VirtualCleanupService.cascadeDeleteProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProfileFindUnique.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      users: { id: 'user-1', isVirtualLearner: true, name: 'virtual_a', email: 'virtual_a@test.local' }
    })
    mockSessionFindMany.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }])
    mockSessionDeleteMany.mockResolvedValue({ count: 2 })
    mockProfileDelete.mockResolvedValue({ id: 'profile-1' })
    mockUserDelete.mockResolvedValue({ id: 'user-1' })
    mockAuditCreate.mockResolvedValue({ id: 'audit-1' })
    for (const table of tables) {
      db[table].deleteMany.mockResolvedValue({ count: 0 })
    }
    mockTransaction.mockImplementation(async (work: (tx: any) => Promise<any>) => work(makeTx()))
  })

  it('级联删除全部虚拟数据并返回清理清单', async () => {
    db.learner_evidence.deleteMany.mockResolvedValue({ count: 7 })
    db.teaching_sessions.deleteMany.mockResolvedValue({ count: 3 })
    db.learning_paths.deleteMany.mockResolvedValue({ count: 2 })
    db.agent_call_logs.deleteMany.mockResolvedValue({ count: 9 })

    const manifest = await service.cascadeDeleteProfile('profile-1', { adminId: 'admin-1' })

    expect(manifest.virtualSessions).toEqual(['session-1', 'session-2'])
    expect(manifest.teachingSessions).toBe(3)
    expect(manifest.learningPaths).toBe(2)
    expect(manifest.learnerEvidence).toBe(7)
    expect(manifest.agentCallLogs).toBe(9)
    expect(manifest.userId).toBe('user-1')

    expect(mockSessionDeleteMany).toHaveBeenCalledWith({ where: { virtualProfileId: 'profile-1' } })
    expect(db.teaching_sessions.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(db.learner_evidence.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(db.learner_projections.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(db.memory_traces.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(db.virtual_quick_learn_runs.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(db.agent_call_logs.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(db.prompt_call_logs.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(db.llm_execution_attempts.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockProfileDelete).toHaveBeenCalledWith({ where: { id: 'profile-1' } })
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: 'user-1' } })
  })

  it('写 admin_audit_logs 级联审计（before=清理范围，after=删除清单）', async () => {
    db.learner_evidence.deleteMany.mockResolvedValue({ count: 7 })
    db.teaching_sessions.deleteMany.mockResolvedValue({ count: 3 })

    await service.cascadeDeleteProfile('profile-1', { adminId: 'admin-1', adminName: 'admin@x' })

    expect(mockAuditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      adminId: 'admin-1',
      adminName: 'admin@x',
      action: 'virtual-cascade-delete',
      targetType: 'virtual-learner',
      targetId: 'profile-1',
      method: 'DELETE',
      success: true
    }) })
    const auditCall = (mockAuditCreate.mock.calls[0][0] as any).data
    const after = JSON.parse(auditCall.afterJson)
    expect(after.deletedTeachingSessions).toBe(3)
    expect(after.deletedEvidence).toBe(7)
    expect(after.deletedSessions).toEqual(['session-1', 'session-2'])
    expect(JSON.parse(auditCall.beforeJson)).toEqual({
      profileId: 'profile-1',
      userId: 'user-1',
      userName: 'virtual_a',
      userEmail: 'virtual_a@test.local'
    })
  })

  it('拒绝删除非虚拟学习者（真实用户保护）', async () => {
    mockProfileFindUnique.mockResolvedValue({
      id: 'profile-1',
      userId: 'user-1',
      users: { id: 'user-1', isVirtualLearner: false, name: 'alice', email: 'alice@x.com' }
    })

    await expect(service.cascadeDeleteProfile('profile-1', { adminId: 'admin-1' }))
      .rejects.toThrow(VirtualCleanupError)
    await expect(service.cascadeDeleteProfile('profile-1', { adminId: 'admin-1' }))
      .rejects.toMatchObject({ code: 'VIRTUAL_PROFILE_REAL_USER_PROTECTED', statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockUserDelete).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it('profile 不存在时抛 404 且不执行任何删除', async () => {
    mockProfileFindUnique.mockResolvedValue(null)

    await expect(service.cascadeDeleteProfile('nope')).rejects.toMatchObject({
      code: 'VIRTUAL_PROFILE_NOT_FOUND',
      statusCode: 404
    })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it('事务抛错时整个级联回滚且不写审计', async () => {
    mockTransaction.mockImplementation(async () => {
      throw new Error('database is locked')
    })

    await expect(service.cascadeDeleteProfile('profile-1')).rejects.toThrow('database is locked')
    expect(mockAuditCreate).not.toHaveBeenCalled()
    expect(mockUserDelete).not.toHaveBeenCalled()
  })
})
