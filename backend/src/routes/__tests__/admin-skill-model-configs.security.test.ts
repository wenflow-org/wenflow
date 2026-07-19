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

jest.mock('../../services/skillModelConfig.service', () => ({
  __esModule: true,
  default: {
    get,
    getAll: jest.fn(),
    upsert,
    delete: jest.fn()
  }
}))

require('../admin/skill-model-configs')

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

describe('Admin Skill 模型配置 Secret 绑定', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    upsert.mockResolvedValue({ skillId: 'path-planning' })
  })

  it('更换 Endpoint 时不能复用已有 Skill 密钥', async () => {
    get.mockResolvedValue({
      skillId: 'path-planning',
      endpoint: 'https://saved-provider.example/v1',
      apiKey: 'saved-secret'
    })
    const req: any = {
      params: { skillId: 'path-planning' },
      body: { endpoint: 'https://new-provider.example/v1', apiKey: '' }
    }
    const res = createResponse()

    await routes['PUT /:skillId'](req, res)

    expect(res.statusCode).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('独立 Skill 密钥必须绑定显式 Endpoint', async () => {
    get.mockResolvedValue({ skillId: 'path-planning', endpoint: null, apiKey: null })
    const req: any = {
      params: { skillId: 'path-planning' },
      body: { apiKey: 'new-secret' }
    }
    const res = createResponse()

    await routes['PUT /:skillId'](req, res)

    expect(res.statusCode).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })
})
