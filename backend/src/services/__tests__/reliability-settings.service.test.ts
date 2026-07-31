const platformFindUnique = jest.fn()
const platformUpsert = jest.fn()
const skillFindUnique = jest.fn()

jest.mock('../../config/system-database', () => ({
  __esModule: true,
  default: {
    platform_settings: {
      findUnique: platformFindUnique,
      upsert: platformUpsert
    },
    skill_model_configs: {
      findUnique: skillFindUnique
    }
  }
}))

import {
  clearReliabilitySettingsCache,
  createRuntimeRetryBudget,
  getEffectiveLogicalRetryLimit,
  getPlatformReliabilitySettings,
  normalizePlatformReliabilitySettings,
  updatePlatformReliabilitySettings
} from '../reliability-settings.service'

describe('reliability settings service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearReliabilitySettingsCache()
    platformFindUnique.mockResolvedValue(null)
    platformUpsert.mockResolvedValue({})
    skillFindUnique.mockResolvedValue(null)
  })

  it('缺少持久化设置时返回安全默认值', async () => {
    await expect(getPlatformReliabilitySettings()).resolves.toEqual({
      maxUpstreamAttempts: 3,
      maxTransportRetries: 1,
      maxLogicalRetries: 1,
      defaultRequestTimeoutMs: 300000,
      retryBaseDelayMs: 1000,
      maxRetryAfterMs: 10000,
      jitterEnabled: true
    })
  })

  it('保存前将设置限制在代码硬上限内', async () => {
    const normalized = normalizePlatformReliabilitySettings({
      maxUpstreamAttempts: 99,
      maxTransportRetries: 99,
      maxLogicalRetries: 99,
      defaultRequestTimeoutMs: 999999,
      retryBaseDelayMs: 999999,
      maxRetryAfterMs: 999999,
      jitterEnabled: false
    })

    expect(normalized).toEqual({
      maxUpstreamAttempts: 5,
      maxTransportRetries: 2,
      maxLogicalRetries: 2,
      defaultRequestTimeoutMs: 300000,
      retryBaseDelayMs: 5000,
      maxRetryAfterMs: 10000,
      jitterEnabled: false
    })

    await updatePlatformReliabilitySettings(normalized)
    expect(platformUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'aiReliability' },
      update: { value: JSON.stringify(normalized) }
    }))
  })

  it('执行预算始终使用平台上限，Skill 只生成局部收紧值', async () => {
    platformFindUnique.mockResolvedValue({
      value: JSON.stringify({
        maxUpstreamAttempts: 4,
        maxTransportRetries: 2,
        maxLogicalRetries: 2,
        defaultRequestTimeoutMs: 120000,
        retryBaseDelayMs: 500,
        maxRetryAfterMs: 3000,
        jitterEnabled: false
      })
    })
    skillFindUnique.mockResolvedValue({ maxLogicalRetries: 0 })

    const budget = await createRuntimeRetryBudget()
    const skillLimit = await getEffectiveLogicalRetryLimit(
      'learning-turn',
      budget.limits.maxLogicalRetries
    )

    expect(budget.limits).toEqual({
      maxUpstreamAttempts: 4,
      maxTransportRetries: 2,
      maxLogicalRetries: 2
    })
    expect(budget.policy).toEqual({
      defaultRequestTimeoutMs: 120000,
      retryBaseDelayMs: 500,
      maxRetryAfterMs: 3000,
      jitterEnabled: false
    })
    expect(skillLimit).toBe(0)
  })

  it('Skill 不能提高平台逻辑重试上限', async () => {
    skillFindUnique.mockResolvedValue({ maxLogicalRetries: 2 })

    await expect(getEffectiveLogicalRetryLimit('learning-turn', 0)).resolves.toBe(0)
    await expect(getEffectiveLogicalRetryLimit('learning-turn', 1)).resolves.toBe(1)
  })
})
