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
  parseUserMcpProviders,
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

  it('校验供应商字段、URL、重复 ID 和默认顶层类型', () => {
    expect(parseUserMcpProviders([{
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

    expect(() => parseUserMcpProviders([
      { id: 'main', name: 'A', endpoint: 'https://a.example' },
      { id: 'MAIN', name: 'B', endpoint: 'https://b.example' }
    ])).toThrow('MCP 供应商 ID 重复: main')
    expect(() => parseUserMcpProviders([
      { id: 'main', name: 'A', endpoint: 'ftp://a.example' }
    ])).toThrow('供应商 endpoint 仅允许 HTTPS')
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

  it('历史 provider 脏数据不阻断旧版远程工具运行时读取', async () => {
    userMcpFindUnique.mockResolvedValue({
      providers: JSON.stringify([{ legacy: true }]),
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
      providers: [],
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
      providers: '[]',
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
      providers: [],
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
      providers: '{bad-json',
      tools: JSON.stringify({ id: 'not-an-array' }),
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: 'wfsec:v1:invalid'
    })

    await expect(getUserMcpRuntimeConfig('user-1')).resolves.toEqual({
      providers: [],
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
        providers: '[]',
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

describe('用户 MCP 工具的 transport 支持', () => {
  it('transport=mcp 落字段；缺省不落（向后兼容既有数据）', () => {
    const withTransport = normalizeStoredUserMcpTools([{
      id: 'tavily',
      name: 'Tavily MCP',
      transport: 'mcp',
      endpoint: 'https://tavily.example/mcp',
      enabled: true
    }])
    expect(withTransport).toHaveLength(1)
    expect(withTransport[0]).toMatchObject({ id: 'tavily', transport: 'mcp' })

    const legacy = normalizeStoredUserMcpTools([{
      id: 'legacy',
      endpoint: 'https://legacy.example/api',
      enabled: true
    }])
    expect(legacy).toHaveLength(1)
    expect(legacy[0].transport).toBeUndefined()
  })

  it('非法 transport 值被拒绝（工具被丢弃）', () => {
    const tools = normalizeStoredUserMcpTools([{
      id: 'bad',
      endpoint: 'https://bad.example/api',
      transport: 'grpc',
      enabled: true
    }])
    expect(tools).toHaveLength(0)
  })

  it('toolsTtlMs 可配置（MCP 工具发现缓存 TTL）', () => {
    const tools = normalizeStoredUserMcpTools([{
      id: 'tavily',
      endpoint: 'https://tavily.example/mcp',
      transport: 'mcp',
      config: { toolsTtlMs: 60000 },
      enabled: true
    }])
    expect(tools[0].config).toMatchObject({ toolsTtlMs: 60000 })
  })
})

/**
 * 写入路径（parseUserMcpTools）回归：
 * 前端保存时**总是**带 transport，而该 schema 是 .strict()——漏配 transport 会让每次保存都 400。
 */
describe('用户 MCP 工具写入路径接受 transport', () => {
  const base = {
    id: 'my-tool',
    name: '我的工具',
    description: '',
    type: 'remote',
    endpoint: 'https://a.example/api',
    enabled: true
  }

  it('transport=http / mcp 均可写入（http 为缺省，归一秒掉）', () => {
    const http = parseUserMcpTools([{ ...base, transport: 'http' }])
    expect(http).toHaveLength(1)
    expect(http[0].transport).toBeUndefined()

    const mcp = parseUserMcpTools([{ ...base, transport: 'mcp' }])
    expect(mcp).toHaveLength(1)
    expect(mcp[0].transport).toBe('mcp')
  })

  it('写入后读回一致（写读同一套 transport 约定）', () => {
    const written = parseUserMcpTools([{ ...base, transport: 'mcp', config: { toolsTtlMs: 60000 } }])
    const readBack = normalizeStoredUserMcpTools(written)
    expect(readBack[0]).toMatchObject({ id: 'my-tool', transport: 'mcp' })
    expect(readBack[0].config).toMatchObject({ toolsTtlMs: 60000 })
  })

  it('非法 transport 报 MCP_TOOL_CONFIG_INVALID（不再因未知键而 400）', () => {
    expect(() => parseUserMcpTools([{ ...base, transport: 'grpc' }]))
      .toThrow(/transport 仅支持 http 或 mcp/)
  })
})
