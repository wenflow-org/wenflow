/**
 * apiConfig.service 占位 key 过滤单测（#142）：
 * env 兜底 / DB 存储 / endpointsMatch 回退三条路径上的文档占位 key 都按「未配置」处理；
 * 真实 key 原样放行；updateConfig 不持久化占位值。
 */
jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_api_configs: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn()
    }
  }
}))

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ invalidateCache: jest.fn() })
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import systemPrisma from '../../config/system-database'
import { logger } from '../../utils/logger'

const findUnique = systemPrisma.platform_api_configs.findUnique as jest.Mock
const upsert = systemPrisma.platform_api_configs.upsert as jest.Mock

type ServiceModule = typeof import('../apiConfig.service')

/** defaultConfig 在模块加载期读 env → 用 isolateModules 让每个用例拿到 freshly-imported 服务 */
function loadService(env: Record<string, string>): ServiceModule['default'] {
  const previous = { ...process.env }
  for (const key of ['AI_API_URL', 'AI_API_KEY', 'AI_MODEL']) delete process.env[key]
  Object.assign(process.env, env)
  try {
    let exported: ServiceModule | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      exported = require('../apiConfig.service') as ServiceModule
    })
    return exported!.default
  } finally {
    for (const key of ['AI_API_URL', 'AI_API_KEY', 'AI_MODEL']) delete process.env[key]
    Object.assign(process.env, previous)
  }
}

describe('apiConfig.service 占位 key 过滤（#142）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue(null)
  })

  it('env 兜底路径：AI_API_KEY 为文档占位值 → apiKey 按「未配置」（空串）返回', async () => {
    const service = loadService({
      AI_API_URL: 'https://api.example.com',
      AI_API_KEY: 'sk-your-api-key',
      AI_MODEL: 'test-model'
    })
    const config = await service.getConfig()
    expect(config.apiKey).toBe('')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('占位值'))
  })

  it('env 兜底路径：真实 key 原样返回，不告警', async () => {
    const service = loadService({
      AI_API_URL: 'https://api.example.com',
      AI_API_KEY: 'sk-real-abc123def456',
      AI_MODEL: 'test-model'
    })
    const config = await service.getConfig()
    expect(config.apiKey).toBe('sk-real-abc123def456')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('DB 行缺 key 且主端点与 env 一致时回退 env 占位值 → 同样按未配置返回', async () => {
    findUnique.mockResolvedValue({
      apiUrl: 'https://api.example.com',
      apiKey: '',
      defaultModel: 'test-model'
    })
    const service = loadService({
      AI_API_URL: 'https://api.example.com',
      AI_API_KEY: 'SK-Your-API-Key',
      AI_MODEL: 'test-model'
    })
    const config = await service.getConfig()
    expect(config.apiKey).toBe('')
  })

  it('DB 行存了真实 key → 原样返回（真实 key 判断不受影响）', async () => {
    findUnique.mockResolvedValue({
      apiUrl: 'https://api.example.com',
      apiKey: 'sk-stored-real-key',
      defaultModel: 'test-model'
    })
    const service = loadService({
      AI_API_URL: 'https://api.example.com',
      AI_API_KEY: 'sk-your-api-key',
      AI_MODEL: 'test-model'
    })
    const config = await service.getConfig()
    expect(config.apiKey).toBe('sk-stored-real-key')
  })

  it('占位值告警每个进程只发一次（getConfig 是热路径）', async () => {
    const service = loadService({
      AI_API_URL: 'https://api.example.com',
      AI_API_KEY: 'sk-your-api-key',
      AI_MODEL: 'test-model'
    })
    await service.getConfig()
    await service.getConfig()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('updateConfig 不把占位值持久化：按空串入库，返回配置如实报未配置', async () => {
    findUnique.mockResolvedValue({
      apiUrl: 'https://api.example.com',
      apiKey: '',
      defaultModel: 'test-model'
    })
    upsert.mockResolvedValue(undefined)
    const service = loadService({
      AI_API_URL: 'https://api.example.com',
      AI_API_KEY: 'sk-your-api-key',
      AI_MODEL: 'test-model'
    })

    const updated = await service.updateConfig({
      apiUrl: 'https://api.example.com',
      apiKey: 'sk-your-api-key',
      defaultModel: 'test-model'
    })

    expect(updated.apiKey).toBe('')
    const upsertArgs = upsert.mock.calls[0][0]
    expect(upsertArgs.update.apiKey).toBe('')
    expect(upsertArgs.create.apiKey).toBe('')
  })
})
