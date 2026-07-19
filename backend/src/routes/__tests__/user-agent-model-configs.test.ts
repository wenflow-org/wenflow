export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler> = {}
const get = jest.fn()
const upsert = jest.fn()

jest.mock('express', () => ({
  Router: () => ({
    get: (path: string, handler: RouteHandler) => { routes[`GET ${path}`] = handler },
    put: (path: string, handler: RouteHandler) => { routes[`PUT ${path}`] = handler },
    delete: (path: string, handler: RouteHandler) => { routes[`DELETE ${path}`] = handler }
  })
}))

jest.mock('../../services/userAgentModelConfig.service', () => ({
  __esModule: true,
  default: {
    get,
    getAllByUser: jest.fn(),
    upsert,
    delete: jest.fn()
  }
}))

require('../user-agent-model-configs')

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

describe('用户 Agent 模型配置', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsert.mockResolvedValue({})
  })

  it('更换自定义 Endpoint 时必须提供新的密钥', async () => {
    get.mockResolvedValue({
      userId: 'user-1',
      agentId: 'path-agent',
      endpoint: 'https://saved-provider.example/v1',
      apiKey: 'saved-secret',
      enabled: true
    })
    const req: any = {
      user: { userId: 'user-1' },
      params: { agentId: 'path-agent' },
      body: {
        endpoint: 'https://new-provider.example/v1',
        apiKey: '',
        enabled: true
      }
    }
    const res = createResponse()

    await routes['PUT /:agentId'](req, res)

    expect(res.statusCode).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('清除自定义 Endpoint 时同时清除旧密钥', async () => {
    get.mockResolvedValue({
      userId: 'user-1',
      agentId: 'path-agent',
      endpoint: 'https://saved-provider.example/v1',
      apiKey: 'saved-secret',
      enabled: true
    })
    const req: any = {
      user: { userId: 'user-1' },
      params: { agentId: 'path-agent' },
      body: { endpoint: null, apiKey: '', enabled: true }
    }
    const res = createResponse()

    await routes['PUT /:agentId'](req, res)

    expect(res.statusCode).toBe(200)
    expect(upsert).toHaveBeenCalledWith('user-1', 'path-agent', expect.objectContaining({
      endpoint: null,
      apiKey: null
    }))
  })
})
