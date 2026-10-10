// 幂等删除回归（2026-10-10 权限批实弹）：无自定义行时 Prisma 抛 P2025——「恢复默认配置」
// 目标态已达成，应静默成功（此前经路由落 500「恢复默认配置失败，请稍后重试」）。
export {}

const uamcDelete = jest.fn()
const invalidateCache = jest.fn()

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: { user_agent_model_configs: { delete: (...a: any[]) => uamcDelete(...a), update: jest.fn(), upsert: jest.fn() } }
}))
jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ invalidateCache }),
}))
jest.mock('../../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))

import userAgentModelConfigService from '../userAgentModelConfig.service'

beforeEach(() => jest.clearAllMocks())

describe('userAgentModelConfigService.delete 幂等性', () => {
  it('无行（P2025）→ 静默成功且不抛错', async () => {
    const err: any = new Error('Record not found')
    err.code = 'P2025'
    uamcDelete.mockRejectedValue(err)

    await expect(userAgentModelConfigService.delete('user-1', 'path-agent')).resolves.toBeUndefined()
    expect(invalidateCache).toHaveBeenCalledWith('user-1', 'path-agent')
  })

  it('其他错误照常抛出', async () => {
    uamcDelete.mockRejectedValue(new Error('db down'))

    await expect(userAgentModelConfigService.delete('user-1', 'path-agent')).rejects.toThrow('db down')
  })

  it('正常删除 → 失效缓存', async () => {
    uamcDelete.mockResolvedValue({})

    await expect(userAgentModelConfigService.delete('user-1', 'path-agent')).resolves.toBeUndefined()
    expect(uamcDelete).toHaveBeenCalledWith({ where: { userId_agentId: { userId: 'user-1', agentId: 'path-agent' } } })
    expect(invalidateCache).toHaveBeenCalledWith('user-1', 'path-agent')
  })
})
