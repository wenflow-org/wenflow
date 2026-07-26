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
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter'
import type { PromptCallSpec } from '../types'
import type { RuntimeContract } from '../../services/prompt-lab/runtime-contract'

const ACTIVE_METADATA_RUNTIME_CONTRACT = {
  version: 'prompt-runtime-contract/v1',
  contextMode: 'snapshot-context',
  businessState: {
    domain: 'active-metadata-domain',
    phases: ['active-metadata-phase'],
    defaultPhase: 'active-metadata-phase',
    terminalPhases: ['active-metadata-phase'],
    statusValues: ['succeeded', 'partial', 'blocked', 'failed']
  },
  contextUpdate: {
    mode: 'state-refresh',
    stateOwner: 'model'
  },
  outputEnvelope: 'adapter'
}

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

  it('Context Envelope 默认不进入 payload，但可用于显式业务投影和 Gateway telemetry', async () => {
    mockGetActivePrompt.mockResolvedValue({
      systemPrompt: 'active prompt',
      version: 1,
      metadata: { promptLab: { runtimeContract: ACTIVE_METADATA_RUNTIME_CONTRACT } }
    })

    const result = await runWithContext({
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: 'user-envelope' },
        session: {
          sessionId: 'session-1',
          conversationId: 'conversation-1',
          pathId: 'path-1',
          taskId: 'task-1'
        },
        locale: { language: 'zh-CN', timeZone: 'Asia/Shanghai' }
      }
    }, () => callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      caller: { skillId: 'test' },
      buildUserPayload: (_input, runtime) => ({
        value: 'business-only',
        language: runtime.contextEnvelope.locale?.language,
        contextMode: runtime.runtimeContract.contextMode
      }),
      normalizeOutput: parsed => parsed
    }, {}))

    expect(result.success).toBe(true)
    expect(result.debug.userPayload).toBe(JSON.stringify({
      value: 'business-only',
      language: 'zh-CN',
      contextMode: 'snapshot-context'
    }, null, 2))
    expect(result.debug.userPayload).not.toContain('session-1')
    expect(mockGatewayExecute).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        sessionId: 'session-1',
        conversationId: 'conversation-1',
        pathId: 'path-1',
        taskId: 'task-1',
        locale: { language: 'zh-CN', timeZone: 'Asia/Shanghai' }
      })
    )
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

  it('将结构化校验问题传给重试回调、重试提示和尝试追踪', async () => {
    mockGetActivePrompt.mockResolvedValue({ systemPrompt: 'active prompt', version: 1 })
    mockGatewayExecute
      .mockResolvedValueOnce({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"value":""}' }, finish_reason: 'stop' }]
      })
      .mockResolvedValueOnce({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"value":"ok"}' }, finish_reason: 'stop' }]
      })
    const onValidationFail = jest.fn(() => '请根据校验问题修正后重新输出 JSON。')

    const result = await callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed,
      validateParsedOutput: parsed => parsed.value
        ? { valid: true }
        : {
            valid: false,
            failureReason: '输出未满足字段约束',
            violations: ['value 不能为空', 'value 必须是有效学习目标']
          },
      retryStrategy: { maxAttempts: 2, onValidationFail }
    }, {})

    expect(result.success).toBe(true)
    expect(onValidationFail).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 2,
      failureReason: '输出未满足字段约束',
      violations: ['value 不能为空', 'value 必须是有效学习目标']
    }))
    expect(mockGatewayExecute).toHaveBeenLastCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: 'payload\n\n请根据校验问题修正后重新输出 JSON。\n\n校验问题：\n- value 不能为空\n- value 必须是有效学习目标'
        })
      ])
    }), expect.anything(), expect.anything())
    expect(result.debug.attempts[0]).toEqual(expect.objectContaining({
      failureReason: '输出未满足字段约束',
      violations: ['value 不能为空', 'value 必须是有效学习目标']
    }))

    const telemetryAttemptTrace = JSON.parse(mockPromptCallCreate.mock.calls[0][0].data.attemptTrace)
    expect(telemetryAttemptTrace[0]).toEqual(expect.objectContaining({
      failureReason: '输出未满足字段约束',
      violations: ['value 不能为空', 'value 必须是有效学习目标']
    }))
  })

  it('为旧式校验器的 failureReason 提供 violations 兼容桥接', async () => {
    mockGetActivePrompt.mockResolvedValue({ systemPrompt: 'active prompt', version: 1 })
    mockGatewayExecute
      .mockResolvedValueOnce({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"value":""}' }, finish_reason: 'stop' }]
      })
      .mockResolvedValueOnce({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"value":"ok"}' }, finish_reason: 'stop' }]
      })
    const onValidationFail = jest.fn(() => null)

    const result = await callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed,
      validateParsedOutput: parsed => parsed.value
        ? { valid: true }
        : { valid: false, failureReason: 'value is required' },
      retryStrategy: { maxAttempts: 2, onValidationFail }
    }, {})

    expect(result.success).toBe(true)
    expect(onValidationFail).toHaveBeenCalledWith(expect.objectContaining({
      failureReason: 'value is required',
      violations: ['value is required']
    }))
  })

  it('返回或抛错前等待 Prompt 摘要写入完成', async () => {
    mockGetActivePrompt.mockResolvedValue(null)
    let resolveWrite: () => void = () => undefined
    let markWriteStarted: () => void = () => undefined
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve
    })
    mockPromptCallCreate.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveWrite = resolve
      markWriteStarted()
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

    await writeStarted
    expect(settled).toBe(false)
    resolveWrite()
    await execution
    expect(settled).toBe(true)
  })

  it('将 ACTIVE Prompt metadata 的运行契约传给 mapEnvelope 并用于结果 envelope', async () => {
    mockGetActivePrompt.mockResolvedValue({
      systemPrompt: 'active prompt',
      metadata: { promptLab: { runtimeContract: ACTIVE_METADATA_RUNTIME_CONTRACT } }
    })
    const mapEnvelope = jest.fn((output: { value: string }, _input: Record<string, never>, runtimeContract: RuntimeContract) => (
      adaptToRuntimeEnvelope({
        contract: runtimeContract,
        artifact: output,
        phase: runtimeContract.businessState.defaultPhase,
        status: 'succeeded',
        nextState: { source: 'custom-mapper' }
      })
    ))
    const spec: PromptCallSpec<Record<string, never>, { value: string }> = {
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed,
      mapEnvelope
    }

    const result = await callPrompt(spec, {})

    expect(result.success).toBe(true)
    expect(mapEnvelope).toHaveBeenCalledWith(
      { value: 'ok' },
      {},
      expect.objectContaining({
        businessState: expect.objectContaining({
          domain: 'active-metadata-domain',
          defaultPhase: 'active-metadata-phase'
        }),
        contextUpdate: expect.objectContaining({ stateOwner: 'model' })
      })
    )
    expect(result.runtimeEnvelope).toEqual(expect.objectContaining({
      businessState: expect.objectContaining({
        domain: 'active-metadata-domain',
        phase: 'active-metadata-phase'
      }),
      contextUpdate: expect.objectContaining({
        mode: 'state-refresh',
        stateOwner: 'model'
      })
    }))
  })

  it('未提供 mapEnvelope 时使用 ACTIVE Prompt metadata 的运行契约进行默认包装', async () => {
    mockGetActivePrompt.mockResolvedValue({
      systemPrompt: 'active prompt',
      metadata: { promptLab: { runtimeContract: ACTIVE_METADATA_RUNTIME_CONTRACT } }
    })

    const result = await callPrompt({
      agentId: 'skill:test',
      defaultSystemPrompt: 'default prompt',
      caller: { skillId: 'test' },
      buildUserPayload: () => 'payload',
      normalizeOutput: parsed => parsed
    }, {})

    expect(result.success).toBe(true)
    expect(result.runtimeEnvelope).toEqual(expect.objectContaining({
      artifact: { value: 'ok' },
      businessState: expect.objectContaining({
        domain: 'active-metadata-domain',
        phase: 'active-metadata-phase',
        isTerminal: true
      }),
      contextUpdate: expect.objectContaining({
        mode: 'state-refresh',
        stateOwner: 'model',
        nextState: null
      })
    }))
  })
})
