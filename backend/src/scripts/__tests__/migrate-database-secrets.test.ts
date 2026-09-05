export {}

const mainMcpFindMany = jest.fn()
const mainMcpUpdate = jest.fn()

const emptyMainModel = () => ({ findMany: jest.fn().mockResolvedValue([]), update: jest.fn() })
const emptySystemModel = () => ({ findMany: jest.fn().mockResolvedValue([]), update: jest.fn() })
const userApis = emptyMainModel()
const userAgents = emptyMainModel()
const platform = emptySystemModel()
const agents = emptySystemModel()
const skills = emptySystemModel()
const lab = emptySystemModel()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    user_api_configs: userApis,
    user_agent_model_configs: userAgents,
    user_agent_configs: userAgents,
    user_mcp_configs: { findMany: mainMcpFindMany, update: mainMcpUpdate },
    $disconnect: jest.fn()
  }
}))

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_api_configs: platform,
    agent_model_configs: agents,
    skill_model_configs: skills,
    agent_lab_configs: lab,
    $disconnect: jest.fn()
  }
}))

import { migrateDatabaseSecrets } from '../migrate-database-secrets'
import { decryptSecret, encryptSecret } from '../../utils/secret-crypto'

const oldKey = Buffer.alloc(32, 1).toString('base64')
const currentKey = Buffer.alloc(32, 2).toString('base64')
const healthCheckContext = 'main.user_mcp_configs.healthCheck'

describe('数据库 Secret 迁移', () => {
  const originalKeys = process.env.SECRET_ENCRYPTION_KEYS
  const originalCurrentKeyId = process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID

  beforeEach(() => {
    jest.clearAllMocks()
    userApis.findMany.mockResolvedValue([])
    userAgents.findMany.mockResolvedValue([])
    platform.findMany.mockResolvedValue([])
    agents.findMany.mockResolvedValue([])
    skills.findMany.mockResolvedValue([])
    lab.findMany.mockResolvedValue([])
    mainMcpUpdate.mockResolvedValue({})
    process.env.SECRET_ENCRYPTION_KEYS = `old:${oldKey},current:${currentKey}`
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'current'
  })

  afterAll(() => {
    if (originalKeys === undefined) delete process.env.SECRET_ENCRYPTION_KEYS
    else process.env.SECRET_ENCRYPTION_KEYS = originalKeys
    if (originalCurrentKeyId === undefined) delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    else process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = originalCurrentKeyId
  })

  it('审计根标量 healthCheck Secret 但不写库', async () => {
    mainMcpFindMany.mockResolvedValue([{
      id: 'mcp-1',
      servers: '[]',
      tools: '[]',
      healthCheck: JSON.stringify('Bearer legacy-secret')
    }])

    const stats = await migrateDatabaseSecrets(false)

    expect(stats).toEqual({ scanned: 3, pending: 1, migrated: 0, failed: 0 })
    expect(mainMcpUpdate).not.toHaveBeenCalled()
  })

  it('应用模式将旧密钥根标量轮换到当前密钥', async () => {
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'old'
    const oldEnvelope = encryptSecret('Bearer legacy-secret', healthCheckContext)!
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'current'
    mainMcpFindMany.mockResolvedValue([{
      id: 'mcp-1',
      servers: '[]',
      tools: '[]',
      healthCheck: JSON.stringify(oldEnvelope)
    }])

    const stats = await migrateDatabaseSecrets(true)

    expect(stats).toEqual({ scanned: 3, pending: 1, migrated: 1, failed: 0 })
    expect(mainMcpUpdate).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(mainMcpUpdate.mock.calls[0][0].data.healthCheck)
    expect(stored).toMatch(/^wfsec:v1:current:/)
    expect(decryptSecret(stored, healthCheckContext)).toBe('Bearer legacy-secret')
  })
})
