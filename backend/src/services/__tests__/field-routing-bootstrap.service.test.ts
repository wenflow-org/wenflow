import * as service from '../field-routing-bootstrap.service'
import { loadOrchestrationFiles, type OrchestrationStage } from '../field-routing/orchestration-file'

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
    // manifest.fieldIds 是全局展平列表（readiness 数量用），逐 stage 唯一断言在 bootstrap 内 fail-fast
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
    // 跨 stage 同名存在性检查：至少 teaching 与 simulation 各有一个 reply
    expect(stages.find((s) => s.stage === 'teaching')!.fields.some((f) => f.fieldId === 'reply')).toBe(true)
    expect(stages.find((s) => s.stage === 'simulation')!.fields.some((f) => f.fieldId === 'reply')).toBe(true)
    expect(manifest.routings).toHaveLength(
      stages.reduce((sum, s) => sum + s.routings.length, 0)
    )
  })
})
