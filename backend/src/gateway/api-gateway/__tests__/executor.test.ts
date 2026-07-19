process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-thirty-two-characters'

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: { create: jest.fn() }
  }
}))

jest.mock('../../../services/agentRequestTimeout.service', () => ({
  getDefaultAIRequestTimeoutMs: () => 5000
}))

jest.mock('../../../config/models.config', () => ({
  supportsThinkingMode: () => false
}))

jest.mock('../../../utils/safe-http', () => ({
  safeHttpRequest: jest.fn(),
  UnsafeUrlError: class UnsafeUrlError extends Error {}
}))

import { APIExecutor } from '../executor'
import type { ResolvedRoute } from '../types'
import { logger } from '../../../utils/logger'
import { safeHttpRequest } from '../../../utils/safe-http'

const safeHttpRequestMock = safeHttpRequest as jest.Mock

const route: ResolvedRoute = {
  providerType: 'openai-compatible',
  providerId: 'test-provider',
  endpoint: 'https://example.com',
  apiKey: 'test-key',
  model: 'test-model',
  temperature: 0.2,
  maxTokens: 128,
  privateNetworkPolicy: 'runtime',
  source: 'platform'
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    url: 'https://example.com/v1/chat/completions',
    headers: { 'content-type': 'application/json' },
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    data: JSON.stringify(body)
  } as any
}

describe('APIExecutor retry attempts', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    safeHttpRequestMock.mockReset()
  })

  it('第一次 503 后重试一次并成功', async () => {
    safeHttpRequestMock
      .mockResolvedValueOnce(jsonResponse(503, { error: 'temporary unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        id: 'completion-1',
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      }))
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-retry-success' }
    )

    expect(response.choices[0].message.content).toBe('ok')
    expect(safeHttpRequestMock).toHaveBeenCalledTimes(2)
  })

  it('认证失败不重试', async () => {
    safeHttpRequestMock.mockResolvedValue(
      jsonResponse(401, { error: 'invalid api key' })
    )
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => logger)

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-no-retry' }
    )).rejects.toThrow('status 401')

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1)
    expect(errorLog).toHaveBeenCalledWith(
      '[api-gateway] execution failed',
      expect.objectContaining({ attempts: 1, success: false })
    )
  })

  it('临时 429 rate limit 会重试', async () => {
    safeHttpRequestMock
      .mockResolvedValueOnce(jsonResponse(429, { error: 'rate limit exceeded' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        id: 'completion-after-rate-limit',
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      }))
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-rate-limit' }
    )

    expect(response.choices[0].message.content).toBe('ok')
    expect(safeHttpRequestMock).toHaveBeenCalledTimes(2)
  })

  it('429 quota exhaustion 不重试', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(429, { error: 'quota exceeded today' }))
    const delay = jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-quota' }
    )).rejects.toThrow('status 429')

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1)
    expect(delay).not.toHaveBeenCalled()
  })

  it('阻止数据库密文进入 Authorization', async () => {
    const encryptedRoute = { ...route, apiKey: 'wfsec:v1:v1:iv:cipher:tag' }
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    await expect(new APIExecutor().execute(
      encryptedRoute,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-encrypted-secret' }
    )).rejects.toThrow('已阻止发送数据库密文')

    expect(safeHttpRequestMock).not.toHaveBeenCalled()
  })

  it('向用户 Endpoint 传递公网策略和请求取消信号', async () => {
    const controller = new AbortController()
    safeHttpRequestMock.mockResolvedValue(jsonResponse(200, {
      id: 'completion-user-provider',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    }))

    await new APIExecutor().execute(
      { ...route, source: 'user-provider', privateNetworkPolicy: 'public-only' },
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-user-provider', abortSignal: controller.signal }
    )

    expect(safeHttpRequestMock).toHaveBeenCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({
        privateNetworkPolicy: 'public-only',
        signal: controller.signal
      })
    )
  })

  it('客户端取消后不重试', async () => {
    safeHttpRequestMock.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' }))
    const delay = jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-canceled', abortSignal: new AbortController().signal }
    )).rejects.toThrow('API request canceled')

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1)
    expect(delay).not.toHaveBeenCalled()
  })

  it('识别 safe-http 的 ETIMEDOUT 并按超时重试', async () => {
    safeHttpRequestMock.mockRejectedValue(Object.assign(new Error('HTTP 请求超时'), { code: 'ETIMEDOUT' }))
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-safe-http-timeout' }
    )).rejects.toThrow('API request timed out after 5000ms')

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(2)
  })

  it('重试等待期间取消时不发起第二次请求', async () => {
    const controller = new AbortController()
    safeHttpRequestMock.mockResolvedValue(jsonResponse(503, { error: 'temporary unavailable' }))
    const execution = new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-cancel-backoff', abortSignal: controller.signal }
    )
    setTimeout(() => controller.abort(), 0)

    await expect(execution).rejects.toThrow('API request canceled')
    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1)
  })
})
