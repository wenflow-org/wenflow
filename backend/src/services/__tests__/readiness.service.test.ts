import { ReadinessService } from '../readiness.service'
import { FIELD_ROUTING_SEED_MANIFEST } from '../field-routing-bootstrap.service'

function createDatabases() {
  const main = {
    users: { findFirst: jest.fn().mockResolvedValue(null) },
    learning_paths: { findFirst: jest.fn().mockResolvedValue(null) },
    domain_event_outbox: { findFirst: jest.fn().mockResolvedValue(null) }
  }
  const system = {
    platform_api_configs: { findFirst: jest.fn().mockResolvedValue(null) },
    agent_prompts: { findFirst: jest.fn().mockResolvedValue({ id: 'prompt' }) },
    agent_contracts: { count: jest.fn().mockResolvedValue(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds.length) },
    field_definitions: { count: jest.fn().mockResolvedValue(FIELD_ROUTING_SEED_MANIFEST.fieldIds.length) },
    agent_field_routings: { count: jest.fn().mockResolvedValue(FIELD_ROUTING_SEED_MANIFEST.routings.length) },
    agent_registrations: { count: jest.fn().mockResolvedValue(1) },
    skill_registrations: { count: jest.fn().mockResolvedValue(1) }
  }
  return { main, system }
}

describe('ReadinessService', () => {
  it('双库和核心运行态可读时返回 ready', async () => {
    const { main, system } = createDatabases()
    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(true)
    expect(result.checks).toEqual({
      mainDatabase: 'ok',
      systemDatabase: 'ok',
      corePrompts: 'ok',
      fieldRouting: 'ok',
      gatewayRegistry: 'ok'
    })
  })

  it('主库查询失败时只返回状态，不泄露错误', async () => {
    const { main, system } = createDatabases()
    main.users.findFirst.mockRejectedValue(new Error('file:/secret/path.db'))
    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(false)
    expect(result.checks.mainDatabase).toBe('failed')
    expect(JSON.stringify(result)).not.toContain('secret/path')
  })

  it('缺少 ACTIVE Prompt 或注册表为空时不 ready', async () => {
    const { main, system } = createDatabases()
    system.agent_prompts.findFirst.mockResolvedValue(null)
    system.skill_registrations.count.mockResolvedValue(0)
    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(false)
    expect(result.checks.corePrompts).toBe('failed')
    expect(result.checks.gatewayRegistry).toBe('failed')
  })

  it('字段路由 seed 只完成一部分时不 ready', async () => {
    const { main, system } = createDatabases()
    system.field_definitions.count.mockResolvedValue(FIELD_ROUTING_SEED_MANIFEST.fieldIds.length - 1)
    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(false)
    expect(result.checks.fieldRouting).toBe('failed')
  })

  it('查询超时时返回 not ready', async () => {
    const { main, system } = createDatabases()
    main.users.findFirst.mockImplementation(() => new Promise(() => undefined))
    const result = await new ReadinessService(main, system, 5).check()

    expect(result.ready).toBe(false)
    expect(result.checks.mainDatabase).toBe('failed')
  })

  it('draining 时立即 not ready 且不再查询数据库', async () => {
    const { main, system } = createDatabases()
    const result = await new ReadinessService(main, system, 2000, () => true).check()

    expect(result.ready).toBe(false)
    expect(main.users.findFirst).not.toHaveBeenCalled()
    expect(system.agent_prompts.findFirst).not.toHaveBeenCalled()
  })
})
