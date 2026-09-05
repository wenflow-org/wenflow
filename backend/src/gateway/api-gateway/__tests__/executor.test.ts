process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-thirty-two-characters'

const agentLogCreate = jest.fn()
const attemptCreate = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: { create: agentLogCreate },
    llm_execution_attempts: { create: attemptCreate }
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
  safeHttpStreamRequest: jest.fn(),
  UnsafeUrlError: class UnsafeUrlError extends Error {},
  SafeHttpBodyLimitError: class SafeHttpBodyLimitError extends Error {}
}))

import { APIExecutor } from '../executor'
import type { ResolvedRoute } from '../types'
import type { RetryBudget } from '../retry-budget'
import { createRetryBudget } from '../retry-budget'
import { logger } from '../../../utils/logger'
import { safeHttpRequest, safeHttpStreamRequest } from '../../../utils/safe-http'

const safeHttpRequestMock = safeHttpRequest as jest.Mock
const streamRequestMock = safeHttpStreamRequest as jest.Mock

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

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    url: 'https://example.com/v1/chat/completions',
    headers: { 'content-type': 'application/json', ...headers },
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    data: JSON.stringify(body)
  } as any
}

describe('APIExecutor retry attempts', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    safeHttpRequestMock.mockReset()
    agentLogCreate.mockReset().mockResolvedValue({})
    attemptCreate.mockReset().mockResolvedValue({})
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
    expect(attemptCreate).toHaveBeenCalledTimes(2)
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      transportAttemptNo: 1,
      success: false,
      retryable: true,
      willRetry: true,
      statusCode: 503,
      errorCategory: 'provider_http'
    }))
    expect(attemptCreate.mock.calls[1][0].data).toEqual(expect.objectContaining({
      transportAttemptNo: 2,
      success: true,
      statusCode: 200
    }))
  })

  it('按执行预算允许两次 Transport Retry', async () => {
    safeHttpRequestMock
      .mockResolvedValueOnce(jsonResponse(503, { error: 'temporary unavailable' }))
      .mockResolvedValueOnce(jsonResponse(503, { error: 'temporary unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        id: 'completion-third-attempt',
        model: 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
      }))
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    const budget: RetryBudget = {
      id: 'rb-three-attempts',
      limits: { maxUpstreamAttempts: 3, maxTransportRetries: 2, maxLogicalRetries: 0 },
      used: { upstreamAttempts: 0, transportRetries: 0, logicalRetries: 0 },
      policy: {
        defaultRequestTimeoutMs: 120000,
        retryBaseDelayMs: 500,
        maxRetryAfterMs: 5000,
        jitterEnabled: false
      }
    }

    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-three-attempts', retryBudget: budget }
    )

    expect(response.choices[0].message.content).toBe('ok')
    expect(safeHttpRequestMock).toHaveBeenCalledTimes(3)
    expect(budget.used.transportRetries).toBe(2)
    expect(attemptCreate.mock.calls.at(-1)[0].data.maxAttempts).toBe(3)
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
    expect(attemptCreate).toHaveBeenCalledTimes(1)
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      retryable: false,
      willRetry: false,
      errorCategory: 'authentication',
      errorCode: 'AUTH_INVALID'
    }))
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
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      errorCategory: 'quota',
      errorCode: 'QUOTA_EXHAUSTED'
    }))
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
    expect(attemptCreate).not.toHaveBeenCalled()
  })

  it('总 Provider 请求预算耗尽后不再发起网络重试', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(503, { error: 'temporary unavailable' }))
    const budget: RetryBudget = {
      id: 'rb-limited',
      limits: { maxUpstreamAttempts: 1, maxTransportRetries: 1, maxLogicalRetries: 1 },
      used: { upstreamAttempts: 0, transportRetries: 0, logicalRetries: 0 },
      policy: {
        defaultRequestTimeoutMs: 300_000,
        retryBaseDelayMs: 1_000,
        maxRetryAfterMs: 10_000,
        jitterEnabled: true
      }
    }

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-budget', retryBudget: budget }
    )).rejects.toMatchObject({ code: 'RETRY_BUDGET_EXHAUSTED' })

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1)
    expect(budget.used.upstreamAttempts).toBe(1)
    expect(budget.exhaustedBy).toBe('upstream-attempts')
  })

  it('HTTP 200 缺少 Chat Completion 结构时记录协议失败', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(200, { error: { message: 'upstream failure' } }))

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-invalid-envelope' }
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SCHEMA' })

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1)
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      success: false,
      errorCategory: 'protocol',
      errorCode: 'INVALID_RESPONSE_SCHEMA'
    }))
    expect(agentLogCreate.mock.calls.at(-1)[0].data).toEqual(expect.objectContaining({
      success: false,
      errorCode: 'INVALID_RESPONSE_SCHEMA'
    }))
  })

  it('HTTP 200 返回空 content 时记录协议失败', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(200, {
      id: 'completion-empty',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '   ' }, finish_reason: 'stop' }]
    }))

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-empty-content' }
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE_SCHEMA' })

    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      success: false,
      errorCode: 'INVALID_RESPONSE_SCHEMA'
    }))
  })

  it('兼容 data.choices 包装的合法响应', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(200, {
      model: 'top-level-model',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      data: {
        id: 'completion-wrapped',
        choices: [{ index: 0, message: { role: 'assistant', content: 'wrapped ok' }, finish_reason: 'stop' }]
      }
    }))

    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-wrapped-response' }
    )

    expect(response.id).toBe('completion-wrapped')
    expect(response.model).toBe('top-level-model')
    expect(response.usage?.total_tokens).toBe(15)
    expect(response.choices[0].message.content).toBe('wrapped ok')
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      responseModel: 'top-level-model',
      totalTokens: 15
    }))
  })

  it('Attempt 遥测写入失败时在 Gateway 摘要标记不完整', async () => {
    attemptCreate.mockRejectedValueOnce(new Error('database busy'))
    safeHttpRequestMock.mockResolvedValue(jsonResponse(200, {
      id: 'completion-telemetry-failed',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    }))

    await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-telemetry-failed' }
    )

    const metadata = JSON.parse(agentLogCreate.mock.calls.at(-1)[0].data.metadata)
    expect(metadata.attemptTelemetryComplete).toBe(false)
  })

  it('将单次请求超时硬限制为 300 秒并写入一致遥测', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(200, {
      id: 'completion-timeout-cap',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    }))

    await new APIExecutor().execute(
      { ...route, timeoutMs: 600_000 },
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-timeout-cap' }
    )

    expect(safeHttpRequestMock).toHaveBeenCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({ timeoutMs: 300_000 })
    )
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      configuredTimeoutMs: 600_000,
      effectiveTimeoutMs: 300_000
    }))
  })

  it('环境默认超时由平台可靠性设置替代，显式路由超时仍优先', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(200, {
      id: 'completion-timeout-source',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    }))
    const budget: RetryBudget = {
      id: 'rb-timeout-source',
      limits: { maxUpstreamAttempts: 2, maxTransportRetries: 0, maxLogicalRetries: 0 },
      used: { upstreamAttempts: 0, transportRetries: 0, logicalRetries: 0 },
      policy: {
        defaultRequestTimeoutMs: 120_000,
        retryBaseDelayMs: 1_000,
        maxRetryAfterMs: 10_000,
        jitterEnabled: true
      }
    }

    await new APIExecutor().execute(
      { ...route, timeoutMs: 600_000, timeoutSource: 'environment-default' },
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-platform-timeout', retryBudget: budget }
    )
    expect(safeHttpRequestMock).toHaveBeenLastCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({ timeoutMs: 120_000 })
    )

    safeHttpRequestMock.mockClear().mockResolvedValue(jsonResponse(200, {
      id: 'completion-route-timeout',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }]
    }))
    budget.used.upstreamAttempts = 0

    await new APIExecutor().execute(
      { ...route, timeoutMs: 12_345, timeoutSource: 'route-override' },
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-route-timeout', retryBudget: budget }
    )
    expect(safeHttpRequestMock).toHaveBeenLastCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({ timeoutMs: 12_345 })
    )
  })

  it('Retry-After 超过自动等待上限时不提前重试', async () => {
    safeHttpRequestMock.mockResolvedValue(jsonResponse(
      429,
      { error: 'rate limit exceeded' },
      { 'retry-after': '60' }
    ))
    const delay = jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-long-retry-after' }
    )).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 60_000 })

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(1)
    expect(delay).not.toHaveBeenCalled()
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      retryable: true,
      willRetry: false,
      retryAfterMs: 60_000
    }))
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
    // 显式收紧 transport 预算，使断言不随平台默认值漂移（默认值由 reliability-settings 测试钉死）
    const budget = createRetryBudget({ maxTransportRetries: 1 })

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }] },
      { traceId: 'trace-safe-http-timeout', retryBudget: budget }
    )).rejects.toMatchObject({ code: 'RETRY_BUDGET_EXHAUSTED' })

    expect(safeHttpRequestMock).toHaveBeenCalledTimes(2)
    expect(budget.exhaustedBy).toBe('transport-retries')
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

describe('APIExecutor streaming (SSE)', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    safeHttpRequestMock.mockReset()
    streamRequestMock.mockReset()
    agentLogCreate.mockReset().mockResolvedValue({})
    attemptCreate.mockReset().mockResolvedValue({})
  })

  function sseResponse(status: number, body: string, headers: Record<string, string> = {}) {
    return async (url: string, options: any) => {
      const responseHeaders = { 'content-type': 'text/event-stream', ...headers }
      options.onHeaders?.(status, responseHeaders)
      options.onChunk?.(Buffer.from(body))
      return { status, headers: responseHeaders, url, totalBytes: Buffer.byteLength(body) }
    }
  }

  it('解析 SSE 增量透传并合成完整 ChatResponse（含 usage/finish_reason 遥测）', async () => {
    const sseBody = [
      'data: {"id":"c-stream","model":"test-model","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}',
      '',
      'data: {"id":"c-stream","model":"test-model","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}',
      '',
      'data: {"id":"c-stream","model":"test-model","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}',
      '',
      'data: [DONE]',
      ''
    ].join('\n')
    streamRequestMock.mockImplementation(sseResponse(200, sseBody))

    const deltas: string[] = []
    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
      { traceId: 'trace-stream', onStreamChunk: (delta) => deltas.push(delta) }
    )

    expect(deltas).toEqual(['你', '好'])
    expect(response.choices[0].message.content).toBe('你好')
    expect(response.choices[0].finish_reason).toBe('stop')
    expect(response.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 })
    expect(response.id).toBe('c-stream')
    expect(attemptCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      success: true,
      finishReason: 'stop',
      promptTokens: 10,
      completionTokens: 4
    }))
    expect(streamRequestMock).toHaveBeenCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.objectContaining({ stream: true, stream_options: { include_usage: true } })
      })
    )
  })

  it('内容增量已透传后传输失败不重试', async () => {
    streamRequestMock.mockImplementation(async (url: string, options: any) => {
      options.onHeaders?.(200, { 'content-type': 'text/event-stream' })
      options.onChunk?.(Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"半截"}}]}\n\n'))
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    })

    await expect(new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
      { traceId: 'trace-stream-no-retry', onStreamChunk: () => {}, retryBudget: createRetryBudget() }
    )).rejects.toMatchObject({ code: 'NETWORK_TRANSIENT' })

    expect(streamRequestMock).toHaveBeenCalledTimes(1)
  })

  it('首个内容增量之前失败按重试预算重试', async () => {
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)
    const budget = createRetryBudget()
    streamRequestMock
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 请求超时'), { code: 'ETIMEDOUT' }))
      .mockImplementationOnce(sseResponse(200, 'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'))

    const deltas: string[] = []
    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
      { traceId: 'trace-stream-retry', onStreamChunk: (delta) => deltas.push(delta), retryBudget: budget }
    )

    expect(streamRequestMock).toHaveBeenCalledTimes(2)
    expect(deltas).toEqual(['ok'])
    expect(response.choices[0].message.content).toBe('ok')
  })

  it('非 2xx 状态码在无内容增量时可重试', async () => {
    jest.spyOn(APIExecutor.prototype as any, 'delay').mockResolvedValue(undefined)
    const rateBody = JSON.stringify({ error: 'rate limit exceeded' })
    streamRequestMock
      .mockImplementationOnce(async (url: string, options: any) => {
        options.onHeaders?.(429, { 'content-type': 'application/json' })
        options.onChunk?.(Buffer.from(rateBody))
        return { status: 429, headers: { 'content-type': 'application/json' }, url, totalBytes: rateBody.length }
      })
      .mockImplementationOnce(sseResponse(200, 'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'))

    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
      { traceId: 'trace-stream-status-retry', onStreamChunk: () => {}, retryBudget: createRetryBudget() }
    )

    expect(streamRequestMock).toHaveBeenCalledTimes(2)
    expect(response.choices[0].message.content).toBe('ok')
  })

  it('provider 忽略 stream 参数返回 JSON 时回退缓冲解析', async () => {
    const jsonBody = JSON.stringify({
      id: 'c-buffered',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '完整内容' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    })
    streamRequestMock.mockImplementation(async (url: string, options: any) => {
      options.onHeaders?.(200, { 'content-type': 'application/json' })
      options.onChunk?.(Buffer.from(jsonBody))
      return { status: 200, headers: { 'content-type': 'application/json' }, url, totalBytes: jsonBody.length }
    })

    const deltas: string[] = []
    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
      { traceId: 'trace-stream-json-fallback', onStreamChunk: (delta) => deltas.push(delta) }
    )

    expect(deltas).toEqual([])
    expect(response.choices[0].message.content).toBe('完整内容')
  })

  it('request.stream 但未提供 onStreamChunk 时仍以流式请求发出（JSON 类输出场景）', async () => {
    const sseBody = 'data: {"id":"c-json","model":"test-model","choices":[{"index":0,"delta":{"content":"{\\"reply\\":\\"hi\\",\\"ok\\":true}"},"finish_reason":null}]}\n\ndata: {"id":"c-json","model":"test-model","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    streamRequestMock.mockImplementation(sseResponse(200, sseBody))

    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
      { traceId: 'trace-stream-no-callback' }
    )

    expect(streamRequestMock).toHaveBeenCalledWith(
      'https://example.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.objectContaining({ stream: true, stream_options: { include_usage: true } })
      })
    )
    expect(response.choices[0].message.content).toBe('{"reply":"hi","ok":true}')
    expect(response.choices[0].finish_reason).toBe('stop')
  })

  it('provider 拒绝 stream_options 时去参数重试一次', async () => {
    const errorBody = JSON.stringify({ error: { message: 'unknown parameter: stream_options' } })
    const bodies: any[] = []
    streamRequestMock.mockImplementation(async (url: string, options: any) => {
      bodies.push(options.body)
      if (bodies.length === 1) {
        options.onHeaders?.(400, { 'content-type': 'application/json' })
        options.onChunk?.(Buffer.from(errorBody))
        return { status: 400, headers: { 'content-type': 'application/json' }, url, totalBytes: errorBody.length }
      }
      options.onHeaders?.(200, { 'content-type': 'text/event-stream' })
      options.onChunk?.(Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"retried"}}]}\n\ndata: [DONE]\n\n'))
      return { status: 200, headers: { 'content-type': 'text/event-stream' }, url, totalBytes: 30 }
    })

    const response = await new APIExecutor().execute(
      route,
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
      { traceId: 'trace-stream-params-fallback', onStreamChunk: () => {} }
    )

    expect(streamRequestMock).toHaveBeenCalledTimes(2)
    expect(bodies[0].stream_options).toEqual({ include_usage: true })
    expect(bodies[1].stream_options).toBeUndefined()
    expect(bodies[1].stream).toBe(true)
    expect(response.choices[0].message.content).toBe('retried')
  })
})
