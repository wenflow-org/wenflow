/**
 * 路径模型评审（path-reviewer）与「评审建议 → 一次返工 → 再评审」比较实验。
 *
 * 2026-11-21 路径评审转后台观察后，本模块**不再在真实/虚拟路径生成主链路里同步评审或自动
 * 重规划**——主链路通过确定性检查后直接落库并启动阶段设计，评审由 outbox 独立泳道异步消费
 * （见 `path-review-observer.ts`）。这里保留两类能力：
 *
 * 1. `requestPathReviewSnapshot`：对**固定路径快照**调用 path-reviewer（后台观察与实验共用）；
 * 2. `runPathReviewComparisonExperiment`：仅在调用方显式开启的试验分组里，执行
 *    「评审 → 一次重规划 → 再评审」，并把原方案与返工方案一起返回给调用方存证。
 *    该函数本身不落库、不改动 durable path，普通路径永远不会走到这里。
 *
 * `analyzePath` 由调用方注入，避免反向依赖 path-generation.core。
 */
import { logger } from '../../../utils/logger';
import { executeSkillWithResult } from '../../../skills';
import { pathReviewerDefinition, PATH_REVIEW_PASS_THRESHOLD } from '../../../skills/path-reviewer';
import { buildPathReviewerGoalContext } from '../path-reviewer-context';
import type { GeneratePathData } from '../learning.types';

/**
 * 试验分组内的返工深度上限：1 = 首评 + 一次重规划 +（对重规划结果）补一次评审。
 * 普通真实/虚拟路径不使用重规划（评审转后台后不再自动返工）。
 */
export const MAX_PATH_REPLAN_DEPTH = 1;

/**
 * analyzePathWithAgent 输出中本模块消费的字段契约（完整返回字面量见
 * path-generation.core 的 analyzePathWithAgent）。索引签名放行 core 透传的
 * 其余字段（pathAgentInput/budgetConservation/…），调用方按 unknown 自行收窄。
 */
export interface PathReviewAnalysis {
  pathName?: string | null;
  summary?: string | null;
  cognitiveCore?: unknown;
  cognitiveDesign?: unknown;
  /** 路径拓扑（path-planning 输出；缺失时旧路径按 diagnostic 评审） */
  topology?: string | null;
  estimatedTotalHours?: number | null;
  suggestedMilestones?: Array<{
    stage?: number;
    title?: string | null;
    name?: string | null;
    coreConcept?: string;
    description?: unknown;
    goal?: string | null;
    estimatedHours?: number | null;
    materialRefs?: unknown[];
    tasks?: unknown[];
  }>;
  sceneFraming?: { normalizedInput?: unknown } | null;
  [key: string]: unknown;
}

/** path-reviewer 的评审输出：passed/score/replanInstructions 是判定字段，其余透传。 */
export interface PathReviewResult {
  passed?: boolean;
  score?: number;
  replanInstructions?: unknown;
  [key: string]: unknown;
}

/** 固定评审快照（v1）：后台观察只认这份快照，不重新读取可能已变化的新路径。 */
export interface PathReviewSnapshotV1 {
  version: 1;
  pathPlan: {
    name?: string | null;
    summary?: string | null;
    topology?: string | null;
    cognitiveCore?: unknown;
    milestones?: unknown[];
    estimatedHours?: number | null;
  };
  goalContext: Record<string, unknown>;
  prerequisiteTree?: unknown;
}

export interface PathReviewInvocationResult {
  /** skill 解包后的评审输出；null = 调用失败 / 重试后仍无有效结果 */
  output: PathReviewResult | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export type AnalyzePathFn = (data: GeneratePathData) => Promise<PathReviewAnalysis>;

function readPrerequisiteTree(analysis: PathReviewAnalysis): unknown {
  return ((analysis.cognitiveCore || analysis.cognitiveDesign) as
    | { prerequisiteTree?: unknown }
    | null
    | undefined)?.prerequisiteTree;
}

/** 用**已落库的**归一化里程碑构造评审快照（不再评审内存中的原始模型输出）。 */
export function buildPathReviewSnapshot(
  data: GeneratePathData,
  analysis: PathReviewAnalysis,
  persistedMilestones?: unknown[],
): PathReviewSnapshotV1 {
  return {
    version: 1,
    pathPlan: {
      name: analysis.pathName ?? null,
      summary: analysis.summary ?? null,
      topology: analysis.topology ?? null,
      cognitiveCore: analysis.cognitiveCore || analysis.cognitiveDesign || null,
      milestones: Array.isArray(persistedMilestones)
        ? persistedMilestones
        : (analysis.suggestedMilestones ?? []),
      estimatedHours: analysis.estimatedTotalHours ?? null,
    },
    goalContext: buildPathReviewerGoalContext({
      description: data.description,
      confirmedProposal: data.userProfile?.confirmedProposal,
      learnerProfile: data.userProfile?.normalizedInput?.learnerProfile,
      analysis,
    }) as unknown as Record<string, unknown>,
    prerequisiteTree: readPrerequisiteTree(analysis),
  };
}

/** 返工结果（重规划分析）→ 固定快照；goalContext 沿用原版，保证比较口径不变。 */
export function buildPathReviewSnapshotFromAnalysis(
  analysis: PathReviewAnalysis,
  goalContext: Record<string, unknown>,
  prerequisiteTree?: unknown,
): PathReviewSnapshotV1 {
  return {
    version: 1,
    pathPlan: {
      name: analysis.pathName ?? null,
      summary: analysis.summary ?? null,
      topology: analysis.topology ?? null,
      cognitiveCore: analysis.cognitiveCore || analysis.cognitiveDesign || null,
      milestones: analysis.suggestedMilestones ?? [],
      estimatedHours: analysis.estimatedTotalHours ?? null,
    },
    goalContext,
    prerequisiteTree: prerequisiteTree ?? readPrerequisiteTree(analysis),
  };
}

/** 快照 → 分析对象（供试验结果保留原方案）。 */
export function snapshotToAnalysis(snapshot: PathReviewSnapshotV1): PathReviewAnalysis {
  return {
    pathName: snapshot.pathPlan.name ?? null,
    summary: snapshot.pathPlan.summary ?? null,
    topology: snapshot.pathPlan.topology ?? null,
    cognitiveCore: snapshot.pathPlan.cognitiveCore ?? null,
    estimatedTotalHours: snapshot.pathPlan.estimatedHours ?? null,
    suggestedMilestones: (snapshot.pathPlan.milestones ?? []) as PathReviewAnalysis['suggestedMilestones'],
  };
}

/**
 * 对固定快照调用 path-reviewer。返回值区分「有输出」与「调用失败/无有效结果」，
 * 便于后台观察把后者记为证据不足，而不是伪造一个 passed。
 */
export async function requestPathReviewSnapshot(
  snapshot: PathReviewSnapshotV1,
): Promise<PathReviewInvocationResult> {
  // 契约：executeSkill 返回已解包 output（无 success/output 包装），此处必须走
  // executeSkillWithResult 才能拿到评审成功标志；误检 executeSkill 的 success 会让
  // 评审结论恒被丢弃（2026-10-22 审计 P1-1）。
  const reviewResult = await executeSkillWithResult(pathReviewerDefinition, {
    pathPlan: snapshot.pathPlan,
    goalContext: snapshot.goalContext,
    prerequisiteTree: snapshot.prerequisiteTree,
  });
  if (reviewResult?.success && reviewResult?.output) {
    return {
      output: reviewResult.output as PathReviewResult,
      errorCode: null,
      errorMessage: null,
    };
  }
  const error = reviewResult?.error as { code?: string; message?: string } | undefined;
  return {
    output: null,
    errorCode: typeof error?.code === 'string' ? error.code : null,
    errorMessage: typeof error?.message === 'string' ? error.message : null,
  };
}

/** 兼容旧调用：从 data + analysis 构造快照后评审。 */
export async function requestPathReview(
  data: GeneratePathData,
  analysis: PathReviewAnalysis,
): Promise<PathReviewInvocationResult> {
  return requestPathReviewSnapshot(buildPathReviewSnapshot(data, analysis));
}

/** passed 与 score 同源：有分数时一律按阈值重判，不采信模型自报 passed。 */
function normalizeReviewVerdict(review: PathReviewResult | null): PathReviewResult | null {
  if (!review) return null;
  if (typeof review.score === 'number' && Number.isFinite(review.score)) {
    return { ...review, passed: review.score >= PATH_REVIEW_PASS_THRESHOLD };
  }
  return review;
}

function buildReplanData(
  data: GeneratePathData,
  snapshot: PathReviewSnapshotV1,
  pathReview: PathReviewResult,
): GeneratePathData {
  return {
    ...data,
    source: 'replan',
    mode: 'replan',
    userProfile: {
      ...(data.userProfile || {}),
      replan: {
        ...(data.userProfile?.replan || {}),
        triggerSource: 'path-reviewer',
        reviewerFeedback: typeof pathReview.replanInstructions === 'string'
          ? pathReview.replanInstructions
          : undefined,
        // 被调整的原路径：只带渲染需要的字段，避免载荷膨胀。
        previousPlan: {
          name: snapshot.pathPlan.name ?? null,
          summary: snapshot.pathPlan.summary ?? null,
          cognitiveCore: snapshot.pathPlan.cognitiveCore ?? null,
          milestones: (Array.isArray(snapshot.pathPlan.milestones) ? snapshot.pathPlan.milestones : []).map((m) => {
            const milestone = m as { title?: string | null; name?: string | null; goal?: string | null };
            return {
              title: milestone?.title ?? milestone?.name ?? null,
              goal: milestone?.goal ?? null,
            };
          }),
        },
      },
    },
  };
}

export interface PathReviewComparison {
  originalScore: number | null;
  replannedScore: number | null;
  scoreDelta: number | null;
  passedChanged: boolean | null;
}

export interface PathReviewExperimentResult {
  originalAnalysis: PathReviewAnalysis;
  originalReview: PathReviewResult | null;
  originalInvocation: PathReviewInvocationResult;
  replanned: boolean;
  replanDepth: number;
  replannedAnalysis?: PathReviewAnalysis;
  /** 返工方案的完整快照：试验存证要求原方案与返工方案都可复核。 */
  replannedSnapshot?: PathReviewSnapshotV1;
  replannedReview?: PathReviewResult | null;
  replannedInvocation?: PathReviewInvocationResult;
  comparison?: PathReviewComparison;
  skippedReason?: string;
}

/**
 * 显式试验分组：评审 →（低分且有返工指令时）最多一次重规划 → 对返工结果再评审。
 *
 * 不落库、不改 durable path；调用方（虚拟实验室的显式实验分组）负责把原方案与返工方案
 * 一起存证。普通真实/虚拟路径不调用本函数。
 */
export async function runPathReviewComparisonExperiment(params: {
  data: GeneratePathData;
  snapshot: PathReviewSnapshotV1;
  analyzePath: AnalyzePathFn;
  review?: (snapshot: PathReviewSnapshotV1) => Promise<PathReviewInvocationResult>;
  /** 原方案已有评审结果时复用，避免重复调用模型 */
  originalInvocation?: PathReviewInvocationResult;
  maxReplanDepth?: number;
}): Promise<PathReviewExperimentResult> {
  const review = params.review ?? requestPathReviewSnapshot;
  const maxDepth = Math.max(0, params.maxReplanDepth ?? MAX_PATH_REPLAN_DEPTH);
  const originalInvocation = params.originalInvocation ?? await review(params.snapshot);
  const originalReview = normalizeReviewVerdict(originalInvocation.output);
  const result: PathReviewExperimentResult = {
    originalAnalysis: snapshotToAnalysis(params.snapshot),
    originalReview,
    originalInvocation,
    replanned: false,
    replanDepth: 0,
  };

  const pathReview = originalReview;
  if (!pathReview) {
    result.skippedReason = 'original_review_unavailable';
    return result;
  }
  if (pathReview.passed !== false) {
    result.skippedReason = 'original_review_passed';
    return result;
  }
  if (pathReview.passed === false && pathReview.replanInstructions) {
    if (maxDepth <= 0) {
      result.skippedReason = 'replan_depth_exhausted';
      return result;
    }
    logger.info('[path-reviewer] 试验分组触发一次重规划（不影响 durable path）', {
      score: pathReview.score,
      replanInstructions: pathReview.replanInstructions,
      maxReplanDepth: maxDepth,
    });
    try {
      const replanData = buildReplanData(params.data, params.snapshot, pathReview);
      const replannedAnalysis = await params.analyzePath(replanData);
      if (!replannedAnalysis?.suggestedMilestones?.length) {
        result.skippedReason = 'replan_empty';
        return result;
      }
      const replannedSnapshot = buildPathReviewSnapshotFromAnalysis(
        replannedAnalysis,
        params.snapshot.goalContext,
        params.snapshot.prerequisiteTree,
      );
      const replannedInvocation = await review(replannedSnapshot);
      const replannedReview = normalizeReviewVerdict(replannedInvocation.output);
      const originalScore = typeof pathReview.score === 'number' ? pathReview.score : null;
      const replannedScore = typeof replannedReview?.score === 'number' ? replannedReview.score : null;
      result.replanned = true;
      result.replanDepth = 1;
      result.replannedAnalysis = replannedAnalysis;
      result.replannedSnapshot = replannedSnapshot;
      result.replannedReview = replannedReview;
      result.replannedInvocation = replannedInvocation;
      result.comparison = {
        originalScore,
        replannedScore,
        scoreDelta: originalScore !== null && replannedScore !== null
          ? replannedScore - originalScore
          : null,
        passedChanged: typeof pathReview.passed === 'boolean' && typeof replannedReview?.passed === 'boolean'
          ? pathReview.passed !== replannedReview.passed
          : null,
      };
      logger.info('[path-reviewer] 试验分组重规划与再评审完成', {
        originalScore,
        replannedScore,
        scoreDelta: result.comparison.scoreDelta,
      });
      return result;
    } catch (error) {
      result.skippedReason = 'replan_failed';
      logger.warn('[path-reviewer] 试验分组重规划失败（保留原方案）', {
        error: error instanceof Error ? error.message : String(error),
      });
      return result;
    }
  }

  // 低分但缺少返工指令：不重规划；由调用方记为证据不足。
  result.skippedReason = 'replan_instructions_missing';
  return result;
}
