/**
 * 链路概要卡的「估算成本」（2026-10-18 走查）。
 *
 * 旧实现按 deepseek-v4-flash 的公开价（¥0.5 / ¥2 每百万 token）硬算：那个模型已下线，
 * 而且成本分析页用的是 `llm-providers.json` 里登记的单价（USD）。同一控制台两个币种、
 * 两套价目表必然对不上——一条 agnes 链路按 DeepSeek 价显示，量级能差一个数量级。
 *
 * 现在的口径与成本分析页一致：**逐 span 用该 span 自己的模型去登记表查单价**，
 * 查到才计入；查不到（未登记 / 未配单价 / 不认识的模型名）计入 unpriced，不编造金额。
 * 单价来源 = 接入页的供应商注册表（`GET /admin/model-providers`，进程内缓存一次）。
 */
import { adminModelProvidersApi } from '@/api/adminApi'
import { normalizeModelName } from './modelNameMatch'

export interface TraceSpanCostInput {
  model?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
}

export interface ModelPrice {
  inputPer1M?: number | null
  outputPer1M?: number | null
}

/** 归一后的模型 key → 单价 */
export type PriceMap = Map<string, ModelPrice>

export interface TraceCostResult {
  /** 已定价调用的金额合计（USD）；一次都算不出 → null */
  usd: number | null
  /** 计入金额的调用数 */
  priced: number
  /** 有 token 但查不到单价的调用数（缺单价的模型名去重见 unpricedModels） */
  unpriced: number
  /** 计入金额的模型名（去重，按出现顺序） */
  pricedModels: string[]
  /** 未计入金额的模型名（去重，按出现顺序） */
  unpricedModels: string[]
}

/** 查表 key：与后端 `services/cost/model-cost.ts` 的 normalizeModelKey 同口径——
    先去 `:` 之后的路由标签后缀（如 `:free`），再取最后一个 `/` 之后的尾段、转小写。
    不命中就判未知（不做模糊/子串匹配，宁可显示「—」也不把不同价位的模型算错）。 */
export function pricingKeyOf(model: string | null | undefined): string {
  const raw = String(model ?? '').trim()
  if (!raw) return ''
  const noTag = raw.includes(':') ? raw.slice(0, raw.indexOf(':')) : raw
  return normalizeModelName(noTag)
}

/**
 * 逐 span 估算成本。纯函数：单价表由调用方给，便于单测与「读取失败不假装有价」。
 */
export function estimateTraceCostUsd(spans: ReadonlyArray<TraceSpanCostInput>, prices: PriceMap | null): TraceCostResult {
  let usd = 0
  let priced = 0
  let unpriced = 0
  const pricedModels: string[] = []
  const unpricedModels: string[] = []
  for (const s of spans) {
    const prompt = Number(s?.promptTokens) || 0
    const completion = Number(s?.completionTokens) || 0
    if (prompt + completion <= 0) continue // 没 token 的 span（网关/模拟）不参与，也不进未定价计数
    const model = String(s?.model ?? '').trim()
    const key = pricingKeyOf(model)
    const price = key && prices ? prices.get(key) : undefined
    const inputRate = price?.inputPer1M
    const outputRate = price?.outputPer1M
    const known = typeof inputRate === 'number' || typeof outputRate === 'number'
    if (!known) {
      unpriced += 1
      if (model && !unpricedModels.includes(model)) unpricedModels.push(model)
      continue
    }
    usd += (prompt * (typeof inputRate === 'number' ? inputRate : 0) + completion * (typeof outputRate === 'number' ? outputRate : 0)) / 1_000_000
    priced += 1
    if (model && !pricedModels.includes(model)) pricedModels.push(model)
  }
  return { usd: priced > 0 ? usd : null, priced, unpriced, pricedModels, unpricedModels }
}

/** 供应商注册表 → 单价表；读失败返回 null（调用方据此说「读不到单价」而不是「没配单价」）。
 *
 *  两条合并规则（2026-10-18 浏览器实测踩到）：
 *  ① 停用的供应商不参与——运行时不路由它们，而 `custom-provider-example`（示例条目，
 *     enabled=false）登记的模型 id 与平台通道**同名**且没配单价；
 *  ② 同一个模型 id 出现多次时，已配单价的条目不被「空单价」条目覆盖，
 *     否则按注册表顺序合并，后面那条 null 会把前面的真单价抹掉（实测 agnes-3.0-flash 就是这样
 *     变成「未配单价」的）。 */
export async function fetchModelPrices(): Promise<PriceMap | null> {
  try {
    const res = await adminModelProvidersApi.get()
    const providers = (res?.data?.data ?? res?.data)?.providers
    if (!Array.isArray(providers)) return null
    const map: PriceMap = new Map()
    for (const p of providers) {
      if (p?.enabled === false) continue
      const models = Array.isArray(p?.models) ? p.models : []
      for (const m of models) {
        const key = pricingKeyOf(m?.id)
        if (!key) continue
        const price = (m?.pricing ?? {}) as ModelPrice
        const hasRate = typeof price.inputPer1M === 'number' || typeof price.outputPer1M === 'number'
        if (!map.has(key) || hasRate) map.set(key, price)
      }
    }
    return map
  } catch {
    return null
  }
}

/* 进程内缓存：概要卡随链路切换重算，没必要每换一条链路打一次注册表接口。
   失败也缓存（null），避免网络坏时每次切换链路都挂 5s 超时。 */
let priceMapPromise: Promise<PriceMap | null> | null = null
export function loadModelPrices(): Promise<PriceMap | null> {
  if (!priceMapPromise) priceMapPromise = fetchModelPrices()
  return priceMapPromise
}

/** 单测用：清掉进程内缓存 */
export function __resetPriceCache(): void {
  priceMapPromise = null
}
