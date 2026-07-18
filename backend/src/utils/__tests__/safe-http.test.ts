jest.mock('dns/promises', () => ({ lookup: jest.fn() }))
jest.mock('axios', () => ({
  __esModule: true,
  default: { request: jest.fn() }
}))

const canAccessPrivateNetworkMock = jest.fn()
jest.mock('../../services/runtime-network-policy.service', () => ({
  canAccessPrivateNetwork: (...args: unknown[]) => canAccessPrivateNetworkMock(...args)
}))

import axios from 'axios'
import { lookup } from 'dns/promises'
import { safeHttpRequest, validateExternalUrl } from '../safe-http'

const lookupMock = lookup as jest.Mock
const requestMock = axios.request as jest.Mock

describe('safe-http SSRF policy', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalPrivateHosts = process.env.SAFE_HTTP_PRIVATE_HOSTS

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    delete process.env.SAFE_HTTP_PRIVATE_HOSTS
    canAccessPrivateNetworkMock.mockReset()
    canAccessPrivateNetworkMock.mockReturnValue(true)
    lookupMock.mockReset()
    requestMock.mockReset()
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalPrivateHosts === undefined) {
      delete process.env.SAFE_HTTP_PRIVATE_HOSTS
    } else {
      process.env.SAFE_HTTP_PRIVATE_HOSTS = originalPrivateHosts
    }
  })

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://[::1]'
  ])('开发环境允许本机或局域网地址：%s', async (url) => {
    const result = await validateExternalUrl(url)
    expect(result.url.toString()).toBe(new URL(url).toString())
  })

  it.each([
    'http://169.254.169.254',
    'http://169.254.1.20',
    'http://224.0.0.1'
  ])('所有环境拒绝 Link-local、元数据或保留地址：%s', async (url) => {
    await expect(validateExternalUrl(url)).rejects.toThrow(/不允许/)
  })

  it('开发环境允许解析到局域网的域名', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.8', family: 4 }])
    await expect(validateExternalUrl('https://internal.example.com')).resolves.toEqual(expect.objectContaining({
      address: '10.0.0.8'
    }))
  })

  it('固定请求到已校验的公网 IP', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    requestMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      data: { ok: true }
    })

    await safeHttpRequest('https://example.com')

    const config = requestMock.mock.calls[0][0]
    const callback = jest.fn()
    config.httpsAgent.options.lookup('example.com', {}, callback)
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(config.maxRedirects).toBe(0)
    expect(config.proxy).toBe(false)
  })

  it('逐跳校验重定向并拒绝跳转到内网', async () => {
    process.env.NODE_ENV = 'production'
    canAccessPrivateNetworkMock.mockReturnValue(false)
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    requestMock.mockResolvedValueOnce({
      status: 302,
      statusText: 'Found',
      headers: { location: 'https://127.0.0.1/private' },
      data: ''
    })

    await expect(safeHttpRequest('https://example.com')).rejects.toThrow('生产环境不允许访问未授权的本机或局域网地址')
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('携带 Authorization 时拒绝跨源重定向，避免密钥外送', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    requestMock.mockResolvedValueOnce({
      status: 302,
      statusText: 'Found',
      headers: { location: 'https://attacker.example/collect' },
      data: ''
    })

    await expect(safeHttpRequest('https://provider.example/v1/models', {
      headers: { Authorization: 'Bearer secret-key' }
    })).rejects.toThrow('携带敏感凭证的请求不允许跨源重定向')
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('生产环境拒绝 HTTP', async () => {
    process.env.NODE_ENV = 'production'
    await expect(validateExternalUrl('http://example.com')).rejects.toThrow('生产环境仅允许 HTTPS URL')
  })

  it('生产环境默认拒绝局域网，但允许精确配置的私有 Host', async () => {
    process.env.NODE_ENV = 'production'
    canAccessPrivateNetworkMock.mockReturnValue(false)
    await expect(validateExternalUrl('https://192.168.31.26:11434')).rejects.toThrow('生产环境不允许访问未授权的本机或局域网地址')

    canAccessPrivateNetworkMock.mockImplementation((hostname: string, address: string) => (
      hostname === '192.168.31.26' || hostname === 'ollama.local' || address === '192.168.31.26'
    ))
    await expect(validateExternalUrl('https://192.168.31.26:11434')).resolves.toEqual(expect.objectContaining({
      address: '192.168.31.26'
    }))

    lookupMock.mockResolvedValue([{ address: '192.168.31.27', family: 4 }])
    await expect(validateExternalUrl('https://ollama.local')).resolves.toEqual(expect.objectContaining({
      address: '192.168.31.27'
    }))
  })
})
