const mockGetActivePrompt = jest.fn()
const mockGatewayExecute = jest.fn()
const mockPromptCallCreate = jest.fn()

jest.mock('../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: mockGetActivePrompt }
}))
jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: mockGatewayExecute })
}))
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    prompt_call_logs: { create: mockPromptCallCreate }
  }
}))

import { callPrompt } from '../prompt-composer'
import { runWithContext } from '../../gateway/api-gateway/context'

describe('callPrompt runtime overrides', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPromptCallCreate.mockResolvedValue({})
    mockGatewayExecute.mockResolvedValue({
      id: 'completion-1',
      model: 'frozen-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '{"value":"ok"}' }, finish_reason: 'stop' }]
    })
  })

  it('冻结 Prompt 可在 ACTIVE 配置缺失时运行并覆盖模型参数与路由', async () => {
    mockGetActivePrompt.mockResolvedValue(null)
    const result = await runWithContext({
      promptRuntimeOverride: {
        systemPromptOverride: 'frozen prompt',
        routingUserIdOverride: 'admin-original',
        modelOverride: 'frozen-model',
        temperatureOverride: 0.15,
        maxTokensOverride: 321,
        routeOverride: {
          expectedProviderId: 'provider-frozen',
          expectedCredentialFingerprint: 'credential-hash',
          endpoint: 'https://frozen.example/v1',
          model: 'frozen-model'
        }
      }
    }, () => callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      requireActivePrompt: true,
      caller: { skillId: 'test' },
      modelDefaults: { temperature: 0.7, maxTokens: 800 },
      buildUserPayload: () => ({ input: true }),
      normalizeOutput: parsed => parsed
    }, {}))

    expect(result.success).toBe(true)
    expect(mockGatewayExecute).toHaveBeenCalledWith({
      messages: [
        { role: 'system', content: 'frozen prompt' },
        { role: 'user', content: '{\n  "input": true\n}' }
      ],
      model: 'frozen-model',
      max_tokens: 321,
      temperature: 0.15
    }, { skillId: 'test' }, { userId: 'admin-original' })
    expect(mockPromptCallCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        systemPromptVersion: null,
        systemPromptHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    }))
  })

  it('没有 ACTIVE Prompt 或冻结 override 时保持缺失错误', async () => {
    mockGetActivePrompt.mockResolvedValue(null)

    const result = await callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      requireActivePrompt: true,
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed
    }, {})

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SKILL_TEST_PROMPT_MISSING')
    expect(mockGatewayExecute).not.toHaveBeenCalled()
  })
})
