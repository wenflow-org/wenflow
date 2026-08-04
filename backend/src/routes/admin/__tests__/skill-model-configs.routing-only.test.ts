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

  it('strips temperature/maxTokens on PUT and returns generationParams projection', async () => {
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
        },
      },
      res
    )

    expect(mockUpsert).toHaveBeenCalledWith(
      'goal-conversation',
      expect.not.objectContaining({
        temperature: expect.anything(),
        maxTokens: expect.anything(),
      })
    )
    expect(mockUpsert.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        model: 'override-model',
        maxLogicalRetries: 1,
        requestTimeoutMs: 60000,
        enabled: true,
      })
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          routingOnly: true,
          generationParams: expect.objectContaining({
            temperature: 0.7,
            maxTokens: 8000,
            owner: 'agent_prompts.ACTIVE (File-as-Truth)',
          }),
        }),
      })
    )
  })

  it('GET exposes generationParams without treating skill_model_configs T as owner', async () => {
    mockGet.mockResolvedValue({
      skillId: 'goal-conversation',
      enabled: false,
      temperature: 0.2,
      maxTokens: 2000,
    })
    const handler = getHandler('get', '/:skillId')
    const res = createRes()
    await handler({ params: { skillId: 'goal-conversation' } }, res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          routingOnly: true,
          generationParams: expect.objectContaining({
            temperature: 0.7,
            maxTokens: 8000,
          }),
        }),
      })
    )
  })
})
