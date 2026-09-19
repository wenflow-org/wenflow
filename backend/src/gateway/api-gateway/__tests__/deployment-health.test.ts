import {
  DEFAULT_COOLDOWN_MS,
  clearCooldown,
  deploymentKey,
  isCoolingDown,
  isFallbackWorthyCategory,
  markCoolingDown,
  resetDeploymentHealth
} from '../deployment-health'
import { getModelFallbacks } from '../../../config/models.config'

describe('deployment-health（部署级冷却）', () => {
  beforeEach(() => resetDeploymentHealth())

  it('deploymentKey 区分 provider / endpoint / model', () => {
    const a = deploymentKey({ providerId: 'p1', endpoint: 'https://a', model: 'm1' })
    const b = deploymentKey({ providerId: 'p1', endpoint: 'https://a', model: 'm2' })
    const c = deploymentKey({ providerId: 'p2', endpoint: 'https://a', model: 'm1' })
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('mark → isCoolingDown 生效，到期自动恢复', () => {
    const key = 'k'
    expect(isCoolingDown(key, 1000)).toBe(false)
    markCoolingDown(key, DEFAULT_COOLDOWN_MS, 1000)
    expect(isCoolingDown(key, 1000)).toBe(true)
    expect(isCoolingDown(key, 1000 + DEFAULT_COOLDOWN_MS - 1)).toBe(true)
    expect(isCoolingDown(key, 1000 + DEFAULT_COOLDOWN_MS)).toBe(false)
  })

  it('clearCooldown 立即恢复', () => {
    const key = 'k'
    markCoolingDown(key, 60_000, 1000)
    expect(isCoolingDown(key, 1000)).toBe(true)
    clearCooldown(key)
    expect(isCoolingDown(key, 1000)).toBe(false)
  })

  it('只有值得换部署的错误类会触发降级', () => {
    expect(isFallbackWorthyCategory('rate_limit')).toBe(true)
    expect(isFallbackWorthyCategory('provider_http')).toBe(true)
    expect(isFallbackWorthyCategory('network')).toBe(true)
    expect(isFallbackWorthyCategory('provider_timeout')).toBe(true)
    // 账号/配置/契约类不降级
    expect(isFallbackWorthyCategory('quota')).toBe(false)
    expect(isFallbackWorthyCategory('authentication')).toBe(false)
    expect(isFallbackWorthyCategory('protocol')).toBe(false)
    expect(isFallbackWorthyCategory(null)).toBe(false)
  })
})

describe('getModelFallbacks（降级候选声明）', () => {
  it('flash 声明 agnes 作为降级候选', () => {
    expect(getModelFallbacks('deepseek-v4-flash')).toEqual(['agnes-3.0-flash'])
  })

  it('pro 声明 flash 作为降级候选', () => {
    expect(getModelFallbacks('deepseek-v4-pro')).toEqual(['deepseek-v4-flash'])
  })

  it('未声明 fallbacks 的模型返回空数组；未知模型同样为空', () => {
    expect(getModelFallbacks('agnes-3.0-flash')).toEqual([])
    expect(getModelFallbacks('unknown-model')).toEqual([])
  })
})
