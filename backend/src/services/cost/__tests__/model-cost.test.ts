import {
  computeCallCostUsd,
  normalizeModelKey,
  resolveModelPricing,
  summarizeCosts,
  type PricingTable,
} from '../model-cost'

const PRICED: PricingTable = [
  { id: 'test-model', provider: 'deepseek', pricing: { inputPer1M: 1, cachedInputPer1M: 0.25, outputPer1M: 2 } },
  { id: 'output-only-model', provider: 'agnes', pricing: { outputPer1M: 4 } },
  { id: 'no-price-model', provider: 'agnes' },
]

const PRICED_VARIANTS: PricingTable = [
  { id: 'deepseek-v4-flash', provider: 'deepseek', pricing: { inputPer1M: 3 } },
]

describe('normalizeModelKey / resolveModelPricing', () => {
  it('默认表未填价时，已知模型也解析为 null（占位空表）', () => {
    expect(resolveModelPricing('deepseek-v4-flash')).toBeNull()
    expect(resolveModelPricing('agnes-3.0-flash')).toBeNull()
  })

  it('归一化匹配大小写 / 首尾空白', () => {
    expect(resolveModelPricing('  DeepSeek-V4-Flash  ', PRICED_VARIANTS)).toEqual({ inputPer1M: 3 })
  })

  it('归一化匹配 provider 前缀与路由标签后缀', () => {
    expect(resolveModelPricing('deepseek/deepseek-v4-flash', PRICED_VARIANTS)).toEqual({ inputPer1M: 3 })
    expect(resolveModelPricing('openrouter/deepseek/deepseek-v4-flash:free', PRICED_VARIANTS)).toEqual({
      inputPer1M: 3,
    })
  })

  it('未知模型名 / 空串 / 非字符串返回 null', () => {
    expect(resolveModelPricing('gpt-4o', PRICED_VARIANTS)).toBeNull()
    expect(resolveModelPricing('', PRICED_VARIANTS)).toBeNull()
    expect(resolveModelPricing('   ', PRICED_VARIANTS)).toBeNull()
    expect(resolveModelPricing(undefined as unknown as string, PRICED_VARIANTS)).toBeNull()
    expect(normalizeModelKey('deepseek/deepseek-v4-flash:free')).toBe('deepseek-v4-flash')
  })
})

describe('computeCallCostUsd', () => {
  it('未知单价 ⇒ usd=null / pricingKnown=false，breakdown 全 null，不抛错不 NaN', () => {
    const result = computeCallCostUsd({ model: 'not-in-table', promptTokens: 100, completionTokens: 50 })
    expect(result).toEqual({
      usd: null,
      breakdown: { input: null, cachedInput: null, output: null },
      pricingKnown: false,
    })
  })

  it('未配置任何单价的 pricing: {} 也视为未知', () => {
    const result = computeCallCostUsd(
      { model: 'empty-pricing', promptTokens: 100, completionTokens: 50 },
      [{ id: 'empty-pricing', provider: 'agnes', pricing: {} }],
    )
    expect(result.pricingKnown).toBe(false)
    expect(result.usd).toBeNull()
  })

  it('基础：未命中输入 + 输出分别计价', () => {
    const result = computeCallCostUsd(
      { model: 'test-model', promptTokens: 1_000_000, completionTokens: 500_000 },
      PRICED,
    )
    expect(result.pricingKnown).toBe(true)
    expect(result.usd).toBeCloseTo(2, 12)
    expect(result.breakdown.input).toBeCloseTo(1, 12)
    expect(result.breakdown.cachedInput).toBeCloseTo(0, 12)
    expect(result.breakdown.output).toBeCloseTo(1, 12)
  })

  it('缓存命中 vs 未命中输入拆分（命中按 cachedInputPer1M）', () => {
    const result = computeCallCostUsd(
      { model: 'test-model', promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 800_000 },
      PRICED,
    )
    expect(result.usd).toBeCloseTo(0.4, 12)
    expect(result.breakdown.input).toBeCloseTo(0.2, 12)
    expect(result.breakdown.cachedInput).toBeCloseTo(0.2, 12)
  })

  it('缺 cachedInputPer1M 时缓存部分回退按输入全价（不折扣，保守高估）', () => {
    const result = computeCallCostUsd(
      { model: 'fallback-model', promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 500_000 },
      [{ id: 'fallback-model', provider: 'deepseek', pricing: { inputPer1M: 1, outputPer1M: 0 } }],
    )
    expect(result.pricingKnown).toBe(true)
    expect(result.breakdown.input).toBeCloseTo(0.5, 12)
    expect(result.breakdown.cachedInput).toBeCloseTo(0.5, 12)
    expect(result.usd).toBeCloseTo(1, 12)
  })

  it('零 token：有明确单价时金额为 0 且 pricingKnown=true', () => {
    const result = computeCallCostUsd({ model: 'test-model', promptTokens: 0, completionTokens: 0 }, PRICED)
    expect(result.pricingKnown).toBe(true)
    expect(result.usd).toBe(0)
    expect(result.breakdown).toEqual({ input: 0, cachedInput: 0, output: 0 })
  })

  it('金额保留到 12 位小数，抹掉浮点尾差', () => {
    const result = computeCallCostUsd(
      { model: 'rounding-model', promptTokens: 1, completionTokens: 0 },
      [{ id: 'rounding-model', provider: 'deepseek', pricing: { inputPer1M: 1 / 3 } }],
    )
    // 未舍入为 3.333333333333333e-7，舍入到 12 位小数后为 3.33333e-7
    expect(result.usd).toBe(0.000000333333)
  })

  it('按当前 token 类别判断：缺输入价且有 prompt 时未知，但 completion-only 可算', () => {
    const withPrompt = computeCallCostUsd(
      { model: 'output-only-model', promptTokens: 1000, completionTokens: 100 },
      PRICED,
    )
    expect(withPrompt.pricingKnown).toBe(false)
    expect(withPrompt.usd).toBeNull()

    const outputOnly = computeCallCostUsd(
      { model: 'output-only-model', promptTokens: 0, completionTokens: 100 },
      PRICED,
    )
    expect(outputOnly.pricingKnown).toBe(true)
    expect(outputOnly.usd).toBeCloseTo(0.0004, 12)
  })

  it('pricingTableOverrides 覆盖默认表；不传则用默认空表判为未知', () => {
    const input = { model: 'test-model', promptTokens: 1_000_000, completionTokens: 0 }
    expect(computeCallCostUsd(input, PRICED).usd).toBeCloseTo(1, 12)
    expect(computeCallCostUsd(input).pricingKnown).toBe(false)
  })

  it('非法 token 值（负数 / NaN）按 0；cachedTokens 超出 prompt 会被 clamp', () => {
    const guarded = computeCallCostUsd(
      { model: 'test-model', promptTokens: -100, completionTokens: Number.NaN, cachedTokens: 50 },
      PRICED,
    )
    expect(guarded.usd).toBe(0)

    const clamped = computeCallCostUsd(
      { model: 'test-model', promptTokens: 100, completionTokens: 0, cachedTokens: 999 },
      PRICED,
    )
    expect(clamped.breakdown.input).toBe(0)
    expect(clamped.breakdown.cachedInput).toBeCloseTo(0.000025, 12)
  })
})

describe('summarizeCosts', () => {
  it('混合已定价 / 未定价：总金额只含已定价，未定价按模型分桶并计数', () => {
    const summary = summarizeCosts(
      [
        { model: 'test-model', promptTokens: 1_000_000, completionTokens: 0 },
        { model: 'TEST-MODEL', promptTokens: 0, completionTokens: 1_000_000 },
        { model: 'no-price-model', promptTokens: 100, completionTokens: 100 },
        { model: 'ghost-model', promptTokens: 1, completionTokens: 1 },
      ],
      { pricingTable: PRICED },
    )

    expect(summary.pricedCalls).toBe(2)
    expect(summary.unpricedCalls).toBe(2)
    expect(summary.totalUsd).toBeCloseTo(3, 12)

    expect(summary.byModel['test-model'].calls).toBe(2)
    expect(summary.byModel['test-model'].pricedCalls).toBe(2)
    expect(summary.byModel['test-model'].usd).toBeCloseTo(3, 12)
    expect(summary.byModel['test-model'].promptTokens).toBe(1_000_000)
    expect(summary.byModel['test-model'].completionTokens).toBe(1_000_000)

    expect(summary.byModel['no-price-model'].unpricedCalls).toBe(1)
    expect(summary.byModel['no-price-model'].usd).toBeNull()
    expect(summary.byModel['ghost-model'].unpricedCalls).toBe(1)
  })

  it('全部未定价：totalUsd=0 但 pricedCalls=0，金额不可用（不是 0 成本）', () => {
    const summary = summarizeCosts([{ model: 'no-price-model', promptTokens: 10, completionTokens: 10 }], {
      pricingTable: PRICED,
    })
    expect(summary.pricedCalls).toBe(0)
    expect(summary.unpricedCalls).toBe(1)
    expect(summary.totalUsd).toBe(0)
    expect(summary.byModel['no-price-model'].usd).toBeNull()
  })

  it('空行数组返回零摘要', () => {
    expect(summarizeCosts([], { pricingTable: PRICED })).toEqual({
      totalUsd: 0,
      pricedCalls: 0,
      unpricedCalls: 0,
      byModel: {},
    })
  })
})
