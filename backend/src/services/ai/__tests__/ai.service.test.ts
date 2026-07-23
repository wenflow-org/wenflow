process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-thirty-two-characters'

const gatewayExecute = jest.fn()

jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: gatewayExecute })
}))

import aiService from '../ai.service'
import { GatewayExecutionError } from '../../../gateway/api-gateway/failure-classification'

describe('AIService gateway errors', () => {
  it('保留 Gateway 错误分类和执行身份', async () => {
    const error = new GatewayExecutionError('request canceled', {
      category: 'caller_abort',
      code: 'CALLER_ABORTED',
      retryable: false
    }).attachExecutionMetadata({
      llmRequestId: 'gw-canceled',
      attemptCount: 1,
      providerId: 'provider-1',
      model: 'test-model'
    })
    gatewayExecute.mockRejectedValueOnce(error)

    await expect(aiService.chat(
      [{ role: 'user', content: 'hello' }],
      { agentId: 'test-agent' }
    )).rejects.toBe(error)

    expect(error).toMatchObject({
      code: 'CALLER_ABORTED',
      category: 'caller_abort',
      llmRequestId: 'gw-canceled'
    })
  })
})
