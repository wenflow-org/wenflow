import * as service from '../field-routing-bootstrap.service'
import { loadOrchestrationFiles, type OrchestrationStage } from '../field-routing/orchestration-file'

jest.mock('../node-config-change-audit', () => ({
  writeNodeConfigChange: jest.fn(async () => 'audit-id'),
}))

const stubStage = (stage: string): OrchestrationStage => ({
  stage,
  contracts: [{ agentId: `agent:${stage}`, displayName: 'x', description: 'x' }],
  fields: [],
  routings: [],
})

const emptyDatabase = (): any => ({
  agent_contracts: {
    findUnique: jest.fn(async () => null),
    upsert: jest.fn(async (args: any) => ({ id: 'id', ...args.create })),
  },
  field_definitions: {
    findUnique: jest.fn(async () => null),
    upsert: jest.fn(async (args: any) => ({ id: 'id', ...args.create })),
  },
  agent_field_routings: {
    findUnique: jest.fn(async () => null),
    upsert: jest.fn(async (args: any) => ({ id: 'id', ...args.create })),
  },
})

describe('field routing bootstrap', () => {
  it('固定按 goal、path、teaching、profile、simulation 顺序执行', async () => {
    const database = emptyDatabase()
    const order = ['goal', 'path', 'teaching', 'profile', 'simulation']

    await service.bootstrapFieldRoutings({
      database: database as any,
      stagesOverride: order.map((name) => stubStage(name)),
    })

    const createdAgentIds = database.agent_contracts.upsert.mock.calls.map(
      (call: any[]) => call[0].create.agentId
    )
    expect(createdAgentIds).toEqual(order.map((name) => `agent:${name}`))
  })

  it('阶段失败时停止后续 seed 并传播错误', async () => {
    const database = emptyDatabase()
    database.agent_contracts.findUnique.mockImplementation(async (args: any) => {
      if (args.where.agentId === 'agent:path') throw new Error('path seed failed')
      return null
    })
    const order = ['goal', 'path', 'teaching', 'profile', 'simulation']

    await expect(
      service.bootstrapFieldRoutings({
        database: database as any,
        stagesOverride: order.map((name) => stubStage(name)),
      })
    ).rejects.toThrow('path seed failed')

    const createdAgentIds = database.agent_contracts.upsert.mock.calls.map(
      (call: any[]) => call[0].create.agentId
    )
    expect(createdAgentIds).toEqual(['agent:goal'])
  })

  it('seed manifest 的全局键唯一且与编排文件数量一致', () => {
    const stages = loadOrchestrationFiles()
    const manifest = service.FIELD_ROUTING_SEED_MANIFEST
    expect(manifest.contractAgentIds).toHaveLength(new Set(manifest.contractAgentIds).size)
    // fieldId 唯一约束为 stage 内唯一：跨 stage 允许同名（teaching/simulation 的 reply），
    // 逐 stage 唯一断言在 bootstrap 内 fail-fast；数量判据用 fieldKeys（复合键）而非展平 fieldIds
    expect(manifest.routings.map((r) => `${r.agentId}\0${r.fieldId}`)).toHaveLength(
      new Set(manifest.routings.map((r) => `${r.agentId}\0${r.fieldId}`)).size
    )
    expect(stages).toHaveLength(5)
    expect(manifest.contractAgentIds).toHaveLength(
      stages.reduce((sum, s) => sum + s.contracts.length, 0)
    )
    expect(manifest.fieldIds).toHaveLength(
      stages.reduce((sum, s) => sum + s.fields.length, 0)
    )
    // fieldKeys 与展平 fieldIds 同长度（每声明一条 = 一个 (stage, fieldId) 对）且逐键唯一
    expect(manifest.fieldKeys).toHaveLength(manifest.fieldIds.length)
    expect(manifest.fieldKeys.map((k) => `${k.stage}\0${k.fieldId}`)).toHaveLength(
      new Set(manifest.fieldKeys.map((k) => `${k.stage}\0${k.fieldId}`)).size
    )
    // 跨 stage 同名存在性检查：至少 teaching 与 simulation 各有一个 reply
    expect(stages.find((s) => s.stage === 'teaching')!.fields.some((f) => f.fieldId === 'reply')).toBe(true)
    expect(stages.find((s) => s.stage === 'simulation')!.fields.some((f) => f.fieldId === 'reply')).toBe(true)
    expect(manifest.routings).toHaveLength(
      stages.reduce((sum, s) => sum + s.routings.length, 0)
    )
  })

  it('对账清理：仅删编排声明外的 code 行，声明内行与 admin 覆盖行不动（#125）', async () => {
    const stages = loadOrchestrationFiles()
    const declaredField = stages.find((s) => s.fields.length > 0)!.fields[0]
    const declaredStage = stages.find((s) => s.fields.length > 0)!.stage
    // admin 覆盖行与 stale 行都按 managedByCode=true 返回（真实查询里 managedByCode=false 被 where 排除）
    const database: any = {
      field_definitions: {
        findMany: jest.fn(async () => [
          { id: 'keep-1', stage: declaredStage, fieldId: declaredField.fieldId },
          { id: 'stale-1', stage: 'teaching', fieldId: '__moved_away_field__' },
          { id: 'stale-2', stage: 'profile', fieldId: '__renamed_field__' },
        ]),
        deleteMany: jest.fn(async () => ({ count: 2 })),
      },
    }
    const result = await service.reconcileStaleFieldDefinitions(database)
    expect(result.deleted).toBe(2)
    expect(result.keys).toEqual(['teaching/__moved_away_field__', 'profile/__renamed_field__'])
    expect(database.field_definitions.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['stale-1', 'stale-2'] } },
    })
    // 查询只取 code 行（admin 覆盖行由 where 排除）
    expect(database.field_definitions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { managedByCode: true } })
    )
  })

  it('对账清理：无残留行时不删除、不写审计', async () => {
    const { writeNodeConfigChange } = jest.requireMock('../node-config-change-audit')
    ;(writeNodeConfigChange as jest.Mock).mockClear()
    const database: any = {
      field_definitions: {
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    }
    const result = await service.reconcileStaleFieldDefinitions(database)
    expect(result).toEqual({ deleted: 0, keys: [] })
    expect(database.field_definitions.deleteMany).not.toHaveBeenCalled()
    expect(writeNodeConfigChange).not.toHaveBeenCalled()
  })
})
