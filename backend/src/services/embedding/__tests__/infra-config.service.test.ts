/**
 * 基础设施模型保存路径：首次只配一个条目时必须能落库。
 *
 * 背景（2026-10-28 走查）：UI 每次只提交正在编辑的那一条（embedding 或 rerank），
 * 旧校验对整份合并配置要求两边都有地址，导致「先配向量化」被重排的空地址卡死。
 */
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_settings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

jest.mock('../../provider-secrets.service', () => ({
  setProviderSecret: jest.fn(async () => undefined),
  deleteProviderSecret: jest.fn(async () => undefined),
  providerSecretSummary: jest.fn(async () => ({ keySource: 'db', keyHint: 'sk-…' })),
  resolveProviderApiKey: jest.fn(async () => null),
}))

jest.mock('../../apiConfig.service', () => ({
  __esModule: true,
  default: { getConfig: jest.fn(async () => ({ apiUrl: '', apiKey: '' })) },
}))

import systemPrisma from '../../../config/system-database'
import apiConfigService from '../../apiConfig.service'
import { setProviderSecret } from '../../provider-secrets.service'
import {
  getInfraModelsView,
  saveInfraModels,
  resetInfraModelConfigCacheForTests,
} from '../infra-config.service'

const settings = systemPrisma.platform_settings as unknown as {
  findUnique: jest.Mock
  upsert: jest.Mock
}
const getPlatformConfigMock = apiConfigService.getConfig as unknown as jest.Mock

describe('saveInfraModels 部分配置', () => {
  const envSnapshot = { ...process.env }
  beforeEach(() => {
    jest.clearAllMocks()
    resetInfraModelConfigCacheForTests()
    delete process.env.EMBEDDING_API_URL
    delete process.env.RERANK_API_URL
    delete process.env.EMBEDDING_API_KEY
    delete process.env.RERANK_API_KEY
    settings.findUnique.mockResolvedValue(null)
    settings.upsert.mockResolvedValue({})
    getPlatformConfigMock.mockResolvedValue({ apiUrl: '', apiKey: '' })
  })
  afterAll(() => {
    process.env = envSnapshot
  })

  it('只提交 embedding：保存成功，rerank 保持未配置而不是报错', async () => {
    await expect(saveInfraModels({
      embedding: {
        endpoint: 'https://gw.example/v1/embeddings',
        model: 'BAAI/bge-m3',
        apiKey: 'test-key',
      },
    })).resolves.toBeTruthy()

    expect(setProviderSecret).toHaveBeenCalledWith('infra-embedding', 'test-key', 'EMBEDDING_API_KEY')
    const persisted = JSON.parse(settings.upsert.mock.calls[0][0].update.value)
    expect(persisted.embedding.endpoint).toBe('https://gw.example/v1/embeddings')
    expect(persisted.embedding.model).toBe('BAAI/bge-m3')
    expect(persisted.rerank.endpoint).toBe('')
  })

  it('只提交 rerank 同样可行', async () => {
    await expect(saveInfraModels({
      rerank: {
        endpoint: 'https://gw.example/v1/rerank',
        model: 'BAAI/bge-reranker-v2-m3',
      },
    })).resolves.toBeTruthy()

    const persisted = JSON.parse(settings.upsert.mock.calls[0][0].update.value)
    expect(persisted.rerank.endpoint).toBe('https://gw.example/v1/rerank')
    expect(persisted.embedding.endpoint).toBe('')
  })

  it('inherit 模式允许不填服务地址，并原样落库', async () => {
    await expect(saveInfraModels({
      embedding: {
        connectionMode: 'inherit',
        model: 'BAAI/bge-m3',
      },
    })).resolves.toBeTruthy()

    const persisted = JSON.parse(settings.upsert.mock.calls[0][0].update.value)
    expect(persisted.embedding.connectionMode).toBe('inherit')
    expect(persisted.embedding.endpoint).toBe('')
    expect(persisted.embedding.model).toBe('BAAI/bge-m3')
  })

  it('inherit 模式：端点按平台 base URL 推导，密钥用平台连接', async () => {
    getPlatformConfigMock.mockResolvedValue({
      apiUrl: 'https://gw.example',
      apiKey: 'platform-key',
    })
    settings.findUnique.mockResolvedValue({
      value: JSON.stringify({
        embedding: {
          provider: 'bge',
          connectionMode: 'inherit',
          endpoint: '',
          model: 'BAAI/bge-m3',
          apiKeyEnv: 'EMBEDDING_API_KEY',
          timeoutMs: 20000,
          batchSize: 32,
          dimensions: null,
        },
        rerank: {
          provider: 'bge',
          connectionMode: 'inherit',
          endpoint: '',
          model: 'BAAI/bge-reranker-v2-m3',
          apiKeyEnv: 'RERANK_API_KEY',
          timeoutMs: 20000,
          batchSize: null,
          dimensions: null,
        },
        required: true,
      }),
    })

    const view = await getInfraModelsView()
    expect(view.platformBaseUrl).toBe('https://gw.example')
    expect(view.embedding.endpoint).toBe('https://gw.example/v1/embeddings')
    expect(view.rerank.endpoint).toBe('https://gw.example/v1/rerank')
    expect(view.embedding.keySource).toBe('platform')
    expect(view.embedding.configured).toBe(true)
    expect(view.rerank.configured).toBe(true)
  })
})
