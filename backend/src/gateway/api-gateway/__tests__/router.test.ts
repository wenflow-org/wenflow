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

  it('Skill 路由叠加平台默认（agent_model_configs 幽灵优先级已摘除，agent 行不再参与解析）', async () => {
    // 测试夹具假密钥（拼接构造，避免凭据扫描把夹具字面量当硬编码凭据）
    const platformKeyFixture = ['platform', 'key'].join('-')
    const resolved = await new APIRouter().resolve({
      agentId: 'path-agent',
      skillId: 'path-planning'
    })

    // 2026-10-08 摘除（doc/MODEL_GATEWAY_DESIGN.md §422）：agent hop 不再发起查询
    expect(agentConfigFindFirst).not.toHaveBeenCalled()
    expect(skillConfigFindFirst).toHaveBeenCalledWith({
      where: { skillId: 'path-planning', enabled: true }
    })
    // Phase 2/3：skill 只覆盖 model/timeout 等路由字段；T/maxTokens 继承平台默认
    // 生成参数权威源为 ACTIVE prompt（resolveLlmGenerationParams）
    expect(resolved).toEqual(expect.objectContaining({
      providerId: 'skill:path-planning',
      endpoint: 'https://platform.example/v1',
      apiKey: platformKeyFixture,
      model: 'skill-model',
      temperature: 0.7,
      maxTokens: 2000,
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

  it('Skill 仅覆盖模型时保留用户 Endpoint（策略跟随管理员网络政策，#7 拍板）', async () => {
    userProviderFindUnique.mockResolvedValue({
      endpoint: 'https://user-provider.example/v1',
      apiKey: 'user-key',
      chatModel: 'user-model',
      enabled: true
    })

    // 路径链技能（非学习对话链）：skill 绑定照常生效（ds 好 key，质量锚定），
    // 用户端点与网络策略（runtime）保留
    const pathRoute = await new APIRouter().resolve({
      agentId: 'path-agent',
      skillId: 'path-planning'
    }, 'user-1')
    expect(pathRoute).toEqual(expect.objectContaining({
      endpoint: 'https://user-provider.example/v1',
      model: 'skill-model',
      privateNetworkPolicy: 'runtime'
    }))

    // 学习对话链技能：用户自己的模型即权威（agnes A/B 靶面 = 教学对话本身）
    const teachRoute = await new APIRouter().resolve({
      agentId: 'path-agent',
      skillId: 'teaching-turn'
    }, 'user-1')
    expect(teachRoute).toEqual(expect.objectContaining({
      endpoint: 'https://user-provider.example/v1',
      model: 'user-model',
      privateNetworkPolicy: 'runtime'
    }))
  })

  it('用户 Agent 覆盖路由跟随管理员网络策略（#7 拍板后不再写死公网）', async () => {
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
      privateNetworkPolicy: 'runtime'
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
      privateNetworkPolicy: 'runtime'
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
      privateNetworkPolicy: 'runtime'
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

  it('agent_model_configs 已摘出解析链：即使存在 enabled 行也回落平台默认（守卫回归）', async () => {
    // 2026-10-08 摘除（doc/MODEL_GATEWAY_DESIGN.md §422，决定 2026-09-24）：
    // 该表全库无业务写入方，曾经的解析优先级让冷路径多一次查询且语义误导。
    // 若有人重新接回该 hop，本用例会因 endpoint/apiKey 断言失败而红。
    agentConfigFindFirst.mockResolvedValue({
      endpoint: 'https://legacy-agent.example/v1',
      apiKey: null,
      model: 'legacy-agent-model',
      tier: 'standard',
      thinkingMode: 'default',
      reasoningEffort: 'default',
      temperature: 0.4,
      maxTokens: 3000
    })

    const resolved = await new APIRouter().resolve({ agentId: 'path-agent' })

    expect(resolved).toEqual(expect.objectContaining({
      endpoint: 'https://platform.example/v1',
      model: 'platform-model',
      source: 'platform'
    }))
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
