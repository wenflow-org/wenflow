/**
 * 路径质量评审配置（阈值/权重/reviewer 版本）的单一构造点。
 *
 * 与 observer 分文件：path-generation.core 落库时要先写 pending 状态与配置指纹，
 * 但不能反向依赖 observer（observer 在试验分组里会延迟加载 core）。本模块只依赖
 * skill 契约与定义，不依赖 prisma/事件。
 */
import { pathReviewerDefinition } from '../../../skills/path-reviewer';
import {
  PATH_REVIEW_DIMENSION_KEYS,
  PATH_REVIEW_DIMENSION_WEIGHTS,
  PATH_REVIEW_PASS_THRESHOLD,
} from '../../../skills/path-reviewer/contract';
import { PATH_REVIEW_REVIEWER_KIND, hashPathReviewSnapshot, type PathReviewReviewerKind } from '../../../events/path-quality-review-event';

export interface PathReviewConfig {
  reviewer: 'skill:path-reviewer';
  reviewerVersion: string;
  reviewerKind: PathReviewReviewerKind;
  threshold: number;
  dimensionKeys: readonly string[];
  dimensionWeights: Readonly<Record<string, number>>;
  configFingerprint: string;
}

/** 评审配置（同配置指纹一致；结果记录里随路径版本一起存证）。 */
export function buildPathReviewConfig(): PathReviewConfig {
  const base = {
    reviewer: 'skill:path-reviewer' as const,
    reviewerVersion: pathReviewerDefinition.version,
    reviewerKind: PATH_REVIEW_REVIEWER_KIND,
    threshold: PATH_REVIEW_PASS_THRESHOLD,
    dimensionKeys: PATH_REVIEW_DIMENSION_KEYS,
    dimensionWeights: PATH_REVIEW_DIMENSION_WEIGHTS,
  };
  return {
    ...base,
    configFingerprint: hashPathReviewSnapshot(base),
  };
}
