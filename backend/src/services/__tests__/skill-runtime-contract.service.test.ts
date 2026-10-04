const mockPromptGroupBy = jest.fn()
const mockAgentQueryRaw = jest.fn()
const mockPromptFindFirst = jest.fn()
const mockResolveRoute = jest.fn()
const mockGetPlatformReliability = jest.fn()
const mockSkillConfigGet = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    prompt_call_logs: { groupBy: (...args: any[]) => mockPromptGroupBy(...args) },
    // 2026-09-30 性能批：归属统计改走 $queryRaw（json_extract 单扫），tagged template 直接收 (strings, ...values)
    $queryRaw: (...args: any[]) => mockAgentQueryRaw(...args),
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
  __clearMetadataSkillIdSniffForTests,
} from '../skill-runtime-contract.service'

/** 2026-10-04 性能批后 $queryRaw 有三种形态：①前缀行 GROUP BY 聚合 ②metadata 兜底嗅探 ③兜底明细 */
let aggRows: any[] = []
let fallbackRows: any[] = []
let sniffHit = false
function installRawQueryRouter() {
  mockAgentQueryRaw.mockImplementation((strings: any) => {
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings)
    if (sql.includes('AS "n"')) return Promise.resolve(aggRows)
    if (sql.includes('LIMIT 1')) return Promise.resolve(sniffHit ? [{ one: 1 }] : [])
    return Promise.resolve(fallbackRows)
  })
}

describe('skill-runtime-contract.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    aggRows = []
    fallbackRows = []
    sniffHit = false
    installRawQueryRouter()
    __clearMetadataSkillIdSniffForTests()
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
    mockAgentQueryRaw.mockResolvedValue([])

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

  it('falls back to agent_call_logs when no prompt logs exist（前缀行 SQL 聚合形态）', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    aggRows = [
      { agentId: 'skill:label-generator', success: 1, n: 1, durSum: 120, lastAt: '2026-07-20T00:00:00.000Z' },
      { agentId: 'skill:label-generator', success: 0, n: 1, durSum: 80, lastAt: '2026-07-21T00:00:00.000Z' },
    ]

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
    // 聚合 SQL 走 agentId 精确 IN（同一 skill 至多两分组），不带 metadata 取出
    const aggCall = mockAgentQueryRaw.mock.calls.find((c: any) => String(c[0].join('?')).includes('AS "n"'))
    expect(String(aggCall?.[0]?.join('?'))).toContain('GROUP BY')
    expect(String(aggCall?.[0]?.join('?'))).not.toContain('json_extract')
  })

  it('metadata 兜底：仅当嗅探命中（非前缀行存在顶层 skillId）才执行兜底扫描', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    sniffHit = true
    fallbackRows = [
      { agentId: 'path-agent', skillId: 'skill:path-planning', success: 1, durationMs: 500, calledAt: '2026-07-22T00:00:00.000Z' },
    ]

    const map = await getUnifiedSkillStats(['path-planning'], '7d')
    const stats = map.get('path-planning')

    expect(stats).toEqual(
      expect.objectContaining({
        callCount: 1,
        successCount: 1,
        source: 'agent_call_logs',
      })
    )
    // 嗅探与兜底都走过 $queryRaw：一次 LIMIT 1 嗅探 + 一次明细兜底
    const sqls = mockAgentQueryRaw.mock.calls.map((c: any) => String(c[0].join('?')))
    expect(sqls.some((s: string) => s.includes('LIMIT 1'))).toBe(true)
    expect(sqls.some((s: string) => s.includes('json_extract'))).toBe(true)
  })

  it('metadata 兜底：嗅探未命中时不跑明细扫描（常态零成本）', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    sniffHit = false

    const map = await getUnifiedSkillStats(['path-planning'], '7d')

    expect(map.get('path-planning')?.callCount).toBe(0)
    const sqls = mockAgentQueryRaw.mock.calls.map((c: any) => String(c[0].join('?')))
    expect(sqls.some((s: string) => s.includes('LIMIT 1'))).toBe(true)
    expect(sqls.some((s: string) => s.includes('json_extract'))).toBe(false)
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
        // 输出预算语义修正（2026-09）：声明值即权威，ACTIVE prompt 8000 不再被抬到 131072
        maxTokens: 8000,
        source: 'active-prompt',
      })
    )
    expect(effective.reliability.maxLogicalRetries).toBe(1)
    expect(effective.reliability.logicalRetrySource).toBe('skill-override')
  })
})
