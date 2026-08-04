export {}

const userMcpFindUnique = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { user_mcp_configs: { findUnique: userMcpFindUnique } }
}))

import {
  getUserMcpRuntimeConfig,
  normalizeStoredUserMcpHealthCheck,
  normalizeStoredUserMcpTools,
  parseUserMcpConfigUpdate,
  parseUserMcpServers,
  parseUserMcpTools,
  serializeUserMcpSecretJson,
  USER_MCP_SECRET_CONTEXTS
} from '../user-mcp-config.service'
import { getAgentManifest, validateManifest } from '../../agent-manifest.service'
import { SecretCryptoError } from '../../../utils/secret-crypto'

function validTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'search',
    name: '远程搜索',
    description: '调用远程搜索服务',
    type: 'search',
    endpoint: 'https://tools.example/search',
    enabled: true,
    ...overrides
  }
}

describe('用户 MCP 配置 Schema', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    userMcpFindUnique.mockReset()
  })

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  })

  it('规范化工具字段并剔除响应态 Secret 标记', () => {
    const tools = parseUserMcpTools([validTool({
      id: ' search-v2 ',
      name: ' 远程搜索 ',
      apiKey: '',
      apiKeyConfigured: true,
      config: { timeout: 5000 }
    })])

    expect(tools).toEqual([{
      id: 'search-v2',
      name: '远程搜索',
      description: '调用远程搜索服务',
      type: 'search',
      endpoint: 'https://tools.example/search',
      apiKey: '',
      config: { timeout: 5000 },
      enabled: true
    }])
  })

  it.each([
    ['缺少必填字段', validTool({ name: undefined }), '工具 name 必填'],
    ['错误 enabled 类型', validTool({ enabled: 'true' }), '工具 enabled 必须是布尔值'],
    ['非法 URL', validTool({ endpoint: 'not-a-url' }), '工具 endpoint URL 格式无效'],
    ['URL 携带凭据', validTool({ endpoint: 'https://user:pass@tools.example/search' }), '工具 endpoint 不允许包含用户名或密码'],
    ['非法协议', validTool({ endpoint: 'file:///tmp/tool' }), '工具 endpoint 仅允许 HTTPS'],
    ['超大超时', validTool({ config: { timeout: 300001 } }), '工具 config.timeout 不能超过 300000 毫秒'],
    ['未知 config 字段', validTool({ config: { timeout: 5000, command: 'calc.exe' } }), '工具 config 包含不支持的字段'],
    ['未知顶层字段', validTool({ command: 'calc.exe' }), '工具包含不支持的字段']
  ])('拒绝%s', (_caseName, tool, message) => {
    expect(() => parseUserMcpTools([tool])).toThrow(message)
  })

  it('拒绝大小写不同但语义相同的重复工具 ID', () => {
    expect(() => parseUserMcpTools([
      validTool({ id: 'Search' }),
      validTool({ id: 'search', endpoint: 'https://tools.example/search-2' })
    ])).toThrow('MCP 工具 ID 重复: search')
  })

  it('生产环境拒绝 HTTP 工具地址', () => {
    process.env.NODE_ENV = 'production'
    expect(() => parseUserMcpTools([
      validTool({ endpoint: 'http://tools.example/search' })
    ])).toThrow('工具 endpoint 仅允许 HTTPS')
  })

  it('拒绝私网字面量和携带查询参数的 endpoint', () => {
    expect(() => parseUserMcpTools([
      validTool({ endpoint: 'https://127.0.0.1:3000/tool' })
    ])).toThrow('工具 endpoint 不允许指向本机、局域网或保留地址')
    expect(() => parseUserMcpTools([
      validTool({ endpoint: 'https://tools.example/search?token=secret' })
    ])).toThrow('工具 endpoint 不允许包含查询参数或片段')
  })

  it('校验服务器字段、URL、重复 ID 和默认顶层类型', () => {
    expect(parseUserMcpServers([{
      id: ' primary ',
      name: ' 主服务 ',
      endpoint: 'https://api.example/v1',
      enabled: true,
      config: { timeout: 1000 }
    }])).toEqual([{
      id: 'primary',
      name: '主服务',
      endpoint: 'https://api.example/v1',
      enabled: true,
      config: { timeout: 1000 }
    }])

    expect(() => parseUserMcpServers([
      { id: 'main', name: 'A', endpoint: 'https://a.example' },
      { id: 'MAIN', name: 'B', endpoint: 'https://b.example' }
    ])).toThrow('MCP 服务器 ID 重复: main')
    expect(() => parseUserMcpServers([
      { id: 'main', name: 'A', endpoint: 'ftp://a.example' }
    ])).toThrow('服务器 endpoint 仅允许 HTTPS')
  })

  it('拒绝错误的顶层字段类型和未知字段', () => {
    expect(() => parseUserMcpConfigUpdate({ fallbackEnabled: 'false' }))
      .toThrow('fallbackEnabled 必须是布尔值')
    expect(() => parseUserMcpConfigUpdate({ routingStrategy: 'random' }))
      .toThrow('routingStrategy 仅支持 priority、latency 或 round-robin')
    expect(() => parseUserMcpConfigUpdate({ healthCheck: { interval: 500 } }))
      .toThrow('healthCheck.interval 不能小于 1000 毫秒')
    expect(() => parseUserMcpConfigUpdate({ unsafeOverride: true }))
      .toThrow('MCP 配置包含不支持的字段')
  })

  it('拒绝客户端提交数据库 Secret 密文封装', () => {
    expect(() => parseUserMcpTools([validTool({ apiKey: 'wfsec:v1:invalid' })]))
      .toThrow('不允许提交数据库 Secret 密文')
    expect(() => parseUserMcpConfigUpdate({
      healthCheck: { headers: { 'X-Service-Key': 'wfsec:v1:invalid' } }
    })).toThrow('不允许提交数据库 Secret 密文')
  })

  it('MCP 工具已纳入正式 Agent Manifest 的 Tool 监控组', () => {
    expect(validateManifest()).toEqual({ ok: true })
    expect(getAgentManifest('skill:mcp-tool')).toEqual(expect.objectContaining({
      kind: 'skill',
      monitoringGroup: 'Tool',
      noPromptFile: true
    }))
  })

  it('历史 server 脏数据不阻断旧版远程工具运行时读取', async () => {
    userMcpFindUnique.mockResolvedValue({
      servers: JSON.stringify([{ legacy: true }]),
      tools: JSON.stringify([{
        id: 'Legacy-Search',
        endpoint: 'https://legacy.example/tool',
        apiKey: 'saved-key'
      }]),
      routingStrategy: 'priority',
      fallbackEnabled: false,
      healthCheck: 'null'
    })

    await expect(getUserMcpRuntimeConfig('user-1')).resolves.toEqual({
      servers: [],
      tools: [{
        id: 'legacy-search',
        name: 'legacy-search',
        description: '',
        type: 'remote',
        endpoint: 'https://legacy.example/tool',
        apiKey: 'saved-key',
        config: undefined,
        enabled: true
      }],
      routingStrategy: 'priority',
      fallbackEnabled: false,
      healthCheck: null
    })
  })

  it('历史无效工具不抢占后续同 ID 合法工具', () => {
    expect(normalizeStoredUserMcpTools([
      { id: 'Search', endpoint: 'not-a-url' },
      { id: 'search', endpoint: 'https://tools.example/search', enabled: true }
    ])).toEqual([expect.objectContaining({
      id: 'search',
      endpoint: 'https://tools.example/search',
      enabled: true
    })])
  })

  it('仅有损坏历史工具时保留其 ID 以阻止平台同名 fallback', async () => {
    userMcpFindUnique.mockResolvedValue({
      servers: '[]',
      tools: JSON.stringify([{
        id: 'Platform-Search',
        endpoint: 'invalid-url',
        enabled: true
      }]),
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: 'null'
    })

    await expect(getUserMcpRuntimeConfig('user-1')).resolves.toEqual({
      servers: [],
      tools: [],
      invalidToolIds: ['platform-search'],
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: null
    })
  })

  it('历史 healthCheck 仅接受合法对象或 null', () => {
    expect(normalizeStoredUserMcpHealthCheck('Bearer leaked-secret')).toBeNull()
    expect(normalizeStoredUserMcpHealthCheck(['secret'])).toBeNull()
    expect(normalizeStoredUserMcpHealthCheck({ enabled: true, interval: 5000 })).toEqual({
      enabled: true,
      interval: 5000
    })
  })

  it('损坏或非数组配置安全降级，允许后续写入自愈', async () => {
    userMcpFindUnique.mockResolvedValue({
      servers: '{bad-json',
      tools: JSON.stringify({ id: 'not-an-array' }),
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: 'wfsec:v1:invalid'
    })

    await expect(getUserMcpRuntimeConfig('user-1')).resolves.toEqual({
      servers: [],
      tools: [],
      toolsConfigInvalid: true,
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: null
    })
  })

  it('Secret 解密失败时失败关闭，不降级为空配置', async () => {
    const originalKeys = process.env.SECRET_ENCRYPTION_KEYS
    const originalCurrentKey = process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    try {
      process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'old'
      process.env.SECRET_ENCRYPTION_KEYS = `old:${Buffer.alloc(32, 1).toString('base64')}`
      const tools = serializeUserMcpSecretJson([{
        id: 'search',
        endpoint: 'https://tools.example/search',
        apiKey: 'saved-key',
        enabled: true
      }], USER_MCP_SECRET_CONTEXTS.tools)
      process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'new'
      process.env.SECRET_ENCRYPTION_KEYS = `new:${Buffer.alloc(32, 2).toString('base64')}`
      userMcpFindUnique.mockResolvedValue({
        servers: '[]',
        tools,
        routingStrategy: 'priority',
        fallbackEnabled: true,
        healthCheck: 'null'
      })

      await expect(getUserMcpRuntimeConfig('user-1')).rejects.toBeInstanceOf(SecretCryptoError)
    } finally {
      if (originalKeys === undefined) delete process.env.SECRET_ENCRYPTION_KEYS
      else process.env.SECRET_ENCRYPTION_KEYS = originalKeys
      if (originalCurrentKey === undefined) delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
      else process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = originalCurrentKey
    }
  })
})
