/**
 * 路径质量评审的后台观察者（2026-11-21）。
 *
 * 职责：消费 `path:quality-review` outbox 事件，对**落库时冻结的路径快照**调用
 * `path-reviewer`，把结果写回 `aiPromptTemplate._generation.pathReview`。
 *
 * 硬约束：
 * - 只更新评审状态，不改 `learning_paths.status`、里程碑、任务或学习进度；
 * - 结果只关联事件里的 `reviewedGenerationRunId`（不可变版本）。写回前在同一事务里
 *   重读路径版本，版本已变（被新生成覆盖）则直接丢弃，绝不修改新路径；
 * - 模型超时/缺字段/低分只影响评审状态：超时/调用失败 → `unavailable`，
 *   输出无效（缺维度/低分无返工指令，重试耗尽）→ `insufficient_evidence`；
 * - 与 `simulation-path-evaluate`（虚拟学员对方案的反应，存 stageResults.path_review）
 *   是两套独立证据：本模块不读写 stageResults，也不改学员状态；
 * - 显式虚拟实验分组（`mode: replan_experiment`）的「评审→一次返工→再评审」结果写在
 *   `_generation.pathReviewExperiment`，`effectOnDurablePath: 'none'`，普通路径不受影响。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { withTransaction } from '../../../utils/with-transaction';
import { parsePathPromptTemplate } from '../learning.helpers';
import type { DurableDomainEvent } from '../../../events/contracts';
import {
  PATH_QUALITY_REVIEW_EVENT_TYPE,
  PATH_REVIEW_REVIEWER_KIND,
  hashPathReviewSnapshot,
  type PathQualityReviewEventData,
  type PathReviewReviewerKind,
} from '../../../events/path-quality-review-event';
import {
  validatePathReviewOutput,
  type PathReviewDimensions,
} from '../../../skills/path-reviewer/contract';
import { buildPathReviewConfig, type PathReviewConfig } from './path-review-config';
import {
  requestPathReviewSnapshot,
  runPathReviewComparisonExperiment,
  type PathReviewInvocationResult,
  type PathReviewResult,
  type PathReviewSnapshotV1,
} from './path-review-replan';
import type { GeneratePathData } from '../learning.types';

export type PathReviewStatus =
  | 'pending'
  | 'passed'
  | 'failed'
  | 'insufficient_evidence'
  | 'unavailable';

export type PathReviewDegradedSource =
  | 'reviewer_timeout'
  | 'reviewer_error'
  | 'invalid_model_output'
  | 'snapshot_missing'
  | 'model_output_omitted';

export interface PathQualityReviewRecord {
  status: PathReviewStatus;
  reviewer: 'skill:path-reviewer';
  reviewerKind: PathReviewReviewerKind;
  reviewedGenerationRunId: string;
  reviewEventId: string;
  reviewConfig: PathReviewConfig;
  snapshotHash: string;
  score: number | null;
  dimensions: PathReviewDimensions | null;
  issues: unknown[];
  passed: boolean | null;
  replanInstructions: string | null;
  replanRecommended: boolean;
  evidence: {
    reason: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  };
  degradedSource: PathReviewDegradedSource | null;
  requestedAt: string | null;
  reviewedAt: string;
}

export interface PathReviewExperimentRecord {
  mode: 'replan_experiment';
  reviewerKind: PathReviewReviewerKind;
  requestedBy: PathQualityReviewEventData['requestedBy'];
  effectOnDurablePath: 'none';
  reviewedGenerationRunId: string;
  original: {
    snapshot: Record<string, unknown>;
    snapshotHash: string;
    review: PathQualityReviewRecord;
  };
  replanned: {
    snapshot: PathReviewSnapshotV1;
    snapshotHash: string;
    review: PathQualityReviewRecord;
  } | null;
  comparison: {
    originalScore: number | null;
    replannedScore: number | null;
    scoreDelta: number | null;
    passedChanged: boolean | null;
  } | null;
  skippedReason: string | null;
  completedAt: string;
}

/** `_generation` 中与评审相关的持久化形状（允许 pending 记录缺字段）。 */
interface PathGenerationReviewMetadata {
  pathVersion?: string | null;
  pathReview?: Partial<PathQualityReviewRecord> | null;
  pathReviewHistory?: unknown[];
  pathReviewExperiment?: PathReviewExperimentRecord | null;
  [key: string]: unknown;
}

const PATH_REVIEW_HISTORY_LIMIT = 10;

function asSnapshot(value: unknown): PathReviewSnapshotV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Partial<PathReviewSnapshotV1>;
  if (!snapshot.pathPlan || typeof snapshot.pathPlan !== 'object' || Array.isArray(snapshot.pathPlan)) {
    return null;
  }
  if (!snapshot.goalContext || typeof snapshot.goalContext !== 'object' || Array.isArray(snapshot.goalContext)) {
    return null;
  }
  return {
    version: 1,
    pathPlan: snapshot.pathPlan,
    goalContext: snapshot.goalContext as Record<string, unknown>,
    prerequisiteTree: snapshot.prerequisiteTree,
  };
}

function classifyInvocationFailure(invocation: PathReviewInvocationResult): {
  status: Extract<PathReviewStatus, 'unavailable' | 'insufficient_evidence'>;
  degradedSource: PathReviewDegradedSource;
  reason: string;
} {
  const code = invocation.errorCode || '';
  const message = invocation.errorMessage || '';
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return { status: 'unavailable', degradedSource: 'reviewer_timeout', reason: 'reviewer_timeout' };
  }
  if (code === 'PATH_REVIEWER_FAILED'
    && /PATH_REVIEWER_(OUTPUT|DIMENSION|REPLAN|SCORE)/i.test(message)) {
    return { status: 'insufficient_evidence', degradedSource: 'invalid_model_output', reason: 'invalid_model_output' };
  }
  if (!message) {
    // skill 返回 success=false 但无错误信息：视为模型输出缺失，而不是平台故障。
    return { status: 'insufficient_evidence', degradedSource: 'model_output_omitted', reason: 'model_output_omitted' };
  }
  return { status: 'insufficient_evidence', degradedSource: 'reviewer_error', reason: 'reviewer_error' };
}

function recordFromInvocation(params: {
  invocation: PathReviewInvocationResult;
  eventId: string;
  data: PathQualityReviewEventData;
  reviewConfig: PathReviewConfig;
  reviewedAt: string;
}): PathQualityReviewRecord {
  const { invocation, eventId, data, reviewConfig, reviewedAt } = params;
  const base: PathQualityReviewRecord = {
    status: 'insufficient_evidence',
    reviewer: 'skill:path-reviewer',
    reviewerKind: PATH_REVIEW_REVIEWER_KIND,
    reviewedGenerationRunId: data.reviewedGenerationRunId,
    reviewEventId: eventId,
    reviewConfig,
    snapshotHash: data.snapshotHash,
    score: null,
    dimensions: null,
    issues: [],
    passed: null,
    replanInstructions: null,
    replanRecommended: false,
    evidence: { reason: null, errorCode: invocation.errorCode, errorMessage: invocation.errorMessage },
    degradedSource: null,
    requestedAt: data.requestedAt ?? null,
    reviewedAt,
  };

  const output = invocation.output as PathReviewResult | null;
  if (!output) {
    const failure = classifyInvocationFailure(invocation);
    return {
      ...base,
      status: failure.status,
      degradedSource: failure.degradedSource,
      evidence: { ...base.evidence, reason: failure.reason },
    };
  }

  // 归一化前再校验一次：防止旧版 / 被 mock 的 skill 漏掉五维度校验。
  const verdict = validatePathReviewOutput(output);
  if (verdict.valid === false) {
    return {
      ...base,
      status: 'insufficient_evidence',
      degradedSource: 'invalid_model_output',
      evidence: { ...base.evidence, reason: verdict.failureReason },
    };
  }

  const replanInstructions = typeof output.replanInstructions === 'string'
    ? output.replanInstructions.trim()
    : null;
  return {
    ...base,
    status: verdict.needsReplan ? 'failed' : 'passed',
    score: verdict.score,
    dimensions: verdict.dimensions,
    issues: Array.isArray(output.issues) ? output.issues : [],
    passed: !verdict.needsReplan,
    replanInstructions,
    replanRecommended: verdict.needsReplan,
  };
}

function buildExperimentRecord(params: {
  data: PathQualityReviewEventData;
  originalRecord: PathQualityReviewRecord;
  experiment: Awaited<ReturnType<typeof runPathReviewComparisonExperiment>>;
  completedAt: string;
}): PathReviewExperimentRecord {
  const { data, originalRecord, experiment, completedAt } = params;
  const reviewConfig = originalRecord.reviewConfig;
  const replannedHash = experiment.replannedSnapshot
    ? hashPathReviewSnapshot(experiment.replannedSnapshot)
    : null;
  const replannedRecord = experiment.replannedInvocation
    ? recordFromInvocation({
        invocation: experiment.replannedInvocation,
        eventId: `${originalRecord.reviewEventId}:replanned`,
        data: replannedHash
          ? { ...data, snapshotHash: replannedHash }
          : data,
        reviewConfig,
        reviewedAt: completedAt,
      })
    : null;
  return {
    mode: 'replan_experiment',
    reviewerKind: PATH_REVIEW_REVIEWER_KIND,
    requestedBy: data.requestedBy,
    effectOnDurablePath: 'none',
    reviewedGenerationRunId: data.reviewedGenerationRunId,
    original: {
      snapshot: data.snapshot,
      snapshotHash: data.snapshotHash,
      review: originalRecord,
    },
    replanned: experiment.replanned && experiment.replannedSnapshot && replannedHash && replannedRecord
      ? {
          snapshot: experiment.replannedSnapshot,
          snapshotHash: replannedHash,
          review: replannedRecord,
        }
      : null,
    comparison: experiment.comparison ?? null,
    skippedReason: experiment.skippedReason ?? null,
    completedAt,
  };
}

async function maybeRunExperiment(params: {
  data: PathQualityReviewEventData;
  originalInvocation: PathReviewInvocationResult;
  originalRecord: PathQualityReviewRecord;
}): Promise<PathReviewExperimentRecord | null> {
  const { data, originalInvocation, originalRecord } = params;
  if (data.mode !== 'replan_experiment') return null;
  if (data.experiment?.compareReplan === false) return null;
  const completedAt = new Date().toISOString();
  try {
    const run = await prisma.path_generation_runs.findUnique({
      where: { id: data.reviewedGenerationRunId },
      select: { inputSnapshot: true, learningPathId: true },
    });
    if (!run?.inputSnapshot || run.learningPathId !== data.pathId) {
      return {
        mode: 'replan_experiment',
        reviewerKind: PATH_REVIEW_REVIEWER_KIND,
        requestedBy: data.requestedBy,
        effectOnDurablePath: 'none',
        reviewedGenerationRunId: data.reviewedGenerationRunId,
        original: { snapshot: data.snapshot, snapshotHash: data.snapshotHash, review: originalRecord },
        replanned: null,
        comparison: null,
        skippedReason: 'generation_input_snapshot_missing',
        completedAt,
      };
    }
    const generationData = JSON.parse(run.inputSnapshot) as GeneratePathData;
    // 延迟加载：普通观察路径不把 path-generation.core 拉进 outbox 消费链。
    const { analyzePathForReviewExperiment } = await import('./path-generation.core');
    const experiment = await runPathReviewComparisonExperiment({
      data: generationData,
      snapshot: data.snapshot as unknown as PathReviewSnapshotV1,
      analyzePath: analyzePathForReviewExperiment,
      originalInvocation,
    });
    return buildExperimentRecord({ data, originalRecord, experiment, completedAt });
  } catch (error) {
    logger.warn('[path-review-observer] 试验分组执行失败（保留原评审，不影响路径）', {
      pathId: data.pathId,
      reviewedGenerationRunId: data.reviewedGenerationRunId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      mode: 'replan_experiment',
      reviewerKind: PATH_REVIEW_REVIEWER_KIND,
      requestedBy: data.requestedBy,
      effectOnDurablePath: 'none',
      reviewedGenerationRunId: data.reviewedGenerationRunId,
      original: { snapshot: data.snapshot, snapshotHash: data.snapshotHash, review: originalRecord },
      replanned: null,
      comparison: null,
      skippedReason: 'experiment_failed',
      completedAt,
    };
  }
}

/**
 * 消费一条 `path:quality-review` 事件。
 *
 * 失败会向上抛给 outbox（按既有退避/死信策略重试）；任何路径内容/状态都不在错误路径上修改。
 */
export async function observePathQualityReview(event: DurableDomainEvent): Promise<void> {
  if (event.type !== PATH_QUALITY_REVIEW_EVENT_TYPE) return;
  const data = event.data as PathQualityReviewEventData;
  if (!data?.pathId || !data.reviewedGenerationRunId) {
    logger.warn('[path-review-observer] 事件载荷缺少 pathId/version，忽略', { eventId: event.id });
    return;
  }
  const reviewConfig = (data.reviewConfig && typeof data.reviewConfig === 'object')
    ? data.reviewConfig as unknown as PathReviewConfig
    : buildPathReviewConfig();

  const path = await prisma.learning_paths.findUnique({
    where: { id: data.pathId },
    select: { id: true, status: true, activeGenerationRunId: true, aiPromptTemplate: true },
  });
  if (!path) {
    logger.warn('[path-review-observer] 路径已不存在，丢弃评审任务', {
      pathId: data.pathId,
      reviewedGenerationRunId: data.reviewedGenerationRunId,
    });
    return;
  }

  const currentTemplate = parsePathPromptTemplate(path.aiPromptTemplate);
  const currentGeneration = (currentTemplate._generation && typeof currentTemplate._generation === 'object')
    ? currentTemplate._generation as PathGenerationReviewMetadata
    : {};
  if (currentGeneration.pathVersion !== data.reviewedGenerationRunId) {
    logger.info('[path-review-observer] 评审任务针对旧版路径，结果丢弃（不修改新路径）', {
      pathId: data.pathId,
      reviewedGenerationRunId: data.reviewedGenerationRunId,
      currentPathVersion: currentGeneration.pathVersion ?? null,
    });
    return;
  }
  if (currentGeneration.pathReview?.reviewEventId === event.id
    && currentGeneration.pathReview?.status !== 'pending') {
    logger.debug('[path-review-observer] 同一版本评审已完成，幂等跳过', {
      pathId: data.pathId,
      eventId: event.id,
    });
    return;
  }

  const snapshot = asSnapshot(data.snapshot);
  const reviewedAt = new Date().toISOString();
  let invocation: PathReviewInvocationResult;
  if (!snapshot) {
    invocation = {
      output: null,
      errorCode: 'PATH_REVIEW_SNAPSHOT_INVALID',
      errorMessage: 'PATH_REVIEW_SNAPSHOT_INVALID',
    };
  } else {
    try {
      invocation = await requestPathReviewSnapshot(snapshot);
    } catch (error) {
      invocation = {
        output: null,
        errorCode: 'PATH_REVIEWER_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const record = recordFromInvocation({
    invocation,
    eventId: event.id,
    data,
    reviewConfig,
    reviewedAt,
  });
  if (!snapshot) {
    record.status = 'insufficient_evidence';
    record.degradedSource = 'snapshot_missing';
    record.evidence = { ...record.evidence, reason: 'snapshot_missing' };
  }

  const experimentRecord = snapshot && invocation.output
    ? await maybeRunExperiment({ data, originalInvocation: invocation, originalRecord: record })
    : null;

  let written = false;
  let skipReason: string | null = null;
  await withTransaction(async (tx) => {
    const current = await tx.learning_paths.findUnique({
      where: { id: data.pathId },
      select: { aiPromptTemplate: true },
    });
    if (!current) {
      skipReason = 'path_missing';
      return;
    }
    const template = parsePathPromptTemplate(current.aiPromptTemplate);
    const generation = (template._generation && typeof template._generation === 'object')
      ? template._generation as PathGenerationReviewMetadata
      : {};
    // 版本栅栏：快照/评审期间路径可能被新生成覆盖；此时只丢弃，不碰新路径。
    if (generation.pathVersion !== data.reviewedGenerationRunId) {
      skipReason = 'stale_version';
      return;
    }
    if (generation.pathReview?.reviewEventId === event.id
      && generation.pathReview?.status !== 'pending') {
      skipReason = 'already_processed';
      return;
    }
    const previousHistory = Array.isArray(generation.pathReviewHistory)
      ? generation.pathReviewHistory.filter((item: unknown) => {
          const record = item as { reviewEventId?: unknown } | null;
          return record?.reviewEventId !== event.id;
        })
      : [];
    const history = [...previousHistory, record].slice(-PATH_REVIEW_HISTORY_LIMIT);
    await tx.learning_paths.update({
      where: { id: data.pathId },
      data: {
        aiPromptTemplate: JSON.stringify({
          ...template,
          _generation: {
            ...generation,
            pathReview: record,
            pathReviewHistory: history,
            ...(experimentRecord ? { pathReviewExperiment: experimentRecord } : {}),
          },
        }),
        // 模板变更落 updatedAt（与 scene 写侧一致），只影响读取缓存，不改路径状态。
        updatedAt: new Date(),
      },
    });
    written = true;
  });

  if (!written) {
    logger.info('[path-review-observer] 评审结果未写回（版本已变或已处理）', {
      pathId: data.pathId,
      reviewedGenerationRunId: data.reviewedGenerationRunId,
      skipReason,
    });
    return;
  }
  logger.info('[path-review-observer] 路径质量评审完成', {
    pathId: data.pathId,
    reviewedGenerationRunId: data.reviewedGenerationRunId,
    status: record.status,
    score: record.score,
    replanRecommended: record.replanRecommended,
    degradedSource: record.degradedSource,
    experiment: experimentRecord
      ? { replanned: Boolean(experimentRecord.replanned), skippedReason: experimentRecord.skippedReason }
      : null,
  });
}
