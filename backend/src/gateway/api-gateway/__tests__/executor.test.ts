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
})
