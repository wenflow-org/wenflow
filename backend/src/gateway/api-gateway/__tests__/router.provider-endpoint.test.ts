/**
 * 供应商自带端点路由规则（llm-providers.json File-as-Truth）：
 * 解析后的模型命中自带 baseUrl 的供应商 ⇒ endpoint/apiKey 整体切换（source=provider-endpoint）；
 * 密钥解析顺序为 **管理台写入的 DB 密文 → apiKeyEnv 环境变量**，两处都缺 ⇒ 明确报错；
 * 用户自带 provider（source user-*）不受覆盖。
 * 测试密钥一律用 ut- 前缀占位（非真实凭据；真实凭据只允许来自环境变量或管理台密文表）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

const secretFindUnique = jest.fn()

jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    agent_model_configs: { findFirst: agentConfigFindFirst },
    skill_model_configs: { findFirst: skillConfigFindFirst },
    platform_api_configs: { findFirst: platformConfigFindFirst },
    provider_secrets: { findUnique: secretFindUnique }
  }
}))

jest.mock('../../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}))

import { APIRouter } from '../router'
import { reloadLlmProvidersIfChanged } from '../../../config/models.config'
import { encryptSecret } from '../../../utils/secret-crypto'
import { invalidateProviderSecretCache } from '../../../services/provider-secrets.service'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-providers-router-'))
const tempConfig = path.join(tmpDir, 'llm-providers.json')

// 占位值：ut- 前缀 = unit-test 假数据，不含任何真实凭据
const UT_PROV_KEY = 'ut-testprov-placeholder-key'
// 测试用密钥环：只在本文件的进程内生效（真密文/真解密，密钥是随机 32 字节）
const UT_DB_KEY = 'ut-db-placeholder-key'
process.env.SECRET_ENCRYPTION_KEYS = `ut-key:${Buffer.alloc(32, 7).toString('base64')}`
process.env.SECRET_ENCRYPTION_CURRENT_KEY_ID = 'ut-key'
const UT_PLATFORM_KEY = 'ut-platform-placeholder-key'
const UT_USER_KEY = 'ut-user-placeholder-key'

const PLATFORM = {
  apiUrl: 'https://platform.example/v1',
  apiKey: UT_PLATFORM_KEY,
  defaultModel: 'test-model',
  defaultReasoningModel: null,
  defaultTemperature: 0.7,
  defaultMaxTokens: 2000,
  reasoningEndpoint: null,
  chatModels: null,
  reasoningModels: null,
  lightModels: null
}

beforeAll(() => {
  fs.writeFileSync(tempConfig, JSON.stringify({
    providers: {
      testprov: {
        name: '测试通道',
        baseUrl: 'http://testprov.local/v1',
        apiKeyEnv: 'TEST_PROV_KEY',
        models: { 'test-model': { label: 'Test Model', tier: 'chat', defaultMaxTokens: 32768 } }
      }
    },
    aliases: {},
    defaults: { chat: 'test-model', reasoning: 'test-model' }
  }), 'utf-8')
  process.env.LLM_PROVIDERS_CONFIG = tempConfig
  process.env.TEST_PROV_KEY = UT_PROV_KEY
  reloadLlmProvidersIfChanged()
})

afterAll(() => {
  delete process.env.LLM_PROVIDERS_CONFIG
  delete process.env.TEST_PROV_KEY
  reloadLlmProvidersIfChanged()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('APIRouter 供应商端点覆盖', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    userOverrideFindFirst.mockResolvedValue(null)
    userProviderFindUnique.mockResolvedValue(null)
    agentConfigFindFirst.mockResolvedValue(null)
    skillConfigFindFirst.mockResolvedValue(null)
    platformConfigFindFirst.mockResolvedValue({ ...PLATFORM })
    secretFindUnique.mockResolvedValue(null)
    invalidateProviderSecretCache()
  })

  it('平台模型命中自带端点的供应商 → endpoint/apiKey 整体切换，source=provider-endpoint', async () => {
    const route = await new APIRouter().resolve({})
    expect(route.model).toBe('test-model')
    expect(route.endpoint).toBe('http://testprov.local/v1')
    expect(route.apiKey).toBe(UT_PROV_KEY)
    expect(route.source).toBe('provider-endpoint')
    expect(route.privateNetworkPolicy).toBe('runtime')
  })

  it('skill 叠层同样生效（模型由 skill 指定，限定式引用还原为上游字面 id）', async () => {
    skillConfigFindFirst.mockResolvedValue({
      skillId: 'demo-skill',
      enabled: true,
      tier: 'chat',
      model: 'testprov/test-model',
      thinkingMode: null,
      reasoningEffort: null,
      endpoint: null,
      apiKey: null,
      temperature: null,
      maxTokens: null,
      requestTimeoutMs: null,
      paramOverrides: null,
      fallbackChain: null
    })
    const route = await new APIRouter().resolve({ skillId: 'demo-skill' })
    expect(route.model).toBe('test-model')
    expect(route.endpoint).toBe('http://testprov.local/v1')
    expect(route.source).toBe('provider-endpoint')
  })

  it('管理台写入的密文优先于环境变量', async () => {
    secretFindUnique.mockResolvedValue({ providerId: 'testprov', apiKey: encryptSecret(UT_DB_KEY, 'system.provider_secrets.apiKey'), apiKeyEnv: 'TEST_PROV_KEY' })
    invalidateProviderSecretCache()
    const route = await new APIRouter().resolve({})
    expect(route.apiKey).toBe(UT_DB_KEY)
    expect(route.endpoint).toBe('http://testprov.local/v1')
  })

  it('供应商密钥 DB 与环境变量都缺 → 明确报错（不带病调用）', async () => {
    delete process.env.TEST_PROV_KEY
    try {
      // 进程内 60s 缓存：环境变量在真实部署里靠重启改，测试里显式失效以模拟重启
      invalidateProviderSecretCache()
      await expect(new APIRouter().resolve({})).rejects.toThrow(/TEST_PROV_KEY/)
    } finally {
      process.env.TEST_PROV_KEY = UT_PROV_KEY
      invalidateProviderSecretCache()
    }
  })

  it('用户自带 provider 不受覆盖（用户模型身份属于用户自己的供应商空间）', async () => {
    userProviderFindUnique.mockResolvedValue({
      endpoint: 'https://user-own.example/v1',
      apiKey: UT_USER_KEY,
      chatModel: 'test-model',
      reasoningModel: null,
      enabled: true
    })
    const route = await new APIRouter().resolve({}, 'user-1')
    expect(route.source).toBe('user-provider')
    expect(route.endpoint).toBe('https://user-own.example/v1')
  })
})
