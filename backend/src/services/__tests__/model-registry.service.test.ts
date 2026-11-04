export {}

const platformFindFirst = jest.fn()
const agentPromptsCount = jest.fn()
const agentCallCount = jest.fn()

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_api_configs: { findFirst: platformFindFirst },
    agent_prompts: { count: agentPromptsCount },
    agent_call_logs: { count: agentCallCount }
  }
}))

import { getModelRegistryOverview } from '../model-registry.service'

const BASE_PLATFORM = {
  id: 'platform',
  defaultModel: 'chat',
  defaultReasoningModel: 'reasoning',
  chatModels: null,
  reasoningModels: null,
  lightModels: null
}

describe('model-registry.service（只读总览）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM })
    agentPromptsCount.mockResolvedValue(0)
    agentCallCount.mockResolvedValue(0)
  })

  /* 2026-11-04 用户「去掉降级这个功能，不要」：冷却注册表只服务换模型降级，
     随降级一起下线；429 计数是调用日志的事实，留在总览里。 */
  it('D12：近 1 小时 429 计数进入总览（冷却数已随降级下线）', async () => {
    agentCallCount.mockResolvedValue(7)
    const overview = await getModelRegistryOverview()
    expect(agentCallCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ statusCode: 429 })
    }))
    expect(overview.rateLimit).toEqual({ windowMinutes: 60, count429: 7 })
  })

  it('别名默认来自代码注册表，并给出默认选中项', async () => {
    const overview = await getModelRegistryOverview()
    const chat = overview.aliases.find((item) => item.alias === 'chat')!
    expect(chat.source).toBe('code')
    expect(chat.members).toEqual(['deepseek-v4.1-flash', 'agnes-3.0-flash'])
    expect(chat.selected).toBe('deepseek-v4.1-flash')
    expect(chat.selectedWhenRequiringThinking).toBe('deepseek-v4.1-flash')
    expect(chat.degradedWhenRequiringThinking).toBe(false)
  })

  it('light 别名在 requireThinking 下标记降级（agnes 不支持思考）', async () => {
    const overview = await getModelRegistryOverview()
    const light = overview.aliases.find((item) => item.alias === 'light')!
    expect(light.selectedWhenRequiringThinking).toBe('agnes-3.0-flash')
    expect(light.degradedWhenRequiringThinking).toBe(true)
  })

  it('DB 覆盖优先，并暴露 dbMembers', async () => {
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM, chatModels: JSON.stringify(['agnes-3.0-flash']) })
    const overview = await getModelRegistryOverview()
    const chat = overview.aliases.find((item) => item.alias === 'chat')!
    expect(chat.source).toBe('db-override')
    expect(chat.dbMembers).toEqual(['agnes-3.0-flash'])
    expect(chat.selected).toBe('agnes-3.0-flash')
  })

  it('DB 覆盖含未注册模型时给出告警且被忽略', async () => {
    platformFindFirst.mockResolvedValue({
      ...BASE_PLATFORM,
      chatModels: JSON.stringify(['not-registered', 'deepseek-v4.1-flash'])
    })
    const overview = await getModelRegistryOverview()
    expect(overview.warnings.some((w) => w.includes('未注册模型'))).toBe(true)
    expect(overview.aliases.find((item) => item.alias === 'chat')!.selected).toBe('deepseek-v4.1-flash')
  })

  it('平台默认模型为别名时给出解析结果与来源', async () => {
    const overview = await getModelRegistryOverview()
    expect(overview.defaults).toMatchObject({
      defaultModelConfigured: 'chat',
      defaultModelResolved: 'deepseek-v4.1-flash',
      defaultModelSource: 'alias'
    })
    // 2026-11-04：平台不再有「默认推理模型」，总览也不再出这一档读数
    expect(overview.defaults).not.toHaveProperty('defaultReasoningModelResolved')
  })

  it('具体模型 id 的来源标记为 concrete', async () => {
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM, defaultModel: 'deepseek-v4.1-flash' })
    const overview = await getModelRegistryOverview()
    expect(overview.defaults.defaultModelSource).toBe('concrete')
    expect(overview.defaults.defaultModelResolved).toBe('deepseek-v4.1-flash')
  })

  /* 2026-10-24：平台没配默认时运行时落到 env，界面必须说清来源，不能只显示「未配置」。
     2026-11-04：只剩一个默认模型（默认推理模型已撤，AI_MODEL_REASONING 不再被读）。 */
  it('runtimeDefaults 区分界面配置 / env 兜底 / 未配置', async () => {
    const ui = await getModelRegistryOverview()
    expect(ui.runtimeDefaults).toMatchObject({ source: 'ui', model: 'deepseek-v4.1-flash' })

    const prevModel = process.env.AI_MODEL
    const prevReasoning = process.env.AI_MODEL_REASONING
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM, defaultModel: null, defaultReasoningModel: null })
    process.env.AI_MODEL = 'agnes-3.0-flash'
    // 历史环境变量留着也不算数——它已不是任何一档的来源
    process.env.AI_MODEL_REASONING = 'deepseek-v4.1-flash'
    try {
      const fromEnv = await getModelRegistryOverview()
      expect(fromEnv.runtimeDefaults).toEqual({ model: 'agnes-3.0-flash', source: 'env' })
      delete process.env.AI_MODEL
      delete process.env.AI_MODEL_REASONING
      const none = await getModelRegistryOverview()
      expect(none.runtimeDefaults).toEqual({ model: null, source: 'none' })
    } finally {
      if (prevModel === undefined) delete process.env.AI_MODEL
      else process.env.AI_MODEL = prevModel
      if (prevReasoning === undefined) delete process.env.AI_MODEL_REASONING
      else process.env.AI_MODEL_REASONING = prevReasoning
    }
  })

  it('模型清单含能力与限额（不再有降级链字段）', async () => {
    const overview = await getModelRegistryOverview()
    const main = overview.models.find((model) => model.id === 'deepseek-v4.1-flash')!
    expect(main.capabilities).toEqual({ supportsThinking: true, supportsReasoningEffort: true })
    expect(main.limits.maxOutputTokens).toBe(131072)
    expect(main.limits.defaultMaxTokens).toBe(32768)
    // 降级功能整个下线（2026-11-04）：总览里不再有模型级 / 运行时级兜底链字段
    expect(main).not.toHaveProperty('fallbacks')
    expect(overview).not.toHaveProperty('fallbackChains')
    expect(overview).not.toHaveProperty('runtime')
    expect(overview).not.toHaveProperty('cooldowns')
  })

  it('提示废弃的 prompt model 副本数量', async () => {
    agentPromptsCount.mockResolvedValue(30)
    const overview = await getModelRegistryOverview()
    expect(overview.deprecatedPromptModelCount).toBe(30)
    expect(overview.warnings.some((w) => w.includes('30 条 ACTIVE prompt'))).toBe(true)
  })
})
