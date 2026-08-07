import { ReadinessService } from '../readiness.service'
import { FIELD_ROUTING_SEED_MANIFEST } from '../field-routing-bootstrap.service'
import { encryptSecret } from '../../utils/secret-crypto'

const originalSecretKeys = process.env.SECRET_ENCRYPTION_KEYS
const originalSecretKeyId = process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
// logger 模块加载会触发 dotenv，注入 backend/.env 的 AI_API_*；测试须显式隔离，
// 避免"平台 AI 路由缺配置"用例被环境变量兜底误判为 ok
const originalAiKey = process.env.AI_API_KEY
const originalAiUrl = process.env.AI_API_URL
const originalAiModel = process.env.AI_MODEL

function createDatabases() {
  const main = {
    users: { findFirst: jest.fn().mockResolvedValue(null) },
    learning_paths: { findFirst: jest.fn().mockResolvedValue(null) },
    domain_event_outbox: { findFirst: jest.fn().mockResolvedValue(null) }
  }
  const system = {
    platform_api_configs: {
      findFirst: jest.fn().mockResolvedValue({
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        defaultModel: 'test-model'
      })
    },
    agent_prompts: {
      findMany: jest.fn().mockResolvedValue([
        { agentId: 'skill:goal-conversation' },
        { agentId: 'skill:path-planning' },
        { agentId: 'skill:stage-designer' },
        { agentId: 'skill:teaching-turn' },
        { agentId: 'skill:session-wrapup' }
      ])
    },
    agent_contracts: { count: jest.fn().mockResolvedValue(FIELD_ROUTING_SEED_MANIFEST.contractAgentIds.length), findMany: jest.fn().mockResolvedValue([]) },
    field_definitions: { count: jest.fn().mockResolvedValue(FIELD_ROUTING_SEED_MANIFEST.fieldIds.length), findMany: jest.fn().mockResolvedValue([]) },
    agent_field_routings: { count: jest.fn().mockResolvedValue(FIELD_ROUTING_SEED_MANIFEST.routings.length), findMany: jest.fn().mockResolvedValue([]) },
    agent_registrations: { count: jest.fn().mockResolvedValue(1) },
    skill_registrations: { count: jest.fn().mockResolvedValue(1) }
  }
  return { main, system }
}

describe('ReadinessService', () => {
  beforeEach(() => {
    delete process.env.AI_API_KEY
    delete process.env.AI_API_URL
    delete process.env.AI_MODEL
  })

  afterEach(() => {
    if (originalSecretKeys === undefined) delete process.env.SECRET_ENCRYPTION_KEYS
    else process.env.SECRET_ENCRYPTION_KEYS = originalSecretKeys
    if (originalSecretKeyId === undefined) delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    else process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = originalSecretKeyId
    if (originalAiKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = originalAiKey
    if (originalAiUrl === undefined) delete process.env.AI_API_URL
    else process.env.AI_API_URL = originalAiUrl
    if (originalAiModel === undefined) delete process.env.AI_MODEL
    else process.env.AI_MODEL = originalAiModel
  })

  it('双库和核心运行态可读时返回 ready', async () => {
    const { main, system } = createDatabases()
    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(true)
    expect(result.checks).toEqual({
      mainDatabase: 'ok',
      systemDatabase: 'ok',
      corePrompts: 'ok',
      aiConfiguration: 'ok',
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
    system.agent_prompts.findMany.mockResolvedValue([])
    system.skill_registrations.count.mockResolvedValue(0)
    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(false)
    expect(result.checks.corePrompts).toBe('failed')
    expect(result.checks.gatewayRegistry).toBe('failed')
  })

  it('平台 AI 路由缺少 endpoint、key 或 model 时不 ready', async () => {
    const { main, system } = createDatabases()
    system.platform_api_configs.findFirst.mockResolvedValue({
      apiUrl: 'https://api.example.com/v1',
      apiKey: '',
      defaultModel: 'test-model'
    })
    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(false)
    expect(result.checks.aiConfiguration).toBe('failed')
  })

  it('平台 API Key 加密后仍会验证其可解密性', async () => {
    process.env.SECRET_ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 7).toString('base64')}`
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'test'
    const { main, system } = createDatabases()
    system.platform_api_configs.findFirst.mockResolvedValue({
      apiUrl: 'https://api.example.com/v1',
      apiKey: encryptSecret('test-key', 'system.platform_api_configs.apiKey'),
      defaultModel: 'test-model'
    })

    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(true)
    expect(result.checks.aiConfiguration).toBe('ok')
  })

  it('平台 API Key 密文无法解密时不 ready', async () => {
    process.env.SECRET_ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 7).toString('base64')}`
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'test'
    const encrypted = encryptSecret('test-key', 'system.platform_api_configs.apiKey')
    process.env.SECRET_ENCRYPTION_KEYS = `other:${Buffer.alloc(32, 8).toString('base64')}`
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'other'
    const { main, system } = createDatabases()
    system.platform_api_configs.findFirst.mockResolvedValue({
      apiUrl: 'https://api.example.com/v1',
      apiKey: encrypted,
      defaultModel: 'test-model'
    })

    const result = await new ReadinessService(main, system).check()

    expect(result.ready).toBe(false)
    expect(result.checks.aiConfiguration).toBe('failed')
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
    expect(system.agent_prompts.findMany).not.toHaveBeenCalled()
  })
})
