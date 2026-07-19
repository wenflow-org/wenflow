const safeHttpRequest = jest.fn()

jest.mock('../../../utils/safe-http', () => ({ safeHttpRequest }))
jest.mock('../../../gateway/api-gateway', () => ({ getAPIGateway: jest.fn() }))

import { runWithContext } from '../../../gateway/api-gateway/context'
import { basicExtractor } from '../basic-extractor'

describe('basic-extractor network boundary', () => {
  beforeEach(() => {
    safeHttpRequest.mockReset()
    safeHttpRequest.mockResolvedValue({ data: '<html><body>Lesson</body></html>' })
  })

  it('用户 URL 始终使用公网策略和请求取消信号', async () => {
    const controller = new AbortController()

    const content = await runWithContext({ abortSignal: controller.signal }, () =>
      basicExtractor.fetchUrlContent!('https://example.com/lesson'))

    expect(content).toBe('Lesson')
    expect(safeHttpRequest).toHaveBeenCalledWith('https://example.com/lesson', expect.objectContaining({
      privateNetworkPolicy: 'public-only',
      signal: controller.signal
    }))
  })
})
