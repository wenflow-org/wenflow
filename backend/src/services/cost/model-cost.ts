/**
 * 纯成本计算（无 IO / 不写库 / 不抛异常）。
 *
 * 这是 Q20「单位经济」的机制层第一步：只把「token → 金额」的换算做成可测的纯函数，
 * 单价仍是 `models.config.ts` 里的占位空表（等财务权威值）。设计口径见
 * `doc/UPGRADE_DIRECTION_20Q.md` §2 Q20 / §7。
 *
 * 口径约定：
 * - 粗算（agent_call_logs）：只用 promptTokens / completionTokens，`cachedTokens` 缺省为 0，
 *   因此缓存命中部分按输入全价计（会高估）。精确口径需 llm_execution_attempts 的缓存明细。
 * - 未知单价 ⇒ `usd: null / pricingKnown: false`，绝不返回 NaN、绝不默认 0。
 * - 金额按 {} 归属：prompt 中未命中的部分计 `input`，命中缓存的部分计 `cachedInput`，
 *   输出计 `output`。
 */
import { AVAILABLE_MODELS, ModelDefinition, ModelPricing } from '../../config/models.config';

/** 计算单价表所需的最小模型形状（实际就是 ModelDefinition 的三字段投影） */
export type PricingModel = Pick<ModelDefinition, 'id' | 'provider'> & { pricing?: ModelPricing };

/** 单价表：只读模型数组；传入即可覆盖默认的 AVAILABLE_MODELS */
export type PricingTable = ReadonlyArray<PricingModel>;

export interface CallCostInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** 命中 KV 前缀缓存的输入 token 数（属于 promptTokens 的子集）；缺省 0 */
  cachedTokens?: number;
}

export interface CallCostBreakdown {
  /** 未命中缓存的输入部分金额（USD）；未知时为 null */
  input: number | null;
  /** 命中缓存的输入部分金额（USD）；未知时为 null */
  cachedInput: number | null;
  /** 输出部分金额（USD）；未知时为 null */
  output: number | null;
}

export interface CallCostResult {
  /** 近似金额（USD）；单价未知时为 null */
  usd: number | null;
  breakdown: CallCostBreakdown;
  pricingKnown: boolean;
}

export interface ModelCostBucket {
  calls: number;
  pricedCalls: number;
  unpricedCalls: number;
  /** 该模型已定价调用金额合计（USD）；无已定价调用时为 null */
  usd: number | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export interface CostSummary {
  /** 已定价调用金额合计（USD），不含未定价调用 */
  totalUsd: number;
  pricedCalls: number;
  unpricedCalls: number;
  /** key = 归一化后的模型名；含未定价模型（usd=null） */
  byModel: Record<string, ModelCostBucket>;
}

export interface SummarizeCostsOptions {
  /** 覆盖默认单价表（测试/临时对账用；不改变 models.config） */
  pricingTable?: PricingTable;
}

/** 金额保留到 12 位小数：足够表达单次调用的微额成本，同时抹掉浮点尾差（避免 3.3e-6 变成 3.3000000000000004e-6） */
const USD_PRECISION = 1e-12;

function roundUsd(value: number): number {
  return Math.round(value / USD_PRECISION) * USD_PRECISION;
}

function toNonNegativeInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * 把模型名归一化为查表 key。容忍常见 provider/model-name 变体：
 * 1. 去首尾空白、转小写；
 * 2. 去掉路由标签后缀（`:` 之后，如 `deepseek-v4-flash:free`）；
 * 3. 去掉 provider 命名空间前缀（最后一个 `/` 之前，如 `deepseek/deepseek-v4-flash`）。
 *
 * 匹配规则：归一化后与 `ModelDefinition.id` **精确**比较（区分不开时宁可判为未知，也不做模糊/子串匹配，
 * 以免把不同价位的模型算错）。因此带日期版本后缀的 id（如 `xxx-20260101`）默认不命中，需显式入表。
 */
export function normalizeModelKey(model: string): string {
  if (typeof model !== 'string') return '';
  let key = model.trim().toLowerCase();
  if (!key) return '';
  const colon = key.indexOf(':');
  if (colon >= 0) key = key.slice(0, colon);
  const slash = key.lastIndexOf('/');
  if (slash >= 0) key = key.slice(slash + 1);
  return key.trim();
}

/**
 * 解析模型单价。未知模型 / 未配置 pricing 时返回 null。
 */
export function resolveModelPricing(
  model: string,
  availableModels: PricingTable = AVAILABLE_MODELS,
): ModelPricing | null {
  const key = normalizeModelKey(model);
  if (!key) return null;
  const match = availableModels.find((item) => normalizeModelKey(item.id) === key);
  return match?.pricing ?? null;
}

/**
 * 计算单次调用金额。
 *
 * - `cachedTokens` 是 `promptTokens` 的子集，会先 clamp 到 [0, promptTokens]；
 * - 命中缓存的单价缺省时回退到 `inputPer1M`（不折扣，保守高估）；
 * - 只有「当前实际发生的 token 类别」都有对应单价，才认为 pricingKnown；
 * - 未知单价 ⇒ `{ usd: null, pricingKnown: false, breakdown 全 null }`，不抛错、不 NaN。
 */
export function computeCallCostUsd(
  input: CallCostInput,
  pricingTableOverrides?: PricingTable,
): CallCostResult {
  const unknown: CallCostResult = {
    usd: null,
    breakdown: { input: null, cachedInput: null, output: null },
    pricingKnown: false,
  };

  const pricing = resolveModelPricing(input?.model ?? '', pricingTableOverrides ?? AVAILABLE_MODELS);
  if (!pricing) return unknown;

  const inputRate = pricing.inputPer1M;
  const cachedRate = pricing.cachedInputPer1M ?? inputRate;
  const outputRate = pricing.outputPer1M;
  const hasAnyRate =
    typeof inputRate === 'number' || typeof cachedRate === 'number' || typeof outputRate === 'number';
  if (!hasAnyRate) return unknown;

  const promptTokens = toNonNegativeInt(input?.promptTokens);
  const completionTokens = toNonNegativeInt(input?.completionTokens);
  const cachedTokens = Math.min(toNonNegativeInt(input?.cachedTokens), promptTokens);
  const uncachedInputTokens = promptTokens - cachedTokens;

  const needInput = uncachedInputTokens > 0;
  const needCached = cachedTokens > 0;
  const needOutput = completionTokens > 0;

  if (
    (needInput && typeof inputRate !== 'number') ||
    (needCached && typeof cachedRate !== 'number') ||
    (needOutput && typeof outputRate !== 'number')
  ) {
    return unknown;
  }

  const inputCost = (uncachedInputTokens * (inputRate ?? 0)) / 1_000_000;
  const cachedInputCost = (cachedTokens * (cachedRate ?? 0)) / 1_000_000;
  const outputCost = (completionTokens * (outputRate ?? 0)) / 1_000_000;

  return {
    usd: roundUsd(inputCost + cachedInputCost + outputCost),
    breakdown: {
      input: roundUsd(inputCost),
      cachedInput: roundUsd(cachedInputCost),
      output: roundUsd(outputCost),
    },
    pricingKnown: true,
  };
}

/**
 * 聚合多行调用的近似金额。未定价调用不计入 totalUsd，只计数；按模型分桶便于列出未定价模型。
 */
export function summarizeCosts(
  rows: ReadonlyArray<CallCostInput>,
  opts?: SummarizeCostsOptions,
): CostSummary {
  const table = opts?.pricingTable ?? AVAILABLE_MODELS;
  const byModel: Record<string, ModelCostBucket> = {};
  let totalUsd = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;

  for (const row of rows ?? []) {
    const promptTokens = toNonNegativeInt(row?.promptTokens);
    const completionTokens = toNonNegativeInt(row?.completionTokens);
    const cachedTokens = Math.min(toNonNegativeInt(row?.cachedTokens), promptTokens);
    const key = normalizeModelKey(row?.model ?? '') || '(unknown)';

    const bucket =
      byModel[key] ??
      (byModel[key] = {
        calls: 0,
        pricedCalls: 0,
        unpricedCalls: 0,
        usd: null,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
      });

    bucket.calls += 1;
    bucket.promptTokens += promptTokens;
    bucket.completionTokens += completionTokens;
    bucket.cachedTokens += cachedTokens;

    const result = computeCallCostUsd(
      { model: row?.model ?? '', promptTokens, completionTokens, cachedTokens },
      table,
    );

    if (result.pricingKnown && result.usd !== null) {
      bucket.pricedCalls += 1;
      bucket.usd = roundUsd((bucket.usd ?? 0) + result.usd);
      pricedCalls += 1;
      totalUsd = roundUsd(totalUsd + result.usd);
    } else {
      bucket.unpricedCalls += 1;
      unpricedCalls += 1;
    }
  }

  return { totalUsd, pricedCalls, unpricedCalls, byModel };
}
