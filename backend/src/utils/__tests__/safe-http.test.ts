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
import {
  isAlwaysBlockedAddress,
  isLocalOrPrivateAddress,
  SafeHttpAbortError,
  SafeHttpTimeoutError,
  safeHttpRequest,
  validateExternalUrl,
  validateSafeHttpConfig
} from '../safe-http'

const lookupMock = lookup as jest.Mock
const requestMock = axios.request as jest.Mock

describe('safe-http SSRF policy', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalPrivateHosts = process.env.SAFE_HTTP_PRIVATE_HOSTS
  const originalNat64Prefixes = process.env.SAFE_HTTP_NAT64_PREFIXES

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    delete process.env.SAFE_HTTP_PRIVATE_HOSTS
    delete process.env.SAFE_HTTP_NAT64_PREFIXES
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
    if (originalNat64Prefixes === undefined) {
      delete process.env.SAFE_HTTP_NAT64_PREFIXES
    } else {
      process.env.SAFE_HTTP_NAT64_PREFIXES = originalNat64Prefixes
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

  it('public-only 调用不继承平台私网放行策略', async () => {
    canAccessPrivateNetworkMock.mockReturnValue(true)
    await expect(validateExternalUrl('https://127.0.0.1:3000', {
      privateNetworkPolicy: 'public-only'
    })).rejects.toThrow('当前调用不允许访问本机或局域网地址')

    lookupMock.mockResolvedValue([{ address: '10.0.0.8', family: 4 }])
    await expect(validateExternalUrl('https://internal.example.com', {
      privateNetworkPolicy: 'public-only'
    })).rejects.toThrow('域名解析到了当前调用不允许访问的本机或局域网地址')
  })

  it('识别十六进制 IPv4-mapped IPv6，阻止私网与元数据绕过', async () => {
    expect(isLocalOrPrivateAddress('::ffff:7f00:1')).toBe(true)
    expect(isLocalOrPrivateAddress('::ffff:a00:1')).toBe(true)
    expect(isAlwaysBlockedAddress('::ffff:a9fe:a9fe')).toBe(true)
    expect(isLocalOrPrivateAddress('64:ff9b::7f00:1')).toBe(true)
    expect(isAlwaysBlockedAddress('64:ff9b:1::7f00:1')).toBe(true)
    expect(isAlwaysBlockedAddress('2002:7f00:1::')).toBe(true)
    expect(isLocalOrPrivateAddress('2001:db8:1:2:0:5efe:7f00:1')).toBe(true)

    await expect(validateExternalUrl('https://[::ffff:127.0.0.1]/tool', {
      privateNetworkPolicy: 'public-only'
    })).rejects.toThrow('当前调用不允许访问本机或局域网地址')
    await expect(validateExternalUrl('https://[::ffff:169.254.169.254]/metadata', {
      privateNetworkPolicy: 'public-only'
    })).rejects.toThrow('不允许访问 Link-local、元数据或保留地址')
  })

  it('按配置识别 RFC 6052 自定义 NAT64 前缀', () => {
    process.env.SAFE_HTTP_NAT64_PREFIXES = '2001:4860:64::/48'

    expect(isLocalOrPrivateAddress('2001:4860:64:7f00:0:100::')).toBe(true)
    expect(isAlwaysBlockedAddress('2001:4860:64:a9fe:a9:fe00::')).toBe(true)
    expect(() => validateSafeHttpConfig()).not.toThrow()

    process.env.SAFE_HTTP_NAT64_PREFIXES = '2001:4860:64::/33'
    expect(() => validateSafeHttpConfig()).toThrow('SAFE_HTTP_NAT64_PREFIXES 配置无效')
  })

  it('public-only 调用在开发环境也拒绝 HTTP', async () => {
    await expect(validateExternalUrl('http://example.com', {
      privateNetworkPolicy: 'public-only'
    })).rejects.toThrow('当前调用仅允许 HTTPS URL')
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
    const allCallback = jest.fn()
    config.httpsAgent.options.lookup('example.com', { all: true }, allCallback)
    expect(allCallback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    expect(config.maxRedirects).toBe(0)
    expect(config.proxy).toBe(false)
  })

  it('将调用方超时封顶为 300 秒', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    requestMock.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { ok: true }
    })

    await safeHttpRequest('https://example.com', { timeoutMs: 2_000_000_000 })

    expect(requestMock.mock.calls[0][0].timeout).toBeLessThanOrEqual(300_000)
  })

  it('总请求时限覆盖 DNS 解析阶段', async () => {
    jest.useFakeTimers()
    lookupMock.mockImplementation(() => new Promise(() => undefined))
    try {
      const assertion = expect(safeHttpRequest('https://example.com', { timeoutMs: 100 }))
        .rejects.toBeInstanceOf(SafeHttpTimeoutError)
      await jest.advanceTimersByTimeAsync(100)
      await assertion
      expect(requestMock).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('重定向共享同一个总请求时限', async () => {
    let now = 1_000
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    requestMock.mockImplementationOnce(async (config) => {
      expect(config.timeout).toBe(1_000)
      now = 1_600
      return {
        status: 302,
        statusText: 'Found',
        headers: { location: 'https://example.com/next' },
        data: ''
      }
    }).mockImplementationOnce(async (config) => {
      expect(config.timeout).toBe(400)
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { ok: true }
      }
    })

    try {
      await expect(safeHttpRequest('https://example.com', { timeoutMs: 1_000 }))
        .resolves.toEqual(expect.objectContaining({ data: { ok: true } }))
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('调用方取消会终止 DNS 等待', async () => {
    lookupMock.mockImplementation(() => new Promise(() => undefined))
    const controller = new AbortController()
    const assertion = expect(safeHttpRequest('https://example.com', {
      signal: controller.signal
    })).rejects.toBeInstanceOf(SafeHttpAbortError)

    controller.abort()
    await assertion
    expect(requestMock).not.toHaveBeenCalled()
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
    await expect(validateExternalUrl('http://example.com')).rejects.toThrow('当前调用仅允许 HTTPS URL')
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
