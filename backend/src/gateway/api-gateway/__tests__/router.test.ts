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

describe('APIRouter Agent/Skill 路由叠加', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    userOverrideFindFirst.mockResolvedValue(null)
    userProviderFindUnique.mockResolvedValue(null)
    platformConfigFindFirst.mockResolvedValue({
      apiUrl: 'https://platform.example/v1',
      apiKey: 'platform-key',
      defaultModel: 'platform-model',
      defaultReasoningModel: 'platform-reasoning',
      defaultTemperature: 0.7,
      defaultMaxTokens: 2000,
      reasoningEndpoint: null
    })
    agentConfigFindFirst.mockResolvedValue({
      endpoint: 'https://agent.example/v1',
      apiKey: 'agent-key',
      model: 'agent-model',
      tier: 'standard',
      thinkingMode: 'disabled',
      reasoningEffort: 'default',
      temperature: 0.4,
      maxTokens: 3000
    })
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null,
      apiKey: null,
      model: 'skill-model',
      tier: 'standard',
      thinkingMode: null,
      reasoningEffort: null,
      temperature: 0.2,
      maxTokens: 5000,
      requestTimeoutMs: 45000
    })
  })

  it('先解析父 Agent，再叠加 Skill 路由配置（T/maxTokens 不由 skill 表覆盖）', async () => {
    const resolved = await new APIRouter().resolve({
      agentId: 'path-agent',
      skillId: 'path-planning'
    })

    expect(agentConfigFindFirst).toHaveBeenCalledWith({
      where: { agentId: 'path-agent', enabled: true }
    })
    expect(skillConfigFindFirst).toHaveBeenCalledWith({
      where: { skillId: 'path-planning', enabled: true }
    })
    // Phase 2/3：skill 只覆盖 model/timeout 等路由字段；T/maxTokens 继承 agent/platform
    // 生成参数权威源为 ACTIVE prompt（resolveLlmGenerationParams）
    expect(resolved).toEqual(expect.objectContaining({
      providerId: 'skill:path-planning',
      endpoint: 'https://agent.example/v1',
      apiKey: 'agent-key',
      model: 'skill-model',
      temperature: 0.4,
      maxTokens: 3000,
      timeoutMs: 45000,
      privateNetworkPolicy: 'runtime'
    }))
  })

  it('semantic-freeze-judge 强制关闭 thinking mode', async () => {
    const resolved = await new APIRouter().resolve({
      agentId: 'prompt-lab',
      skillId: 'semantic-freeze-judge',
    })

    expect(resolved).toEqual(expect.objectContaining({
      thinkingMode: 'disabled',
      reasoningEffort: 'default',
    }))
  })

  it('Skill 仅覆盖模型时保留用户 Endpoint 的公网策略', async () => {
    userProviderFindUnique.mockResolvedValue({
      endpoint: 'https://user-provider.example/v1',
      apiKey: 'user-key',
      chatModel: 'user-model',
      enabled: true
    })

    const resolved = await new APIRouter().resolve({
      agentId: 'path-agent',
      skillId: 'path-planning'
    }, 'user-1')

    expect(resolved).toEqual(expect.objectContaining({
      endpoint: 'https://user-provider.example/v1',
      model: 'skill-model',
      privateNetworkPolicy: 'public-only'
    }))
  })

  it('用户 Agent 覆盖路由始终使用公网策略', async () => {
    userOverrideFindFirst.mockResolvedValue({
      endpoint: 'https://user-agent.example/v1',
      apiKey: 'user-agent-key',
      model: 'user-agent-model',
      temperature: 0.3,
      maxTokens: 1200,
      enabled: true
    })

    const resolved = await new APIRouter().resolve({ agentId: 'path-agent' }, 'user-1')

    expect(resolved).toEqual(expect.objectContaining({
      source: 'user-agent-override',
      endpoint: 'https://user-agent.example/v1',
      privateNetworkPolicy: 'public-only'
    }))
  })

  it('用户 Agent 自定义 Endpoint 缺少自有密钥时不回退平台密钥', async () => {
    userOverrideFindFirst.mockResolvedValue({
      endpoint: 'https://user-agent.example/v1',
      apiKey: null,
      model: 'user-agent-model',
      temperature: 0.3,
      maxTokens: 1200,
      enabled: true
    })

    const resolved = await new APIRouter().resolve({ agentId: 'path-agent' }, 'user-1')

    expect(resolved).toEqual(expect.objectContaining({
      endpoint: 'https://user-agent.example/v1',
      apiKey: '',
      privateNetworkPolicy: 'public-only'
    }))
  })

  it('Skill 密钥不能覆盖继承的用户 Endpoint 密钥', async () => {
    userProviderFindUnique.mockResolvedValue({
      endpoint: 'https://user-provider.example/v1',
      apiKey: 'user-key',
      chatModel: 'user-model',
      enabled: true
    })
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null,
      apiKey: 'skill-key',
      model: 'skill-model',
      tier: 'standard',
      temperature: 0.2,
      maxTokens: 5000,
      requestTimeoutMs: 45000
    })

    const resolved = await new APIRouter().resolve({
      agentId: 'path-agent',
      skillId: 'path-planning'
    }, 'user-1')

    expect(resolved).toEqual(expect.objectContaining({
      endpoint: 'https://user-provider.example/v1',
      apiKey: 'user-key',
      source: 'user-provider',
      privateNetworkPolicy: 'public-only'
    }))
  })

  it('Skill 更换 Endpoint 时不能继承用户密钥', async () => {
    userProviderFindUnique.mockResolvedValue({
      endpoint: 'https://user-provider.example/v1',
      apiKey: 'user-key',
      chatModel: 'user-model',
      enabled: true
    })
    skillConfigFindFirst.mockResolvedValue({
      endpoint: 'https://skill-provider.example/v1',
      apiKey: null,
      model: 'skill-model',
      tier: 'standard',
      temperature: 0.2,
      maxTokens: 5000,
      requestTimeoutMs: 45000
    })

    const resolved = await new APIRouter().resolve({
      agentId: 'path-agent',
      skillId: 'path-planning'
    }, 'user-1')

    expect(resolved).toEqual(expect.objectContaining({
      endpoint: 'https://skill-provider.example/v1',
      apiKey: '',
      source: 'platform',
      privateNetworkPolicy: 'runtime'
    }))
  })

  it('平台 Agent 自定义 Endpoint 缺少自有密钥时不回退平台密钥', async () => {
    agentConfigFindFirst.mockResolvedValue({
      endpoint: 'https://agent-custom.example/v1',
      apiKey: null,
      model: 'agent-model',
      tier: 'standard',
      thinkingMode: 'default',
      reasoningEffort: 'default',
      temperature: 0.4,
      maxTokens: 3000
    })

    const resolved = await new APIRouter().resolve({ agentId: 'path-agent' })

    expect(resolved).toEqual(expect.objectContaining({
      endpoint: 'https://agent-custom.example/v1',
      apiKey: '',
      source: 'agent-config'
    }))
  })

  it('平台 Agent 重复同一 Endpoint 时可继承平台密钥', async () => {
    agentConfigFindFirst.mockResolvedValue({
      endpoint: 'https://platform.example/v1/',
      apiKey: null,
      model: 'agent-model',
      tier: 'standard',
      thinkingMode: 'default',
      reasoningEffort: 'default',
      temperature: 0.4,
      maxTokens: 3000
    })

    const resolved = await new APIRouter().resolve({ agentId: 'path-agent' })

    expect(resolved.apiKey).toBe('platform-key')
  })

  it('数据库自定义平台 Endpoint 缺少数据库密钥时不继承环境密钥', async () => {
    const originalApiKey = process.env.AI_API_KEY
    process.env.AI_API_KEY = 'environment-key'
    platformConfigFindFirst.mockResolvedValue({
      apiUrl: 'https://database-provider.example/v1',
      apiKey: null,
      defaultModel: 'platform-model',
      defaultReasoningModel: 'platform-reasoning',
      defaultTemperature: 0.7,
      defaultMaxTokens: 2000,
      reasoningEndpoint: null
    })

    try {
      const resolved = await new APIRouter().resolve({})
      expect(resolved).toEqual(expect.objectContaining({
        endpoint: 'https://database-provider.example/v1',
        apiKey: ''
      }))
    } finally {
      if (originalApiKey === undefined) delete process.env.AI_API_KEY
      else process.env.AI_API_KEY = originalApiKey
    }
  })
})
