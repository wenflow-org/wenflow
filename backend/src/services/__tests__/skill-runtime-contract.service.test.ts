const mockPromptGroupBy = jest.fn()
const mockPromptFindMany = jest.fn()
const mockAgentQueryRaw = jest.fn()
const mockPromptFindFirst = jest.fn()
const mockResolveRoute = jest.fn()
const mockGetPlatformReliability = jest.fn()
const mockSkillConfigGet = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    prompt_call_logs: {
      groupBy: (...args: any[]) => mockPromptGroupBy(...args),
      findMany: (...args: any[]) => mockPromptFindMany(...args),
    },
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
  getSkillSampleInput,
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

  /* 2026-11-08 语义调整：prompt_call_logs 由「优先」改为「无 skill 执行行时的兜底」。
     原因见下方新增用例——prompt 表不记录 skill 级失败，单看它必漏算失败。 */
  it('无 skill 执行行时回落到 prompt_call_logs（LLM 技能无 agent 遥测的兜底）', async () => {
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

  /* 2026-11-08 用户实测 Bug：「运行时」卡片写着「调用 5 · 失败 0 · 成功率 100%」，
     底下「最近调用」却躺着 4 条 SKILL_EXECUTION_FAILED 红行。
     根因：skill 只要在 prompt_call_logs 有行，skill 层的 agent_call_logs 就被整段跳过；
     而结构化输出校验失败（category=internal）只在 agent 表里，prompt 表一条都没有。
     口径改为「有 skill 执行行就以它为准」→ 卡片与列表一致。
     本用例锁死：两表都有行时，计数取 skill 执行行（9 = 5 成功 + 4 失败），不取 prompt 的 5。 */
  it('两表都有行时以 skill 执行行为准（失败不再被 prompt 行吞掉）', async () => {
    mockPromptGroupBy
      .mockResolvedValueOnce([
        {
          agentId: 'skill:goal-conversation',
          _count: { _all: 5 },
          _avg: { durationMs: 12000 },
          _max: { createdAt: new Date('2026-07-25T00:00:00.000Z') },
        },
      ])
      .mockResolvedValueOnce([
        { agentId: 'skill:goal-conversation', success: true, _count: { _all: 5 } },
      ])
    // skill 执行行：5 成功 + 4 失败（结构化输出缺字段，category=internal，prompt 表无对应行）
    aggRows = [
      { agentId: 'skill:goal-conversation', success: 1, n: 5, durSum: 60000, lastAt: '2026-07-25T00:00:00.000Z' },
      { agentId: 'skill:goal-conversation', success: 0, n: 4, durSum: 8000, lastAt: '2026-07-26T00:00:00.000Z' },
    ]

    const map = await getUnifiedSkillStats(['goal-conversation'], 'all')
    const stats = map.get('goal-conversation')

    expect(stats).toEqual(
      expect.objectContaining({
        callCount: 9,
        successCount: 5,
        failureCount: 4,
        successRate: 55.6,
        source: 'agent_call_logs',
      })
    )
    // 卡片失败数与「最近调用」列表（同读 agent 表）严格一致
    expect(stats!.failureCount).toBe(4)
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

  it('聚合行 lastAt 是 SQLite 整数毫秒（BigInt）时按时间戳归一，不抛 BigInt 转换错误', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    // 真实库：agent_call_logs.calledAt 全表以 INTEGER 存储，$queryRaw 返回 BigInt
    aggRows = [
      { agentId: 'skill:teaching-turn', success: 1, n: 3n, durSum: 300n, lastAt: 1792574025470n },
      { agentId: 'skill:teaching-turn', success: 0, n: 1n, durSum: 50n, lastAt: 1792574025000n },
    ]

    const map = await getUnifiedSkillStats(['teaching-turn'], 'all')
    const stats = map.get('teaching-turn')

    expect(stats).toEqual(
      expect.objectContaining({
        callCount: 4,
        successCount: 3,
        failureCount: 1,
        source: 'agent_call_logs',
      })
    )
    expect(stats?.lastCalledAt?.toISOString()).toBe(new Date(1792574025470).toISOString())
  })

  it('metadata 兜底行的 calledAt 为 BigInt 时同样归一', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    sniffHit = true
    fallbackRows = [
      { agentId: 'path-agent', skillId: 'skill:path-planning', success: 1, durationMs: 500, calledAt: 1792574025470n },
    ]

    const map = await getUnifiedSkillStats(['path-planning'], '7d')
    const stats = map.get('path-planning')

    expect(stats?.callCount).toBe(1)
    expect(stats?.lastCalledAt?.toISOString()).toBe(new Date(1792574025470).toISOString())
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

  it('聚合行 lastAt 为 SQLite 整数（BigInt）时不抛错（#127）', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    aggRows = [
      { agentId: 'skill:label-generator', success: 1, n: 2, durSum: 240, lastAt: 1792574025470n },
    ]

    const map = await getUnifiedSkillStats(['label-generator'], '7d')

    expect(map.get('label-generator')).toEqual(
      expect.objectContaining({
        callCount: 2,
        successCount: 2,
        lastCalledAt: new Date(1792574025470),
        source: 'agent_call_logs',
      })
    )
  })

  it('metadata 兜底行 calledAt 为 BigInt 时同样归一（#127）', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    sniffHit = true
    fallbackRows = [
      { agentId: 'path-agent', skillId: 'skill:path-planning', success: 1, durationMs: 500, calledAt: 1792574025470n },
    ]

    const map = await getUnifiedSkillStats(['path-planning'], '7d')

    expect(map.get('path-planning')).toEqual(
      expect.objectContaining({
        callCount: 1,
        successCount: 1,
        lastCalledAt: new Date(1792574025470),
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
        // 输出预算语义修正（2026-09）：声明值即权威，ACTIVE prompt 8000 不再被抬到 131072
        maxTokens: 8000,
        source: 'active-prompt',
      })
    )
    expect(effective.reliability.maxLogicalRetries).toBe(1)
    expect(effective.reliability.logicalRetrySource).toBe('skill-override')
  })

  /* #177：展示用成功率口径剔除上游/基础设施失败与调用方取消（与 executor 同口径）。 */
  it('成功率口径带上游失败剔除条件：prompt groupBy where + agent 聚合 SQL', async () => {
    mockPromptGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    aggRows = []

    await getUnifiedSkillStats(['label-generator'], 'all')

    // prompt_call_logs：where 带 NOT(失败 且 errorCode 属上游码/调用方取消)
    const promptWhere = JSON.stringify(mockPromptGroupBy.mock.calls[0][0].where)
    expect(promptWhere).toContain('RETRY_BUDGET_EXHAUSTED')
    expect(promptWhere).toContain('CALLER_ABORTED')

    // agent_call_logs：前缀聚合 SQL 内联同口径剔除谓词——按 category 判（单一真源），
    // errorCode 分支仅在 errorCategory 为空（skill 层旧行）时回退，避免把 category='protocol'
    // 的真实失败静默化（TRUNCATED_EMPTY_OUTPUT 反复重试 → RETRY_BUDGET_EXHAUSTED）。
    const aggCall = mockAgentQueryRaw.mock.calls.find((c: any) => String(c[0]?.join?.('?')).includes('AS "n"'))
    const aggSql = JSON.stringify(aggCall?.slice(1))
    expect(aggSql).toContain('errorCategory')
    expect(aggSql).toContain('IS NULL')
    expect(aggSql).toContain('provider_http')
    expect(aggSql).toContain('RETRY_BUDGET_EXHAUSTED')
  })

  /* 2026-11-08 试跑页「填入示例输入」：取最近一次成功真实调用的载荷。 */
  describe('getSkillSampleInput', () => {
    it('取第一条可解析、未被瘦身的真实载荷', async () => {
      mockPromptFindMany.mockResolvedValue([
        { userPayload: '{"__slim":true,"bytes":5984,"sha256":"d2f3a8ed"}', createdAt: new Date('2026-11-01') },
        { userPayload: '{"milestone":{"title":"并发基础"}}', createdAt: new Date('2026-10-31') },
      ])

      const sample = await getSkillSampleInput('stage-designer')

      expect(sample?.origin).toBe('real-call')
      expect(JSON.parse(sample!.json)).toEqual({ milestone: { title: '并发基础' } })
      // 查询按 skill 前缀 + 裸 id 两种落库形态一起找，只要成功行
      const where = mockPromptFindMany.mock.calls[0][0].where
      expect(where.agentId.in).toEqual(['skill:stage-designer', 'stage-designer'])
      expect(where.success).toBe(true)
    })

    it('全是瘦身摘要 / 非法 JSON 时返回 null（由前端回落契约骨架）', async () => {
      mockPromptFindMany.mockResolvedValue([
        { userPayload: '{"__slim":true,"bytes":1,"sha256":"x"}', createdAt: new Date() },
        { userPayload: 'not json', createdAt: new Date() },
        { userPayload: '[1,2,3]', createdAt: new Date() },
      ])

      expect(await getSkillSampleInput('stage-designer')).toBeNull()
    })

    it('查询抛错时返回 null，不把便利功能变成新的错误面', async () => {
      mockPromptFindMany.mockRejectedValue(new Error('db down'))
      expect(await getSkillSampleInput('stage-designer')).toBeNull()
    })

    /* 2026-11-09 走查修复：库里存在「演示/探针行」——`seedpcl_*` 把 {"seed":true,"step":N}
       写在 skill:goal-conversation 名下，而该 Skill 的输入契约是 userInput/state/conversationContext。
       此前按「最新一条非瘦身成功行」直接返回，于是「填入示例输入」把仿真参数填进编辑器，
       紧接着点「开始试跑」必然报输入形状错误，真正该用的契约骨架反倒被绕过。 */
    it('载荷键与该 Skill 输入契约一个都不重合 → 跳过，继续找下一条可用的', async () => {
      mockPromptFindMany.mockResolvedValue([
        { userPayload: '{"seed":true,"step":40}', createdAt: new Date('2026-11-08') },
        { userPayload: '{"userInput":"我不想学数学了","state":{"confidence":0.4}}', createdAt: new Date('2026-11-07') },
      ])

      const sample = await getSkillSampleInput('goal-conversation')

      expect(sample?.origin).toBe('real-call')
      expect(JSON.parse(sample!.json)).toEqual({ userInput: '我不想学数学了', state: { confidence: 0.4 } })
    })

    it('只有形状不符的行时返回 null（由前端回落输入契约骨架）', async () => {
      mockPromptFindMany.mockResolvedValue([
        { userPayload: '{"seed":true,"step":87}', createdAt: new Date('2026-11-08') },
        { userPayload: '{"seed":true,"step":29}', createdAt: new Date('2026-11-07') },
      ])

      expect(await getSkillSampleInput('goal-conversation')).toBeNull()
    })

    it('契约读不到（无 core 文件）时不按形状拦：宁可给得不够完美，也不能彻底不给', async () => {
      mockPromptFindMany.mockResolvedValue([
        { userPayload: '{"whatever":1}', createdAt: new Date('2026-11-08') },
      ])

      const sample = await getSkillSampleInput('no-such-skill-xyz')
      expect(JSON.parse(sample!.json)).toEqual({ whatever: 1 })
    })
  })
})
