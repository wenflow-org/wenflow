const safeHttpRequest = jest.fn()

jest.mock('../../../utils/safe-http', () => ({ safeHttpRequest }))

import { runWithContext } from '../../../gateway/api-gateway/context'
import { imageAnalyzer } from '../index'

describe('image-analyzer network boundary', () => {
  beforeEach(() => {
    safeHttpRequest.mockReset()
    const png = Buffer.alloc(24)
    png.writeUInt32BE(0x89504e47, 0)
    png.writeUInt32BE(1, 16)
    png.writeUInt32BE(1, 20)
    safeHttpRequest.mockResolvedValue({ data: png.buffer })
  })

  it('远程图片读取始终使用公网策略和请求取消信号', async () => {
    const controller = new AbortController()

    const result = await runWithContext({ abortSignal: controller.signal }, () => imageAnalyzer({
      imageUrl: 'https://example.com/image.png',
      analysisType: 'ocr'
    }))

    expect(result.success).toBe(true)
    expect(safeHttpRequest).toHaveBeenCalledWith('https://example.com/image.png', expect.objectContaining({
      privateNetworkPolicy: 'public-only',
      signal: controller.signal
    }))
  })
})
