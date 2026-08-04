const networkPolicy = {
  adminAccessMode: 'private' as 'loopback' | 'private' | 'any',
  adminAllowedIps: [] as string[]
}

jest.mock('../../services/runtime-network-policy.service', () => ({
  getRuntimeNetworkPolicy: () => ({
    ...networkPolicy,
    allowPrivateNetwork: true,
    privateNetworkHosts: [],
    source: 'environment'
  })
}))

import { adminAccessRestrictMiddleware } from '../admin-access-restrict.middleware'

function createResponse() {
  const response: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    }
  }
  return response
}

describe('adminAccessRestrictMiddleware', () => {
  beforeEach(() => {
    networkPolicy.adminAccessMode = 'private'
    networkPolicy.adminAllowedIps = []
  })

  it.each(['127.0.0.1', '::1', '192.168.31.24', '10.0.0.8', '172.26.208.1'])(
    'private 模式允许本机或局域网地址 %s',
    (ip) => {
      const next = jest.fn()
      adminAccessRestrictMiddleware({ ip, socket: {} } as any, createResponse(), next)
      expect(next).toHaveBeenCalledTimes(1)
    }
  )

  it('private 模式拒绝公网地址', () => {
    const res = createResponse()
    const next = jest.fn()
    adminAccessRestrictMiddleware({ ip: '8.8.8.8', socket: {} } as any, res, next)
    expect(res.statusCode).toBe(403)
    expect(res.body.error.code).toBe('ADMIN_NETWORK_RESTRICTED')
    expect(next).not.toHaveBeenCalled()
  })

  it('loopback 模式拒绝局域网地址', () => {
    networkPolicy.adminAccessMode = 'loopback'
    const res = createResponse()
    adminAccessRestrictMiddleware({ ip: '192.168.31.24', socket: {} } as any, res, jest.fn())
    expect(res.statusCode).toBe(403)
  })

  it('允许精确配置的公网管理地址', () => {
    networkPolicy.adminAllowedIps = ['203.0.113.10', '8.8.8.8']
    const next = jest.fn()
    adminAccessRestrictMiddleware({ ip: '8.8.8.8', socket: {} } as any, createResponse(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('any 模式允许公网地址', () => {
    networkPolicy.adminAccessMode = 'any'
    const next = jest.fn()
    adminAccessRestrictMiddleware({ ip: '8.8.8.8', socket: {} } as any, createResponse(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })
})
