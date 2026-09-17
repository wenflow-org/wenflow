jest.mock('dns/promises', () => ({ lookup: jest.fn() }))
jest.mock('axios', () => ({
  __esModule: true,
  default: { request: jest.fn() }
}))
jest.mock('../../services/runtime-network-policy.service', () => ({
  canAccessPrivateNetwork: () => false
}))

import { lookup } from 'dns/promises'
import { validateExternalUrl } from '../safe-http'

const lookupMock = lookup as jest.Mock

/** fake-IP / TUN 代理（Clash 等）会把公网域名解析到 198.18.0.0/15 保留段 */
const FAKE_IP = [{ address: '198.18.1.205', family: 4 }]

describe('safe-http SAFE_HTTP_TRUSTED_HOSTS', () => {
  const original = process.env.SAFE_HTTP_TRUSTED_HOSTS

  afterEach(() => {
    if (original === undefined) {
      delete process.env.SAFE_HTTP_TRUSTED_HOSTS
    } else {
      process.env.SAFE_HTTP_TRUSTED_HOSTS = original
    }
    lookupMock.mockReset()
  })

  it('未配置白名单时，解析到保留地址的域名仍被拒绝（默认策略不变）', async () => {
    delete process.env.SAFE_HTTP_TRUSTED_HOSTS
    lookupMock.mockResolvedValue(FAKE_IP)

    await expect(validateExternalUrl('https://api.search.tinyfish.ai')).rejects.toThrow(/保留地址/)
  })

  it('白名单精确命中时放行 fake-IP 解析结果', async () => {
    process.env.SAFE_HTTP_TRUSTED_HOSTS = 'api.search.tinyfish.ai'
    lookupMock.mockResolvedValue(FAKE_IP)

    await expect(validateExternalUrl('https://api.search.tinyfish.ai?query=x')).resolves.toEqual(
      expect.objectContaining({ address: '198.18.1.205', family: 4 })
    )
  })

  it('白名单不做子域泛化（非精确匹配仍被拒绝）', async () => {
    process.env.SAFE_HTTP_TRUSTED_HOSTS = 'api.search.tinyfish.ai'
    lookupMock.mockResolvedValue(FAKE_IP)

    await expect(validateExternalUrl('https://evil.example.com')).rejects.toThrow(/保留地址/)
  })

  it('白名单大小写与空格容错', async () => {
    process.env.SAFE_HTTP_TRUSTED_HOSTS = ' api.search.tinyfish.ai , other.example.com '
    lookupMock.mockResolvedValue(FAKE_IP)

    await expect(validateExternalUrl('https://API.Search.TinyFish.AI')).resolves.toEqual(
      expect.objectContaining({ address: '198.18.1.205' })
    )
  })
})
