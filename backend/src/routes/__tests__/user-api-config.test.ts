export {}

type RouteHandler = (...args: any[]) => any

const routes: Record<string, RouteHandler> = {}
const findUnique = jest.fn()
const update = jest.fn()
const create = jest.fn()
const safeHttpRequest = jest.fn()
const invalidateCache = jest.fn()

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
    user_api_configs: {
      findUnique,
      update,
      create
    }
  }
}))

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ invalidateCache })
}))

jest.mock('../../services/apiConfig.service', () => ({
  __esModule: true,
  default: { getPlatformDefault: jest.fn() }
}))

jest.mock('../../utils/safe-http', () => ({ safeHttpRequest }))

require('../user-api-config')

import { runWithContext } from '../../gateway/api-gateway/context'

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

describe('用户 API 配置连接测试', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue(null)
    update.mockResolvedValue({})
    create.mockResolvedValue({})
    safeHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      data: { model: 'test-model' }
    })
  })

  it('用户 Endpoint 始终使用公网策略和请求取消信号', async () => {
    const controller = new AbortController()
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        endpoint: 'https://provider.example/v1/',
        apiKey: 'user-secret',
        model: 'test-model'
      }
    }
    const res = createResponse()
    const next = jest.fn()

    await runWithContext({ abortSignal: controller.signal }, () =>
      routes['POST /test'](req, res, next))

    expect(res.statusCode).toBe(200)
    expect(safeHttpRequest).toHaveBeenCalledWith(
      'https://provider.example/v1/chat/completions',
      expect.objectContaining({
        privateNetworkPolicy: 'public-only',
        signal: controller.signal
      })
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('不能把已保存密钥发送到请求指定的新 Endpoint', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      endpoint: 'https://saved-provider.example/v1',
      apiKey: 'saved-secret',
      chatModel: 'saved-model',
      enabled: true
    })
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        endpoint: 'https://attacker.example/v1',
        apiKey: '',
        model: 'test-model'
      }
    }
    const res = createResponse()

    await routes['POST /test'](req, res, jest.fn())

    expect(res.statusCode).toBe(400)
    expect(safeHttpRequest).not.toHaveBeenCalled()
  })

  it('启用状态下更换 Endpoint 必须同时提交新密钥', async () => {
    findUnique.mockResolvedValue({
      userId: 'user-1',
      endpoint: 'https://saved-provider.example/v1',
      apiKey: 'saved-secret',
      chatModel: 'saved-model',
      reasoningModel: 'saved-model',
      enabled: true
    })
    const req: any = {
      user: { userId: 'user-1' },
      body: {
        endpoint: 'https://new-provider.example/v1',
        apiKey: '',
        chatModel: 'new-model',
        enabled: true
      }
    }
    const res = createResponse()

    await routes['PUT /'](req, res, jest.fn())

    expect(res.statusCode).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('不能保存未绑定 Endpoint 的用户密钥', async () => {
    const req: any = {
      user: { userId: 'user-1' },
      body: { endpoint: null, apiKey: 'orphan-secret', enabled: false }
    }
    const res = createResponse()

    await routes['PUT /'](req, res, jest.fn())

    expect(res.statusCode).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })
})
