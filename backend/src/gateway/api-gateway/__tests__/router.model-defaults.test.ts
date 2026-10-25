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
    platform_api_configs: { findFirst: platformConfigFindFirst }
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
      requestTimeoutMs: null, paramOverrides: null, fallbackChain: null
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
      requestTimeoutMs: null, paramOverrides: null, fallbackChain: null
    })
    const { APIRouter } = await import('../router')
    const route = await new APIRouter().resolve({ agentId: 'a', skillId: 's-enabled' })
    expect(route.thinkingMode).toBe('enabled')
    expect(route.responseFormat).toBe('json_object')
  })
})
