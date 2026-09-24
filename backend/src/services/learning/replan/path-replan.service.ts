/**
 * 路径重规划域（架构审计 §5 行动 #2：learning.service.ts 按领域拆分——重规划域）
 *
 * 职责：单阶段重排（redesignMilestoneTasks）、多阶段重排（resolveDownstreamReplanTargets →
 * redesignMilestoneRange → executeDownstreamReplan 后台执行体）与对外的 requestPathReplan
 * 入口（预览/确认/冻结已完成任务）。行为与拆分前 learning.service 同名方法逐一等价。
 */
import prisma from '../../../config/database';
import { withTransaction } from '../../../utils/with-transaction';
import { executeSkill } from '../../../skills';
import { stageDesignerDefinition } from '../../../skills/stage-designer';
import { assertGenerationRunFence, assertStageTasksPresent } from '../path-generation-status';
import {
  assertPathMutationSafe,
  buildPathReplanSnapshot,
  claimPathReplanSnapshot,
  createPathVersioningUnsupportedError,
  isPathMutationConflictError,
  PathMutationConflictError,
  type PathReplanSnapshot,
} from '../path-mutation-safety';
import {
  generateDisplayLabel,
  getSceneFramingNormalizedInput,
  normalizePathTaskType,
  parsePathCognitiveDesign,
  parsePathPromptTemplate,
  resolvePersistedNormalizedInput,
  resolveTaskConcept,
} from '../learning.helpers';
import type { PathReplanRequest } from '../learning.types';
import { createDomainEvent } from '../../../events/contracts';
import { enqueueDomainEvent } from '../../../events/outbox.repository';
import { learnerSnapshotRefreshService } from '../../learner/LearnerSnapshotRefreshService';
import { dashboardGuidanceSnapshotService } from '../../learner/DashboardGuidanceSnapshotService';
import { learnerProjectionService } from '../../learner/LearnerProjectionService';
import { runBackgroundTask } from '../../background-task-tracker.service';
import {
  createAndClaimGenerationRun,
  failGenerationRun,
  heartbeatGenerationRun,
  restorePathAfterMutationConflict,
  startGenerationHeartbeat,
  updatePathGenerationStatus,
} from '../generation/run-lifecycle';

function resolveStageReplanTarget(path: any, requestedStageNumber?: number | null) {
  if (requestedStageNumber) {
    const requested = path.milestones.find((milestone: any) => milestone.stageNumber === requestedStageNumber) || null;
    return requested?.status === 'completed' ? null : requested;
  }

  const activeMilestone = path.milestones.find((milestone: any) => {
    if (milestone.status === 'completed') return false;
    const tasks = milestone.subtasks || [];
    return tasks.length === 0 || tasks.some((task: any) => task.status !== 'completed');
  });

  return activeMilestone || null;
}

async function redesignMilestoneTasks(
  path: any,
  milestone: any,
  data: PathReplanRequest,
  learnerReplanProjection: any,
  runId: string,
  snapshot: PathReplanSnapshot,
  options: {
    skipFinalizeRun?: boolean;
    eventRunTotal?: number;
  } = {}
) {
  const { skipFinalizeRun = false, eventRunTotal = 1 } = options;
  const parsedTemplate = parsePathPromptTemplate(path.aiPromptTemplate || null);
  const pathCognitiveDesign = parsePathCognitiveDesign(path.aiPromptTemplate || null);
  const normalizedInput = getSceneFramingNormalizedInput(parsedTemplate?.sceneFraming)
    || resolvePersistedNormalizedInput(parsedTemplate)
    || null;
  const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
    ? parsedTemplate.sceneFraming
    : null;
  const completedTasks = (milestone.subtasks || []).filter((task: any) => task.status === 'completed');
  const sortedMilestones = [...(path.milestones || [])].sort((a: any, b: any) => a.stageNumber - b.stageNumber);
  const milestoneIndex = sortedMilestones.findIndex((m: any) => m.id === milestone.id);
  const previousMilestone = milestoneIndex > 0 ? sortedMilestones[milestoneIndex - 1] : null;

  const stageDesignerInput = {
    milestone: {
      stageNumber: milestone.stageNumber,
      title: milestone.title,
      coreConcept: milestone.coreConceptId || null,
      description: milestone.description || null,
      goal: milestone.goal || null,
      estimatedHours: milestone.estimatedHours || null,
    },
    ...(previousMilestone ? {
      previousMilestone: {
        stageNumber: previousMilestone.stageNumber,
        title: previousMilestone.title,
        coreConcept: previousMilestone.coreConceptId || null,
      },
    } : {}),
    cognitiveCore: pathCognitiveDesign,
    normalizedInput,
    repairHints: {
      reason: data.reason || null,
      triggerSource: data.triggerSource || null,
      evidence: data.evidence || null,
      learnerReplanProjection,
      preserveCompletedTasks: completedTasks.map((task: any) => ({ id: task.id, title: task.title })),
    },
  };
  const stageResult = await executeSkill(stageDesignerDefinition, stageDesignerInput);

  const newTasks = Array.isArray(stageResult?.subtasks) ? stageResult.subtasks : [];
  assertStageTasksPresent(milestone.stageNumber, newTasks);

  await withTransaction(async (tx) => {
    await assertGenerationRunFence(tx, path.id, runId);
    await claimPathReplanSnapshot(tx, snapshot);
    await assertPathMutationSafe(tx, path.id, 'replan-stage', {
      milestoneId: milestone.id,
      ...(Array.isArray((data.evidence as any)?.clearedSessionIds) && (data.evidence as any).clearedSessionIds.length
        ? { ignoreCompletedSessionIds: (data.evidence as any).clearedSessionIds as string[] }
        : {})
    });
    await tx.subtasks.deleteMany({
      where: {
        milestoneId: milestone.id,
        status: { not: 'completed' },
      }
    });

    for (let index = 0; index < newTasks.length; index += 1) {
      const taskData = newTasks[index];
      const resolvedConcept = resolveTaskConcept(
        typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
        pathCognitiveDesign,
        typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
      );
      const displayLabel = generateDisplayLabel(taskData.knowledgeType || null, taskData.cognitiveLevel || null)
        || (taskData.knowledgeType && taskData.cognitiveLevel ? `${taskData.knowledgeType} + ${taskData.cognitiveLevel}` : null);

      await tx.subtasks.create({
        data: {
          id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${milestone.stageNumber}_${index}`,
          milestoneId: milestone.id,
          userId: data.userId,
          title: taskData.title || `任务${index + 1}`,
          description: taskData.description || '',
          taskType: normalizePathTaskType(taskData.type),
          estimatedMinutes: taskData.estimatedMinutes || 30,
          acceptanceCriteria: taskData.acceptanceHint || '',
          coreConcept: resolvedConcept.linkedConceptName || null,
          linkedConceptId: resolvedConcept.linkedConceptId || null,
          linkedConceptName: resolvedConcept.linkedConceptName || null,
          knowledgeType: taskData.knowledgeType || null,
          cognitiveLevel: taskData.cognitiveLevel || null,
          icapLevel: taskData.icapLevel || null,
          displayLabel,
          learningObjectives: null,
          transferable: taskData.transferable ?? false,
          annotationConfidence: null,
          order: Math.max(-1, ...completedTasks.map((task: any) => Number(task.order) || 0)) + 1 + index,
          status: 'todo',
          updatedAt: new Date(),
        }
      });
    }

    // 阶段/路径估时回写：本阶段任务分钟汇总（ceil 整小时）；路径=Σ各阶段（含未重设计阶段既有任务）
    const redesignTotalMinutes = (newTasks as Array<{ estimatedMinutes?: number }>)
      .reduce((sum, t) => sum + (Number(t?.estimatedMinutes) || 0), 0);
    // 保留的已完成任务也计入本阶段时长
    const completedMinutes = completedTasks.reduce((sum: number, t: any) => sum + (Number(t?.estimatedMinutes) || 0), 0);
    const stageNewHours = newTasks.length > 0 ? Math.max(1, Math.ceil((redesignTotalMinutes + completedMinutes) / 60)) : null;
    if (stageNewHours !== null) {
      await tx.milestones.update({
        where: { id: milestone.id },
        data: { estimatedHours: stageNewHours, updatedAt: new Date() }
      });
    }
    // 路径汇总：以全部阶段任务分钟真实汇总（含重设计阶段新任务 + 其它阶段既有任务）。
    // 渐进式路径（批次 D）存在**未设计阶段**（无任务、保留骨架 LLM 估值）——
    // 这些阶段的估时用 milestone.estimatedHours 现值累加，否则路径总时被算小。
    const allPathTasks = await tx.subtasks.findMany({
      where: { milestones: { learningPathId: path.id } },
      select: { estimatedMinutes: true, milestoneId: true },
    });
    const designedMilestoneIds = new Set(allPathTasks.map((t: any) => t.milestoneId));
    const undesignedMilestones = await tx.milestones.findMany({
      where: { learningPathId: path.id, id: { notIn: [...designedMilestoneIds] } },
      select: { estimatedHours: true },
    });
    const undesignedHours = undesignedMilestones.reduce(
      (sum: number, m: any) => sum + (Number(m?.estimatedHours) || 0),
      0
    );
    const pathTotalMinutes = allPathTasks.reduce((sum, t: any) => sum + (Number(t?.estimatedMinutes) || 0), 0);
    const pathHoursFromTasks = allPathTasks.length > 0 ? Math.max(1, Math.ceil(pathTotalMinutes / 60)) : 0;
    const pathHours = pathHoursFromTasks + Math.ceil(undesignedHours);

    await tx.learning_paths.update({
      where: { id: path.id },
      data: {
        // 断链修复 P0-4：真实 replan 流补写 replan 元数据（此前 LearningDecisionFeedService
        // 依赖 replanReason 非空，而真实 replan 从不写 → 决策卡不出现）
        ...(pathHours > 0 ? { estimatedHours: pathHours } : {}),
        replanMode: data.mode || 'overwrite',
        replanTriggerSource: data.triggerSource || 'api',
        replanReason: data.reason || null,
        aiPromptTemplate: JSON.stringify({
          ...parsedTemplate,
          stageDesigns: {
            ...(parsedTemplate?.stageDesigns && typeof parsedTemplate.stageDesigns === 'object' ? parsedTemplate.stageDesigns : {}),
            [`stage-${milestone.stageNumber}`]: {
              inputPayload: stageDesignerInput,
              rawModelOutput: stageResult?._debug?.rawModelOutput || null,
              extractedJson: stageResult?._debug?.extractedJson || null,
              normalizedOutput: {
                subtasks: newTasks,
              },
              redesignedAt: new Date().toISOString(),
              redesignReason: data.reason || null,
              ...(eventRunTotal > 1 ? { rangeDesign: true } : {}),
            }
          },
          _generation: {
            ...(parsedTemplate?._generation && typeof parsedTemplate._generation === 'object' ? parsedTemplate._generation : {}),
            stageDesign: 'succeeded',
            lastError: null,
            triggerSource: data.triggerSource || 'api',
            updatedAt: new Date().toISOString(),
          }
        }),
        updatedAt: new Date(),
      }
    });
    if (!skipFinalizeRun) {
      await tx.path_generation_runs.update({
        where: { id: runId },
        data: {
          status: 'succeeded',
          retryAllowed: false,
          totalItems: eventRunTotal,
          completedItems: eventRunTotal,
          progress: 100,
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(),
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
    }
    await enqueueDomainEvent(tx, createDomainEvent({
      type: 'path:adjusted',
      aggregateType: 'path',
      aggregateId: path.id,
      userId: data.userId,
      source: 'learning-service',
      data: {
        pathId: path.id,
        milestoneId: milestone.id,
        stageNumber: milestone.stageNumber,
        redesignedTaskCount: newTasks.length,
        preservedCompletedTaskCount: completedTasks.length,
        reason: data.reason || null,
        triggerSource: data.triggerSource || 'api'
      }
    }));
  });

  return {
    pathId: path.id,
    redesignedStageNumber: milestone.stageNumber,
    redesignedTaskCount: newTasks.length,
    preservedCompletedTaskCount: completedTasks.length,
  };
}

/** 多阶段重排：解析目标阶段（含起始阶段的已学冻结与进行中拦截） */
function resolveDownstreamReplanTargets(
  path: any,
  requestedFromStage?: number | null
): any[] {
  const sorted = [...(path.milestones || [])]
    .sort((a: any, b: any) => a.stageNumber - b.stageNumber);
  const active = sorted.find((m: any) => m.status !== 'completed');
  if (!active) return [];
  if (requestedFromStage !== undefined && requestedFromStage !== null) {
    const from = sorted.find((m: any) => m.stageNumber === requestedFromStage);
    if (!from) throw new Error('指定调整的起始阶段不存在');
    if (from.status === 'completed') throw new Error('指定调整的起始阶段已学完，请选择未开始学习的阶段');
    return sorted.filter((m: any) => m.stageNumber >= from.stageNumber && m.status !== 'completed');
  }
  // 缺省 = 当前活动阶段（含）
  return sorted.filter((m: any) => m.stageNumber >= active.stageNumber && m.status !== 'completed');
}

/** 多阶段重排驱动：串行逐阶段重设计任务，进度回写 heartbeat（前台轮询可见） */
async function redesignMilestoneRange(
  path: any,
  milestones: any[],
  data: PathReplanRequest,
  learnerReplanProjection: any,
  runId: string
) {
  let redesignedStages = 0;
  let redesignedTaskCount = 0;
  let preservedCompletedTaskCount = 0;

  for (let index = 0; index < milestones.length; index += 1) {
    const milestone = milestones[index];
    // 每个阶段执行前重读该阶段最新状态（前一阶段的写入会更新其 updatedAt；自身仅受外部写影响）
    const freshMilestone = await prisma.milestones.findUnique({
      where: { id: milestone.id },
      include: { subtasks: { orderBy: { order: 'asc' } } }
    });
    if (!freshMilestone) throw new Error('调整目标阶段不存在');
    const result = await redesignMilestoneTasks(
      path,
      freshMilestone,
      { ...data, evidence: {
          ...(data.evidence || {}),
          downstreamRange: {
            fromStageNumber: milestones[0].stageNumber,
            total: milestones.length,
            index: index + 1,
          },
        } },
      learnerReplanProjection,
      runId,
      buildPathReplanSnapshot(freshMilestone),
      {
        skipFinalizeRun: true,
        eventRunTotal: milestones.length,
      }
    );
    redesignedStages += 1;
    redesignedTaskCount += result.redesignedTaskCount;
    preservedCompletedTaskCount += result.preservedCompletedTaskCount;
    await heartbeatGenerationRun(
      path.id,
      runId,
      {
        totalItems: milestones.length,
        completedItems: redesignedStages,
        progress: Math.round((redesignedStages / milestones.length) * 100),
      }
    );
  }
  return { redesignedStages, redesignedTaskCount, preservedCompletedTaskCount };
}

/** 多阶段重排后台执行体：预检 → 逐阶段重设计 → 收尾 run（heartbeat 由 interval 维持） */
async function executeDownstreamReplan(context: {
  pathId: string;
  userId: string;
  fromStageNumber: number;
  stageCount: number;
  data: PathReplanRequest;
  learnerReplanProjection: any;
  runId: string;
}): Promise<void> {
  const { pathId, fromStageNumber, stageCount, data, learnerReplanProjection, runId } = context;
  const stopHeartbeat = startGenerationHeartbeat(pathId, runId);
  try {
    // 执行期重读路径（请求期快照可能已被其它后台写触碰；以执行期一致状态为准）
    const freshPath = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      include: { milestones: { include: { subtasks: true } } }
    });
    if (!freshPath) throw new Error('学习路径不存在');
    const milestones = resolveDownstreamReplanTargets(freshPath, fromStageNumber);
    if (milestones.length !== stageCount) {
      throw new PathMutationConflictError(
        '调整范围内阶段状态已变化，请刷新后重新调整',
        'PATH_REPLAN_RANGE_CHANGED'
      );
    }

    // 预检：无进行中任务/未结束课堂（提交期逐阶段各自乐观锁 claim + 安全检查）
    // 只读校验事务（无写入）：保留裸 $transaction 以维持只读快照语义，本轮不接入写入封装
    await prisma.$transaction(async (tx) => {
      await assertGenerationRunFence(tx, pathId, runId);
      await assertPathMutationSafe(tx, pathId, 'replan-stage', {
        milestoneIds: milestones.map((m: any) => m.id),
        ...(Array.isArray((data.evidence as any)?.clearedSessionIds) && (data.evidence as any).clearedSessionIds.length
          ? { ignoreCompletedSessionIds: (data.evidence as any).clearedSessionIds as string[] }
          : {})
      });
    });

    await redesignMilestoneRange(
      freshPath,
      milestones,
      data,
      learnerReplanProjection,
      runId
    );

    // 收尾：run 成功落库（阶段任务已逐阶段写入）
    await withTransaction(async (tx) => {
      await assertGenerationRunFence(tx, pathId, runId);
      await tx.path_generation_runs.update({
        where: { id: runId },
        data: {
          status: 'succeeded',
          retryAllowed: false,
          totalItems: milestones.length,
          completedItems: milestones.length,
          progress: 100,
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(),
          finishedAt: new Date(),
          errorCode: null,
          errorMessage: null
        }
      });
    });
  } catch (error) {
    if (isPathMutationConflictError(error)) {
      await restorePathAfterMutationConflict(pathId, runId, error);
      throw error;
    }
    try {
      await updatePathGenerationStatus(pathId, {
        stageDesign: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
        triggerSource: data.triggerSource || 'api',
        updatedAt: new Date().toISOString()
      }, runId);
      await failGenerationRun(
        pathId,
        runId,
        error,
        error instanceof Error && error.message.includes('EMPTY_TASKS')
          ? 'PATH_STAGE_DESIGN_ZERO_TASKS'
          : 'PATH_ENRICHMENT_FAILED',
        'stageDesign'
      );
    } catch (fenceError) {
      if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
    }
    throw error;
  } finally {
    stopHeartbeat();
  }
}

export async function requestPathReplan(data: PathReplanRequest) {
  const requestedMode = data.mode || 'overwrite';
  const mode = requestedMode;
  const triggerSource = data.triggerSource || 'api';

  const path = await prisma.learning_paths.findUnique({
    where: { id: data.pathId },
    include: {
      milestones: {
        include: {
          subtasks: true
        }
      }
    }
  });

  if (!path) {
    throw new Error('学习路径不存在');
  }

  if (path.userId !== data.userId) {
    throw new Error('无权访问此学习路径');
  }

  if (requestedMode === 'new_version') {
    throw createPathVersioningUnsupportedError();
  }

  const completedTaskIds = path.milestones
    .flatMap((milestone: any) => milestone.subtasks || [])
    .filter((task: any) => task.status === 'completed')
    .map((task: any) => task.id);

  const learnerSnapshot = await learnerSnapshotRefreshService.refresh({
    userId: data.userId,
    pathId: data.pathId,
    scope: 'path',
  });
  const learnerReplanProjection = learnerProjectionService.toReplanProjection(learnerSnapshot);
  const replanSignal = learnerSnapshot.replanSignal;

  // 后续阶段重排（多阶段）：显式指定 fromStageNumber 时触发
  const downstreamTargets = data.fromStageNumber !== undefined && data.fromStageNumber !== null
    ? resolveDownstreamReplanTargets(path, data.fromStageNumber)
    : null;

  const targetMilestone = downstreamTargets && downstreamTargets.length > 0
    ? downstreamTargets[0]
    : resolveStageReplanTarget(path, data.stageNumber || null);
  const replanSnapshot = targetMilestone ? buildPathReplanSnapshot(targetMilestone) : null;

  if (!targetMilestone || !replanSnapshot) {
    if (data.previewOnly) {
      return {
        enabled: false,
        status: 'no-signal',
        signal: { shouldSuggest: false, recommendation: 'keep', rationale: '当前路径没有可重设计的阶段。' },
        request: {
          pathId: data.pathId,
          userId: data.userId,
          triggerSource,
          mode,
          requestedMode,
          stageNumber: null,
          fromStageNumber: data.fromStageNumber ?? null,
          reason: data.reason || '',
        },
      };
    }
    throw new Error('当前路径没有可重设计的阶段');
  }

  if (data.previewOnly || (replanSignal?.shouldSuggest && data.requireConfirmation !== false)) {
    // 预览模式：无论是否建议调整都返回诊断（keep 也展示「无需调整」），不执行
    // 常规模式：有建议且需确认时先返回 awaiting-confirmation
    return {
      enabled: false,
      status: replanSignal?.shouldSuggest || data.previewOnly
        ? 'awaiting-confirmation'
        : 'no-signal',
      signal: replanSignal,
      request: {
        pathId: data.pathId,
        userId: data.userId,
        triggerSource,
        mode,
        requestedMode,
        stageNumber: targetMilestone?.stageNumber || null,
        fromStageNumber: data.fromStageNumber ?? null,
        reason: data.reason || replanSignal?.rationale || '',
        evidence: {
          ...(data.evidence || {}),
          learnerReplanProjection,
          replanSignal,
        }
      }
    };
  }

  const currentMilestoneTitle = learnerReplanProjection?.path.currentPosition.milestoneTitle || '';
  const stableConcepts = learnerReplanProjection?.mastery.stableConcepts || [];
  const fragileConcepts = learnerReplanProjection?.mastery.fragileConcepts || [];
  const strugglingConcepts = learnerReplanProjection?.mastery.strugglingConcepts || [];
  const prerequisiteGaps = learnerReplanProjection?.risk.prerequisiteGaps?.map((item) => item.label) || [];

  // ---- 多阶段重排（后续阶段，保留已学）：后台执行，前台轮询 lifecycle ----
  if (downstreamTargets && downstreamTargets.length > 0) {
    const rangeMilestones = downstreamTargets;
    const rangeRun = await createAndClaimGenerationRun(
      data.pathId,
      'stageDesign',
      'stageDesign',
      rangeMilestones.length,
      'replan-stage',
      path.activeGenerationRunId,
      {
        milestoneIds: rangeMilestones.map((m: any) => m.id),
        ...(Array.isArray((data.evidence as any)?.clearedSessionIds) && (data.evidence as any).clearedSessionIds.length
          ? { ignoreCompletedSessionIds: (data.evidence as any).clearedSessionIds as string[] }
          : {})
      }
    );

    await updatePathGenerationStatus(data.pathId, {
      stageDesign: 'processing',
      lastError: null,
      triggerSource,
      updatedAt: new Date().toISOString()
    }, rangeRun.id);

    const rangeContext = {
      pathId: data.pathId,
      userId: data.userId,
      fromStageNumber: rangeMilestones[0].stageNumber,
      stageCount: rangeMilestones.length,
      data,
      learnerReplanProjection: {
        ...learnerReplanProjection,
        summary: {
          currentMilestoneTitle,
          stableConcepts,
          fragileConcepts,
          strugglingConcepts,
          prerequisiteGaps,
          freezeCompletedTaskIds: completedTaskIds,
          downstreamRange: true,
        },
      },
      runId: rangeRun.id,
    };
    runBackgroundTask(
      'learning.path.downstream-replan',
      () => executeDownstreamReplan(rangeContext as any),
      { pathId: data.pathId, runId: rangeRun.id, userId: data.userId }
    );

    dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'path-replanned');

    return {
      enabled: true,
      status: 'accepted',
      policy: {
        immutableLearned: true,
        freezeCompletedTaskIds: completedTaskIds,
        defaultMode: 'overwrite',
        downstream: {
          fromStageNumber: rangeMilestones[0].stageNumber,
          stageCount: rangeMilestones.length,
        }
      },
      request: {
        pathId: data.pathId,
        userId: data.userId,
        triggerSource,
        mode,
        requestedMode,
        stageNumber: rangeMilestones[0].stageNumber,
        fromStageNumber: rangeMilestones[0].stageNumber,
        reason: data.reason || '',
        evidence: {
          ...(data.evidence || {}),
          learnerReplanProjection,
          replanSignal,
          downstreamRange: {
            fromStageNumber: rangeMilestones[0].stageNumber,
            stageCount: rangeMilestones.length,
          },
        }
      },
      result: {
        pathId: data.pathId,
        runId: rangeRun.id,
        fromStageNumber: rangeMilestones[0].stageNumber,
        stageCount: rangeMilestones.length,
        mode,
        requestedMode,
      }
    };
  }

  // ---- 单阶段重排（当前活动阶段，原行为）----
  const run = await createAndClaimGenerationRun(
    data.pathId,
    'stageDesign',
    'stageDesign',
    1,
    'replan-stage',
    path.activeGenerationRunId,
    {
      milestoneId: targetMilestone.id,
      ...(Array.isArray((data.evidence as any)?.clearedSessionIds) && (data.evidence as any).clearedSessionIds.length
        ? { ignoreCompletedSessionIds: (data.evidence as any).clearedSessionIds as string[] }
        : {})
    }
  );
  const stopHeartbeat = startGenerationHeartbeat(data.pathId, run.id);
  let redesignResult;
  try {
    await updatePathGenerationStatus(data.pathId, {
      stageDesign: 'processing',
      lastError: null,
      triggerSource,
      updatedAt: new Date().toISOString()
    }, run.id);
    redesignResult = await redesignMilestoneTasks(path, targetMilestone, data, {
      ...learnerReplanProjection,
      summary: {
        currentMilestoneTitle,
        stableConcepts,
        fragileConcepts,
        strugglingConcepts,
        prerequisiteGaps,
        freezeCompletedTaskIds: completedTaskIds,
      }
    }, run.id, replanSnapshot);
  } catch (error) {
    if (isPathMutationConflictError(error)) {
      await restorePathAfterMutationConflict(data.pathId, run.id, error);
      throw error;
    }

    try {
      await updatePathGenerationStatus(data.pathId, {
        stageDesign: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
        triggerSource,
        updatedAt: new Date().toISOString()
      }, run.id);
      await failGenerationRun(
        data.pathId,
        run.id,
        error,
        error instanceof Error && error.message.includes('EMPTY_TASKS')
          ? 'PATH_STAGE_DESIGN_ZERO_TASKS'
          : 'PATH_ENRICHMENT_FAILED',
        'stageDesign'
      );
    } catch (fenceError) {
      if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
    }
    throw error;
  } finally {
    stopHeartbeat();
  }

  dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'path-replanned');

  return {
    enabled: true,
    status: 'redesigned-stage',
    policy: {
      immutableLearned: true,
      freezeCompletedTaskIds: completedTaskIds,
      defaultMode: 'overwrite'
    },
    request: {
      pathId: data.pathId,
      userId: data.userId,
      triggerSource,
      mode,
      requestedMode,
      stageNumber: targetMilestone.stageNumber,
      reason: data.reason || '',
      evidence: {
        ...(data.evidence || {}),
        learnerReplanProjection,
        replanSignal,
      }
    },
    result: {
      pathId: data.pathId,
      runId: run.id,
      redesignedStageNumber: redesignResult.redesignedStageNumber,
      redesignedTaskCount: redesignResult.redesignedTaskCount,
      preservedCompletedTaskCount: redesignResult.preservedCompletedTaskCount,
      mode,
      requestedMode,
    }
  };
}
