const mockPromptGroupBy = jest.fn()
const mockAgentFindMany = jest.fn()
const mockPromptFindFirst = jest.fn()
const mockResolveRoute = jest.fn()
const mockGetPlatformReliability = jest.fn()
const mockSkillConfigGet = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    prompt_call_logs: { groupBy: (...args: any[]) => mockPromptGroupBy(...args) },
    agent_call_logs: { findMany: (...args: any[]) => mockAgentFindMany(...args) },
  },
}))

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_prompts: { findFirst: (...args: any[]) => mockPromptFindFirst(...args) },
  },
}))

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ resolveRoute: mockResolveRoute }),
}))

jest.mock('../reliability-settings.service', () => ({
  getPlatformReliabilitySettings: (...args: any[]) => mockGetPlatformReliability(...args),
}))

jest.mock('../skillModelConfig.service', () => ({
  __esModule: true,
  default: { get: (...args: any[]) => mockSkillConfigGet(...args) },
}))

jest.mock('../agent-manifest.service', () => ({
  getCanonicalAgentId: (id: string) =>
    String(id || '').startsWith('skill:') ? id : `skill:${String(id || '').replace(/^skill:/, '')}`,
  getAgentOfSkill: () => ({ id: 'goal-agent', name: '目标 Agent' }),
  getAgentManifest: () => ({
    id: 'skill:goal-conversation',
    defaultModelConfig: { temperature: 0.7, maxTokens: 1800 },
  }),
}))

import {
  getUnifiedSkillStats,
  resolveEffectiveSkillRuntimeConfig,
} from '../skill-runtime-contract.service'

describe('skill-runtime-contract.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPlatformReliability.mockResolvedValue({
      maxUpstreamAttempts: 2,
      maxTransportRetries: 1,
      maxLogicalRetries: 2,
    })
  })

  it('prefers prompt_call_logs over agent_call_logs for LLM skills', async () => {
    mockPromptGroupBy
      .mockResolvedValueOnce([
        {
          agentId: 'skill:goal-conversation',
          _count: { _all: 82 },
          _avg: { durationMs: 36600 },
          _max: { createdAt: new Date('2026-07-25T00:00:00.000Z') },
        },
      ])
      .mockResolvedValueOnce([
        { agentId: 'skill:goal-conversation', success: true, _count: { _all: 62 } },
        { agentId: 'skill:goal-conversation', success: false, _count: { _all: 20 } },
      ])
    mockAgentFindMany.mockResolvedValue([
      {
        agentId: 'skill:goal-conversation',
        metadata: '{"skillId":"goal-conversation"}',
        success: true,
        durationMs: 1000,
        calledAt: new Date(),
      },
    ])

    const map = await getUnifiedSkillStats(['goal-conversation'], 'all')
    const stats = map.get('goal-conversation')

    expect(stats).toEqual(
      expect.objectContaining({
        callCount: 82,
        successCount: 62,
        failureCount: 20,
        successRate: 75.6,
        avgDurationMs: 36600,
        source: 'prompt_call_logs',
        range: 'all',
      })
    )
  })

  it('falls back to agent_call_logs when no prompt logs exist', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    mockAgentFindMany.mockResolvedValue([
      {
        agentId: 'skill:label-generator',
        metadata: null,
        success: true,
        durationMs: 120,
        calledAt: new Date('2026-07-20T00:00:00.000Z'),
      },
      {
        agentId: 'skill:label-generator',
        metadata: null,
        success: false,
        durationMs: 80,
        calledAt: new Date('2026-07-21T00:00:00.000Z'),
      },
    ])

    const map = await getUnifiedSkillStats(['label-generator'], 'all')
    const stats = map.get('label-generator')

    expect(stats).toEqual(
      expect.objectContaining({
        callCount: 2,
        successCount: 1,
        failureCount: 1,
        successRate: 50,
        avgDurationMs: 100,
        source: 'agent_call_logs',
      })
    )
  })

  it('merges route + ACTIVE prompt into effective LLM request', async () => {
    mockSkillConfigGet.mockResolvedValue({
      enabled: true,
      model: 'skill-override-model',
      temperature: 0.2,
      maxTokens: 2000,
      maxLogicalRetries: 1,
      requestTimeoutMs: 60000,
      thinkingMode: 'default',
      reasoningEffort: 'default',
    })
    mockResolveRoute.mockResolvedValue({
      model: 'route-model',
      temperature: 0.2,
      maxTokens: 2000,
      timeoutMs: 60000,
      thinkingMode: 'default',
      reasoningEffort: 'default',
    })
    mockPromptFindFirst.mockResolvedValue({
      id: 'ap_1',
      version: 3,
      model: null,
      temperature: 0.7,
      maxTokens: 8000,
    })

    const effective = await resolveEffectiveSkillRuntimeConfig('goal-conversation')

    expect(effective.route).toEqual(
      expect.objectContaining({
        model: 'route-model',
        maxTokens: 2000,
        source: 'skill-override',
        hasSkillOverride: true,
      })
    )
    expect(effective.llmRequest).toEqual(
      expect.objectContaining({
        model: 'route-model',
        temperature: 0.7,
        maxTokens: 8000,
        source: 'active-prompt',
      })
    )
    expect(effective.reliability.maxLogicalRetries).toBe(1)
    expect(effective.reliability.logicalRetrySource).toBe('skill-override')
  })
})
