/**
 * 模型级生成参数运行时优先级（2026-10-24）：
 *   Skill 显式配置 > 最终模型的模型默认 > 平台默认。
 */
export {}

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const userOverrideFindFirst = jest.fn()
const userProviderFindUnique = jest.fn()
const agentConfigFindFirst = jest.fn()
const skillConfigFindFirst = jest.fn()
const platformConfigFindFirst = jest.fn()
/** #177：目录热重载后归一化平台默认会读/写 platform_api_configs */
const platformConfigFindUnique = jest.fn()
const platformConfigUpdate = jest.fn()

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    user_agent_model_configs: { findFirst: userOverrideFindFirst },
    user_api_configs: { findUnique: userProviderFindUnique }
  }
}))

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_model_configs: { findFirst: agentConfigFindFirst },
    skill_model_configs: { findFirst: skillConfigFindFirst },
    platform_api_configs: {
      findFirst: platformConfigFindFirst,
      findUnique: platformConfigFindUnique,
      update: platformConfigUpdate
    }
  }
}))

jest.mock('../../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-gen-defaults-'))
const tempConfig = path.join(tmpDir, 'llm-providers.json')

function writeRegistry(): void {
  fs.writeFileSync(tempConfig, JSON.stringify({
    providers: {
      platform: {
        name: '平台',
        enabled: true,
        recommended: true,
        models: {
          'm-model': {
            tier: 'chat',
            defaultThinkingMode: 'disabled',
            defaultResponseFormat: 'json_object'
          },
          'm-plain': { tier: 'chat' }
        }
      }
    },
    aliases: { chat: ['m-model'], reasoning: ['m-model'] },
    defaults: { chat: 'm-model', reasoning: 'm-model' }
  }), 'utf-8')
}

describe('模型级生成参数优先级', () => {
  beforeAll(() => {
    writeRegistry()
    process.env.LLM_PROVIDERS_CONFIG = tempConfig
  })

  afterAll(() => {
    delete process.env.LLM_PROVIDERS_CONFIG
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    userOverrideFindFirst.mockResolvedValue(null)
    userProviderFindUnique.mockResolvedValue(null)
    platformConfigFindFirst.mockResolvedValue({
      apiUrl: 'https://platform.example/v1',
      apiKey: 'platform-key',
      defaultModel: 'm-model',
      defaultReasoningModel: 'm-model',
      defaultTemperature: 0.7,
      defaultMaxTokens: 2000,
      defaultThinkingMode: 'enabled',
      defaultReasoningEffort: 'high',
      defaultResponseFormat: 'none'
    })
    skillConfigFindFirst.mockResolvedValue(null)
    // #177：常态没有目录变化 → 归一化不会被调用；给个空行防未 stub
    platformConfigFindUnique.mockResolvedValue(null)
    platformConfigUpdate.mockResolvedValue(undefined)
  })

  // 路由在 resolve 时按 env 里的文件热重载；每个用例前重建一次不需要，文件没变。
  it('平台默认路由：模型默认覆盖平台默认', async () => {
    const { APIRouter } = await import('../router')
    const route = await new APIRouter().resolve({ agentId: 'a' })
    expect(route.model).toBe('m-model')
    expect(route.thinkingMode).toBe('disabled')
    expect(route.responseFormat).toBe('json_object')
  })

  it('Skill 换到没有模型默认的模型：回落平台默认', async () => {
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null, apiKey: null, model: 'm-plain', tier: 'chat',
      thinkingMode: null, reasoningEffort: null, temperature: 0.2, maxTokens: 5000,
      requestTimeoutMs: null, paramOverrides: null
    })
    const { APIRouter } = await import('../router')
    const route = await new APIRouter().resolve({ agentId: 'a', skillId: 's-plain' })
    expect(route.model).toBe('m-plain')
    expect(route.thinkingMode).toBe('enabled')
    expect(route.reasoningEffort).toBe('high')
    expect(route.responseFormat).toBe('none')
  })

  it('Skill 显式思考模式压过模型默认；未显式设置的输出格式仍取模型默认', async () => {
    skillConfigFindFirst.mockResolvedValue({
      endpoint: null, apiKey: null, model: 'm-model', tier: 'chat',
      thinkingMode: 'enabled', reasoningEffort: null, temperature: 0.2, maxTokens: 5000,
      requestTimeoutMs: null, paramOverrides: null
    })
    const { APIRouter } = await import('../router')
    const route = await new APIRouter().resolve({ agentId: 'a', skillId: 's-enabled' })
    expect(route.thinkingMode).toBe('enabled')
    expect(route.responseFormat).toBe('json_object')
  })

  /* 2026-11-05 产品决定下线 #177 目录外默认门禁，见 CHANGELOG：
     平台默认未配时，env AI_MODEL 即使不在注册表内也原样生效——运行期不再把它拦回文件默认。 */
  it('#177 已下线：平台默认未配 + env AI_MODEL 目录外 → env 值原样生效', async () => {
    platformConfigFindFirst.mockResolvedValue({
      apiUrl: 'https://platform.example/v1',
      apiKey: 'platform-key',
      defaultModel: '',
      defaultReasoningModel: '',
      defaultTemperature: 0.7,
      defaultMaxTokens: 2000,
      defaultThinkingMode: 'default',
      defaultReasoningEffort: 'default',
      defaultResponseFormat: 'none'
    })
    const previous = process.env.AI_MODEL
    process.env.AI_MODEL = 'out-of-catalog-judge'
    try {
      const { APIRouter } = await import('../router')
      const route = await new APIRouter().resolve({ agentId: 'a' })
      expect(route.model).toBe('out-of-catalog-judge')
    } finally {
      if (previous === undefined) delete process.env.AI_MODEL
      else process.env.AI_MODEL = previous
    }
  })

  /* 2026-11-05 产品决定下线 #177 目录外默认门禁，见 CHANGELOG：
     手改目录收缩后热重载不再把平台默认归一化到目录内，DB 里的 defaultModel 原样参与路由。 */
  it('#177 已下线：手改目录收缩后热重载 → 平台默认不再被归一化', async () => {
    const { APIRouter } = await import('../router')
    platformConfigFindUnique.mockResolvedValue({
      defaultModel: 'm-model',
      defaultReasoningModel: 'm-model',
      defaultEvaluationModel: 'm-model',
      chatModels: null,
      reasoningModels: null,
      lightModels: null
    })
    // 手改文件：把 m-model 从目录里删掉，只剩 m-plain（mtime 单调前推，确保热重载识别）。
    // 用 try/finally 还原原目录，避免污染后续用例（不再依赖“本用例是文件最后一个”）。
    const original = fs.readFileSync(tempConfig, 'utf-8')
    try {
      fs.writeFileSync(tempConfig, JSON.stringify({
        providers: {
          platform: { name: '平台', enabled: true, recommended: true, models: { 'm-plain': { tier: 'chat' } } }
        },
        aliases: { chat: ['m-plain'], reasoning: ['m-plain'] },
        defaults: { chat: 'm-plain', reasoning: 'm-plain' }
      }), 'utf-8')
      fs.utimesSync(tempConfig, new Date(), new Date(Date.now() + 3_600_000))

      const route = await new APIRouter().resolve({ agentId: 'a' })

      // 不再回写 platform_api_configs；目录外的平台默认（m-model）仍按字面透传。
      expect(platformConfigUpdate).not.toHaveBeenCalled()
      expect(route.model).toBe('m-model')
    } finally {
      fs.writeFileSync(tempConfig, original, 'utf-8')
      fs.utimesSync(tempConfig, new Date(), new Date(Date.now() + 7_200_000))
    }
  })
})
