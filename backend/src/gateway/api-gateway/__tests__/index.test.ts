import { createHash } from 'crypto'
import { APIGateway } from '../index'
import { runWithContext } from '../context'

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
      timeoutMs: 12345
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
})
