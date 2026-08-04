const findUnique = jest.fn()
const upsert = jest.fn()

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_api_configs: { findUnique, upsert }
  }
}))

describe('runtime network policy service', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalMode = process.env.ADMIN_ACCESS_MODE
  const originalAllowPrivate = process.env.SAFE_HTTP_ALLOW_PRIVATE_NETWORK

  beforeEach(() => {
    jest.resetModules()
    findUnique.mockReset()
    upsert.mockReset()
    process.env.NODE_ENV = 'development'
    process.env.ADMIN_ACCESS_MODE = 'private'
    delete process.env.SAFE_HTTP_ALLOW_PRIVATE_NETWORK
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalMode === undefined) delete process.env.ADMIN_ACCESS_MODE
    else process.env.ADMIN_ACCESS_MODE = originalMode
    if (originalAllowPrivate === undefined) delete process.env.SAFE_HTTP_ALLOW_PRIVATE_NETWORK
    else process.env.SAFE_HTTP_ALLOW_PRIVATE_NETWORK = originalAllowPrivate
  })

  it('数据库字段为空时沿用开发环境默认值', async () => {
    findUnique.mockResolvedValue({
      adminAccessMode: null,
      adminAllowedIps: null,
      allowPrivateNetwork: null,
      privateNetworkHosts: null
    })
    const service = require('../runtime-network-policy.service')

    const policy = await service.refreshRuntimeNetworkPolicy()

    expect(policy).toEqual(expect.objectContaining({
      adminAccessMode: 'private',
      allowPrivateNetwork: true,
      source: 'environment'
    }))
  })

  it('保存后立即更新运行时快照', async () => {
    upsert.mockResolvedValue({})
    const service = require('../runtime-network-policy.service')

    const policy = await service.updateRuntimeNetworkPolicy({
      adminAccessMode: 'loopback',
      adminAllowedIps: [' 8.8.8.8 ', '8.8.8.8'],
      allowPrivateNetwork: false,
      privateNetworkHosts: ['OLLAMA.LOCAL', '192.168.31.26']
    })

    expect(policy).toEqual({
      adminAccessMode: 'loopback',
      adminAllowedIps: ['8.8.8.8'],
      allowPrivateNetwork: false,
      privateNetworkHosts: ['ollama.local', '192.168.31.26'],
      source: 'database'
    })
    expect(service.canAccessPrivateNetwork('ollama.local', '192.168.31.27')).toBe(true)
    expect(service.canAccessPrivateNetwork('other.local', '192.168.31.27')).toBe(false)
  })
})
