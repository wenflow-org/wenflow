const safeHttpRequest = jest.fn()

jest.mock('../../../utils/safe-http', () => ({ safeHttpRequest }))

import { runWithContext } from '../../../gateway/api-gateway/context'
import { webExtractor } from '../index'

describe('web-extractor network boundary', () => {
  beforeEach(() => {
    safeHttpRequest.mockReset()
    safeHttpRequest.mockResolvedValue({
      data: '<html><head><title>Lesson</title></head><body><p>Content</p></body></html>'
    })
  })

  it('用户可调用的网页提取始终使用公网策略和请求取消信号', async () => {
    const controller = new AbortController()

    const result = await runWithContext({ abortSignal: controller.signal }, () => webExtractor({
      url: 'https://example.com/lesson',
      timeout: 2_000_000_000
    }))

    expect(result.success).toBe(true)
    expect(safeHttpRequest).toHaveBeenCalledWith('https://example.com/lesson', expect.objectContaining({
      timeoutMs: 2_000_000_000,
      privateNetworkPolicy: 'public-only',
      signal: controller.signal
    }))
  })
})
