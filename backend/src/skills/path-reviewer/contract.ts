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

/**
 * 行为锚定档位（2026-11-22 分档改造）：模型只报档位、不报小数——防「先拍分数再凑 issues」
 * 的逆向合理化与线性稀释（0.40×0.25 + 0.87×0.75 = 0.7525 曾可带 Integrity 红线过闸）。
 * 数值由平台按锚点映射后加权，score/passed 全程确定性计算。
 */
export const PATH_REVIEW_TIER_KEYS = ['strong', 'adequate', 'weak', 'fail'] as const;

export type PathReviewTier = (typeof PATH_REVIEW_TIER_KEYS)[number];

/** 档位→数值锚点（与 prompts/core/path-reviewer.yaml 的档位定义逐项一致）。 */
export const PATH_REVIEW_TIER_SCORES: Readonly<Record<PathReviewTier, number>> = {
  strong: 1.0,
  adequate: 0.85,
  weak: 0.6,
  fail: 0.3,
};

function isPathReviewTier(value: unknown): value is PathReviewTier {
  return typeof value === 'string' && (PATH_REVIEW_TIER_KEYS as readonly string[]).includes(value);
}

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

/**
 * 合取硬闸门（2026-11-22）：加权分只是必要条件之一。任一 issue severity=high（失败特征清单
 * 里 high 全是结构红线：终点前置/概念偷跑、标题与验收脱节等）或任一维度 fail，
 * 无论其余维度多好看一律未通过——线性加权不允许稀释结构级缺陷。
 */
export function computePathReviewNeedsReplan(
  issues: Array<{ severity?: unknown }>,
  failTiers: ReadonlySet<PathReviewDimensionKey>,
): boolean {
  const highSeverity = Array.isArray(issues)
    && issues.some((issue) => typeof issue?.severity === 'string' && issue.severity.trim().toLowerCase() === 'high');
  // fail 只认显式档位；legacy 0-1 数值没有 fail 语义，其合取闸由 issues severity 承担。
  return highSeverity || failTiers.size > 0;
}

/** 从原始输出读 issues 的 severity 集合（归一化前后都可安全调用）。 */
function readHighSeverityIssues(parsed: unknown): boolean {
  const record = parsed as { issues?: unknown } | null;
  return Array.isArray(record?.issues)
    && (record.issues as unknown[]).some(
      (issue) => typeof (issue as { severity?: unknown })?.severity === 'string'
        && ((issue as { severity: string }).severity.trim().toLowerCase() === 'high'),
    );
}

/** 证据不足的稳定标记（后台观察状态 / 离线审计共用）。 */
export const PATH_REVIEW_EVIDENCE_INSUFFICIENT = 'PATH_REVIEW_EVIDENCE_INSUFFICIENT';

export type PathReviewValidationResult =
  | {
      valid: true;
      dimensions: PathReviewDimensions;
      /** 命中 fail 档的维度（legacy 0-1 数值输出恒为空集——数值没有档位语义）。 */
      failTiers: ReadonlySet<PathReviewDimensionKey>;
      /** 由五维度按统一权重确定性重算，不采信模型自报总分。 */
      score: number;
      /** 合取闸：加权分不达阈值 ∨ 任一 severity=high 结构红线 ∨ 任一维度 fail。 */
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
 * 归一化前校验（严格口径，2026-11-22 档位制）：
 * 1. 输出必须是对象；
 * 2. `dimensions` 必须含五个维度，每项是行为锚定档位（strong|adequate|weak|fail）；
 *    [0,1] 数字仍接受（旧提示词版本 / 历史重放兼容，无档位语义）；
 * 3. needsReplan 按合取闸判定（加权分不达标 ∨ severity=high 结构红线 ∨ fail 档），
 *    未通过时必须给出非空 `replanInstructions`；
 * 4. 显式提供的 `score`/`passed` 仅作畸变检查，最终一律由平台确定性重算。
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
  const failTiers = new Set<PathReviewDimensionKey>();
  for (const key of PATH_REVIEW_DIMENSION_KEYS) {
    const value = (rawDimensions as Record<string, unknown>)[key];
    if (isPathReviewTier(value)) {
      // 档位（2026-11-22 新口径）：锚点映射进数值；fail 进合取闸集合。
      dimensions[key] = PATH_REVIEW_TIER_SCORES[value];
      if (value === 'fail') failTiers.add(key);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      // legacy 0-1 数字（旧提示词版本/历史重放兼容，无档位语义）。
      if (value < 0 || value > 1) {
        return { valid: false, failureReason: `PATH_REVIEWER_DIMENSION_OUT_OF_RANGE:${key}` };
      }
      dimensions[key] = value;
      continue;
    }
    return { valid: false, failureReason: `PATH_REVIEWER_DIMENSION_INVALID:${key}` };
  }

  const score = computePathReviewScore(dimensions);
  const needsReplan = score < PATH_REVIEW_PASS_THRESHOLD
    || computePathReviewNeedsReplan(Array.isArray(record.issues) ? (record.issues as Array<{ severity?: unknown }>) : [], failTiers);
  if (needsReplan && !readReplanInstructions(record)) {
    return { valid: false, failureReason: 'PATH_REVIEWER_REPLAN_INSTRUCTIONS_REQUIRED' };
  }

  return { valid: true, dimensions, failTiers, score, needsReplan };
}
