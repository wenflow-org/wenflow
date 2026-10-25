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
import { markCoolingDown, resetDeploymentHealth } from '../../gateway/api-gateway/deployment-health'

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
    resetDeploymentHealth()
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM })
    agentPromptsCount.mockResolvedValue(0)
    agentCallCount.mockResolvedValue(0)
  })

  it('D12：近 1 小时 429 计数与当前冷却数进入总览', async () => {
    agentCallCount.mockResolvedValue(7)
    markCoolingDown('deepseek::https://api.example.com/v1::deepseek-v4.1-flash', 60_000)
    const overview = await getModelRegistryOverview()
    expect(agentCallCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ statusCode: 429 })
    }))
    expect(overview.rateLimit).toEqual({ windowMinutes: 60, count429: 7, coolingDown: 1 })
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
      defaultModelSource: 'alias',
      defaultReasoningModelConfigured: 'reasoning',
      defaultReasoningModelResolved: 'deepseek-v4.1-flash',
      defaultReasoningModelSource: 'alias'
    })
  })

  it('具体模型 id 的来源标记为 concrete', async () => {
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM, defaultModel: 'deepseek-v4.1-flash' })
    const overview = await getModelRegistryOverview()
    expect(overview.defaults.defaultModelSource).toBe('concrete')
    expect(overview.defaults.defaultModelResolved).toBe('deepseek-v4.1-flash')
  })

  /* 2026-10-24：平台没配默认时运行时落到 env，界面必须说清来源，不能只显示「未配置」。 */
  it('runtimeDefaults 区分界面配置 / env 兜底 / 未配置', async () => {
    const ui = await getModelRegistryOverview()
    expect(ui.runtimeDefaults).toMatchObject({ source: 'ui', model: 'deepseek-v4.1-flash' })

    const prevModel = process.env.AI_MODEL
    const prevReasoning = process.env.AI_MODEL_REASONING
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM, defaultModel: null, defaultReasoningModel: null })
    process.env.AI_MODEL = 'agnes-3.0-flash'
    process.env.AI_MODEL_REASONING = 'agnes-3.0-flash'
    try {
      const fromEnv = await getModelRegistryOverview()
      expect(fromEnv.runtimeDefaults).toEqual({
        model: 'agnes-3.0-flash',
        source: 'env',
        reasoningModel: 'agnes-3.0-flash',
        reasoningSource: 'env'
      })
      delete process.env.AI_MODEL
      delete process.env.AI_MODEL_REASONING
      const none = await getModelRegistryOverview()
      expect(none.runtimeDefaults).toEqual({ model: null, source: 'none', reasoningModel: null, reasoningSource: 'none' })
    } finally {
      if (prevModel === undefined) delete process.env.AI_MODEL
      else process.env.AI_MODEL = prevModel
      if (prevReasoning === undefined) delete process.env.AI_MODEL_REASONING
      else process.env.AI_MODEL_REASONING = prevReasoning
    }
  })

  it('模型清单含能力、限额与降级链', async () => {
    const overview = await getModelRegistryOverview()
    const main = overview.models.find((model) => model.id === 'deepseek-v4.1-flash')!
    expect(main.capabilities).toEqual({ supportsThinking: true, supportsReasoningEffort: true })
    expect(main.limits.maxOutputTokens).toBe(131072)
    expect(main.limits.defaultMaxTokens).toBe(32768)
    expect(main.fallbacks).toEqual([])
    // 2026-10-18 上游下线 V4/V4-Pro 后平台目录不再声明模型级 fallbacks；有效链为空
    expect(overview.fallbackChains).toEqual([])
    expect(overview.runtime).toEqual({ maxModelCandidates: 3, fallbackSwapsModelOnly: true })
  })

  it('暴露当前冷却中的部署', async () => {
    markCoolingDown('platform|https://gw.example/v1|deepseek-v4.1-flash', 60_000)
    const overview = await getModelRegistryOverview()
    expect(overview.cooldowns).toHaveLength(1)
    expect(overview.cooldowns[0]).toMatchObject({
      providerId: 'platform',
      endpoint: 'https://gw.example/v1',
      model: 'deepseek-v4.1-flash'
    })
  })

  it('提示废弃的 prompt model 副本数量', async () => {
    agentPromptsCount.mockResolvedValue(30)
    const overview = await getModelRegistryOverview()
    expect(overview.deprecatedPromptModelCount).toBe(30)
    expect(overview.warnings.some((w) => w.includes('30 条 ACTIVE prompt'))).toBe(true)
  })
})
