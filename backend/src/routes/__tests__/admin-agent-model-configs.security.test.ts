export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler> = {}
const get = jest.fn()
const upsert = jest.fn()

jest.mock('express', () => ({
  Router: () => ({
    get: (path: string, handler: RouteHandler) => { routes[`GET ${path}`] = handler },
    put: (path: string, handler: RouteHandler) => { routes[`PUT ${path}`] = handler },
    post: (path: string, handler: RouteHandler) => { routes[`POST ${path}`] = handler },
    delete: (path: string, handler: RouteHandler) => { routes[`DELETE ${path}`] = handler }
  })
}))

jest.mock('../../services/agentModelConfig.service', () => ({
  __esModule: true,
  default: {
    get,
    getAll: jest.fn(),
    upsert,
    delete: jest.fn(),
    initializeDefaults: jest.fn()
  }
}))

jest.mock('../../services/agentRequestTimeout.service', () => ({
  getAgentRequestTimeoutInfo: jest.fn(() => ({ requestTimeoutMs: 60000 }))
}))

require('../admin/agent-model-configs')

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

describe('Admin Agent 模型配置 Secret 绑定', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsert.mockResolvedValue({ agentId: 'path-agent' })
  })

  it('更换 Endpoint 时不能复用已有 Agent 密钥', async () => {
    get.mockResolvedValue({
      agentId: 'path-agent',
      endpoint: 'https://saved-provider.example/v1',
      apiKey: 'saved-secret'
    })
    const req: any = {
      params: { agentId: 'path-agent' },
      body: { endpoint: 'https://new-provider.example/v1', apiKey: '' }
    }
    const res = createResponse()

    await routes['PUT /:agentId'](req, res)

    expect(res.statusCode).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('独立 Agent 密钥必须绑定显式 Endpoint', async () => {
    get.mockResolvedValue({ agentId: 'path-agent', endpoint: null, apiKey: null })
    const req: any = {
      params: { agentId: 'path-agent' },
      body: { apiKey: 'new-secret' }
    }
    const res = createResponse()

    await routes['PUT /:agentId'](req, res)

    expect(res.statusCode).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })
})
