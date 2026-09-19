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
    expect(route.model).toBe('deepseek-v4-flash')
  })

  it('DB 覆盖（chatModels）优先于代码注册表', async () => {
    platformConfigFindFirst.mockResolvedValue({
      ...BASE_PLATFORM,
      chatModels: JSON.stringify(['agnes-3.0-flash'])
    })
    const route = await new APIRouter().resolve({})
    expect(route.model).toBe('agnes-3.0-flash')
  })

  it('skill 级 model 为别名 light → 展开为 agnes', async () => {
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
    expect(route.model).toBe('agnes-3.0-flash')
  })

  it('tier=reasoning + model 为别名 reasoning → 按能力选 pro', async () => {
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
    expect(route.model).toBe('deepseek-v4-pro')
  })

  it('具体模型 id 不受别名逻辑影响（向后兼容）', async () => {
    platformConfigFindFirst.mockResolvedValue({ ...BASE_PLATFORM, defaultModel: 'deepseek-v4-flash' })
    const route = await new APIRouter().resolve({})
    expect(route.model).toBe('deepseek-v4-flash')
  })
})
