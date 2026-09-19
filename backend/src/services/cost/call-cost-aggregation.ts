/**
 * 调用成本聚合（只读纯函数，无 IO / 不写库 / 不抛异常）。
 *
 * 复用 `model-cost.ts` 的既有口径，不重复造换算：
 * - 金额由 `computeCallCostUsd` 计算；
 * - 单价未知 ⇒ `usd: null / pricingKnown: false`，**绝不用 0 冒充**；
 * - `agent_call_logs` 无缓存命中明细，`cachedTokens` 缺省 0，缓存命中部分按输入全价计（保守高估）。
 *
 * 本模块只做「多行调用 → 分桶」的纯函数；数据库读取与时间范围过滤留在路由层
 * （与 `/api/admin/token-cost/*` 现有 days/includeTest 口径一致）。
 *
 * 桶语义（每个 `CostBucket`）：
 * - `calls` / `promptTokens` / `completionTokens`：该桶内全部调用（含未定价）；
 * - `pricedCalls`：能算出金额并计入 `usd` 的调用数；
 * - `callsMissingPricing`：单价未知、未计入 `usd` 的调用数；
 * - `usd`：已定价调用金额合计；**没有任何已定价调用时为 null**（不是 0）；
 * - `pricingKnown`：是否所有调用都有单价（存在未定价调用即为 false，即使 `usd` 是部分金额）。
 */
import {
  computeCallCostUsd,
  resolveModelPricing,
  roundUsd,
  type PricingTable,
} from './model-cost';
import { AVAILABLE_MODELS, type ModelPricing } from '../../config/models.config';

/** 未归因（无 model / skillId / agentId / userId）时的分组 key，与 token-cost 路由一致 */
export const UNATTRIBUTED_KEY = '未归因';
/** 无会话归属时的分组 key，与 audit-session-cost 脚本一致 */
export const NO_SESSION_KEY = '(无会话)';

/** 聚合输入行（字段与 agent_call_logs 选列对齐；维度字段可选） */
export interface CostInputRow {
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** 命中 KV 前缀缓存的输入 token（promptTokens 子集）；agent_call_logs 无此列时缺省 0 */
  cachedTokens?: number | null;
  /** 会话归因（agent_call_logs.sessionId） */
  sessionId?: string | null;
  /** 技能归因（metadata.skillId 解析结果） */
  skillId?: string | null;
  /** 节点归因（agent_call_logs.agentId） */
  agentId?: string | null;
  /** 用户归因（agent_call_logs.userId） */
  userId?: string | null;
}

/** 单个维度桶（成本 + 用量 + 调用计数） */
export interface CostBucket {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** 已定价调用金额合计（USD）；无任何已定价调用时为 null */
  usd: number | null;
  /** 是否所有调用都有单价（存在未定价调用即为 false） */
  pricingKnown: boolean;
  /** 单价未知、未计入 usd 的调用数 */
  callsMissingPricing: number;
  /** 已定价、计入 usd 的调用数 */
  pricedCalls: number;
}

/** 带分组 key 的桶 */
export interface GroupedCost<K extends string = string> extends CostBucket {
  key: K;
  display: string;
}

/** 单价配置状态：让运维知道该去补哪些模型的单价 */
export interface PricingStatus {
  /** 已出现且能解析到至少一个费率的模型（原始名去重） */
  configuredModels: string[];
  /** 已出现但解析不到单价 / 单价为空占位的模型（原始名去重）——运维补价清单 */
  missingPricingModels: string[];
}

/** 三维（模型 / 会话 / 技能 / 节点）+ 总量聚合结果 */
export interface CallCostAggregation {
  totals: CostBucket;
  byModel: GroupedCost[];
  bySession: GroupedCost[];
  bySkill: GroupedCost[];
  byAgent: GroupedCost[];
  pricingStatus: PricingStatus;
}

export interface AggregateCallCostsOptions {
  /** 覆盖默认单价表（测试/临时对账用；不改变 models.config） */
  pricingTable?: PricingTable;
}

/** 新建零值成本桶（路由侧初始化 RankEntry 用） */
export function createCostBucket(): CostBucket {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    usd: null,
    pricingKnown: true,
    callsMissingPricing: 0,
    pricedCalls: 0,
  };
}

function toNonNegativeInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * 单遍累加：把一行调用计入桶（供路由与聚合函数共用）。
 *
 * - 与 `computeCallCostUsd` 语义完全一致（不重复实现换算）；
 * - 未知单价的调用只增加 `callsMissingPricing`，不污染 `usd`；
 * - 每次累加后同步 `pricingKnown = callsMissingPricing === 0`。
 */
export function accumulateCost(
  bucket: CostBucket,
  row: CostInputRow,
  pricingTable: PricingTable = AVAILABLE_MODELS,
): CostBucket {
  const promptTokens = toNonNegativeInt(row?.promptTokens);
  const completionTokens = toNonNegativeInt(row?.completionTokens);
  const cachedTokens = Math.min(toNonNegativeInt(row?.cachedTokens), promptTokens);

  bucket.calls += 1;
  bucket.promptTokens += promptTokens;
  bucket.completionTokens += completionTokens;

  const result = computeCallCostUsd(
    { model: row?.model ?? '', promptTokens, completionTokens, cachedTokens },
    pricingTable,
  );

  if (result.pricingKnown && result.usd !== null) {
    bucket.pricedCalls += 1;
    bucket.usd = roundUsd((bucket.usd ?? 0) + result.usd);
  } else {
    bucket.callsMissingPricing += 1;
  }
  bucket.pricingKnown = bucket.callsMissingPricing === 0;
  return bucket;
}

/** 汇总多行调用为一个成本桶（不分组） */
export function summarizeCallCosts(
  rows: ReadonlyArray<CostInputRow>,
  opts?: AggregateCallCostsOptions,
): CostBucket {
  const table = opts?.pricingTable ?? AVAILABLE_MODELS;
  const bucket = createCostBucket();
  for (const row of rows ?? []) accumulateCost(bucket, row, table);
  return bucket;
}

export interface GroupCostsOptions<K extends string> extends AggregateCallCostsOptions {
  /** keyOf 返回空值时的兜底 key（默认「未归因」） */
  fallbackKey?: K;
  /** key → 展示名（默认同 key） */
  displayOf?: (key: K) => string;
}

/**
 * 通用分组聚合：`keyOf` 提取分组键（空值归入 `fallbackKey`）。
 * 保持首次出现顺序；每个 key 一个桶。
 */
export function groupCosts<K extends string>(
  rows: ReadonlyArray<CostInputRow>,
  keyOf: (row: CostInputRow) => K | null | undefined,
  opts?: GroupCostsOptions<K>,
): GroupedCost<K>[] {
  const table = opts?.pricingTable ?? AVAILABLE_MODELS;
  const fallback = (opts?.fallbackKey ?? UNATTRIBUTED_KEY) as K;
  const map = new Map<K, GroupedCost<K>>();

  for (const row of rows ?? []) {
    const raw = keyOf(row);
    const key = (raw === null || raw === undefined || raw === '' ? fallback : raw) as K;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        display: opts?.displayOf ? opts.displayOf(key) : String(key),
        ...createCostBucket(),
      };
      map.set(key, bucket);
    }
    accumulateCost(bucket, row, table);
  }

  return [...map.values()];
}

/** pricing 是否至少配置了一个费率（空对象 `{}` 视为未配置） */
function hasConfiguredRate(pricing: ModelPricing | null): boolean {
  if (!pricing) return false;
  return [pricing.inputPer1M, pricing.cachedInputPer1M, pricing.outputPer1M].some(
    (value) => typeof value === 'number' && Number.isFinite(value),
  );
}

/**
 * 依据「实际出现过的模型」列出已配置 / 待补单价的模型（原始名去重，保持出现顺序）。
 * 用于运维定位「该去补哪些模型的单价」。
 */
export function describePricingStatus(
  observedModels: ReadonlyArray<string | null | undefined>,
  pricingTable: PricingTable = AVAILABLE_MODELS,
): PricingStatus {
  const configuredModels: string[] = [];
  const missingPricingModels: string[] = [];
  const seen = new Set<string>();

  for (const raw of observedModels ?? []) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (hasConfiguredRate(resolveModelPricing(name, pricingTable))) configuredModels.push(name);
    else missingPricingModels.push(name);
  }

  return { configuredModels, missingPricingModels };
}

/**
 * 三维聚合：按模型 / 会话 / 技能（skillId）/ 节点（agentId）分桶，并给出总量与单价状态。
 */
export function aggregateCallCosts(
  rows: ReadonlyArray<CostInputRow>,
  opts?: AggregateCallCostsOptions,
): CallCostAggregation {
  const table = opts?.pricingTable ?? AVAILABLE_MODELS;
  return {
    totals: summarizeCallCosts(rows, { pricingTable: table }),
    byModel: groupCosts(rows, (row) => row.model || UNATTRIBUTED_KEY, { pricingTable: table }),
    bySession: groupCosts(rows, (row) => row.sessionId || NO_SESSION_KEY, { pricingTable: table }),
    bySkill: groupCosts(rows, (row) => row.skillId || UNATTRIBUTED_KEY, { pricingTable: table }),
    byAgent: groupCosts(rows, (row) => row.agentId || UNATTRIBUTED_KEY, { pricingTable: table }),
    pricingStatus: describePricingStatus(
      (rows ?? []).map((row) => row?.model ?? ''),
      table,
    ),
  };
}
