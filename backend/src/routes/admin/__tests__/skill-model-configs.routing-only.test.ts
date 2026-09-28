const mockGet = jest.fn()
const mockUpsert = jest.fn()
const mockDelete = jest.fn()
const mockGetPlatformReliability = jest.fn()
const mockResolveLlmCallParams = jest.fn()

jest.mock('../../../services/skillModelConfig.service', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockGet(...args),
    upsert: (...args: any[]) => mockUpsert(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}))

jest.mock('../../../services/reliability-settings.service', () => ({
  getPlatformReliabilitySettings: (...args: any[]) => mockGetPlatformReliability(...args),
}))

jest.mock('../../../services/resolve-llm-call-params', () => ({
  resolveLlmCallParams: (...args: any[]) => mockResolveLlmCallParams(...args),
}))

jest.mock('../../../utils/secret-redaction', () => ({
  preserveConfiguredSecret: (input: any) => input,
  toSecretSafeResponse: (value: any) => value,
}))

import router from '../skill-model-configs'

function getHandler(method: 'get' | 'put', path: string) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === path && item.route?.methods?.[method]
  )
  if (!layer) throw new Error(`route not found: ${method} ${path}`)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function createRes() {
  const res: any = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  res.json.mockReturnValue(res)
  return res
}

describe('skill-model-configs routing-only write path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetPlatformReliability.mockResolvedValue({ maxLogicalRetries: 2 })
    mockResolveLlmCallParams.mockResolvedValue({
      model: 'prompt-or-route-model',
      temperature: 0.7,
      maxTokens: 8000,
      sources: {
        model: 'route-fallback',
        temperature: 'active-prompt',
        maxTokens: 'active-prompt',
      },
    })
  })

  it('PUT 忽略裸 temperature/maxTokens，接受 paramOverrides/fallbackChain 并返回新契约投影', async () => {
    mockGet.mockResolvedValue({
      skillId: 'goal-conversation',
      enabled: true,
      model: null,
      endpoint: null,
      apiKey: null,
    })
    mockUpsert.mockImplementation(async (_id: string, data: any) => ({
      skillId: 'goal-conversation',
      enabled: true,
      ...data,
    }))

    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    await handler(
      {
        params: { skillId: 'goal-conversation' },
        body: {
          enabled: true,
          model: 'override-model',
          temperature: 0.1,
          maxTokens: 999,
          maxLogicalRetries: 1,
          requestTimeoutMs: 60000,
          paramOverrides: { temperature: 0.4, topP: 0.9, maxTokens: 32000 },
          fallbackChain: ['deepseek-v4-pro'],
        },
      },
      res
    )

    // 裸 temperature/maxTokens 仍被忽略（兼容旧客户端；请改用 paramOverrides）
    expect(mockUpsert.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        model: 'override-model',
        maxLogicalRetries: 1,
        requestTimeoutMs: 60000,
        enabled: true,
        paramOverrides: JSON.stringify({ temperature: 0.4, topP: 0.9, maxTokens: 32000 }),
        fallbackChain: JSON.stringify(['deepseek-v4-pro']),
      })
    )
    expect(mockUpsert.mock.calls[0][1]).not.toHaveProperty('temperature', 0.1)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          routingOnly: false,
          generationParams: expect.objectContaining({
            temperature: 0.7,
            topP: null,
            maxTokens: 8000,
            sources: expect.objectContaining({
              temperature: 'active-prompt',
              maxTokens: 'active-prompt',
            }),
            owner: expect.stringContaining('skill-override'),
          }),
        }),
      })
    )
  })

  it('PUT 拒绝 skill: 前缀幽灵行写入', async () => {
    mockGet.mockResolvedValue(null)
    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    await handler(
      { params: { skillId: 'skill:goal-conversation' }, body: { enabled: true } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('PUT 拒绝无 scheme 的 endpoint', async () => {
    mockGet.mockResolvedValue({ skillId: 'goal-conversation', enabled: true, apiKey: null })
    mockUpsert.mockResolvedValue({ skillId: 'goal-conversation' })
    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    await handler(
      {
        params: { skillId: 'goal-conversation' },
        body: { enabled: true, endpoint: '101.43.146.102:30001', apiKey: 'k' },
      },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT 拒绝跨 tier 的 fallback 候选', async () => {
    mockGet.mockResolvedValue({ skillId: 'goal-conversation', enabled: true, model: 'deepseek-v4.1-flash', apiKey: null })
    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    await handler(
      {
        params: { skillId: 'goal-conversation' },
        body: { enabled: true, fallbackChain: ['deepseek-v4-pro'] },
      },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('GET 暴露含 topP 与 sources 的生成参数投影', async () => {
    mockGet.mockResolvedValue({
      skillId: 'goal-conversation',
      enabled: false,
      temperature: 0.2,
      maxTokens: 2000,
      paramOverrides: null,
      fallbackChain: null,
    })
    const handler = getHandler('get', '/:skillId')
    const res = createRes()
    await handler({ params: { skillId: 'goal-conversation' } }, res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          routingOnly: false,
          generationParams: expect.objectContaining({
            temperature: 0.7,
            topP: null,
            maxTokens: 8000,
          }),
        }),
      })
    )
  })
})
