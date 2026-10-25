export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler> = {}
const getConfig = jest.fn()
const updateConfig = jest.fn()
const testConnection = jest.fn()
const safeHttpRequest = jest.fn()
const refresh = jest.fn()
const getRuntimeCapabilityProbeEnabled = jest.fn()

jest.mock('express', () => ({
  Router: () => ({
    get: (path: string, handler: RouteHandler) => { routes[`GET ${path}`] = handler },
    put: (path: string, handler: RouteHandler) => { routes[`PUT ${path}`] = handler },
    post: (path: string, handler: RouteHandler) => { routes[`POST ${path}`] = handler }
  })
}))

jest.mock('../../services/apiConfig.service', () => ({
  __esModule: true,
  default: {
    getConfig,
    getPlatformDefault: jest.fn(),
    updateConfig,
    testConnection
  }
}))

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ invalidateCache: jest.fn() })
}))

jest.mock('../../utils/safe-http', () => ({ safeHttpRequest }))

jest.mock('../../services/runtime-network-policy.service', () => ({
  getRuntimeNetworkPolicy: jest.fn(() => ({})),
  updateRuntimeNetworkPolicy: jest.fn()
}))

jest.mock('../../services/ai-capability-health.service', () => ({
  aiCapabilityHealthService: { refresh }
}))

jest.mock('../../services/capability-probe-settings.service', () => ({
  getRuntimeCapabilityProbeEnabled
}))

require('../admin/api-config')

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

const currentConfig = {
  apiUrl: 'https://saved-provider.example/v1',
  apiKey: 'saved-secret',
  availableModels: ['saved-model'],
  defaultModel: 'saved-model',
  defaultReasoningModel: 'saved-model',
  defaultEvaluationModel: 'saved-model',
  defaultTemperature: 0.7,
  defaultMaxTokens: 2000,
  reasoningEndpoint: undefined,
  lightEndpoint: undefined,
  chatModels: [],
  reasoningModels: [],
  lightModels: []
}

describe('Admin API 配置 Secret 绑定', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getConfig.mockResolvedValue(currentConfig)
    updateConfig.mockResolvedValue(currentConfig)
    refresh.mockResolvedValue({})
    getRuntimeCapabilityProbeEnabled.mockResolvedValue(true)
  })

  it('更换主 Endpoint 时不能复用掩码后的平台密钥', async () => {
    const req: any = {
      body: {
        apiUrl: 'https://new-provider.example/v1',
        apiKey: '',
        availableModels: ['new-model'],
        defaultModel: 'new-model'
      }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(400)
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('新增推理 Endpoint 时必须提交新的平台密钥', async () => {
    const req: any = {
      body: {
        apiUrl: currentConfig.apiUrl,
        apiKey: '',
        reasoningEndpoint: 'https://reasoning-provider.example/v1'
      }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(400)
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('模型测试不能把已保存密钥发送到请求指定的新 Endpoint', async () => {
    const req: any = {
      body: {
        apiUrl: 'https://attacker.example/v1',
        apiKey: '',
        model: 'test-model'
      }
    }
    const res = createResponse()

    await routes['POST /test-model'](req, res)

    expect(res.statusCode).toBe(400)
    expect(safeHttpRequest).not.toHaveBeenCalled()
  })

  it('移除附加 Endpoint 时可保留现有平台密钥', async () => {
    getConfig.mockResolvedValue({
      ...currentConfig,
      reasoningEndpoint: 'https://reasoning-provider.example/v1'
    })
    const req: any = {
      body: {
        apiUrl: currentConfig.apiUrl,
        apiKey: '',
        reasoningEndpoint: null
      }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(200)
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      apiUrl: currentConfig.apiUrl,
      apiKey: 'saved-secret',
      reasoningEndpoint: undefined
    }))
  })

  it('附加 Endpoint 必须以主服务地址为凭据锚点', async () => {
    getConfig.mockResolvedValue({ ...currentConfig, apiUrl: '', apiKey: '' })
    const req: any = {
      body: {
        apiUrl: '',
        apiKey: 'fresh-secret',
        reasoningEndpoint: 'https://reasoning-provider.example/v1'
      }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(400)
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it('清除所有 Endpoint 时同时清除数据库平台密钥', async () => {
    const req: any = {
      body: { apiUrl: '', apiKey: '', reasoningEndpoint: null, lightEndpoint: null }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(200)
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      apiUrl: '',
      apiKey: ''
    }))
  })

  it('不能保存未绑定主 Endpoint 的平台密钥', async () => {
    const req: any = {
      body: { apiUrl: '', apiKey: 'orphan-secret' }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(400)
    expect(updateConfig).not.toHaveBeenCalled()
  })

  /* 连接健康快照（2026-10-23 接手）：前端「连接并拉取 / 重新拉取」的结果随连接域保存，
     刷新后徽章时间不再回退。只认三态字符串与合法时间戳。 */
  it('连接状态与检查时间可随保存落盘', async () => {
    const checkedAt = '2026-10-23T01:02:03.000Z'
    const req: any = {
      body: { apiUrl: currentConfig.apiUrl, apiKey: '', connectionStatus: 'connected', lastCheckedAt: checkedAt }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(200)
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      connectionStatus: 'connected',
      lastCheckedAt: new Date(checkedAt)
    }))
  })

  it('非法连接状态归一为 unknown，非法时间戳不落盘', async () => {
    const req: any = {
      body: { apiUrl: currentConfig.apiUrl, apiKey: '', connectionStatus: 'weird-state', lastCheckedAt: 'not-a-date' }
    }
    const res = createResponse()

    await routes['PUT /'](req, res)

    expect(res.statusCode).toBe(200)
    const payload = updateConfig.mock.calls[0][0]
    expect(payload.connectionStatus).toBe('unknown')
    expect(payload).not.toHaveProperty('lastCheckedAt')
  })
})
