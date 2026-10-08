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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { reloadLlmProvidersIfChanged } from '../../../config/models.config'

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
      { skillId: 'goal-conversation', endpoint: 'http://127.0.0.1:3000/v1', model: 'deepseek-v4.1-flash', tier: 'chat', paramOverrides: null, fallbackChain: null },
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
      { skillId: 'skill-author', endpoint: null, model: 'deepseek-v4.1-flash', tier: 'chat', paramOverrides: null, fallbackChain: null },
    ])

    const handler = getHandler('get', '/coverage')
    const res = createRes()
    await handler({ query: {} }, res)

    const payload = res.json.mock.calls[0][0]
    expect(payload.data.unconfigured).toEqual([]) // 白名单成员不计入未配置
    expect(payload.data.allowlisted).toEqual([])  // 但已有 model 行 → 不在 allowlisted
  })
})


// ---------------------------------------------------------------------------
// 供应商维度（llm-providers.json File-as-Truth）：限定式引用 / 跨供应商兜底拒绝。
// 用临时目录配置切换注册表，跑完恢复种子目录（不影响文件内前序用例的种子注册表状态）。
// ---------------------------------------------------------------------------
describe('skill-model-configs 兜底链的供应商校验', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-providers-skilltest-'))
  const tempConfig = path.join(tmpDir, 'llm-providers.json')

  beforeAll(() => {
    fs.writeFileSync(tempConfig, JSON.stringify({
      providers: {
        platform: {
          name: '平台通道',
          models: {
            'main-chat': { label: 'Main Chat', tier: 'chat', defaultMaxTokens: 32768 },
            'alt-chat': { label: 'Alt Chat', tier: 'chat', defaultMaxTokens: 32768 },
          },
        },
        other: {
          name: '其他通道',
          baseUrl: 'http://other.example/v1',
          apiKeyEnv: 'UT_OTHER_KEY',
          models: {
            'other-chat': { label: 'Other Chat', tier: 'chat', defaultMaxTokens: 32768 },
          },
        },
      },
      aliases: {},
      defaults: { chat: 'main-chat', reasoning: 'main-chat' },
    }), 'utf-8')
    process.env.LLM_PROVIDERS_CONFIG = tempConfig
    process.env.UT_OTHER_KEY = 'ut-other-placeholder-key'
    reloadLlmProvidersIfChanged()
  })

  afterAll(() => {
    delete process.env.LLM_PROVIDERS_CONFIG
    delete process.env.UT_OTHER_KEY
    reloadLlmProvidersIfChanged()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function putFallback(body: Record<string, unknown>) {
    const handler = getHandler('put', '/:skillId')
    const res = createRes()
    return handler(
      { params: { skillId: 'goal-conversation' }, body: { enabled: true, model: 'main-chat', ...body } },
      res
    ).then(() => res)
  }

  it('接受同供应商限定式引用（platform/alt-chat）与裸 id（alt-chat）', async () => {
    const res = await putFallback({ fallbackChain: ['platform/alt-chat'] })
    expect(res.status).not.toHaveBeenCalledWith(400)
    const res2 = await putFallback({ fallbackChain: ['alt-chat'] })
    expect(res2.status).not.toHaveBeenCalledWith(400)
  })

  it('拒绝跨供应商候选（裸 id 或限定式，两种写法都拦）', async () => {
    const res = await putFallback({ fallbackChain: ['other/other-chat'] })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('跨供应商'),
      })
    )
    const res2 = await putFallback({ fallbackChain: ['other-chat'] })
    expect(res2.status).toHaveBeenCalledWith(400)
  })

  it('限定式引用与裸 id 指向同一模型时视为自身并拒绝', async () => {
    const res = await putFallback({ fallbackChain: ['platform/main-chat'] })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('不能是主模型自身'),
      })
    )
  })
})
