process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-thirty-two-characters'

const gatewayExecute = jest.fn()
const mockGetActivePrompt = jest.fn()

jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: gatewayExecute })
}))

// 隔离 DB 依赖：CI 环境 system DB 可能未就绪（agent_prompts 表不存在），
// 否则 getActivePrompt 真实查询会在 gateway 错误前抛 Prisma 错误
jest.mock('../../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: mockGetActivePrompt }
}))

import aiService from '../ai.service'
import { GatewayExecutionError } from '../../../gateway/api-gateway/failure-classification'

describe('AIService gateway errors', () => {
  beforeEach(() => {
    gatewayExecute.mockReset()
    mockGetActivePrompt.mockReset()
    // generic-chat 为 requireActivePrompt：需返回非空 ACTIVE prompt 才能走到 gateway
    mockGetActivePrompt.mockResolvedValue({ systemPrompt: 'test system prompt', version: 1 })
  })

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
