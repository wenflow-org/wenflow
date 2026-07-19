const mockResolveRoute = jest.fn()
const mockExecute = jest.fn()
const mockUpdateMany = jest.fn()

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ resolveRoute: mockResolveRoute }),
  APIExecutor: jest.fn().mockImplementation(() => ({ execute: mockExecute }))
}))

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_api_configs: { updateMany: mockUpdateMany }
  }
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import { AICapabilityHealthService } from '../ai-capability-health.service'

const route = {
  providerType: 'openai-compatible' as const,
  providerId: 'platform',
  endpoint: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  temperature: 0,
  maxTokens: 16,
  privateNetworkPolicy: 'runtime' as const,
  source: 'platform' as const
}

describe('AICapabilityHealthService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveRoute.mockResolvedValue(route)
    mockExecute.mockResolvedValue({
      id: 'probe',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
    })
    mockUpdateMany.mockResolvedValue({ count: 1 })
  })

  it('相同平台路由只执行一次低成本探测并标记 system-canary', async () => {
    const service = new AICapabilityHealthService()

    const snapshot = await service.refresh()

    expect(mockResolveRoute).toHaveBeenCalledTimes(5)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: route.endpoint, model: route.model, timeoutMs: 10_000 }),
      expect.objectContaining({ max_tokens: 4, temperature: 0 }),
      expect.objectContaining({ sourceEntry: 'system-canary', callerAgent: 'system-canary' })
    )
    expect(snapshot.overall).toBe('operational')
    expect(snapshot.capabilities.every(item => item.status === 'operational')).toBe(true)
  })

  it('连续两次失败才不可用，并要求连续两次成功恢复', async () => {
    const service = new AICapabilityHealthService()
    await service.refresh()

    mockExecute.mockRejectedValue(new Error('API request timed out after 10000ms'))
    const firstFailure = await service.refresh()
    const secondFailure = await service.refresh()

    expect(firstFailure.overall).toBe('degraded')
    expect(secondFailure.overall).toBe('unavailable')
    expect(service.isCapabilityAvailable('goal-conversation')).toBe(false)

    mockExecute.mockResolvedValue({
      id: 'probe',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }]
    })
    const firstRecovery = await service.refresh()
    const secondRecovery = await service.refresh()

    expect(firstRecovery.overall).toBe('unavailable')
    expect(secondRecovery.overall).toBe('operational')
    expect(service.isCapabilityAvailable('goal-conversation')).toBe(true)
  })

  it('余额不足的 403 归类为 QUOTA_EXHAUSTED，而不是认证失败', async () => {
    const service = new AICapabilityHealthService()
    mockExecute.mockRejectedValue(new Error('API request failed with status 403: insufficient balance'))

    const snapshot = await service.refresh()

    expect(snapshot.capabilities[0]).toEqual(expect.objectContaining({
      status: 'unknown',
      failureCode: 'QUOTA_EXHAUSTED',
      retryable: false
    }))
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ connectionStatus: 'unknown' })
    }))
  })

  it('路由字段不完整时归类为不可重试的 CONFIG_MISSING', async () => {
    const service = new AICapabilityHealthService()
    mockResolveRoute.mockResolvedValue({ ...route, apiKey: '' })

    const snapshot = await service.refresh()

    expect(mockExecute).not.toHaveBeenCalled()
    expect(snapshot.capabilities[0]).toEqual(expect.objectContaining({
      status: 'unknown',
      failureCode: 'CONFIG_MISSING',
      retryable: false
    }))
  })

  it('单次探测总时长到十秒时主动取消并归类为超时', async () => {
    jest.useFakeTimers()
    try {
      const service = new AICapabilityHealthService()
      mockExecute.mockImplementation((_route, _request, context) => new Promise((_resolve, reject) => {
        context.abortSignal.addEventListener('abort', () => reject(new Error('API request canceled')))
      }))

      const refresh = service.refresh()
      await jest.advanceTimersByTimeAsync(10_000)
      const snapshot = await refresh

      expect(snapshot.capabilities[0]).toEqual(expect.objectContaining({
        status: 'unknown',
        failureCode: 'UPSTREAM_TIMEOUT',
        retryable: true
      }))
    } finally {
      jest.useRealTimers()
    }
  })
})
