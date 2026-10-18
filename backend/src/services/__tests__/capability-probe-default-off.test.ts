/**
 * 测活探针「默认必须关闭」的回归测试（2026-10-18 用户明确要求）。
 *
 * 探针会周期性对 5 个能力逐个发真实模型请求，默认开启等于持续消耗额度。
 * 这里锁住四件事：
 *   1) 代码默认值是 false（改常量即红）；
 *   2) platform_settings 无设置行时按 false 处理；
 *   3) 读取设置失败时回落 false（不因数据库故障打开探测）；
 *   4) 服务实例初始未启用，start() 在关闭态不创建定时器。
 */

const mockFindUnique = jest.fn()
const mockUpsert = jest.fn()

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_settings: { findUnique: mockFindUnique, upsert: mockUpsert },
    platform_api_configs: { updateMany: jest.fn() }
  }
}))

jest.mock('../../gateway/api-gateway', () => ({
  getAPIGateway: () => ({ resolveRoute: jest.fn() }),
  APIExecutor: jest.fn().mockImplementation(() => ({ execute: jest.fn() }))
}))

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import {
  DEFAULT_CAPABILITY_PROBE_ENABLED,
  clearCapabilityProbeSettingsCache,
  getPlatformCapabilityProbeEnabled,
  getRuntimeCapabilityProbeEnabled
} from '../capability-probe-settings.service'
import { AICapabilityHealthService } from '../ai-capability-health.service'

describe('测活探针默认关闭（硬约束）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearCapabilityProbeSettingsCache()
  })

  it('代码默认值是 false', () => {
    expect(DEFAULT_CAPABILITY_PROBE_ENABLED).toBe(false)
  })

  it('库里没有设置行时返回 false', async () => {
    mockFindUnique.mockResolvedValue(null)
    await expect(getPlatformCapabilityProbeEnabled()).resolves.toBe(false)
  })

  it('读取设置失败时回落 false，不因 IO 故障打开探测', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'))
    await expect(getRuntimeCapabilityProbeEnabled()).resolves.toBe(false)
  })

  it('服务实例初始未启用，start() 在关闭态不创建定时器', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval')
    try {
      const service = new AICapabilityHealthService()
      expect(service.isEnabled()).toBe(false)
      mockFindUnique.mockResolvedValue(null)
      await service.start()
      expect(setIntervalSpy).not.toHaveBeenCalled()
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  it('stop() 在关闭态是幂等的（不报错、不触发探测）', async () => {
    const service = new AICapabilityHealthService()
    await expect(service.stop()).resolves.toBeUndefined()
  })
})
