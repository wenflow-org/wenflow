/**
 * 链路概要卡「估算成本」的算钱口径（2026-10-18 走查）。
 *
 * 背景：旧实现把 deepseek-v4-flash 的公开价（¥0.5 / ¥2 每百万）写死在页面里，那个模型已下线，
 * 而且成本分析页用的是登记表里的 USD 单价——同屏两个币种两套价目表。现在改成逐 span 用
 * 自己的模型查登记单价，查不到就不计（与成本页「缺单价不编造金额」同口径）。
 * 这里锁三件事：① 逐 span 各按自己的模型价；② 未配单价的调用不计入但如实计数；
 * ③ 模型名归一（provider 前缀 / `:free` 标签）与后端 normalizeModelKey 同口径。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateTraceCostUsd, pricingKeyOf, type PriceMap } from '../traceCost'

const providers = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock('@/api/adminApi', () => ({
  adminModelProvidersApi: {
    get: vi.fn(async () => ({ data: { data: { providers: providers.value } } }))
  }
}))
const { fetchModelPrices, __resetPriceCache } = await import('../traceCost')

const PRICES: PriceMap = new Map([
  ['deepseek-v4.1-flash', { inputPer1M: 0.3, cachedInputPer1M: 0.006, outputPer1M: 1.2 }],
  ['agnes-3.0-flash', { inputPer1M: 0.03, outputPer1M: 0.15 }]
])

describe('pricingKeyOf（与后端 normalizeModelKey 同口径）', () => {
  it('取最后一个 / 之后的尾段并转小写', () => {
    expect(pricingKeyOf('deepseek/deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(pricingKeyOf('DeepSeek-V4.1-Flash')).toBe('deepseek-v4.1-flash')
  })

  it('去掉 : 之后的路由标签后缀', () => {
    expect(pricingKeyOf('deepseek-v4.1-flash:free')).toBe('deepseek-v4.1-flash')
  })

  it('空值给空串（调用方据此判未定价）', () => {
    expect(pricingKeyOf('')).toBe('')
    expect(pricingKeyOf(null)).toBe('')
  })
})

describe('estimateTraceCostUsd（逐 span 按自己模型的单价算）', () => {
  it('同一条链路里的两个模型各按自己的价（不是统一按主模型价）', () => {
    const r = estimateTraceCostUsd([
      { model: 'deepseek-v4.1-flash', promptTokens: 1_000_000, completionTokens: 0 },
      { model: 'agnes-3.0-flash', promptTokens: 1_000_000, completionTokens: 0 }
    ], PRICES)
    expect(r.usd).toBeCloseTo(0.33, 6)   // 0.3（v4.1）+ 0.03（agnes）
    expect(r.priced).toBe(2)
    expect(r.unpriced).toBe(0)
    expect(r.pricedModels).toEqual(['deepseek-v4.1-flash', 'agnes-3.0-flash'])
  })

  it('输出 token 按输出单价：输入与输出分开计价', () => {
    const r = estimateTraceCostUsd([{ model: 'deepseek-v4.1-flash', promptTokens: 500_000, completionTokens: 100_000 }], PRICES)
    expect(r.usd).toBeCloseTo(0.15 + 0.12, 6)
  })

  it('未登记单价（或未登记的模型名）不计入金额，但如实计数并列出模型名', () => {
    const r = estimateTraceCostUsd([
      { model: 'deepseek-v4.1-flash', promptTokens: 1_000_000, completionTokens: 0 },
      { model: 'someone-else-9b', promptTokens: 1_000_000, completionTokens: 0 },
      { model: 'agnes-3.0-flash', promptTokens: 1_000_000, completionTokens: 0 }
    ], PRICES)
    expect(r.usd).toBeCloseTo(0.33, 6)
    expect(r.priced).toBe(2)
    expect(r.unpriced).toBe(1)
    expect(r.unpricedModels).toEqual(['someone-else-9b'])
  })

  it('单价表读不到（null）：算不出金额就别给数，全部计未定价', () => {
    const r = estimateTraceCostUsd([{ model: 'deepseek-v4.1-flash', promptTokens: 100, completionTokens: 100 }], null)
    expect(r.usd).toBeNull()
    expect(r.priced).toBe(0)
    expect(r.unpriced).toBe(1)
  })

  it('没有 token 的 span（网关/模拟类）不参与，也不冒充「未定价调用」', () => {
    const r = estimateTraceCostUsd([
      { model: null, promptTokens: 0, completionTokens: 0 },
      { model: 'deepseek-v4.1-flash', promptTokens: null, completionTokens: null }
    ], PRICES)
    expect(r.usd).toBeNull()
    expect(r.unpriced).toBe(0)
    expect(r.unpricedModels).toEqual([])
  })

  it('模型只配了输出单价：输入部分按 0 计、仍算已定价（不整条判未定价）', () => {
    const prices: PriceMap = new Map([['half-priced', { outputPer1M: 1 }]])
    const r = estimateTraceCostUsd([{ model: 'half-priced', promptTokens: 1_000_000, completionTokens: 1_000_000 }], prices)
    expect(r.usd).toBeCloseTo(1, 6)
    expect(r.priced).toBe(1)
  })
})

describe('fetchModelPrices（注册表 → 单价表）', () => {
  beforeEach(() => {
    __resetPriceCache()
    providers.value = []
  })

  it('停用的供应商不参与（示例条目与平台通道同名且没配单价）', async () => {
    providers.value = [
      { id: 'platform', enabled: true, models: [{ id: 'agnes-3.0-flash', pricing: { inputPer1M: 0.03, outputPer1M: 0.15 } }] },
      { id: 'custom-provider-example', enabled: false, models: [{ id: 'agnes-3.0-flash', pricing: null }] }
    ]
    const map = await fetchModelPrices()
    expect(map?.get('agnes-3.0-flash')).toEqual({ inputPer1M: 0.03, outputPer1M: 0.15 })
  })

  it('同名模型多次登记：空单价不覆盖已配单价（顺序无关）', async () => {
    providers.value = [
      { id: 'a', enabled: true, models: [{ id: 'm1', pricing: null }] },
      { id: 'b', enabled: true, models: [{ id: 'm1', pricing: { inputPer1M: 1 } }] }
    ]
    const map = await fetchModelPrices()
    expect(map?.get('m1')).toEqual({ inputPer1M: 1 })
  })

  it('provider/model 前缀变体归一后能查到（deepseek/deepseek-v4.1-flash）', async () => {
    providers.value = [{ id: 'platform', enabled: true, models: [{ id: 'deepseek-v4.1-flash', pricing: { inputPer1M: 0.3 } }] }]
    const map = await fetchModelPrices()
    expect(map?.get(pricingKeyOf('deepseek/deepseek-v4.1-flash'))).toEqual({ inputPer1M: 0.3 })
  })
})
