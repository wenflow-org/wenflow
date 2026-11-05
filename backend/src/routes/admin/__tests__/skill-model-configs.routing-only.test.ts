const mockGet = jest.fn()
const mockUpsert = jest.fn()
const mockDelete = jest.fn()
const mockGetAll = jest.fn()
const mockGetPlatformReliability = jest.fn()
const mockResolveLlmCallParams = jest.fn()
const mockScanPromptFiles = jest.fn()

jest.mock('../../../services/skillModelConfig.service', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockGet(...args),
    upsert: (...args: any[]) => mockUpsert(...args),
    delete: (...args: any[]) => mockDelete(...args),
    getAll: (...args: any[]) => mockGetAll(...args),
  },
}))

jest.mock('../../../composers/prompt-files/loader', () => ({
  scanPromptFiles: (...args: any[]) => mockScanPromptFiles(...args),
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

function getHandler(method: 'get' | 'put' | 'post', path: string) {
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

  it('PUT 忽略裸 temperature/maxTokens，接受 paramOverrides 并返回新契约投影', async () => {
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
          // #177：未自带 endpoint 的 skill 只能钉目录内模型（门禁见下方同名用例），
          // 本用例考的是 paramOverrides 管线，故用注册表内的真实模型。
          model: 'deepseek-v4.1-flash',
          temperature: 0.1,
          maxTokens: 999,
          maxLogicalRetries: 1,
          requestTimeoutMs: 60000,
          paramOverrides: { temperature: 0.4, topP: 0.9, maxTokens: 32000 },
          // 2026-11-04 用户「去掉降级这个功能，不要」：兜底链字段整个下线，
          // 客户端再传也只当没看见（下面断言它不会落进写盘参数）
          fallbackChain: ['agnes-3.0-flash'],
        },
      },
      res
    )

    // 裸 temperature/maxTokens 仍被忽略（兼容旧客户端；请改用 paramOverrides）
    expect(mockUpsert.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        model: 'deepseek-v4.1-flash',
        maxLogicalRetries: 1,
        requestTimeoutMs: 60000,
        enabled: true,
        paramOverrides: JSON.stringify({ temperature: 0.4, topP: 0.9, maxTokens: 32000 }),
      })
    )
    expect(mockUpsert.mock.calls[0][1]).not.toHaveProperty('temperature', 0.1)
    expect(mockUpsert.mock.calls[0][1]).not.toHaveProperty('fallbackChain')
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

  /* 降级功能已下线：兜底链字段不再有任何校验面（以前会拦未注册候选），
     传了就只是被忽略；这条守住「别把字段又悄悄接回来」。 */
  it('兜底链字段已下线：传未注册候选也不报错，也不会写进配置', async () => {
    mockGet.mockResolvedValue({ skillId: 'goal-conversation', enabled: true, model: 'deepseek-v4.1-flash', apiKey: null })
    mockUpsert.mockImplementation(async (_id: string, data: any) => ({ skillId: 'goal-conversation', ...data }))
    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    await handler(
      {
        params: { skillId: 'goal-conversation' },
        body: { enabled: true, fallbackChain: ['totally-unknown-model'] },
      },
      res
    )
    expect(res.status).not.toHaveBeenCalledWith(400)
    expect(mockUpsert.mock.calls[0][1]).not.toHaveProperty('fallbackChain')
  })

  /* #177：未自带 endpoint 的 skill 走继承通道，显式钉目录外模型会在运行期无可用渠道。 */
  it('PUT 拒绝未自带 endpoint 时钉目录外模型', async () => {
    mockGet.mockResolvedValue({ skillId: 'goal-conversation', enabled: true, model: null, endpoint: null, apiKey: null })
    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    await handler(
      { params: { skillId: 'goal-conversation' }, body: { enabled: true, model: 'totally-unknown-model' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('totally-unknown-model'),
    }))
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('自带 endpoint 的 skill 允许钉该独立通道的模型（不受平台目录约束）', async () => {
    mockGet.mockResolvedValue({ skillId: 'goal-conversation', enabled: true, model: null, endpoint: null, apiKey: null })
    mockUpsert.mockImplementation(async (_id: string, data: any) => ({ skillId: 'goal-conversation', ...data }))
    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    await handler(
      {
        params: { skillId: 'goal-conversation' },
        body: { enabled: true, model: 'self-hosted-model', endpoint: 'http://127.0.0.1:30001/v1', apiKey: 'k' },
      },
      res
    )
    expect(res.status).not.toHaveBeenCalledWith(400)
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('GET 暴露含 topP 与 sources 的生成参数投影', async () => {
    mockGet.mockResolvedValue({
      skillId: 'goal-conversation',
      enabled: false,
      temperature: 0.2,
      maxTokens: 2000,
      paramOverrides: null,
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

describe('bulk-apply：清空模型覆盖（跟随平台默认）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockResolvedValue({ skillId: 'a', model: 'deepseek-v4.1-flash' })
    mockUpsert.mockImplementation(async (skillId: string, input: any) => ({ skillId, ...input }))
  })

  it('clearModel 只把 model 置空，不碰通道 / 思考 / 参数', async () => {
    const handler = getHandler('post', '/bulk-apply')
    const req: any = { body: { skillIds: ['a', 'b'], clearModel: true } }
    const res = createRes()
    await handler(req, res)
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    expect(mockUpsert).toHaveBeenCalledWith('a', { model: null })
    expect(mockUpsert).toHaveBeenCalledWith('b', { model: null })
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: '已清空模型覆盖，改为跟随平台默认',
      data: expect.objectContaining({ applied: 2, failed: 0 }),
    }))
  })

  it('clearModel 与设置模型 / 通道互斥（避免结果取决于字段顺序）', async () => {
    const handler = getHandler('post', '/bulk-apply')
    const res = createRes()
    await handler({ body: { skillIds: ['a'], clearModel: true, model: 'agnes-3.0-flash' } } as any, res)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
  })

  /* #177：批量套用未提供独立 endpoint 时，同样不能把目录外模型钉给走继承通道的 skill。 */
  it('未提供 endpoint 时拒绝批量套用目录外模型', async () => {
    const handler = getHandler('post', '/bulk-apply')
    const res = createRes()
    await handler({ body: { skillIds: ['a', 'b'], model: 'totally-unknown-model' } } as any, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('coverage 覆盖矩阵（拍板 #9：平台默认白名单）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('白名单 4 技能不计入 unconfigured，但 skills 列表保留（审计可见性）；allowlisted 回报实际未配置成员', async () => {
    mockScanPromptFiles.mockReturnValue({
      files: [
        { agentId: 'skill:goal-conversation' },
        { agentId: 'skill:skill-author' },
        { agentId: 'skill:skill-compiler' },
        { agentId: 'skill:virtual-learner-referee' },
        { agentId: 'skill:virtual-learner-actor-auditor' },
      ],
    })
    // 只有 goal-conversation 有配置行；白名单 4 技能全部 platform-default
    mockGetAll.mockResolvedValue([
      { skillId: 'goal-conversation', endpoint: 'http://127.0.0.1:3000/v1', model: 'deepseek-v4.1-flash', tier: 'chat', paramOverrides: null },
    ])

    const handler = getHandler('get', '/coverage')
    const res = createRes()
    await handler({ query: {} }, res)

    const payload = res.json.mock.calls[0][0]
    expect(payload.success).toBe(true)
    expect(payload.data.unconfigured).toEqual([])
    expect(payload.data.allowlisted).toEqual([
      'skill-author', 'skill-compiler', 'virtual-learner-actor-auditor', 'virtual-learner-referee',
    ])
    // skills 列表仍含全部 5 个（白名单成员可见，source 仍如实标 platform-default）
    const byId = new Map<string, any>(payload.data.skills.map((s: any) => [s.skillId, s]))
    expect(byId.get('skill-author').source).toBe('platform-default')
    expect(byId.get('goal-conversation').source).toBe('skill-channel')
  })

  it('白名单技能一旦补了配置行即移出 allowlisted（名单只登记「确实走平台默认」的成员）', async () => {
    mockScanPromptFiles.mockReturnValue({
      files: [{ agentId: 'skill:skill-author' }],
    })
    mockGetAll.mockResolvedValue([
      { skillId: 'skill-author', endpoint: null, model: 'deepseek-v4.1-flash', tier: 'chat', paramOverrides: null },
    ])

    const handler = getHandler('get', '/coverage')
    const res = createRes()
    await handler({ query: {} }, res)

    const payload = res.json.mock.calls[0][0]
    expect(payload.data.unconfigured).toEqual([]) // 白名单成员不计入未配置
    expect(payload.data.allowlisted).toEqual([])  // 但已有 model 行 → 不在 allowlisted
  })
})
