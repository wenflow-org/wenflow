process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-thirty-two-characters'

const executeMock = jest.fn()
const getActivePromptMock = jest.fn()
const createPromptCallMock = jest.fn()

jest.mock('../../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ execute: executeMock }),
}))

jest.mock('../../../services/agentConfig.service', () => ({
  agentConfigService: { getActivePrompt: getActivePromptMock },
}))

jest.mock('../../../services/prompt-composer', () => ({
  composePromptFromAgentRouting: jest.fn(),
  isPromptSupplementEnabled: () => false,
  getRoutingSnapshotHash: jest.fn(async () => 'test-routing-hash'),
}))

jest.mock('../../../services/telemetry-writer.service', () => ({
  telemetryWriter: {
    createPromptCall: (...args: any[]) => createPromptCallMock(...args),
  },
}))

import { goalConversationAgentHandler } from '../index'

const activeContract = {
  version: 'prompt-runtime-contract/v1',
  contextMode: 'snapshot-context',
  businessState: {
    domain: 'active-goal-domain',
    phases: ['understanding', 'proposing', 'ready', 'completed'],
    defaultPhase: 'understanding',
    terminalPhases: ['ready', 'completed'],
    statusValues: ['succeeded', 'partial', 'blocked', 'failed'],
  },
  contextUpdate: {
    mode: 'thread-state',
    stateOwner: 'model',
    description: 'distinct active goal contract',
  },
  outputEnvelope: 'adapter',
}

const validStructuredContent = JSON.stringify({
  reply: '我们先确认你的学习目标。',
  state: {
    stage: 'understanding',
    confidence: 0.66,
    done: false,
  },
  understanding: {
    real_problem: '学习 TypeScript',
    background: { current_level: 'beginner' },
  },
  nextQuestions: ['你每周能投入多少时间？'],
  quickReplies: ['每周五小时', '每周十小时'],
})

function mockActivePrompt(metadata: unknown = {
  promptLab: { runtimeContract: activeContract },
}) {
  getActivePromptMock.mockResolvedValue({
    systemPrompt: 'goal system prompt',
    version: 3,
    temperature: 0.2,
    maxTokens: 1200,
    metadata,
  })
}

describe('goal-conversation runtime envelope contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createPromptCallMock.mockResolvedValue(true)
    mockActivePrompt()
  })

  it('uses ACTIVE metadata contract on validated success', async () => {
    executeMock.mockResolvedValue({
      choices: [{ message: { content: validStructuredContent }, finish_reason: 'stop' }],
      _gatewayMetadata: { attemptCount: 1 },
    })

    const result = await goalConversationAgentHandler(
      { goal: '学习 TypeScript', metadata: {} },
      { userId: 'user-1', conversationHistory: [] } as any
    )

    expect(result.success).toBe(true)
    expect(createPromptCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'skill:goal-conversation',
        success: true,
        failureStage: null,
      })
    )
    expect(result.schemaVersion).toBe('agent-output-v1')
    expect(result.userVisible).toContain('学习目标')
    expect(result.runtimeEnvelope).toEqual(expect.objectContaining({
      businessState: expect.objectContaining({
        domain: 'active-goal-domain',
        phase: 'understanding',
        status: 'succeeded',
      }),
      contextUpdate: expect.objectContaining({
        mode: 'thread-state',
        stateOwner: 'model',
        nextState: expect.objectContaining({
          stage: 'understanding',
          confidence: 0.66,
        }),
      }),
    }))
  })

  it('顶层 needsMaterial 通过校验并落到 understanding（goal→path 资料采集缝）', async () => {
    const contentWithNeed = JSON.stringify({
      reply: '这条路依赖《3-6 岁儿童学习与发展指南》。',
      state: { stage: 'proposing', confidence: 0.9, done: false },
      understanding: { real_problem: '按指南设计活动' },
      nextQuestions: ['要不要先读指南？'],
      confirmedProposal: {
        learning_direction: '指南落地',
        first_deliverable: '一份活动方案',
        key_stages: ['读懂领域', '设计活动'],
        out_of_scope: [],
        scope_size: 'small',
      },
      needsMaterial: {
        kind: '指南',
        title: '《3-6 岁儿童学习与发展指南》',
        why: '活动设计要有官方依据',
        queries: ['3-6岁儿童学习与发展指南'],
      },
    })
    executeMock.mockResolvedValue({
      choices: [{ message: { content: contentWithNeed }, finish_reason: 'stop' }],
      _gatewayMetadata: { attemptCount: 1 },
    })

    const result = await goalConversationAgentHandler(
      { goal: '按指南设计活动', metadata: {} },
      { userId: 'user-1', conversationHistory: [] } as any
    )

    expect(result.success).toBe(true)
    expect((result.internal as any).ext.goalConversation.understanding.needsMaterial).toEqual(
      expect.objectContaining({ title: '《3-6 岁儿童学习与发展指南》' })
    )
  })

  it('uses ACTIVE metadata contract on validation failure', async () => {
    executeMock.mockResolvedValue({
      choices: [{ message: { content: '没有结构化输出' }, finish_reason: 'stop' }],
      _gatewayMetadata: { attemptCount: 1 },
    })

    const result = await goalConversationAgentHandler(
      { goal: '学习 TypeScript', metadata: {} },
      { userId: 'user-1', conversationHistory: [] } as any,
      { maxFormatRetries: 0 }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('STRUCTURED_OUTPUT_INVALID')
    expect(createPromptCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'skill:goal-conversation',
        success: false,
        failureStage: 'validation',
      })
    )
    expect(result.runtimeEnvelope).toEqual(expect.objectContaining({
      businessState: expect.objectContaining({
        domain: 'active-goal-domain',
        status: 'failed',
        reason: 'STRUCTURED_OUTPUT_INVALID',
      }),
      contextUpdate: expect.objectContaining({
        mode: 'thread-state',
        stateOwner: 'model',
      }),
    }))
  })

  it('marks observation mode as partial with ACTIVE metadata contract', async () => {
    executeMock.mockResolvedValue({
      choices: [{ message: { content: '没有结构化输出' }, finish_reason: 'stop' }],
      _gatewayMetadata: { attemptCount: 1 },
    })

    const result = await goalConversationAgentHandler(
      { goal: '学习 TypeScript', metadata: {} },
      { userId: 'user-1', conversationHistory: [] } as any,
      { maxFormatRetries: 0, allowInvalidStructuredOutput: true }
    )

    expect(result.success).toBe(true)
    expect(result.debug?.observationMode).toBe(true)
    expect(result.runtimeEnvelope).toEqual(expect.objectContaining({
      businessState: expect.objectContaining({
        domain: 'active-goal-domain',
        status: 'partial',
        reason: 'observation-mode',
      }),
    }))
  })

  it('falls back to default contract when ACTIVE metadata is missing', async () => {
    getActivePromptMock.mockResolvedValue({
      systemPrompt: 'goal system prompt',
      version: 1,
      temperature: 0.7,
      maxTokens: 8000,
      metadata: null,
    })
    executeMock.mockResolvedValue({
      choices: [{ message: { content: validStructuredContent }, finish_reason: 'stop' }],
      _gatewayMetadata: { attemptCount: 1 },
    })

    const result = await goalConversationAgentHandler(
      { goal: '学习 TypeScript', metadata: {} },
      { userId: 'user-1', conversationHistory: [] } as any
    )

    expect(result.success).toBe(true)
    expect(result.runtimeEnvelope?.businessState?.domain).toBe('goal-conversation')
  })
})
