/**
 * path-reviewer 输出契约（2026-11-21 路径评审转后台观察）。
 *
 * 单一真相源：五维度、权重、通过阈值、确定性算分与「低分必须带返工指令」的校验。
 * 该契约同时被两处消费：
 * - `skills/path-reviewer/index.ts`（模型输出归一化前的校验 / 归一化）；
 * - `services/learning/generation/path-review-observer.ts`（后台观察结果落状态）。
 *
 * 为什么要把校验提到归一化之前：旧实现 `clamp01(undefined)=0.5` 会把缺字段静默补成
 * 「中等分」，低分又没有 `replanInstructions` 时也被当成有效评审。现在缺维度、越界、
 * 低分缺返工指令都直接判无效（skill 层按既有 retryStrategy 重试），重试耗尽后由调用方
 * 记为「证据不足」，绝不伪造一个可消费的评审结论。
 */

export const PATH_REVIEW_DIMENSION_KEYS = [
  'clarity',
  'integrity',
  'depth',
  'practicality',
  'pertinence',
] as const;

export type PathReviewDimensionKey = (typeof PATH_REVIEW_DIMENSION_KEYS)[number];

export type PathReviewDimensions = Record<PathReviewDimensionKey, number>;

/** 与 prompts/core/path-reviewer.yaml 的评分口径逐项一致（Clarity .2 / Integrity .25 / Depth .2 / Practicality .2 / Pertinence .15）。 */
export const PATH_REVIEW_DIMENSION_WEIGHTS: Readonly<Record<PathReviewDimensionKey, number>> = {
  clarity: 0.2,
  integrity: 0.25,
  depth: 0.2,
  practicality: 0.2,
  pertinence: 0.15,
};

/** 评审通过阈值；score 与 passed 同源（finalScore < 此值即未通过）。 */
export const PATH_REVIEW_PASS_THRESHOLD = 0.75;

/** 证据不足的稳定标记（后台观察状态 / 离线审计共用）。 */
export const PATH_REVIEW_EVIDENCE_INSUFFICIENT = 'PATH_REVIEW_EVIDENCE_INSUFFICIENT';

export type PathReviewValidationResult =
  | {
      valid: true;
      dimensions: PathReviewDimensions;
      /** 由五维度按统一权重确定性重算，不采信模型自报总分。 */
      score: number;
      needsReplan: boolean;
    }
  | {
      valid: false;
      failureReason: string;
    };

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 用统一公式算分：五维度加权平均。缺维度不做默认补齐（由校验拒绝）。
 */
export function computePathReviewScore(dimensions: PathReviewDimensions): number {
  let total = 0;
  let weight = 0;
  for (const key of PATH_REVIEW_DIMENSION_KEYS) {
    total += dimensions[key] * PATH_REVIEW_DIMENSION_WEIGHTS[key];
    weight += PATH_REVIEW_DIMENSION_WEIGHTS[key];
  }
  return weight > 0 ? clampScore(total / weight) : 0;
}

function readReplanInstructions(parsed: unknown): string {
  const record = parsed as { replanInstructions?: unknown } | null;
  return typeof record?.replanInstructions === 'string'
    ? record.replanInstructions.trim()
    : '';
}

/**
 * 归一化前校验（严格口径）：
 * 1. 输出必须是对象；
 * 2. `dimensions` 必须含五个维度，且每项是 [0,1] 内的有限数字；
 * 3. 若统一公式算出的 score < 阈值，必须给出非空 `replanInstructions`；
 * 4. 显式提供的 `score` 必须是有限数字（仅用于发现明显畸变，最终分数一律由维度重算）。
 */
export function validatePathReviewOutput(parsed: unknown): PathReviewValidationResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, failureReason: 'PATH_REVIEWER_OUTPUT_NOT_OBJECT' };
  }
  const record = parsed as Record<string, unknown>;
  if (record.score !== undefined && !isFiniteNumber(record.score)) {
    return { valid: false, failureReason: 'PATH_REVIEWER_SCORE_INVALID' };
  }
  const rawDimensions = record.dimensions;
  if (!rawDimensions || typeof rawDimensions !== 'object' || Array.isArray(rawDimensions)) {
    return { valid: false, failureReason: 'PATH_REVIEWER_DIMENSIONS_MISSING' };
  }

  const dimensions = {} as PathReviewDimensions;
  for (const key of PATH_REVIEW_DIMENSION_KEYS) {
    const value = (rawDimensions as Record<string, unknown>)[key];
    if (!isFiniteNumber(value)) {
      return { valid: false, failureReason: `PATH_REVIEWER_DIMENSION_INVALID:${key}` };
    }
    if (value < 0 || value > 1) {
      return { valid: false, failureReason: `PATH_REVIEWER_DIMENSION_OUT_OF_RANGE:${key}` };
    }
    dimensions[key] = value;
  }

  const score = computePathReviewScore(dimensions);
  const needsReplan = score < PATH_REVIEW_PASS_THRESHOLD;
  if (needsReplan && !readReplanInstructions(record)) {
    return { valid: false, failureReason: 'PATH_REVIEWER_REPLAN_INSTRUCTIONS_REQUIRED' };
  }

  return { valid: true, dimensions, score, needsReplan };
}
