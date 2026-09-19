export {}

const platformFindFirst = jest.fn()
const agentPromptsCount = jest.fn()

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_api_configs: { findFirst: platformFindFirst },
    agent_prompts: { count: agentPromptsCount }
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
  })

  it('别名默认来自代码注册表，并给出默认选中项', async () => {
    const overview = await getModelRegistryOverview()
    const chat = overview.aliases.find((item) => item.alias === 'chat')!
    expect(chat.source).toBe('code')
    expect(chat.members).toEqual(['deepseek-v4-flash', 'agnes-3.0-flash'])
    expect(chat.selected).toBe('deepseek-v4-flash')
    expect(chat.selectedWhenRequiringThinking).toBe('deepseek-v4-flash')
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
      chatModels: JSON.stringify(['not-registered', 'deepseek-v4-flash'])
    })
    const overview = await getModelRegistryOverview()
    expect(overview.warnings.some((w) => w.includes('未注册模型'))).toBe(true)
    expect(overview.aliases.find((item) => item.alias === 'chat')!.selected).toBe('deepseek-v4-flash')
  })

  it('平台默认模型为别名时给出解析结果与来源', async () => {
    const overview = await getModelRegistryOverview()
    expect(overview.defaults).toMatchObject({
      defaultModelConfigured: 'chat',
      defaultModelResolved: 'deepseek-v4-flash',
      defaultModelSource: 'alias',
      defaultReasoningModelConfigured: 'reasoning',
      defaultReasoningModelResolved: 'deepseek-v4-pro',
      defaultReasoningModelSource: 'alias'
    })
  })

  it('具体模型 id 的来源标记为 concrete', async () => {
    platformFindFirst.mockResolvedValue({ ...BASE_PLATFORM, defaultModel: 'deepseek-v4-flash' })
    const overview = await getModelRegistryOverview()
    expect(overview.defaults.defaultModelSource).toBe('concrete')
    expect(overview.defaults.defaultModelResolved).toBe('deepseek-v4-flash')
  })

  it('模型清单含能力、限额与降级链', async () => {
    const overview = await getModelRegistryOverview()
    const flash = overview.models.find((model) => model.id === 'deepseek-v4-flash')!
    expect(flash.capabilities).toEqual({ supportsThinking: true, supportsReasoningEffort: true })
    expect(flash.limits.maxOutputTokens).toBe(131072)
    expect(flash.limits.defaultMaxTokens).toBe(32768)
    expect(flash.fallbacks).toEqual(['agnes-3.0-flash'])
    expect(overview.fallbackChains).toEqual([
      { model: 'deepseek-v4-flash', fallbacks: ['agnes-3.0-flash'] },
      { model: 'deepseek-v4-pro', fallbacks: ['deepseek-v4-flash'] }
    ])
  })

  it('暴露当前冷却中的部署', async () => {
    markCoolingDown('platform|https://gw.example/v1|deepseek-v4-pro', 60_000)
    const overview = await getModelRegistryOverview()
    expect(overview.cooldowns).toHaveLength(1)
    expect(overview.cooldowns[0]).toMatchObject({
      providerId: 'platform',
      endpoint: 'https://gw.example/v1',
      model: 'deepseek-v4-pro'
    })
  })

  it('提示废弃的 prompt model 副本数量', async () => {
    agentPromptsCount.mockResolvedValue(30)
    const overview = await getModelRegistryOverview()
    expect(overview.deprecatedPromptModelCount).toBe(30)
    expect(overview.warnings.some((w) => w.includes('30 条 ACTIVE prompt'))).toBe(true)
  })
})
