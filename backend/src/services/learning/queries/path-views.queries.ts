/**
 * 路径/任务读取视图查询（架构审计 §5 行动 #2：learning.service.ts 按领域拆分——查询域）
 *
 * 职责：路径详情（getLearningPath）、生成生命周期轮询视图、用户路径列表、任务详情、
 * 学习统计等只读组装，以及配套的 processDetail / stageTraces / 学习准入状态 /
 * 场景摘要 / 实际投入分钟等视图组装件。行为与拆分前 learning.service 同名方法逐一等价。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import stateTrackingService from '../learning-state.service';
import {
  buildGenerationRunStatus,
  getSafeGenerationErrorMessage,
  isGenerationRunStale,
  resolveGenerationRetry,
  type PersistedPathGenerationRun,
} from '../path-generation-status';
import { getActiveGenerationRun } from '../generation/run-lifecycle';
import {
  buildSceneSummaryFromFraming,
  getSceneFramingNormalizedInput,
  isSuspiciousCognitiveDomain,
  isSuspiciousCoreConceptName,
  normalizeConceptText,
  normalizePathHoursFromTasks,
  normalizeSessionDurationMinutes,
  normalizeStageTracePhase,
  normalizeStageTraceStatus,
  normalizeStringArray,
  parseJsonSafe,
  parsePathAdjustmentEvidence,
  parsePathAdjustmentPolicy,
  parsePathCognitiveDesign,
  parsePathGenerationStatus,
  parsePathMilestoneConceptBindings,
  parsePathPromptTemplate,
  parsePathSummary,
  parseTaskLearningObjectives,
  resolveMilestoneConcept,
  resolveNormalizedInputSnapshot,
  resolvePersistedNormalizedInput,
  resolveTaskConcept,
} from '../learning.helpers';
import { extractPromptMaterials, PATH_MATERIAL_LIMITS } from '../../materials/material-prompt-projection';
import type { PathSceneFraming, PathStageTraceItem } from '../learning.types';

export function buildPathProcessDetail(path: any) {
  const parsedTemplate = parsePathPromptTemplate(path.aiPromptTemplate || null);
  const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate || null);
  const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
    ? parsedTemplate.sceneFraming
    : null;
  const sceneFramingRaw = typeof parsedTemplate?.sceneFramingRaw === 'string'
    ? parsedTemplate.sceneFramingRaw
    : null;
  const sceneFramingInput = parsedTemplate?.sceneFramingInput && typeof parsedTemplate.sceneFramingInput === 'object'
    ? parsedTemplate.sceneFramingInput
    : null;
  const pathAgentInput = parsedTemplate?.pathAgentInput && typeof parsedTemplate.pathAgentInput === 'object'
    ? parsedTemplate.pathAgentInput
    : null;
  const pathAgentRaw = typeof parsedTemplate?.pathAgentRaw === 'string'
    ? parsedTemplate.pathAgentRaw
    : null;
  const stageDesigns = parsedTemplate?.stageDesigns && typeof parsedTemplate.stageDesigns === 'object'
    ? parsedTemplate.stageDesigns
    : null;
  const normalizedInput = resolveNormalizedInputSnapshot(parsedTemplate);
  const goalFinalPayload = parsedTemplate?.goalFinalPayload && typeof parsedTemplate.goalFinalPayload === 'object'
    ? parsedTemplate.goalFinalPayload
    : null;
  const sceneFramingNormalizedInput = getSceneFramingNormalizedInput(sceneFraming) || resolvePersistedNormalizedInput(parsedTemplate);
  const cognitiveDesign = parsePathCognitiveDesign(path.aiPromptTemplate || null);
  const milestoneConceptBindings = parsePathMilestoneConceptBindings(path.aiPromptTemplate || null);
  const milestoneConceptBindingMap = new Map<number, { coreConcept: string | null; title?: string | null }>();
  milestoneConceptBindings.forEach((item) => {
    milestoneConceptBindingMap.set(item.stageNumber, {
      coreConcept: item.coreConcept,
      title: item.title,
    });
  });
  const milestoneConcepts = (path.milestones || []).map((milestone: any, index: number) => {
    const stageNumber = Number.isFinite(Number(milestone?.stageNumber)) ? Number(milestone.stageNumber) : index + 1;
    const binding = milestoneConceptBindingMap.get(stageNumber);
    const resolvedMilestoneConcept = resolveMilestoneConcept(
      milestone?.coreConceptId || binding?.coreConcept || null,
      cognitiveDesign,
      milestone?.coreConceptName || binding?.coreConcept || null,
    );
    return {
      milestoneId: milestone.id,
      stageNumber,
      title: milestone.title || milestone.goal || binding?.title || null,
      ...resolvedMilestoneConcept,
    };
  });
  const taskProfiles = (path.milestones || []).flatMap((milestone: any) =>
    (milestone.subtasks || []).map((task: any) => ({
      ...resolveTaskConcept(task.linkedConceptId || task.coreConcept, cognitiveDesign, task.linkedConceptName || task.coreConcept),
      taskId: task.id,
      milestoneId: milestone.id,
      milestoneTitle: milestone.title || milestone.goal || null,
      title: task.title,
      status: task.status,
      knowledgeType: task.knowledgeType || null,
      cognitiveLevel: task.cognitiveLevel || null,
      displayLabel: task.displayLabel || null,
      learningObjectives: parseTaskLearningObjectives(task.learningObjectives),
      coreConcept: normalizeConceptText(task.linkedConceptName || task.coreConcept),
      transferable: task.transferable ?? false,
      annotationConfidence: task.annotationConfidence ?? null,
    }))
  );
  const cognitiveDiagnostics = {
    suspiciousDomain: isSuspiciousCognitiveDomain(cognitiveDesign?.cognitiveDomain),
    suspiciousConcepts: Array.isArray(cognitiveDesign?.coreConcepts)
      ? cognitiveDesign.coreConcepts
          .filter((concept: any) => isSuspiciousCoreConceptName(concept?.name))
          .map((concept: any) => ({ id: concept.id, name: concept.name }))
      : [],
  };

  return {
    source: typeof normalizedInput?.source === 'string'
      ? normalizedInput.source
      : (typeof parsedTemplate?.source === 'string' ? parsedTemplate.source : null),
    mode: typeof normalizedInput?.mode === 'string'
      ? normalizedInput.mode
      : (typeof parsedTemplate?.mode === 'string' ? parsedTemplate.mode : null),
    sourceConversationId: goalFinalPayload?.sourceConversationId || normalizedInput?.sourceConversationId || generationStatus?.sourceConversationId || null,
    goalFinalPayload: {
      provenance: {
        source: goalFinalPayload ? 'persisted-goal-final-payload' : 'missing',
        isBackfilled: false,
        summary: goalFinalPayload
          ? '这份数据是 Goal 阶段最终产出并正式保存的 Path 入口 payload。'
          : '当前路径没有保存 Goal Final Payload。'
      },
      display: {
        description: goalFinalPayload?.rawGoal || null,
        subject: normalizedInput?.subject || null,
        deadlineText: normalizedInput?.deadlineText || null,
        sourceGoal: null,
        skillLevel: normalizedInput?.skillLevel || null,
        timePerDay: normalizedInput?.timePerDay || null,
      },
      rawGoal: goalFinalPayload?.rawGoal || null,
      finalUserVisible: goalFinalPayload?.finalUserVisible || null,
      visibleSummary: goalFinalPayload?.visibleSummary || null,
      conversationHistory: Array.isArray(goalFinalPayload?.conversationHistory)
        ? goalFinalPayload.conversationHistory
        : [],
    },
    normalizedInput: {
      provenance: {
        source: normalizedInput
          ? 'persisted-normalized-input'
          : 'missing',
        isBackfilled: false,
        summary: normalizedInput
          ? '这份数据是 orchestrator 归一化后正式保存的 Path 内部输入。'
          : '当前路径没有保存可用的 normalized input。'
      },
      description: normalizedInput?.description || null,
      subject: normalizedInput?.subject || null,
      deadlineText: normalizedInput?.deadlineText || null,
      sourceConversationId: normalizedInput?.sourceConversationId || null,
      existingPathId: normalizedInput?.existingPathId || null,
      skillLevel: normalizedInput?.skillLevel || null,
      timePerDay: normalizedInput?.timePerDay || null,
      confirmedProposal: normalizedInput?.confirmedProposal || null,
      conversationHistory: Array.isArray(normalizedInput?.conversationHistory)
        ? normalizedInput.conversationHistory
        : [],
      normalizedInput: normalizedInput?.normalizedInput || sceneFramingNormalizedInput || null,
    },
    framing: sceneFraming ? {
      normalizedInput: sceneFramingNormalizedInput || null,
      legacyFrame: {
        version: sceneFraming.version || null,
        intent: sceneFraming.intent || null,
        targetState: sceneFraming.targetState || null,
        firstDeliverable: sceneFraming.firstDeliverable || null,
        cognitiveDomain: sceneFraming.cognitiveDomain || null,
        planningFocus: normalizeStringArray(sceneFraming.planningFocus),
        excludedScope: normalizeStringArray(sceneFraming.excludedScope),
        resourceProfile: {
          timeBudget: sceneFraming.resourceProfile?.timeBudget || null,
          timeHorizon: sceneFraming.resourceProfile?.timeHorizon || null,
          pace: sceneFraming.resourceProfile?.pace || null,
        },
        sourceGoal: sceneFraming.sourceGoal && typeof sceneFraming.sourceGoal === 'object'
          ? sceneFraming.sourceGoal
          : null,
      }
    } : null,
    cognitiveDesign,
    cognitiveDiagnostics,
    adjustmentPolicy: parsePathAdjustmentPolicy(path.aiPromptTemplate || null),
    adjustmentEvidence: parsePathAdjustmentEvidence(path.aiPromptTemplate || null),
    generationTimeline: generationStatus ? {
      core: generationStatus.core || null,
      coreStep: generationStatus.coreStep || null,
      stageDesign: generationStatus.stageDesign || null,
      lastError: generationStatus.lastError || null,
      triggerSource: generationStatus.triggerSource || null,
      updatedAt: generationStatus.updatedAt || null,
      stageDesignRetryCount: generationStatus.stageDesignRetryCount || 0,
      lastStageDesignRetryAt: generationStatus.lastStageDesignRetryAt || null,
    } : null,
    milestoneConcepts,
    taskProfiles,
    stageDesigns,
      raw: {
        goalFinalPayload,
        normalizedInput,
        normalizedInputStructured: sceneFramingNormalizedInput || null,
        sceneFramingInput,
        sceneFramingRaw,
        pathAgentInput,
        pathAgentRaw,
        sceneFraming,
        stageDesigns,
        promptTemplate: parsedTemplate,
        generationStatus,
      },
  };
}

export async function getPathStageTraces(pathId: string, sourceConversationId?: string | null): Promise<PathStageTraceItem[]> {
  const logs = await prisma.agent_call_logs.findMany({
    where: {
      agentId: 'path-agent',
      sourceEntry: 'platform',
      OR: [
        { metadata: { contains: pathId } },
        ...(sourceConversationId ? [{ metadata: { contains: sourceConversationId } }] : []),
      ],
    },
    orderBy: { calledAt: 'asc' },
    take: 20,
  });

  return logs
    .map((log) => {
      const metadata = parseJsonSafe(log.metadata);
      const input = parseJsonSafe(log.input);
      const output = parseJsonSafe(log.output);
      const phase = normalizeStageTracePhase(metadata?.phase || input?.phase);
      const status = normalizeStageTraceStatus(metadata?.status || input?.status);
      const tracePathId = metadata?.pathId || input?.pathId || null;
      const traceSourceConversationId = metadata?.sourceConversationId || input?.sourceConversationId || null;

      if (tracePathId !== pathId && (!sourceConversationId || traceSourceConversationId !== sourceConversationId)) {
        return null;
      }

      return {
        id: log.id,
        phase,
        status,
        success: !!log.success,
        pathId: tracePathId,
        sourceConversationId: traceSourceConversationId,
        triggerSource: metadata?.triggerSource || input?.triggerSource || null,
        durationMs: log.durationMs || 0,
        error: log.error || null,
        errorCode: log.errorCode || null,
        input,
        output,
        calledAt: log.calledAt.toISOString(),
      } as PathStageTraceItem;
    })
    .filter(Boolean) as PathStageTraceItem[];
}

/** 学习准入状态：融合 path 状态、legacy 生成状态与 run 状态，产出可否开课与阻塞原因 */
export function getPathLearningAccessState(
  pathStatus: string | null | undefined,
  aiPromptTemplate: string | null,
  activeRun?: PersistedPathGenerationRun | null,
  aiGenerated = false,
  taskCount = 0
) {
  const legacyGenerationStatus = parsePathGenerationStatus(aiPromptTemplate);
  const persistedRunStatus = buildGenerationRunStatus(activeRun);
  const generationStatus = legacyGenerationStatus || persistedRunStatus
    ? {
        ...(legacyGenerationStatus || {}),
        ...(persistedRunStatus || {})
      }
    : null;
  const enrichmentStatus = generationStatus?.stageDesign;
  // 渐进式（批次 D）：_generation.progressive 标记的路径按「已设计部分可学」判定——
  // 后续 stage 的追加设计（processing）不 block 已就绪 stage；首 stage 仍在设计时照常阻塞。
  const progressive = (() => {
    try {
      const template = aiPromptTemplate ? JSON.parse(aiPromptTemplate) : null;
      const generation = template?._generation;
      return generation?.progressive === true;
    } catch {
      return false;
    }
  })();
  const hasDesignedStage = progressive && (() => {
    try {
      const template = aiPromptTemplate ? JSON.parse(aiPromptTemplate) : null;
      const designs = template?.stageDesigns;
      return !!designs && typeof designs === 'object' && Object.keys(designs).length > 0;
    } catch {
      return false;
    }
  })();

  if (pathStatus !== 'active') {
    if (pathStatus === 'generating') {
      return {
        generationStatus,
        canStartLearning: false,
        learningBlockedReason: '学习路径仍在生成中，请稍候再开始学习。'
      };
    }

    if (pathStatus === 'failed') {
      return {
        generationStatus,
        canStartLearning: false,
        learningBlockedReason: '学习路径生成失败，请先重新生成路径。'
      };
    }
  }

  if (!generationStatus || !enrichmentStatus) {
    const missingGeneratedState = pathStatus === 'active' && aiGenerated && taskCount === 0;
    return {
      generationStatus,
      canStartLearning: pathStatus === 'active' && !missingGeneratedState,
      learningBlockedReason: pathStatus === 'active' && !missingGeneratedState
        ? null
        : missingGeneratedState
          ? '学习路径生成状态缺失，暂不能开始学习，请重试生成。'
        : '学习路径当前不可开始，请稍后再试。'
    };
  }

  if (enrichmentStatus === 'succeeded') {
    return {
      generationStatus,
      canStartLearning: true,
      learningBlockedReason: null
    };
  }

  // 渐进式：已有任一阶段设计完成 → 已就绪部分可学（后续 stage 的追加设计不阻塞全局）
  if (progressive && hasDesignedStage && (enrichmentStatus === 'processing' || enrichmentStatus === 'pending')) {
    return {
      generationStatus,
      canStartLearning: true,
      learningBlockedReason: null
    };
  }

  if (enrichmentStatus === 'failed') {
    return {
      generationStatus,
      canStartLearning: false,
      learningBlockedReason: '阶段任务生成遇到问题，系统会继续尝试，请稍后再开始学习。'
    };
  }

  return {
    generationStatus,
    canStartLearning: false,
    learningBlockedReason: '阶段任务还在生成中，请稍后再开始学习。'
  };
}

export function getPathSceneSummary(raw: string | null, fallbackMilestones?: any[]): Record<string, any> | null {
  const generationScene = parsePathGenerationStatus(raw)?.scene;
  if (generationScene && typeof generationScene === 'object') {
    return generationScene;
  }

  const parsed = parsePathPromptTemplate(raw);
  const sceneFraming = parsed?.sceneFraming && typeof parsed.sceneFraming === 'object'
    ? parsed.sceneFraming as PathSceneFraming
    : null;
  const milestoneCount = Array.isArray(fallbackMilestones) ? fallbackMilestones.length : undefined;
  const taskCount = Array.isArray(fallbackMilestones)
    ? fallbackMilestones.reduce((sum: number, milestone: any) => sum + ((milestone?.subtasks || []).length), 0)
    : undefined;

  return buildSceneSummaryFromFraming(sceneFraming, milestoneCount, taskCount);
}

/** 把完成课堂的真实分钟（终态取 duration，进行中按活跃估算）挂到任务视图上 */
async function attachActualMinutesToPath(path: any): Promise<any> {
  const milestones = path?.milestones || [];
  const cognitiveDesign = parsePathCognitiveDesign(path?.aiPromptTemplate || null);
  const milestoneConceptBindings = parsePathMilestoneConceptBindings(path?.aiPromptTemplate || null);
  const milestoneConceptBindingMap = new Map<number, { coreConcept: string | null; title?: string | null }>();
  milestoneConceptBindings.forEach((item) => {
    milestoneConceptBindingMap.set(item.stageNumber, {
      coreConcept: item.coreConcept,
      title: item.title,
    });
  });
  const allSubtasks = milestones.flatMap((milestone: any) => milestone.subtasks || []);
  const taskIds = allSubtasks.map((task: any) => task.id).filter(Boolean);

  if (taskIds.length === 0) {
    return path;
  }

  const sessions = await prisma.teaching_sessions.findMany({
    where: {
      userId: path.userId,
      taskId: { in: taskIds },
      status: 'completed',
      wrapup: { not: null },
    },
    select: {
      taskId: true,
      duration: true,
      startTime: true,
      endTime: true,
      wrapup: true,
    },
  });

  const actualMinutesMap = new Map<string, number>();
  const latestSessionAtMap = new Map<string, string>();
  const latestWrapupStatusMap = new Map<string, string | null>();
  sessions.forEach((session) => {
    if (!session.taskId) return;

    const minutes = normalizeSessionDurationMinutes(session);
    if (minutes <= 0) return;

    actualMinutesMap.set(session.taskId, (actualMinutesMap.get(session.taskId) || 0) + minutes);

    const sessionAt = (session.endTime || session.startTime)?.toISOString?.() || null;
    const previousAt = latestSessionAtMap.get(session.taskId);
    if (sessionAt && (!previousAt || new Date(sessionAt).getTime() > new Date(previousAt).getTime())) {
      latestSessionAtMap.set(session.taskId, sessionAt);
      try {
        const wrapup = session.wrapup ? JSON.parse(session.wrapup) : null;
        latestWrapupStatusMap.set(session.taskId, wrapup?.status || null);
      } catch {
        latestWrapupStatusMap.set(session.taskId, null);
      }
    }
  });

  return {
    ...path,
    milestones: milestones.map((milestone: any, index: number) => {
      const stageNumber = Number.isFinite(Number(milestone?.stageNumber)) ? Number(milestone.stageNumber) : index + 1;
      const milestoneConcept = resolveMilestoneConcept(
        milestone?.coreConceptId || milestoneConceptBindingMap.get(stageNumber)?.coreConcept || null,
        cognitiveDesign,
        milestone?.coreConceptName || milestoneConceptBindingMap.get(stageNumber)?.coreConcept || null,
      );

      return {
        ...milestone,
        coreConceptId: milestoneConcept.coreConceptId,
        coreConceptName: milestoneConcept.coreConceptName,
        coreConceptDescription: milestoneConcept.coreConceptDescription,
        coreConceptSource: milestoneConcept.conceptSource,
        subtasks: (milestone.subtasks || []).map((task: any) => ({
          ...task,
          actualMinutes: actualMinutesMap.get(task.id) ?? null,
          hasTeachingWrapup: latestSessionAtMap.has(task.id),
          latestTeachingSessionAt: latestSessionAtMap.get(task.id) ?? null,
          latestWrapupStatus: latestWrapupStatusMap.get(task.id) ?? null,
        })),
      };
    }),
  };
}

export async function getLearningPath(pathId: string) {
  try {
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      include: {
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: {
            subtasks: {
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    });

    if (!path) {
      throw new Error('学习路径不存在');
    }

    const pathWithActualMinutes = await attachActualMinutesToPath(path);
    // 资料：从路径模板取回（sceneFraming 优先，回退持久化快照）——供学习者侧展示
    const pathTemplate = parsePathPromptTemplate(path.aiPromptTemplate || null);
    const pathMaterialsNormalizedInput = getSceneFramingNormalizedInput(pathTemplate?.sceneFraming)
      || resolvePersistedNormalizedInput(pathTemplate);
    // 资料引用（materialRefs）：byStage 键=阶段号、byTask 键=subtaskId（生成期已逐字核对）
    const materialRefsRaw = pathTemplate?.materialRefs && typeof pathTemplate.materialRefs === 'object'
      ? pathTemplate.materialRefs as Record<string, any>
      : null;
    const materialRefsByStage: Record<string, any[]> = materialRefsRaw?.byStage || {};
    const materialRefsByTask: Record<string, any[]> = materialRefsRaw?.byTask || {};
    const attachMaterialRefs = (milestones: any[]) => (Array.isArray(milestones) ? milestones : []).map((milestone: any) => ({
      ...milestone,
      materialRefs: materialRefsByStage[String(milestone?.stageNumber ?? milestone?.stage ?? '')] || undefined,
      subtasks: Array.isArray(milestone?.subtasks)
        ? milestone.subtasks.map((task: any) => ({ ...task, materialRefs: materialRefsByTask[String(task?.id)] || undefined }))
        : milestone?.subtasks,
    }));
    const activeRun = await getActiveGenerationRun(path.id, path.activeGenerationRunId);
    const taskCount = pathWithActualMinutes.milestones.reduce(
      (sum: number, milestone: any) => sum + ((milestone.subtasks || []).length),
      0
    );
    const accessState = getPathLearningAccessState(
      path.status,
      path.aiPromptTemplate,
      activeRun,
      path.aiGenerated,
      taskCount
    );
    const processDetail = buildPathProcessDetail(pathWithActualMinutes);
    const stageTraces = await getPathStageTraces(path.id, processDetail.sourceConversationId || null);

    // 「预计投入」以任务分钟汇总为准（LLM 骨架期粗估仅作内部参考，见 normalizePathHoursFromTasks 说明）
    const normalized = normalizePathHoursFromTasks(pathWithActualMinutes);

    return {
      ...pathWithActualMinutes,
      estimatedHours: normalized.estimatedHours,
      estimatedHoursRaw: normalized.estimatedHoursRaw,
      summary: parsePathSummary(path.aiPromptTemplate),
      generationStatus: accessState.generationStatus,
      generationRun: buildGenerationRunStatus(activeRun),
      sceneSummary: getPathSceneSummary(path.aiPromptTemplate, normalized.milestones),
      cognitiveDesign: parsePathCognitiveDesign(path.aiPromptTemplate),
      adjustmentPolicy: parsePathAdjustmentPolicy(path.aiPromptTemplate),
      adjustmentEvidence: parsePathAdjustmentEvidence(path.aiPromptTemplate),
      processDetail: {
        ...processDetail,
        stageTraces,
      },
      canStartLearning: accessState.canStartLearning,
      learningBlockedReason: accessState.learningBlockedReason,
      replanLineage: {
        sourcePathId: path.sourcePathId || null,
        replanMode: path.replanMode || null,
        triggerSource: path.replanTriggerSource || null,
        reason: path.replanReason || null,
      },
      // 学习者可见的资料（顶层字段，绕开 stripPathGenerationInternals 对 processDetail/aiPromptTemplate 的剥离）：
      // 前端据此渲染"这条路径长在你上传的资料上"，也让学习者能回看自己上传了什么。
      materials: extractPromptMaterials(pathMaterialsNormalizedInput, PATH_MATERIAL_LIMITS),
      milestones: attachMaterialRefs(normalized.milestones),
      stages: attachMaterialRefs(normalized.milestones),
      totalStages: path.totalMilestones
    };
  } catch (error) {
    logger.error('获取学习路径详情失败:', error);
    throw error;
  }
}

export async function getPathGenerationLifecycle(pathId: string, userId: string) {
  const path = await prisma.learning_paths.findUnique({
    where: { id: pathId },
    select: {
      id: true,
      userId: true,
      status: true,
      aiGenerated: true,
      aiPromptTemplate: true,
      activeGenerationRunId: true,
      totalMilestones: true,
      updatedAt: true,
      activeGenerationRun: true,
      milestones: {
        select: {
          stageNumber: true,
          subtasks: { select: { id: true } }
        },
        orderBy: { stageNumber: 'asc' }
      }
    }
  });

  if (!path) throw new Error('学习路径不存在');
  if (path.userId !== userId) throw new Error('无权访问此学习路径');

  const run = path.activeGenerationRun;
  const legacy = parsePathGenerationStatus(path.aiPromptTemplate);
  // 渐进式（批次 D）探针：_generation.progressive 标记 + 已设计阶段数（供 run 分支与返回值共用）
  const progressive = (() => {
    try {
      const template = path.aiPromptTemplate ? JSON.parse(path.aiPromptTemplate) : null;
      return template?._generation?.progressive === true;
    } catch {
      return false;
    }
  })();
  const designedStages = path.milestones.filter((milestone) => milestone.subtasks.length > 0).length;
  const totalPathStages = Math.max(path.totalMilestones || 0, path.milestones.length, 0);
  // 活动 stageDesign run 的工作量以 run.totalItems 为准（整路径生成 = 全部阶段；
  // 后续阶段重排 = 被重排的子集，仅展示该部分进度）；
  // 无活动 run（core 完成等待/历史状态）时退回路径阶段数。
  const runTotal = (run?.phase === 'stageDesign' || !run) ? (run?.totalItems || 0) : 0;
  const totalStages = runTotal > 0
    ? runTotal
    : Math.max(path.totalMilestones || 0, path.milestones.length, 0);
  const taskCount = path.milestones.reduce((sum, milestone) => sum + milestone.subtasks.length, 0);
  const accessState = getPathLearningAccessState(
    path.status,
    path.aiPromptTemplate,
    run,
    path.aiGenerated,
    taskCount
  );
  const stale = isGenerationRunStale(run);
  const retry = resolveGenerationRetry(path.status, legacy, run, path.updatedAt);

  let phase: 'core' | 'stage_design' | 'ready' = 'ready';
  let status: 'queued' | 'processing' | 'stale' | 'failed' | 'ready' = 'ready';

  if (run && run.status !== 'cancelled') {
    // 渐进式（批次 D）：stage N+1 的追加设计 run 活跃时**不回到生成态**——
    // 已就绪阶段的可学性不受影响（accessState 渐进判定已放行）；进度见 designedStages。
    const progressiveAppendDesign = progressive
      && run.phase === 'stageDesign'
      && (run.status === 'queued' || run.status === 'processing');
    if (run.status === 'succeeded' && run.phase === 'stageDesign') {
      phase = 'ready';
      status = 'ready';
    } else if (progressiveAppendDesign && accessState.canStartLearning) {
      phase = 'ready';
      status = 'ready';
    } else {
      phase = run.phase === 'stageDesign' ? 'stage_design' : 'core';
    }
    if (stale) status = 'stale';
    else if (run.status === 'failed') status = 'failed';
    else if (run.status === 'queued') status = 'queued';
    else if (run.status === 'processing') status = 'processing';
    else if (run.status === 'succeeded' && run.phase === 'core') {
      phase = 'stage_design';
      status = 'queued';
    }
  } else if (path.status === 'generating' || path.status === 'failed' || legacy?.core === 'failed') {
    phase = 'core';
    status = path.status === 'failed' || legacy?.core === 'failed' ? 'failed' : 'processing';
  } else if (legacy?.stageDesign === 'failed') {
    phase = 'stage_design';
    status = 'failed';
  } else if (legacy?.stageDesign === 'pending' || legacy?.stageDesign === 'processing') {
    phase = 'stage_design';
    status = 'processing';
  } else if (!accessState.canStartLearning) {
    phase = 'stage_design';
    status = 'stale';
  }

  const lifecycle = phase === 'ready'
    ? 'ready'
    : `${phase}_${status}`;
  const completedStages = phase === 'ready'
    ? totalStages
    : phase === 'stage_design'
      ? Math.min(run?.completedItems || 0, totalStages)
      : 0;
  const currentStageNumber = phase === 'stage_design' && status !== 'ready' && completedStages < totalStages
    ? path.milestones[completedStages]?.stageNumber || completedStages + 1
    : null;

  // 渐进式（批次 D）：进度口径=「已设计阶段 / 总阶段」——设计按学习节奏逐段发生，
  // 与 eager 的「本 run 全量进度」不同；前端据此显示「第 N/M 阶段已就绪，后续随学习生成」。
  // （progressive/designedStages/totalPathStages 已在函数前部解析）

  return {
    lifecycle,
    phase,
    status,
    runId: run?.id || null,
    heartbeatAt: run?.heartbeatAt?.toISOString?.() || legacy?.updatedAt || null,
    retryAllowed: retry.allowed,
    retryType: retry.retryType === 'stageDesign' ? 'stage_design' : retry.retryType,
    completedStages,
    totalStages,
    currentStageNumber,
    ...(progressive ? { progressive: true, designedStages, totalPathStages } : {}),
    errorMessage: getSafeGenerationErrorMessage(
      run?.phase || (phase === 'stage_design' ? 'stageDesign' : phase),
      status,
      run?.errorCode
    ),
    canStartLearning: phase === 'ready' && accessState.canStartLearning
  };
}

export async function getUserLearningPaths(userId: string) {
  try {
    const paths = await prisma.learning_paths.findMany({
      where: { userId },
      include: {
        activeGenerationRun: true,
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: {
            subtasks: {
              orderBy: { order: 'asc' }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return paths.map(path => {
      const allTasks = path.milestones.flatMap((m: any) => m.subtasks || []);
      const totalTaskCount = allTasks.length;
      const completedTaskCount = allTasks.filter((t: any) => t.status === 'completed').length;
      const accessState = getPathLearningAccessState(
        path.status,
        path.aiPromptTemplate,
        path.activeGenerationRun,
        path.aiGenerated,
        totalTaskCount
      );

      // 「预计投入」以任务分钟汇总为准（与详情页口径一致）
      const normalized = normalizePathHoursFromTasks(path);

      return {
        ...path,
        name: path.title,
        estimatedHours: normalized.estimatedHours,
        estimatedHoursRaw: normalized.estimatedHoursRaw,
        summary: parsePathSummary(path.aiPromptTemplate),
        generationStatus: accessState.generationStatus,
        generationRun: buildGenerationRunStatus(path.activeGenerationRun),
        sceneSummary: getPathSceneSummary(path.aiPromptTemplate, normalized.milestones),
        cognitiveDesign: parsePathCognitiveDesign(path.aiPromptTemplate),
        adjustmentPolicy: parsePathAdjustmentPolicy(path.aiPromptTemplate),
        adjustmentEvidence: parsePathAdjustmentEvidence(path.aiPromptTemplate),
        canStartLearning: accessState.canStartLearning,
        learningBlockedReason: accessState.learningBlockedReason,
        replanLineage: {
          sourcePathId: path.sourcePathId || null,
          replanMode: path.replanMode || null,
          triggerSource: path.replanTriggerSource || null,
          reason: path.replanReason || null,
        },
        totalStages: path.totalMilestones,
        taskSummary: {
          total: totalTaskCount,
          completed: completedTaskCount,
          progress: totalTaskCount > 0 ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0
        }
      };
    });
  } catch (error) {
    logger.error('获取用户学习路径失败:', error);
    throw error;
  }
}

export async function getTaskDetail(taskId: string, userId?: string) {
  try {
    const subtask = await prisma.subtasks.findUnique({
      where: { id: taskId },
      include: {
        milestones: {
          include: {
            learning_paths: true,
            subtasks: {
              select: {
                id: true,
                title: true,
                status: true,
                order: true,
              },
              orderBy: { order: 'asc' }
            }
          }
        }
      }
    });

    if (!subtask) {
      throw new Error('任务不存在');
    }

    const learningPath = subtask.milestones?.learning_paths || null;

    if (userId && learningPath?.userId !== userId) {
      throw new Error('无权访问此任务');
    }

    const accessState = learningPath
      ? getPathLearningAccessState(
          learningPath.status,
          learningPath.aiPromptTemplate,
          null,
          learningPath.aiGenerated,
          1
        )
      : {
          generationStatus: null,
          canStartLearning: true,
          learningBlockedReason: null
        };

    const latestTeachingSession = await prisma.teaching_sessions.findFirst({
      where: {
        taskId,
        ...(userId ? { userId } : {}),
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { startTime: 'desc' },
      select: {
        startTime: true,
        wrapup: true,
      }
    });

    let latestWrapupStatus: string | null = null;
    if (latestTeachingSession?.wrapup) {
      try {
        latestWrapupStatus = JSON.parse(latestTeachingSession.wrapup)?.status || null;
      } catch {
        latestWrapupStatus = null;
      }
    }

    return {
      ...subtask,
      hasTeachingWrapup: !!latestTeachingSession,
      latestTeachingSessionAt: latestTeachingSession?.startTime?.toISOString?.() || null,
      latestWrapupStatus,
      week: subtask.milestones,
      milestone: subtask.milestones,
      learningPath: learningPath
        ? {
            ...learningPath,
            generationStatus: accessState.generationStatus,
            canStartLearning: accessState.canStartLearning,
            learningBlockedReason: accessState.learningBlockedReason
          }
        : learningPath,
    };
  } catch (error) {
    logger.error('获取任务详情失败:', error);
    throw error;
  }
}

/** 获取任务详情（别名，用于路由） */
export async function getTaskById(taskId: string, userId?: string) {
  return getTaskDetail(taskId, userId);
}

export async function getLearningStats(userId: string) {
  try {
    const user = await prisma.users.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    const subtasks = await prisma.subtasks.findMany({
      where: { userId }
    });

    const totalPaths = await prisma.learning_paths.count({
      where: {
        userId,
        status: {
          not: 'failed'
        }
      }
    });

    const completedSubtasks = subtasks.filter(t => t.status === 'completed');
    const inProgressSubtasks = subtasks.filter(t => t.status === 'in_progress');
    const todoSubtasks = subtasks.filter(t => t.status === 'todo');

    const totalEstimatedMinutes = subtasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
    // 与 /users/me/sessions、学习状态页统一口径：只排除被回收重开的 superseded（无真实进展），
    // discarded（用户「重新开始」的旧会话）计入真实学习时长
    const sessions = await prisma.teaching_sessions.findMany({
      where: { userId, status: { notIn: ['superseded'] } },
      select: {
        duration: true,
        startTime: true,
        endTime: true,
        // 未结束会话（active/paused）的时长需按活跃时长估算，见
        // normalizeSessionDurationMinutes（走查 P9）
        status: true,
        messages: true,
        teachingState: true,
        updatedAt: true,
      },
    });
    const totalMinutes = sessions.reduce((sum, session) => sum + normalizeSessionDurationMinutes(session), 0);
    const activeLearningDays = new Set(
      sessions.map((session) => session.startTime.toISOString().split('T')[0])
    ).size;
    const avgDailyMinutes = activeLearningDays > 0
      ? Number((totalMinutes / activeLearningDays).toFixed(1))
      : 0;

    // 获取学习状态指标
    const currentState = await stateTrackingService.getCurrentStateDisplay(userId);
    const suggestion = currentState ? stateTrackingService.generateDisplaySuggestion(currentState) : null;
    const displayState = currentState || null;

    return {
      user: {
        id: user.id,
        name: user.name,
        xp: user.xp,
        level: Math.floor(Math.sqrt(user.xp / 100)) + 1
      },
      subtasks: {
        total: subtasks.length,
        completed: completedSubtasks.length,
        inProgress: inProgressSubtasks.length,
        todo: todoSubtasks.length
      },
      tasks: {
        total: subtasks.length,
        completed: completedSubtasks.length,
        inProgress: inProgressSubtasks.length,
        todo: todoSubtasks.length,
        completionRate: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0
      },
      paths: {
        total: totalPaths
      },
      time: {
        totalMinutes,
        totalCompleted: totalMinutes,
        totalEstimated: totalEstimatedMinutes,
        activeLearningDays,
        avgDailyMinutes,
        progress: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0,
        completionRate: subtasks.length > 0 ? (completedSubtasks.length / subtasks.length * 100).toFixed(1) : '0'
      },
      state: displayState,
      suggestion
    };
  } catch (error) {
    logger.error('获取学习统计失败:', error);
    throw error;
  }
}
