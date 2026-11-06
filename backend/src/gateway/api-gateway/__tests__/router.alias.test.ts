export {}

const userOverrideFindFirst = jest.fn()
const userProviderFindUnique = jest.fn()
const agentConfigFindFirst = jest.fn()
const skillConfigFindFirst = jest.fn()
const platformConfigFindFirst = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    user_agent_model_configs: { findFirst: userOverrideFindFirst },
    user_api_configs: { findUnique: userProviderFindUnique }
  }
}))

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_model_configs: { findFirst: agentConfigFindFirst },
    skill_model_configs: { findFirst: skillConfigFindFirst },
    platform_api_configs: { findFirst: platformConfigFindFirst }
  }
}))

jest.mock('../../../utils/logger', () => ({
  logger: { error: jest.fn() }
}))

import { APIRouter } from '../router'

const BASE_PLATFORM = {
  apiUrl: 'https://platform.example/v1',
  apiKey: 'platform-key',
  defaultModel: 'chat',
  defaultReasoningModel: 'reasoning',
  defaultTemperature: 0.7,
  defaultMaxTokens: 2000,
  reasoningEndpoint: null,
  chatModels: null,
  reasoningModels: null,
  lightModels: null
}

describe('APIRouter 逻辑别名解析（chat / reasoning / light）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    userOverrideFindFirst.mockResolvedValue(null)
    userProviderFindUnique.mockResolvedValue(null)
    agentConfigFindFirst.mockResolvedValue(null)
    skillConfigFindFirst.mockResolvedValue(null)
    platformConfigFindFirst.mockResolvedValue({ ...BASE_PLATFORM })
  })

  it('平台 defaultModel 为别名 chat → 展开为第一位部署', async () => {
    const route = await new APIRouter().resolve({})
    expect(route.model).toBe('deepseek-v4.1-flash')
  })

  it('DB 覆盖（chatModels）优先于代码注册表', async () => {
    platformConfigFindFirst.mockResolvedValue({
      ...BASE_PLATFORM,
      chatModels: JSON.stringify(['agnes-2.5-flash'])
    })
    const route = await new APIRouter().resolve({})
    expect(route.model).toBe('agnes-2.5-flash')
  })

  it('skill 级 model 为别名 light → 展开为 agnes', async () => {
    // 夹具改用注册表内 enabled 的模型：agnes-3.0-flash 只在停用的示例 provider 里。
    platformConfigFindFirst.mockResolvedValue({
      ...BASE_PLATFORM,
      lightModels: JSON.stringify(['agnes-2.5-flash'])
    })
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null,
      apiKey: null,
      model: 'light',
      tier: 'chat',
      thinkingMode: null,
      reasoningEffort: null,
      temperature: 0.2,
      maxTokens: 5000,
      requestTimeoutMs: 45000
    })
    const route = await new APIRouter().resolve({ skillId: 'some-skill' })
    expect(route.model).toBe('agnes-2.5-flash')
  })

  it('tier=reasoning + model 为别名 reasoning → 按能力选支持思考的 v4.1-flash', async () => {
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null,
      apiKey: null,
      model: 'reasoning',
      tier: 'reasoning',
      thinkingMode: null,
      reasoningEffort: null,
      temperature: 0.2,
      maxTokens: 5000,
      requestTimeoutMs: 45000
    })
    const route = await new APIRouter().resolve({ skillId: 'reasoning-skill' })
    expect(route.model).toBe('deepseek-v4.1-flash')
  })

  it('具体模型 id 不受别名逻辑影响（向后兼容）', async () => {
    platformConfigFindFirst.mockResolvedValue({ ...BASE_PLATFORM, defaultModel: 'deepseek-v4.1-flash' })
    const route = await new APIRouter().resolve({})
    expect(route.model).toBe('deepseek-v4.1-flash')
  })

  /* 2026-10-24：推理档此前只在技能自己写了模型时生效；未写模型退回平台默认。
     2026-11-04 用户「为什么还在区分默认推理和对话，没有这个了。所谓的推理，是取决于使用者
     开启的思考强度」：平台不再有「默认推理模型」，档位不再影响模型选择——
     tier=reasoning 且未配模型时和别的档一样沿用基础路由（即平台那一个默认）。 */
  it('tier=reasoning 且未配模型 → 沿用平台默认（档位不再换模型）', async () => {
    platformConfigFindFirst.mockResolvedValue({
      ...BASE_PLATFORM,
      defaultModel: 'deepseek-v4.1-flash',
      // 库里可能还留着历史值，但后端已不再读它（这一行就是来钉住「读了也不算数」）
      defaultReasoningModel: 'agnes-3.0-flash'
    })
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null,
      apiKey: null,
      model: null,
      tier: 'reasoning',
      thinkingMode: null,
      reasoningEffort: null,
      requestTimeoutMs: null
    })
    const route = await new APIRouter().resolve({ skillId: 'reasoning-skill' })
    expect(route.model).toBe('deepseek-v4.1-flash')
    expect(route.modelExplicit).toBe(false)
  })

  it('tier=chat 且未配模型 → 仍走平台对话默认', async () => {
    platformConfigFindFirst.mockResolvedValue({
      ...BASE_PLATFORM,
      defaultModel: 'agnes-3.0-flash',
      defaultReasoningModel: 'deepseek-v4.1-flash'
    })
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null,
      apiKey: null,
      model: null,
      tier: 'chat',
      thinkingMode: null,
      reasoningEffort: null,
      requestTimeoutMs: null
    })
    const route = await new APIRouter().resolve({ skillId: 'chat-skill' })
    expect(route.model).toBe('agnes-3.0-flash')
  })

  it('平台没配推理默认 → 推理档沿用基础路由，不凭空改模型', async () => {
    platformConfigFindFirst.mockResolvedValue({
      ...BASE_PLATFORM,
      defaultModel: 'agnes-3.0-flash',
      defaultReasoningModel: null
    })
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null,
      apiKey: null,
      model: null,
      tier: 'reasoning',
      thinkingMode: null,
      reasoningEffort: null,
      requestTimeoutMs: null
    })
    const route = await new APIRouter().resolve({ skillId: 'reasoning-skill' })
    expect(route.model).toBe('agnes-3.0-flash')
  })
})
