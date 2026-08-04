import { createHash } from 'crypto'
import { APIGateway } from '../index'
import { runWithContext } from '../context'
import { createRetryBudget } from '../retry-budget'

function route(apiKey = 'secret') {
  return {
    providerType: 'openai-compatible' as const,
    providerId: 'provider-1',
    endpoint: 'https://current.example/v1',
    apiKey,
    model: 'current-model',
    thinkingMode: 'default' as const,
    reasoningEffort: 'default' as const,
    temperature: 0.7,
    maxTokens: 1000,
    timeoutMs: 60000,
    privateNetworkPolicy: 'runtime' as const,
    source: 'platform' as const
  }
}

describe('APIGateway route overrides', () => {
  it('保留当前凭证并应用冻结的 endpoint 与 model', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(route()), setRoute: jest.fn() }
    gateway.executor = { execute: jest.fn().mockResolvedValue({ id: 'ok' }) }
    const fingerprint = createHash('sha256').update(JSON.stringify('secret')).digest('hex')

    await runWithContext({
      promptRuntimeOverride: { routeOverride: {
        expectedProviderId: 'provider-1',
        expectedCredentialFingerprint: fingerprint,
        endpoint: 'https://frozen.example/v1',
        model: 'frozen-model',
        timeoutMs: 12345
      } }
    }, () => gateway.execute({ messages: [] }, { skillId: 'skill-1' }))

    expect(gateway.executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'secret',
      providerId: 'provider-1',
      endpoint: 'https://frozen.example/v1',
      model: 'frozen-model',
      timeoutMs: 12345,
      timeoutSource: 'route-override',
      privateNetworkPolicy: 'public-only'
    }), { messages: [] }, expect.anything())
  })

  it('可信快照可显式保留平台 Endpoint 的运行时私网策略', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(route()), setRoute: jest.fn() }
    gateway.executor = { execute: jest.fn().mockResolvedValue({ id: 'ok' }) }

    await runWithContext({
      promptRuntimeOverride: { routeOverride: {
        endpoint: 'https://frozen.example/v1',
        privateNetworkPolicy: 'runtime'
      } }
    }, () => gateway.execute({ messages: [] }, { skillId: 'skill-1' }))

    expect(gateway.executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://frozen.example/v1',
      privateNetworkPolicy: 'runtime'
    }), { messages: [] }, expect.anything())
  })

  it('快照不能放宽用户 Endpoint 的公网策略', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = {
      getRoute: jest.fn().mockReturnValue({ ...route(), privateNetworkPolicy: 'public-only' }),
      setRoute: jest.fn()
    }
    gateway.executor = { execute: jest.fn().mockResolvedValue({ id: 'ok' }) }

    await runWithContext({
      promptRuntimeOverride: { routeOverride: { privateNetworkPolicy: 'runtime' } }
    }, () => gateway.execute({ messages: [] }, { skillId: 'skill-1' }))

    expect(gateway.executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      privateNetworkPolicy: 'public-only'
    }), { messages: [] }, expect.anything())
  })

  it('Provider 或凭证漂移时拒绝静默切换', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(route('changed-secret')), setRoute: jest.fn() }
    gateway.executor = { execute: jest.fn() }
    const fingerprint = createHash('sha256').update(JSON.stringify('secret')).digest('hex')

    await expect(runWithContext({
      promptRuntimeOverride: { routeOverride: {
        expectedProviderId: 'provider-1',
        expectedCredentialFingerprint: fingerprint
      } }
    }, () => gateway.execute({ messages: [] }, { skillId: 'skill-1' }))).rejects.toThrow('API route credentials changed')
    expect(gateway.executor.execute).not.toHaveBeenCalled()
  })

  it('忽略调用方直接放入 ExecutionContext 的 routeOverride', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(route()), setRoute: jest.fn() }
    gateway.executor = { execute: jest.fn().mockResolvedValue({ id: 'ok' }) }

    await gateway.execute({ messages: [] }, { skillId: 'skill-1' }, {
      routeOverride: {
        endpoint: 'https://attacker.example/v1',
        model: 'attacker-model'
      }
    } as any)

    expect(gateway.executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://current.example/v1',
      model: 'current-model'
    }), { messages: [] }, expect.anything())
  })

  it('将旧 skill:* caller 归一为父 Agent 与 Skill 双身份', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(null), setRoute: jest.fn() }
    gateway.router = { resolve: jest.fn().mockResolvedValue(route()) }
    gateway.executor = { execute: jest.fn().mockResolvedValue({ id: 'ok' }) }

    await runWithContext({ userId: 'user-1' }, () => gateway.execute(
      { messages: [] },
      { agentId: 'skill:path-planning' }
    ))

    expect(gateway.router.resolve).toHaveBeenCalledWith({
      agentId: 'path-agent',
      skillId: 'path-planning',
      userId: 'user-1'
    }, 'user-1')
  })

  it('显式上下文未提供预算时继承当前请求的重试预算', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(route()), setRoute: jest.fn() }
    gateway.executor = { execute: jest.fn().mockResolvedValue({ id: 'ok' }) }
    const retryBudget = createRetryBudget()

    await runWithContext({ retryBudget }, () => gateway.execute(
      { messages: [] },
      { skillId: 'skill-1' },
      { requestPath: '/test', retryBudget: undefined }
    ))

    expect(gateway.executor.execute).toHaveBeenCalledWith(
      expect.anything(),
      { messages: [] },
      expect.objectContaining({ retryBudget })
    )
  })

  it('从 Context Envelope 继承 session 与 locale telemetry', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(route()), setRoute: jest.fn() }
    gateway.executor = { execute: jest.fn().mockResolvedValue({ id: 'ok' }) }

    await runWithContext({
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        session: { sessionId: 'session-1', conversationId: 'conversation-1', pathId: 'path-1', taskId: 'task-1' },
        locale: { language: 'zh-CN', timeZone: 'Asia/Shanghai' }
      }
    }, () => gateway.execute({ messages: [] }, { skillId: 'skill-1' }))

    expect(gateway.executor.execute).toHaveBeenCalledWith(
      expect.anything(),
      { messages: [] },
      expect.objectContaining({
        sessionId: 'session-1',
        conversationId: 'conversation-1',
        pathId: 'path-1',
        taskId: 'task-1',
        locale: { language: 'zh-CN', timeZone: 'Asia/Shanghai' }
      })
    )
  })

  it('resolveRoute 与 execute 使用相同的父 Agent 归一化', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(null), setRoute: jest.fn() }
    gateway.router = { resolve: jest.fn().mockResolvedValue(route()) }

    await gateway.resolveRoute({ skillId: 'path-planning' }, 'user-1')

    expect(gateway.router.resolve).toHaveBeenCalledWith({
      agentId: 'path-agent',
      skillId: 'path-planning',
      userId: 'user-1'
    }, 'user-1')
  })

  it('显式 Agent 调用不继承环境中的无关 Skill', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(null), setRoute: jest.fn() }
    gateway.router = { resolve: jest.fn().mockResolvedValue(route()) }

    await runWithContext({ skillId: 'path-planning' }, () =>
      gateway.resolveRoute({ agentId: 'goal-agent' }, 'user-1'))

    expect(gateway.router.resolve).toHaveBeenCalledWith({
      agentId: 'goal-agent',
      skillId: undefined,
      userId: 'user-1'
    }, 'user-1')
  })

  it('resolveRoute 未显式传 userId 时不继承环境用户', async () => {
    const gateway = new APIGateway() as any
    gateway.cache = { getRoute: jest.fn().mockReturnValue(null), setRoute: jest.fn() }
    gateway.router = { resolve: jest.fn().mockResolvedValue(route()) }

    await runWithContext({ userId: 'ambient-user' }, () =>
      gateway.resolveRoute({ skillId: 'path-planning' }))

    expect(gateway.router.resolve).toHaveBeenCalledWith({
      agentId: 'path-agent',
      skillId: 'path-planning',
      userId: undefined
    }, undefined)
  })
})
