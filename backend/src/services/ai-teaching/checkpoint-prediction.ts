/**
 * 检查点预测（#96 阈值拟合的数据前置）
 *
 * 为什么需要：检查点证据（`learner_evidence: checkpoint:result`）此前只有「对/错」与题型，
 * 没有**系统在判分前的掌握度预测**——于是无法回答「阈值/分档是否校准」：没人知道
 * 系统认为学习者已掌握时，实际答对率是多少。本模块在判分当回合解析一个预测值，
 * 随证据落库，供 `audit-threshold-calibration.ts` 画校准表、拟合阈值。
 *
 * 预测来源优先级（全部为确定性、无额外 LLM 调用）：
 *   1. 本回合 `analysis.ktEstimate.conceptMastery` 命中同一概念（按概念名归一或 kcId）；
 *   2. 回落到本回合合并后的知识看板 `knowledgeState`（progress/100）；
 *   3. 都没有 → `null`（不猜；校准表只统计有预测的样本）。
 *
 * 模型自述的 `understanding` 单独落库作对照，**不**当作掌握度预测（避免把自评当独立信号）。
 */
import { normalizeConceptName } from './checkpoint-shared';

export type CheckpointPredictionSource = 'kt-estimate' | 'knowledge-state' | 'none';

export interface CheckpointPrediction {
  /** 判分前系统对「该概念已掌握」的概率/进度（0-1）；null=无可用预测 */
  predictedMastery: number | null;
  source: CheckpointPredictionSource;
  /** 模型本轮 understanding（0-1）；仅作对照，不参与预测来源 */
  understanding: number | null;
}

interface KnowledgePointLike {
  name?: unknown;
  progress?: unknown;
  kcId?: unknown;
  status?: unknown;
}

interface KtMasteryLike {
  conceptKey?: unknown;
  kcId?: unknown;
  mastery?: unknown;
}

export interface ResolveCheckpointPredictionInput {
  conceptName?: string | null;
  conceptKey?: string | null;
  knowledgePoints?: KnowledgePointLike[] | null;
  ktConceptMastery?: KtMasteryLike[] | null;
  understanding?: number | null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finiteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * 解析检查点的预测掌握度。纯函数：不读库、不调模型，便于单测与重放。
 */
export function resolveCheckpointPrediction(input: ResolveCheckpointPredictionInput): CheckpointPrediction {
  const understanding = finiteNumber(input.understanding);
  const points = Array.isArray(input.knowledgePoints) ? input.knowledgePoints : [];
  const ktItems = Array.isArray(input.ktConceptMastery) ? input.ktConceptMastery : [];
  const conceptName = normalizeConceptName(input.conceptName ?? '');
  const conceptKey = normalizeConceptName(input.conceptKey ?? '');
  const targetName = conceptName || conceptKey;

  // 概念名 → kcId（看板是 kcId 的权威来源；ktEstimate 的 kcId 由模型从 taskKcs 回填）
  const kcIdByName = new Map<string, string>();
  for (const point of points) {
    const kcId = typeof point?.kcId === 'string' ? point.kcId.trim() : '';
    const name = normalizeConceptName(point?.name ?? '');
    if (kcId && name) kcIdByName.set(name, kcId);
  }
  const targetKcId = targetName ? kcIdByName.get(targetName) ?? null : null;

  for (const item of ktItems) {
    const mastery = finiteNumber(item?.mastery);
    if (mastery === null) continue;
    const itemName = normalizeConceptName(item?.conceptKey ?? '');
    const itemKcId = typeof item?.kcId === 'string' ? item.kcId.trim() : '';
    const nameHit = targetName !== '' && (itemName === targetName || (conceptKey !== '' && itemName === conceptKey));
    const kcHit = targetKcId !== null && itemKcId !== '' && itemKcId === targetKcId;
    if (nameHit || kcHit) {
      return { predictedMastery: clamp01(mastery), source: 'kt-estimate', understanding };
    }
  }

  for (const point of points) {
    if (!targetName || normalizeConceptName(point?.name ?? '') !== targetName) continue;
    const progress = finiteNumber(point?.progress);
    if (progress === null) continue;
    return { predictedMastery: clamp01(progress / 100), source: 'knowledge-state', understanding };
  }

  return { predictedMastery: null, source: 'none', understanding };
}

interface ResultPayloadLike {
  judgedBy?: unknown;
  type?: unknown;
  passed?: unknown;
  predictedMastery?: unknown;
  predictionSource?: unknown;
  understanding?: unknown;
}

export interface CalibrationSummary {
  totalRows: number;
  codeJudged: number;
  usable: number;
  predictionCoverage: number;
  bySource: Record<string, number>;
  byType: Array<{ type: string; total: number; code: number; usable: number; passRate: number | null }>;
  buckets: CalibrationBucket[];
  understandingBuckets: CalibrationBucket[];
}

/**
 * 汇总一批 `checkpoint:result` 证据行（payload 字符串）成校准表。纯函数。
 * 只把「代码裁决 + 非简答 + 有 predictedMastery」的样本放进校准表；
 * understanding 单独出一张对照表（模型自述，不作独立信号）。
 */
export function summarizeCalibration(rows: Array<{ payload: string | null }>): CalibrationSummary {
  const pairs: Array<{ predictedMastery: number; passed: boolean }> = [];
  const understandingPairs: Array<{ predictedMastery: number; passed: boolean }> = [];
  const bySource: Record<string, number> = {};
  const byType = new Map<string, { total: number; code: number; usable: number; passed: number }>();
  let totalRows = 0;
  let codeJudged = 0;

  for (const row of rows) {
    totalRows += 1;
    let parsed: ResultPayloadLike | null = null;
    try {
      parsed = JSON.parse(String(row.payload || '{}')) as ResultPayloadLike;
    } catch {
      continue;
    }
    const type = typeof parsed?.type === 'string' ? parsed.type : 'unknown';
    const bucket = byType.get(type) ?? { total: 0, code: 0, usable: 0, passed: 0 };
    bucket.total += 1;
    const isCode = parsed?.judgedBy === 'code';
    if (isCode) {
      codeJudged += 1;
      bucket.code += 1;
    }
    const passed = parsed?.passed === true;
    if (isCode) bucket.passed += passed ? 1 : 0;
    byType.set(type, bucket);
    if (!isCode || type === 'short_answer') continue;

    const predicted = Number(parsed?.predictedMastery);
    if (Number.isFinite(predicted)) {
      pairs.push({ predictedMastery: predicted, passed });
      bucket.usable += 1;
      const source = typeof parsed?.predictionSource === 'string' ? parsed.predictionSource : 'unknown';
      bySource[source] = (bySource[source] ?? 0) + 1;
    }
    const understanding = Number(parsed?.understanding);
    if (Number.isFinite(understanding)) {
      understandingPairs.push({ predictedMastery: understanding, passed });
    }
  }

  const nonShortCode = Array.from(byType.entries())
    .filter(([type]) => type !== 'short_answer')
    .reduce((sum, [, item]) => sum + item.code, 0);

  return {
    totalRows,
    codeJudged,
    usable: pairs.length,
    predictionCoverage: nonShortCode > 0 ? pairs.length / nonShortCode : 0,
    bySource,
    byType: Array.from(byType.entries())
      .map(([type, item]) => ({
        type,
        total: item.total,
        code: item.code,
        usable: item.usable,
        passRate: item.code > 0 ? item.passed / item.code : null,
      }))
      .sort((a, b) => b.total - a.total),
    buckets: bucketCalibration(pairs),
    understandingBuckets: bucketCalibration(understandingPairs),
  };
}

export interface CalibrationBucket {
  /** 桶标签，如 "0.6–0.8" */
  label: string;
  lower: number;
  upper: number;
  sample: number;
  /** 桶内平均预测掌握度 */
  predictedMean: number | null;
  /** 桶内实际通过率 */
  observedRate: number | null;
  /** observed − predicted（正=低估，负=高估） */
  gap: number | null;
}

/**
 * 把 (predictedMastery, passed) 对分桶成校准表。纯函数。
 * 边界约定：左闭右开，1.0 归入最后一桶。
 */
export function bucketCalibration(
  pairs: Array<{ predictedMastery: number; passed: boolean }>,
  bucketCount = 5,
): CalibrationBucket[] {
  const count = Math.max(1, Math.floor(bucketCount));
  const buckets: Array<{ lower: number; upper: number; sumP: number; passed: number; sample: number }> = [];
  for (let i = 0; i < count; i += 1) {
    buckets.push({ lower: i / count, upper: (i + 1) / count, sumP: 0, passed: 0, sample: 0 });
  }
  for (const pair of pairs) {
    const p = Number(pair.predictedMastery);
    if (!Number.isFinite(p)) continue;
    const clamped = clamp01(p);
    const index = clamped >= 1 ? count - 1 : Math.min(count - 1, Math.floor(clamped * count));
    const bucket = buckets[index];
    bucket.sample += 1;
    bucket.sumP += clamped;
    if (pair.passed === true) bucket.passed += 1;
  }
  const fmt = (v: number) => v.toFixed(2);
  return buckets.map((bucket) => {
    const predictedMean = bucket.sample > 0 ? bucket.sumP / bucket.sample : null;
    const observedRate = bucket.sample > 0 ? bucket.passed / bucket.sample : null;
    return {
      label: `${fmt(bucket.lower)}–${fmt(bucket.upper)}`,
      lower: bucket.lower,
      upper: bucket.upper,
      sample: bucket.sample,
      predictedMean,
      observedRate,
      gap: predictedMean !== null && observedRate !== null ? observedRate - predictedMean : null,
    };
  });
}
