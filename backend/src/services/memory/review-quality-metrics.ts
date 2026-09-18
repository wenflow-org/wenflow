/**
 * 复习选点质量度量（升级方向 Q1：**先量化"复习选点"质量，再决定要不要引入排序模型**）
 *
 * 定位：本模块只做**测量**，不做选点、不改调度、不碰数据库。
 * 输入是"已经取好的数据"（选点计划、复习证据、额度账本行），输出是确定性、可单测的指标。
 * 这样做的原因（与 `retention-curve.ts` 同一哲学）：
 *   在引入排序模型之前，先用可复算的观测指标回答"当前选点到底差在哪"，
 *   否则无法证明排序模型带来了改进，也无法为它设定验收基线。
 *
 * ⚠️ 全局口径边界（所有指标共享，结论必须带上）：
 * - **观测性，非因果**：什么点在什么时候被复习，是由调度器（FSRS 到期）与当日配额共同决定的，
 *   与概念难度/掌握度相关。指标只描述现状，**不能**读成"选点策略导致 X"。
 * - **无向量/无语义模型**：没有 embedding，所谓"交错（interleaving）"只能用**概念键是否相同**
 *   近似，无法度量真正的语义干扰（见 `computeInterleavingProxy`）。
 * - **纯函数**：不读时钟、不访问 DB、不依赖全局状态；同一输入必得同一输出，便于回归对比。
 */

import { isRetrievalSuccess, isRetrievalSuccessLenient } from './retention-curve';

/** 目标保留率（FSRS `desiredRetention` 语义）：复习时点 retention 高于它 = "过早复习" */
export const DEFAULT_TARGET_RETENTION = 0.9;

/** 复习评分的已知取值（与 `ReviewCompletedConsumer.ReviewRating` 同口径） */
export const KNOWN_REVIEW_RATINGS = ['again', 'hard', 'good', 'easy'] as const;
export type KnownReviewRating = (typeof KNOWN_REVIEW_RATINGS)[number];
export type ReviewRatingBucket = KnownReviewRating | 'unknown';

export interface ReviewQualityThresholds {
  /** 目标保留率；`computeRetrievabilityRegret` 用它判定"过早复习" */
  targetRetention: number;
}

function resolveThresholds(overrides?: Partial<ReviewQualityThresholds>): ReviewQualityThresholds {
  const raw = overrides?.targetRetention;
  const targetRetention = typeof raw === 'number' && Number.isFinite(raw) ? clamp01(raw) : DEFAULT_TARGET_RETENTION;
  return { targetRetention };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 四舍五入到 4 位小数：指标输出统一精度，避免浮点尾差让快照对比抖动 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** 概念键的最小归一化：仅去空白。完整归一化由调用方（CLI）走 `normalizeConceptKey`。 */
function localConceptKey(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** 统计每个概念的出现次数（保持首次出现顺序，便于稳定取 top / tie-break） */
function countByConcept(keys: ReadonlyArray<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) 可提取性后悔（retrievability regret）
// ─────────────────────────────────────────────────────────────────────────────

export interface RetrievabilityObservation {
  conceptKey: string;
  /** 选点/复习时点的可提取概率（FSRS retrievability，0..1）；缺失（null/NaN）计入 missing */
  retention?: number | null | undefined;
}

export interface RetrievabilityRegretSummary {
  /** 有效样本数（retention 为有限数，已 clamp 到 [0,1]） */
  validCount: number;
  /** retention 缺失/非有限的样本数 */
  missingCount: number;
  /** 平均保留率（有效样本）；无有效样本为 null */
  meanRetention: number | null;
  /** 平均后悔值：mean(max(0, retention − target))；无有效样本为 null */
  meanRegret: number | null;
  /** 单点最大后悔值；无有效样本为 null */
  maxRegret: number | null;
  /** 过早复习占比：retention > target 的有效样本比例；无有效样本为 null */
  overTargetRate: number | null;
  /** 目标保留率（回显，便于解释） */
  targetRetention: number;
}

/**
 * 可提取性后悔：**平均"复习得太早"的程度**。
 *
 * 定义：对每个被选中/被复习的点位，`regret = max(0, retention − target)`；
 * 再对有效样本取平均。retention 高于目标说明"它其实还没忘"——这次复习消耗了
 * 认知预算却没带来多少巩固收益（Bjork 的"有益困难"要求检索时有一定遗忘）。
 *
 * 假设/限制：
 * - retention 是**选点时刻**的可提取概率估计（来自 `memoryWarmup.items[].retention`），
 *   不是复习后回填值；本函数不负责推算，只负责聚合。
 * - target 默认 0.9（FSRS desiredRetention 量级）；它是策略参数，不是真理，
 *   换 target 会整体平移 meanRegret，跨报告对比时必须固定。
 * - 非有限值视为缺失（`missingCount`），不参与均值；缺得太多时结论不可靠。
 */
export function computeRetrievabilityRegret(
  items: ReadonlyArray<RetrievabilityObservation>,
  thresholds?: Partial<ReviewQualityThresholds>,
): RetrievabilityRegretSummary {
  const { targetRetention } = resolveThresholds(thresholds);
  let validCount = 0;
  let missingCount = 0;
  let retentionSum = 0;
  let regretSum = 0;
  let maxRegret = 0;
  let overTarget = 0;

  for (const item of items) {
    const retention = toFiniteNumber(item?.retention);
    if (retention === null) {
      missingCount += 1;
      continue;
    }
    const value = clamp01(retention);
    validCount += 1;
    retentionSum += value;
    const regret = Math.max(0, value - targetRetention);
    regretSum += regret;
    if (regret > maxRegret) maxRegret = regret;
    if (value > targetRetention) overTarget += 1;
  }

  if (validCount === 0) {
    return {
      validCount: 0,
      missingCount,
      meanRetention: null,
      meanRegret: null,
      maxRegret: null,
      overTargetRate: null,
      targetRetention,
    };
  }
  return {
    validCount,
    missingCount,
    meanRetention: round4(retentionSum / validCount),
    meanRegret: round4(regretSum / validCount),
    maxRegret: round4(maxRegret),
    overTargetRate: round4(overTarget / validCount),
    targetRetention,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) 到期覆盖（due coverage）
// ─────────────────────────────────────────────────────────────────────────────

export interface DueCoverageInput {
  /** 实际选中/复习的点数 */
  selectedCount: number;
  /** 同一时点的到期积压总数（应 ≥ selectedCount；含未选中的部分） */
  dueCount: number;
}

export interface DueCoverageSummary {
  selectedCount: number;
  dueCount: number;
  /** 原始比值 selected/due；due<=0 时为 null */
  rawCoverage: number | null;
  /** 截断到 [0,1] 的覆盖率（主口径）；due<=0 时为 null */
  coverage: number | null;
  /** 未服务的到期积压 = max(0, due − selected) */
  backlog: number;
  /** selected > due 的多出量（口径不一致/异常的信号） */
  overSelected: number;
}

function nonNegativeInt(value: unknown): number {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric <= 0) return 0;
  return Math.floor(numeric);
}

/**
 * 到期覆盖：**到期积压里有多大比例真的被服务到了**。
 *
 * 定义：`coverage = selected / due`（due > 0），并截断到 [0,1]；
 * `backlog = due − selected` 是没被服务的部分。
 *
 * 假设/限制：
 * - due 是"同一时点的到期总量"的**快照**。历史时点的真实到期数没有落库，
 *   工程上用"选中数 + 计划里持久化的 backlogCount"近似（见 CLI 说明）。
 * - selected > due 说明口径不一致（例如 due 只统计了当前路径），此时 coverage 记 1，
 *   并用 `overSelected` 显式暴露，而不是给出 >100% 的假覆盖率。
 * - due = 0 且 selected = 0 → coverage 无意义，返回 null（不要把它当 0%）。
 */
export function computeDueCoverage(input: DueCoverageInput): DueCoverageSummary {
  const selectedCount = nonNegativeInt(input?.selectedCount);
  const dueCount = nonNegativeInt(input?.dueCount);
  if (dueCount <= 0) {
    return {
      selectedCount,
      dueCount: 0,
      rawCoverage: null,
      coverage: null,
      backlog: 0,
      overSelected: selectedCount,
    };
  }
  const raw = selectedCount / dueCount;
  return {
    selectedCount,
    dueCount,
    rawCoverage: round4(raw),
    coverage: round4(clamp01(raw)),
    backlog: Math.max(0, dueCount - selectedCount),
    overSelected: Math.max(0, selectedCount - dueCount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) 概念覆盖熵（concept coverage entropy）
// ─────────────────────────────────────────────────────────────────────────────

export interface ConceptCoverageOptions {
  /** 概念全集（例如该学习者所有 `extractionCount > 0` 的痕迹）：用于检测"窗口内一次都没复习到"的饥饿概念 */
  universeConceptKeys?: ReadonlyArray<string>;
}

export interface ConceptCoverageEntropySummary {
  /** 有效复习次数（概念键非空的条目数） */
  totalReviews: number;
  /** 窗口内出现过的不同概念数 */
  distinctConcepts: number;
  /** 香农熵（bit）：−Σ p·log2(p)；无样本为 null */
  entropyBits: number | null;
  /** 该概念数下的熵上界 log2(distinct)；distinct<=1 时为 0；无样本为 null */
  maxEntropyBits: number | null;
  /** 归一化熵 0..1（entropy/max；distinct<=1 时 0）；无样本为 null。越低越集中 */
  normalizedEntropy: number | null;
  /** 最热概念占比；无样本为 null */
  topShare: number | null;
  topConceptKey: string | null;
  /** Herfindahl 指数 Σp²（1 = 全集中在单一概念）；无样本为 null */
  herfindahl: number | null;
  /** 有效概念数 1/HHI（"均匀时相当于覆盖了几个概念"）；无样本为 null */
  effectiveConcepts: number | null;
  /** 传入概念全集时：窗口内一次都没复习到的全集概念数；未传为 null */
  unreviewedUniverseCount: number | null;
  /** 传入概念全集时：被复习到的全集概念占比；全集为空/未传为 null */
  universeCoverage: number | null;
}

/**
 * 概念覆盖熵：**复习量在不同概念之间分得多不均**。
 *
 * 定义：把窗口内的复习次数按概念汇总成分布 p，取香农熵 `H = −Σ p·log2(p)`（bit）；
 * 同时给归一化熵 `H / log2(distinct)`、最热概念占比、HHI 与有效概念数。
 * 熵低 = 复习集中在少数概念上（局部循环 / 饥饿并存），是"选点多样性"的直接观测量。
 *
 * 假设/限制：
 * - 概念键是**字符串相等**口径；没有语义聚类，近义的不同说法会被当成两个概念
 *   （CLI 会先过 `normalizeConceptKey`，但仍不完美）。
 * - 熵高不必然是好事：一个需要反复回捞的难点被多复习几次，会拉低熵却是正确的。
 *   因此熵只与"最热占比 / 未覆盖概念数"一起读，不单独下结论。
 * - `universeConceptKeys` 只用于饥饿检测；不传则 `unreviewedUniverseCount` 为 null。
 */
export function computeConceptCoverageEntropy(
  items: ReadonlyArray<{ conceptKey: string }>,
  options: ConceptCoverageOptions = {},
): ConceptCoverageEntropySummary {
  const keys: string[] = [];
  for (const item of items) {
    const key = localConceptKey(item?.conceptKey);
    if (key) keys.push(key);
  }
  const counts = countByConcept(keys);
  const totalReviews = keys.length;
  const distinctConcepts = counts.size;

  const universe: string[] = [];
  const seenUniverse = new Set<string>();
  for (const raw of options.universeConceptKeys ?? []) {
    const key = localConceptKey(raw);
    if (!key || seenUniverse.has(key)) continue;
    seenUniverse.add(key);
    universe.push(key);
  }
  const universeProvided = options.universeConceptKeys !== undefined;

  if (totalReviews === 0) {
    return {
      totalReviews: 0,
      distinctConcepts: 0,
      entropyBits: null,
      maxEntropyBits: null,
      normalizedEntropy: null,
      topShare: null,
      topConceptKey: null,
      herfindahl: null,
      effectiveConcepts: null,
      unreviewedUniverseCount: universeProvided ? universe.length : null,
      universeCoverage: universeProvided ? (universe.length > 0 ? 0 : null) : null,
    };
  }

  let entropy = 0;
  let herfindahl = 0;
  let topCount = 0;
  let topConceptKey: string | null = null;
  for (const [key, count] of counts) {
    const p = count / totalReviews;
    entropy -= p * Math.log2(p);
    herfindahl += p * p;
    if (count > topCount) {
      topCount = count;
      topConceptKey = key;
    }
  }
  const maxEntropyBits = distinctConcepts > 1 ? Math.log2(distinctConcepts) : 0;
  const normalizedEntropy = maxEntropyBits > 0 ? entropy / maxEntropyBits : 0;

  let unreviewedUniverseCount: number | null = null;
  let universeCoverage: number | null = null;
  if (universeProvided) {
    let covered = 0;
    for (const key of universe) {
      if (counts.has(key)) covered += 1;
    }
    unreviewedUniverseCount = universe.length - covered;
    universeCoverage = universe.length > 0 ? covered / universe.length : null;
  }

  return {
    totalReviews,
    distinctConcepts,
    entropyBits: round4(entropy),
    maxEntropyBits: round4(maxEntropyBits),
    normalizedEntropy: round4(normalizedEntropy),
    topShare: round4(topCount / totalReviews),
    topConceptKey,
    herfindahl: round4(herfindahl),
    effectiveConcepts: herfindahl > 0 ? round4(1 / herfindahl) : null,
    unreviewedUniverseCount,
    universeCoverage: universeCoverage === null ? null : round4(universeCoverage),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) 交错代理（interleaving proxy）
// ─────────────────────────────────────────────────────────────────────────────

export interface InterleavingObservation {
  conceptKey: string;
}

export interface InterleavingProxySummary {
  totalItems: number;
  /** 相邻对数 = max(0, totalItems − 1) */
  transitions: number;
  /** 相邻且概念键相同的对数 */
  sameConceptTransitions: number;
  /** 相邻同概念比例 0..1；不足两项时为 null。越高越"块状 / 局部循环" */
  sameConceptAdjacencyRate: number | null;
  /** 最长同概念连续段长度（单点算 1） */
  longestSameConceptRun: number;
  /** 出现过的不同概念数 */
  distinctConcepts: number;
}

/**
 * 交错代理：**相邻复习项里有多少是同一个概念**。
 *
 * 定义：按输入顺序（调用方保证是时间序）遍历概念键，统计相邻对中键相同的比例，
 * 以及最长同概念连续段。比例越低越接近"交错练习"，越高越像"同概念连续重复"。
 *
 * ⚠️ 这是**代理，不是真正的语义干扰度量**：系统没有 embedding，无法判断
 * "两个不同概念键是否在语义上互相干扰"。它只能回答"相邻的是不是同一条痕迹"。
 * 而且同概念相邻未必是坏事（正当的连续巩固）；它主要用来发现**局部循环**
 * （例如一次课里同一概念被安排了两遍、或队列被少量概念占满）。
 *
 * 假设/限制：
 * - 输入顺序即复习顺序；调用方不得打乱（跨学习者拼接会产生无意义的边界相邻，
 *   全局统计应改用"按学习者加权的平均"，见 CLI）。
 * - 空白概念键会被跳过，不计入 totalItems，也不参与相邻判定。
 */
export function computeInterleavingProxy(
  items: ReadonlyArray<InterleavingObservation>,
): InterleavingProxySummary {
  const keys: string[] = [];
  for (const item of items) {
    const key = localConceptKey(item?.conceptKey);
    if (key) keys.push(key);
  }
  const totalItems = keys.length;
  const distinctConcepts = new Set(keys).size;
  if (totalItems === 0) {
    return {
      totalItems: 0,
      transitions: 0,
      sameConceptTransitions: 0,
      sameConceptAdjacencyRate: null,
      longestSameConceptRun: 0,
      distinctConcepts: 0,
    };
  }

  let sameConceptTransitions = 0;
  let longestRun = 1;
  let currentRun = 1;
  for (let i = 1; i < totalItems; i += 1) {
    if (keys[i] === keys[i - 1]) {
      sameConceptTransitions += 1;
      currentRun += 1;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 1;
    }
  }
  const transitions = totalItems - 1;
  return {
    totalItems,
    transitions,
    sameConceptTransitions,
    sameConceptAdjacencyRate: transitions > 0 ? round4(sameConceptTransitions / transitions) : null,
    longestSameConceptRun: longestRun,
    distinctConcepts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) 复习结果分布（outcome）
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewOutcomeSummary {
  total: number;
  counts: Record<ReviewRatingBucket, number>;
  /** 严口径成功数：good / easy（与动态预算 `computeSuccessRate` 同口径） */
  strictSuccess: number;
  strictSuccessRate: number | null;
  /** 宽口径成功数：非 again（FSRS 语义，hard 也算"回忆出来了"） */
  lenientSuccess: number;
  lenientSuccessRate: number | null;
}

/**
 * 复习结果分布：**选出来的点复习完之后，答得怎么样**。
 *
 * 定义：按 FSRS 评分（again/hard/good/easy）计数，同时给严口径（good/easy）与
 * 宽口径（非 again）成功率。口径复用 `retention-curve`，避免两套语义。
 *
 * 假设/限制：
 * - 这是**结果**指标，不是选点指标；它用于判断"选点是否过难/过易"，
 *   单独看会混淆概念难度与选点质量（难概念本就容易 again）。
 * - 未知/缺失评分计入 `unknown`，不进入任何成功率分母。
 */
export function computeReviewOutcomeSummary(
  items: ReadonlyArray<{ rating?: string | null | undefined }>,
): ReviewOutcomeSummary {
  const counts: Record<ReviewRatingBucket, number> = {
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
    unknown: 0,
  };
  let known = 0;
  let strictSuccess = 0;
  let lenientSuccess = 0;
  for (const item of items) {
    const rating = String(item?.rating ?? '').trim().toLowerCase();
    if (!(KNOWN_REVIEW_RATINGS as ReadonlyArray<string>).includes(rating)) {
      counts.unknown += 1;
      continue;
    }
    counts[rating as KnownReviewRating] += 1;
    known += 1;
    if (isRetrievalSuccess(rating)) strictSuccess += 1;
    if (isRetrievalSuccessLenient(rating)) lenientSuccess += 1;
  }
  return {
    total: items.length,
    counts,
    strictSuccess,
    strictSuccessRate: known > 0 ? round4(strictSuccess / known) : null,
    lenientSuccess,
    lenientSuccessRate: known > 0 ? round4(lenientSuccess / known) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6) 重复复习（repetition）
// ─────────────────────────────────────────────────────────────────────────────

export interface RepetitionSummary {
  totalReviews: number;
  distinctConcepts: number;
  /** 重复复习次数 = totalReviews − distinctConcepts */
  repeatReviews: number;
  /** 重复复习占比；无样本为 null */
  repeatShare: number | null;
  /** 单概念最大复习次数 */
  maxReviewsPerConcept: number;
  mostReviewedConceptKey: string | null;
}

/**
 * 重复复习：**窗口内同一概念被反复复习的程度**。
 *
 * 定义：`repeatReviews = 总复习次数 − 不同概念数`，`repeatShare = repeatReviews / 总数`。
 * 与覆盖熵互补：熵看分布形状，这里直接给"重复量"。
 *
 * 假设/限制：
 * - 重复可能是正当的（难点需要多次回捞），也可能是选点退化（同一天/同一课重复占额度）。
 *   需要与 `computeDueCoverage`、`computeInterleavingProxy` 一起读。
 * - 概念键同样只做字符串相等，近义说法会低估重复。
 */
export function computeRepetitionSummary(
  items: ReadonlyArray<{ conceptKey: string }>,
): RepetitionSummary {
  const keys: string[] = [];
  for (const item of items) {
    const key = localConceptKey(item?.conceptKey);
    if (key) keys.push(key);
  }
  const counts = countByConcept(keys);
  const totalReviews = keys.length;
  let maxReviewsPerConcept = 0;
  let mostReviewedConceptKey: string | null = null;
  for (const [key, count] of counts) {
    if (count > maxReviewsPerConcept) {
      maxReviewsPerConcept = count;
      mostReviewedConceptKey = key;
    }
  }
  const distinctConcepts = counts.size;
  const repeatReviews = totalReviews - distinctConcepts;
  return {
    totalReviews,
    distinctConcepts,
    repeatReviews,
    repeatShare: totalReviews > 0 ? round4(repeatReviews / totalReviews) : null,
    maxReviewsPerConcept,
    mostReviewedConceptKey,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7) 额度利用（quota utilization，附加）
// ─────────────────────────────────────────────────────────────────────────────

export interface QuotaDayObservation {
  /** UTC 日期（yyyy-mm-dd），与 `review-quota` 账本同口径 */
  date: string;
  usedLoad: number;
  limitLoad: number;
  usedCount?: number | null;
}

export interface QuotaUtilizationSummary {
  /** 传入的天数（含不可度量的） */
  days: number;
  /** limitLoad > 0 的可度量天数 */
  measurableDays: number;
  /** 可度量天的平均利用率 used/limit；无可度量天为 null */
  avgUtilization: number | null;
  /** 可度量天的最大利用率；无可度量天为 null */
  maxUtilization: number | null;
  /** 利用率 > 1（当天超额，理论上会被顺延，出现即异常）的天数 */
  overLimitDays: number;
  totalUsedLoad: number;
  totalUsedCount: number;
}

/**
 * 额度利用：**当天负担额度被用掉了多少**（附加指标，用于解释 due coverage）。
 *
 * 定义：按天 `utilization = usedLoad / limitLoad`，给均值、最大值、超额天数与总量。
 *
 * 假设/限制：
 * - 数据来自 `learner_projections(scope='review-quota')`，只覆盖记账生效之后的日期；
 *   更早的日期不可度量（不计入分母）。
 * - 利用率低 ≠ 选点差：可能是当天根本没开课；必须与"有课天数"一起读。
 */
export function summarizeQuotaUtilization(
  days: ReadonlyArray<QuotaDayObservation>,
): QuotaUtilizationSummary {
  let measurableDays = 0;
  let utilizationSum = 0;
  let maxUtilization = 0;
  let overLimitDays = 0;
  let totalUsedLoad = 0;
  let totalUsedCount = 0;
  for (const day of days) {
    const usedLoad = Math.max(0, toFiniteNumber(day?.usedLoad) ?? 0);
    const limitLoad = toFiniteNumber(day?.limitLoad) ?? 0;
    const usedCount = Math.max(0, Math.floor(toFiniteNumber(day?.usedCount) ?? 0));
    totalUsedLoad += usedLoad;
    totalUsedCount += usedCount;
    if (limitLoad <= 0) continue;
    const utilization = usedLoad / limitLoad;
    measurableDays += 1;
    utilizationSum += utilization;
    if (utilization > maxUtilization) maxUtilization = utilization;
    if (utilization > 1 + 1e-9) overLimitDays += 1;
  }
  return {
    days: days.length,
    measurableDays,
    avgUtilization: measurableDays > 0 ? round4(utilizationSum / measurableDays) : null,
    maxUtilization: measurableDays > 0 ? round4(maxUtilization) : null,
    overLimitDays,
    totalUsedLoad: round4(totalUsedLoad),
    totalUsedCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8) 聚合入口 + 指标字典
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewQualityItem {
  conceptKey: string;
  /** 选点时刻的 retention（可选；来自 `memoryWarmup.items[].retention`） */
  retention?: number | null;
  /** 复习结果评分（可选；来自 `learner_evidence` 的 `review:completed` payload） */
  rating?: string | null;
}

export interface ReviewQualityInput {
  /** 有序（时间序）的被选中/被复习点位：交错代理依赖此顺序 */
  reviewed: ReadonlyArray<ReviewQualityItem>;
  /** 同一时点到期总量（含未选中）；缺省/null 时不算 due coverage */
  dueCount?: number | null;
  /** 概念全集（饥饿检测用）；缺省则不输出未覆盖概念数 */
  universeConceptKeys?: ReadonlyArray<string>;
  thresholds?: Partial<ReviewQualityThresholds>;
}

export interface ReviewQualitySummary {
  retrievabilityRegret: RetrievabilityRegretSummary;
  dueCoverage: DueCoverageSummary | null;
  conceptCoverageEntropy: ConceptCoverageEntropySummary;
  interleaving: InterleavingProxySummary;
  outcome: ReviewOutcomeSummary;
  repetition: RepetitionSummary;
  thresholds: ReviewQualityThresholds;
}

/**
 * 聚合入口：把同一批点位一次性算出全部选点质量指标。
 * 纯函数——CLI 负责取数，本函数只负责计算；单测可注入内联夹具。
 */
export function summarizeReviewQuality(input: ReviewQualityInput): ReviewQualitySummary {
  const reviewed = input.reviewed ?? [];
  const thresholds = resolveThresholds(input.thresholds);
  const dueCount = toFiniteNumber(input.dueCount);
  return {
    retrievabilityRegret: computeRetrievabilityRegret(reviewed, thresholds),
    dueCoverage: dueCount === null
      ? null
      : computeDueCoverage({ selectedCount: reviewed.length, dueCount }),
    conceptCoverageEntropy: computeConceptCoverageEntropy(reviewed, {
      universeConceptKeys: input.universeConceptKeys,
    }),
    interleaving: computeInterleavingProxy(reviewed),
    outcome: computeReviewOutcomeSummary(reviewed),
    repetition: computeRepetitionSummary(reviewed),
    thresholds,
  };
}

export interface ReviewQualityMetricDefinition {
  key: string;
  label: string;
  definition: string;
  dataSource: string;
  limitation: string;
}

/**
 * 指标字典（单一事实来源）：CLI 图例、审计文档与报告都从这里取，
 * 避免"代码改了、说明没改"的口径漂移。
 */
export const REVIEW_QUALITY_METRIC_DEFINITIONS: ReadonlyArray<ReviewQualityMetricDefinition> = [
  {
    key: 'retrievabilityRegret',
    label: '可提取性后悔',
    definition: 'mean(max(0, retention − targetRetention))，targetRetention 默认 0.9；越大说明越多点在"还没忘"时被复习。',
    dataSource: 'teaching_sessions.teachingState.sessionArtifacts.memoryWarmup.items[].retention（选点时刻快照）',
    limitation: '观测性；retention 是选点估计值而非复习后回填；换 target 会整体平移，跨报告需固定 target。',
  },
  {
    key: 'dueCoverage',
    label: '到期覆盖',
    definition: 'selected / due（截断到 [0,1]）；backlog = due − selected 是未服务的积压。',
    dataSource: 'selected = memoryWarmup.items.length；due = selected + memoryWarmup.backlogCount（均为持久化快照）',
    limitation: '历史"真实到期数"未落库，due 用计划内持久化的 backlogCount 近似；leech/毕业点已被排除在 backlog 外。',
  },
  {
    key: 'conceptCoverageEntropy',
    label: '概念覆盖熵',
    definition: '复习次数按概念分布的香农熵（bit）及归一化熵、最热占比、HHI、有效概念数。',
    dataSource: 'learner_evidence(review:completed/review:warmup).payload.conceptKey；全集来自 memory_traces(extractionCount>0)',
    limitation: '字符串相等口径，无语义聚类；熵低不必然是坏事（难点多复习会拉低熵），需与最热占比/未覆盖数合读。',
  },
  {
    key: 'interleaving',
    label: '交错代理',
    definition: '相邻复习项概念键相同的比例，以及最长同概念连续段；越低越接近交错练习。',
    dataSource: '按时间排序的 memoryWarmup.items[].conceptKey（无计划时回落到 evidence 时间序）',
    limitation: '**代理而非真值**：无 embedding，无法度量语义干扰；同概念相邻也可能是正当的连续巩固。',
  },
  {
    key: 'outcome',
    label: '复习结果分布',
    definition: 'again/hard/good/easy 计数；严口径成功率 = good+easy，宽口径 = 非 again。',
    dataSource: 'learner_evidence(review:completed).payload.rating',
    limitation: '结果指标而非选点指标；难概念本就容易 again，单独看会混淆难度与选点质量。',
  },
  {
    key: 'repetition',
    label: '重复复习',
    definition: 'repeatShare =（总复习次数 − 不同概念数）/ 总复习次数。',
    dataSource: 'learner_evidence(review:completed/review:warmup).payload.conceptKey',
    limitation: '字符串相等口径；重复可能是正当的难点回捞，需与覆盖/交错合读。',
  },
  {
    key: 'quotaUtilization',
    label: '额度利用（附加）',
    definition: '按天 usedLoad / limitLoad 的均值/最大值、超额天数与总量。',
    dataSource: 'learner_projections(scope=review-quota).payload.{usedLoad,limitLoad,usedCount,date}',
    limitation: '仅覆盖记账生效之后的日期；利用率低也可能只是当天没开课。',
  },
];

export const reviewQualityMetrics = {
  computeRetrievabilityRegret,
  computeDueCoverage,
  computeConceptCoverageEntropy,
  computeInterleavingProxy,
  computeReviewOutcomeSummary,
  computeRepetitionSummary,
  summarizeQuotaUtilization,
  summarizeReviewQuality,
  REVIEW_QUALITY_METRIC_DEFINITIONS,
};

export default reviewQualityMetrics;
