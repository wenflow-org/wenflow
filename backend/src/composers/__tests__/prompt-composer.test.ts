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
    }, { skillId: 'test' }, expect.objectContaining({
      userId: 'admin-original',
      promptCallId: expect.stringMatching(/^pcl_/),
      promptAttemptNo: 1
    }))
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
    expect(mockPromptCallCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        success: false,
        failureStage: 'prompt_resolution',
        promptAttemptCount: 0
      })
    }))
  })

  it('网关传输失败时不进入 Prompt 逻辑重试并记录 transport 失败', async () => {
    mockGetActivePrompt.mockResolvedValue({
      systemPrompt: 'active prompt',
      version: 1,
      temperature: 0.2,
      maxTokens: 200
    })
    mockGatewayExecute.mockRejectedValue(Object.assign(new Error('provider unavailable'), { code: 'UPSTREAM_503' }))

    await expect(callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      requireActivePrompt: true,
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed,
      retryStrategy: { maxAttempts: 2 }
    }, {})).rejects.toThrow('provider unavailable')

    expect(mockGatewayExecute).toHaveBeenCalledTimes(1)
    expect(mockPromptCallCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        success: false,
        errorCode: 'UPSTREAM_503',
        failureStage: 'transport',
        promptAttemptCount: 1,
        llmRequestCount: 1
      })
    }))
  })

  it('逻辑重试后传输失败时记录最后一次 Gateway 请求身份', async () => {
    mockGetActivePrompt.mockResolvedValue({
      systemPrompt: 'active prompt',
      version: 1,
      temperature: 0.2,
      maxTokens: 200
    })
    mockGatewayExecute
      .mockResolvedValueOnce({
        id: 'completion-invalid',
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'not json' }, finish_reason: 'stop' }],
        _gatewayMetadata: {
          llmRequestId: 'gw-first',
          providerId: 'provider-1',
          resolvedModel: 'test-model',
          attemptCount: 1
        }
      })
      .mockRejectedValueOnce(Object.assign(new Error('provider unavailable'), {
        code: 'UPSTREAM_503',
        llmRequestId: 'gw-second',
        providerId: 'provider-1',
        model: 'test-model',
        attemptCount: 2
      }))

    await expect(callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      requireActivePrompt: true,
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed,
      retryStrategy: { maxAttempts: 2 }
    }, {})).rejects.toThrow('provider unavailable')

    expect(mockPromptCallCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        finalLlmRequestId: 'gw-second',
        providerId: 'provider-1',
        model: 'test-model',
        promptAttemptCount: 2,
        llmRequestCount: 2,
        attemptTrace: expect.stringContaining('gw-second')
      })
    }))
  })

  it('返回或抛错前等待 Prompt 摘要写入完成', async () => {
    mockGetActivePrompt.mockResolvedValue(null)
    let resolveWrite: () => void = () => undefined
    mockPromptCallCreate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWrite = resolve
    }))

    let settled = false
    const execution = callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      requireActivePrompt: true,
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed
    }, {}).then(() => {
      settled = true
    })

    await new Promise(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    resolveWrite()
    await execution
    expect(settled).toBe(true)
  })
})
