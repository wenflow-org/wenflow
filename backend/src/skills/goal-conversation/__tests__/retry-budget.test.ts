process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-thirty-two-characters'

const executeMock = jest.fn()
const getActivePromptMock = jest.fn()

jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: executeMock })
}))

jest.mock('../../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: getActivePromptMock }
}))

jest.mock('../../../services/prompt-composer', () => ({
  composePromptFromAgentRouting: jest.fn(),
  isPromptSupplementEnabled: () => false,
  getRoutingSnapshotHash: jest.fn(async () => 'test-routing-hash'),
}))

jest.mock('../../../services/telemetry-writer.service', () => ({
  telemetryWriter: {
    createPromptCall: jest.fn().mockResolvedValue(true),
  },
}))

import { runWithContext } from '../../../gateway/api-gateway/context'
import { createRetryBudget } from '../../../gateway/api-gateway/retry-budget'
import { goalConversationAgentHandler } from '../index'

describe('Goal Conversation retry budget', () => {
  beforeEach(() => {
    executeMock.mockReset().mockResolvedValue({
      choices: [{ message: { content: '没有结构化输出' }, finish_reason: 'stop' }],
      _gatewayMetadata: { attemptCount: 1 }
    })
    getActivePromptMock.mockReset().mockResolvedValue(null)
  })

  it('复用请求预算并在一次逻辑重试后停止', async () => {
    const retryBudget = createRetryBudget()

    const result = await runWithContext({ retryBudget }, () => goalConversationAgentHandler(
      { goal: '学习 TypeScript', metadata: {} },
      { userId: 'user-1', conversationHistory: [] } as any,
      { maxFormatRetries: 2, systemPromptOverride: '测试提示词' }
    ))

    expect(executeMock).toHaveBeenCalledTimes(2)
    expect(executeMock.mock.calls[0][2].retryBudget).toBe(retryBudget)
    expect(executeMock.mock.calls[1][2].retryBudget).toBe(retryBudget)
    expect(retryBudget.used.logicalRetries).toBe(1)
    expect(retryBudget.exhaustedBy).toBe('logical-retries')
    expect(result).toMatchObject({
      success: false,
      error: 'STRUCTURED_OUTPUT_INVALID',
      debug: {
        attemptCount: 2,
        actualRetryCount: 1,
        structuredOutputValid: false
      }
    })
  })
})
