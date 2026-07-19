export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler> = {}
const findUnique = jest.fn()
const update = jest.fn()
const create = jest.fn()
const executeSkill = jest.fn()

jest.mock('express', () => ({
  __esModule: true,
  default: {
    Router: () => ({
      get: (path: string, handler: RouteHandler) => { routes[`GET ${path}`] = handler },
      put: (path: string, handler: RouteHandler) => { routes[`PUT ${path}`] = handler },
      post: (path: string, handler: RouteHandler) => { routes[`POST ${path}`] = handler },
      delete: (path: string, handler: RouteHandler) => { routes[`DELETE ${path}`] = handler }
    })
  }
}))

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    user_mcp_configs: { findUnique, update, create }
  }
}))

jest.mock('../../gateway', () => ({
  getGateway: () => ({ executeSkill })
}))

jest.mock('../../utils/safe-http', () => ({
  safeHttpRequest: jest.fn(),
  isAlwaysBlockedAddress: jest.fn(() => false),
  isLocalOrPrivateAddress: jest.fn(() => false)
}))

require('../user-mcp')

import {
  serializeUserMcpSecretJson,
  USER_MCP_SECRET_CONTEXTS
} from '../../services/mcp/user-mcp-config.service'
import { SecretCryptoError } from '../../utils/secret-crypto'

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    }
  }
}

describe('用户 MCP 路由', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockReset()
    update.mockReset()
    create.mockReset()
    executeSkill.mockReset()
    findUnique.mockResolvedValue(null)
    update.mockResolvedValue({})
    create.mockResolvedValue({})
  })

  it('配置写入前拒绝服务器本地工具', async () => {
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        tools: [{ id: 'file-reader', endpoint: ' LOCAL ', enabled: true }]
      }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['PUT /'](req, res, next)

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'MCP_USER_LOCAL_TOOL_FORBIDDEN',
        message: '用户 MCP 配置不允许声明服务器本地工具'
      }
    })
    expect(findUnique).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('拒绝非数组 tools 配置', async () => {
    const req: any = {
      user: { userId: 'user-1' },
      body: { tools: { id: 'search', endpoint: 'https://tools.example/search' } }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['PUT /'](req, res, next)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toEqual({
      code: 'MCP_TOOLS_INVALID',
      message: 'MCP tools 必须是数组'
    })
    expect(findUnique).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it.each([
    [
      '缺少工具字段',
      { tools: [{ id: 'search', endpoint: 'https://tools.example/search', enabled: true }] },
      'MCP_TOOL_CONFIG_INVALID',
      '工具 name 必填'
    ],
    [
      '重复工具 ID',
      {
        tools: [
          { id: 'Search', name: 'A', description: '', type: 'search', endpoint: 'https://a.example', enabled: true },
          { id: 'search', name: 'B', description: '', type: 'search', endpoint: 'https://b.example', enabled: true }
        ]
      },
      'MCP_TOOL_CONFIG_INVALID',
      'MCP 工具 ID 重复: search'
    ],
    [
      '错误 fallback 类型',
      { fallbackEnabled: 'false' },
      'MCP_CONFIG_INVALID',
      'fallbackEnabled 必须是布尔值'
    ],
    [
      '错误服务器结构',
      { servers: { id: 'main' } },
      'MCP_SERVERS_INVALID',
      'MCP servers 必须是数组'
    ]
  ])('写入前拒绝%s', async (_caseName, body, code, message) => {
    const req: any = { user: { userId: 'user-1' }, body }
    const res = createResponse()
    const next = jest.fn()

    await routes['PUT /'](req, res, next)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toEqual(expect.objectContaining({ code, message }))
    expect(findUnique).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('写入前规范化合法工具配置', async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        tools: [{
          id: ' search-v2 ',
          name: ' 远程搜索 ',
          description: '搜索',
          type: 'search',
          endpoint: ' https://tools.example/search ',
          enabled: true,
          apiKey: '',
          apiKeyConfigured: false,
          config: { timeout: 5000 }
        }]
      }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['PUT /'](req, res, next)

    const createdData = create.mock.calls[0][0].data
    expect(JSON.parse(createdData.tools)).toEqual([{
      id: 'search-v2',
      name: '远程搜索',
      description: '搜索',
      type: 'search',
      endpoint: 'https://tools.example/search',
      apiKey: '',
      config: { timeout: 5000 },
      enabled: true
    }])
    expect(res.body.data.tools[0]).toEqual(expect.objectContaining({
      id: 'search-v2',
      name: '远程搜索',
      endpoint: 'https://tools.example/search',
      apiKey: '',
      apiKeyConfigured: false
    }))
    expect(next).not.toHaveBeenCalled()
  })

  it('添加服务器前执行同一套 Schema 校验和规范化', async () => {
    findUnique.mockResolvedValue(null)
    create.mockResolvedValue({})
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        id: ' primary ',
        name: ' 主服务 ',
        endpoint: ' https://api.example/v1 ',
        apiKey: '',
        apiKeyConfigured: false,
        enabled: true
      }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['POST /servers'](req, res, next)

    const createdData = create.mock.calls[0][0].data
    expect(JSON.parse(createdData.servers)).toEqual([{
      id: 'primary',
      name: '主服务',
      endpoint: 'https://api.example/v1',
      apiKey: '',
      enabled: true
    }])
    expect(res.body.data.servers[0]).toEqual(expect.objectContaining({
      id: 'primary',
      name: '主服务',
      endpoint: 'https://api.example/v1',
      apiKeyConfigured: false
    }))
    expect(next).not.toHaveBeenCalled()
  })

  it('添加服务器时拒绝危险 URL', async () => {
    const req: any = {
      user: { userId: 'user-1' },
      body: { id: 'main', name: '主服务', endpoint: 'file:///etc/passwd' }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['POST /servers'](req, res, next)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'MCP_SERVER_CONFIG_INVALID',
      message: '服务器 endpoint 仅允许 HTTPS'
    }))
    expect(findUnique).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('添加服务器时清理无效历史项而不阻断合法写入', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      servers: JSON.stringify([{ legacy: true }]),
      tools: '[]',
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: 'null'
    })
    const req: any = {
      user: { userId: 'user-1' },
      body: { id: 'main', name: '主服务', endpoint: 'https://api.example/v1' }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['POST /servers'](req, res, next)

    const stored = JSON.parse(update.mock.calls[0][0].data.servers)
    expect(stored).toEqual([{
      id: 'main',
      name: '主服务',
      endpoint: 'https://api.example/v1'
    }])
    expect(res.body.data.servers).toEqual([{
      id: 'main',
      name: '主服务',
      endpoint: 'https://api.example/v1'
    }])
    expect(next).not.toHaveBeenCalled()
  })

  it('写入前拒绝伪造数据库 Secret 密文', async () => {
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        tools: [{
          id: 'search',
          name: '搜索',
          description: '搜索',
          type: 'search',
          endpoint: 'https://tools.example/search',
          apiKey: 'wfsec:v1:invalid',
          enabled: true
        }]
      }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['PUT /'](req, res, next)

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toEqual(expect.objectContaining({
      code: 'MCP_CONFIG_INVALID',
      message: '不允许提交数据库 Secret 密文'
    }))
    expect(findUnique).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('部分更新时保留未提交的 MCP 配置字段', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      servers: JSON.stringify([{ id: 'server-1', endpoint: 'https://api.example' }]),
      tools: JSON.stringify([{ id: 'search', endpoint: 'https://tools.example/search', enabled: true }]),
      routingStrategy: 'latency',
      fallbackEnabled: false,
      healthCheck: JSON.stringify({ enabled: true, interval: 5000 })
    })
    update.mockResolvedValue({})
    const req: any = {
      user: { userId: 'user-1' },
      body: { tools: [] }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['PUT /'](req, res, next)

    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({
        tools: '[]'
      })
    })
    expect(update.mock.calls[0][0].data).not.toHaveProperty('servers')
    expect(update.mock.calls[0][0].data).not.toHaveProperty('routingStrategy')
    expect(update.mock.calls[0][0].data).not.toHaveProperty('fallbackEnabled')
    expect(update.mock.calls[0][0].data).not.toHaveProperty('healthCheck')
    expect(res.body.data).toEqual({
      servers: [{
        id: 'server-1',
        name: 'server-1',
        endpoint: 'https://api.example',
        enabled: true
      }],
      tools: [],
      routingStrategy: 'latency',
      fallbackEnabled: false,
      healthCheck: { enabled: true, interval: 5000 }
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('无关部分更新不会清除非数组历史配置', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      servers: JSON.stringify({ legacy: true }),
      tools: '{bad-json',
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: 'null'
    })
    const req: any = {
      user: { userId: 'user-1' },
      body: { fallbackEnabled: false }
    }
    const res = createResponse()
    const next = jest.fn()

    await routes['PUT /'](req, res, next)

    expect(update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: expect.objectContaining({
        fallbackEnabled: false
      })
    })
    expect(update.mock.calls[0][0].data).not.toHaveProperty('servers')
    expect(update.mock.calls[0][0].data).not.toHaveProperty('tools')
    expect(res.body.data).toEqual(expect.objectContaining({
      servers: [],
      tools: [],
      fallbackEnabled: false
    }))
    expect(next).not.toHaveBeenCalled()
  })

  it('历史标量 healthCheck 不会在读取或部分更新时回显', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      servers: '[]',
      tools: '[]',
      routingStrategy: 'priority',
      fallbackEnabled: true,
      healthCheck: JSON.stringify('Bearer leaked-secret')
    })
    const getRes = createResponse()
    const getNext = jest.fn()

    await routes['GET /']({ user: { userId: 'user-1' } }, getRes, getNext)

    expect(getRes.body.data.healthCheck).toBeNull()
    expect(JSON.stringify(getRes.body)).not.toContain('leaked-secret')
    expect(getNext).not.toHaveBeenCalled()

    const putRes = createResponse()
    const putNext = jest.fn()
    await routes['PUT /']({
      user: { userId: 'user-1' },
      body: { fallbackEnabled: false }
    }, putRes, putNext)

    expect(update.mock.calls[0][0].data).not.toHaveProperty('healthCheck')
    expect(putRes.body.data.healthCheck).toBeNull()
    expect(JSON.stringify(putRes.body)).not.toContain('leaked-secret')
    expect(putNext).not.toHaveBeenCalled()
  })

  it('Secret 解密失败时不重写现有配置', async () => {
    const originalKeys = process.env.SECRET_ENCRYPTION_KEYS
    const originalCurrentKey = process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
    try {
      process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'old'
      process.env.SECRET_ENCRYPTION_KEYS = `old:${Buffer.alloc(32, 3).toString('base64')}`
      const tools = serializeUserMcpSecretJson([{
        id: 'search',
        endpoint: 'https://tools.example/search',
        apiKey: 'saved-key',
        enabled: true
      }], USER_MCP_SECRET_CONTEXTS.tools)
      process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'new'
      process.env.SECRET_ENCRYPTION_KEYS = `new:${Buffer.alloc(32, 4).toString('base64')}`
      findUnique.mockResolvedValue({
        userId: 'user-1',
        servers: '[]',
        tools,
        routingStrategy: 'priority',
        fallbackEnabled: true,
        healthCheck: 'null'
      })
      const res = createResponse()
      const next = jest.fn()

      await routes['PUT /']({
        user: { userId: 'user-1' },
        body: { fallbackEnabled: false }
      }, res, next)

      expect(next).toHaveBeenCalledWith(expect.any(SecretCryptoError))
      expect(update).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    } finally {
      if (originalKeys === undefined) delete process.env.SECRET_ENCRYPTION_KEYS
      else process.env.SECRET_ENCRYPTION_KEYS = originalKeys
      if (originalCurrentKey === undefined) delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
      else process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = originalCurrentKey
    }
  })

  it('healthCheck headers 和 env 全字段密文落库且响应脱敏', async () => {
    const key = Buffer.alloc(32, 7).toString('base64')
    process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'test'
    process.env.SECRET_ENCRYPTION_KEYS = `test:${key}`
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        healthCheck: {
          enabled: true,
          headers: {
            'X-Service-Key': 'header-secret',
            Accept: 'application/json'
          },
          env: {
            SERVICE_KEY: 'env-secret',
            REGION: 'cn'
          }
        }
      }
    }
    const res = createResponse()
    const next = jest.fn()

    try {
      await routes['PUT /'](req, res, next)

      const stored = create.mock.calls[0][0].data.healthCheck
      expect(stored).toContain('wfsec:v1:test:')
      expect(stored).not.toContain('header-secret')
      expect(stored).not.toContain('application/json')
      expect(stored).not.toContain('env-secret')
      expect(stored).not.toContain('"cn"')
      expect(res.body.data.healthCheck).toEqual({
        enabled: true,
        headers: {
          'X-Service-Key': '',
          'X-Service-KeyConfigured': true,
          Accept: '',
          AcceptConfigured: true
        },
        env: {
          SERVICE_KEY: '',
          SERVICE_KEYConfigured: true,
          REGION: '',
          REGIONConfigured: true
        }
      })
      expect(next).not.toHaveBeenCalled()
    } finally {
      delete process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID
      delete process.env.SECRET_ENCRYPTION_KEYS
    }
  })

  it('通过统一 Gateway 执行工具且不接受请求体中的身份覆盖', async () => {
    executeSkill.mockResolvedValue({
      output: { toolId: 'search', source: 'user', result: { items: [] } },
      duration: 12
    })
    const req: any = {
      user: { userId: 'user-1' },
      params: { id: 'search' },
      body: {
        userId: 'attacker',
        params: { query: 'lesson' }
      }
    }
    const res = createResponse()

    await routes['POST /tools/:id/execute'](req, res)

    expect(executeSkill).toHaveBeenCalledWith('mcp-tool', expect.objectContaining({
      toolId: 'search',
      params: { query: 'lesson' },
      signal: expect.any(Object)
    }))
    expect(res.body).toEqual({
      success: true,
      data: { toolId: 'search', source: 'user', result: { items: [] } },
      metadata: { duration: 12 }
    })
  })

  it('显式 null params 交给统一 Skill 返回参数错误', async () => {
    executeSkill.mockRejectedValue(Object.assign(new Error('invalid params'), {
      code: 'MCP_TOOL_PARAMS_INVALID'
    }))
    const res = createResponse()

    await routes['POST /tools/:id/execute']({
      user: { userId: 'user-1' },
      params: { id: 'search' },
      body: { params: null }
    }, res)

    expect(executeSkill).toHaveBeenCalledWith('mcp-tool', expect.objectContaining({
      toolId: 'search',
      params: null
    }))
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toEqual({
      code: 'MCP_TOOL_PARAMS_INVALID',
      message: 'MCP params 必须是对象'
    })
  })

  it.each([
    ['MCP_USER_LOCAL_TOOL_FORBIDDEN', 403, '用户 MCP 配置不允许声明服务器本地工具'],
    ['SKILL_DISABLED', 403, '该能力已被当前用户禁用'],
    ['MCP_TOOL_NOT_FOUND', 404, 'MCP 工具不存在'],
    ['MCP_TOOL_PARAMS_INVALID', 400, 'MCP params 必须是对象'],
    ['MCP_TOOL_ENDPOINT_FORBIDDEN', 403, 'MCP 工具地址不允许访问'],
    ['MCP_UPSTREAM_HTTP_ERROR', 502, 'MCP 上游工具返回错误'],
    ['MCP_UPSTREAM_UNAVAILABLE', 502, 'MCP 上游工具暂时不可用'],
    ['MCP_UPSTREAM_TIMEOUT', 504, 'MCP 上游工具响应超时'],
    ['MCP_TOOL_EXECUTION_FAILED', 500, 'MCP 工具执行失败']
  ])('将 %s 映射为 HTTP %s', async (code, status, safeMessage) => {
    executeSkill.mockRejectedValue(Object.assign(new Error('执行失败'), { code }))
    const req: any = {
      user: { userId: 'user-1' },
      params: { id: 'search' },
      body: { params: {} }
    }
    const res = createResponse()

    await routes['POST /tools/:id/execute'](req, res)

    expect(res.statusCode).toBe(status)
    expect(res.body).toEqual({
      success: false,
      error: { code, message: safeMessage }
    })
  })

  it('未知内部错误码统一隐藏为 MCP_TOOL_EXECUTION_FAILED', async () => {
    executeSkill.mockRejectedValue(Object.assign(new Error('database path leaked'), { code: 'P2025' }))
    const req: any = {
      user: { userId: 'user-1' },
      params: { id: 'search' },
      body: { params: {} }
    }
    const res = createResponse()

    await routes['POST /tools/:id/execute'](req, res)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({
      success: false,
      error: { code: 'MCP_TOOL_EXECUTION_FAILED', message: 'MCP 工具执行失败' }
    })
  })
})
