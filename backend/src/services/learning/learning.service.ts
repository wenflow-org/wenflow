// 学习服务
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import stateTrackingService from './learning-state.service';
import achievementService from '../achievements/achievement.service';
import type { AgentInput } from '../../agents/protocol';
import { normalizeAgentOutput } from '../../agents/output-normalizer';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import { learnerStateReviewService } from '../learner/LearnerStateReviewService';
import { conceptConsolidatorService } from '../learner/ConceptConsolidatorService';
import { runBackgroundTask } from '../background-task-tracker.service';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { learnerProgressService } from '../learner/LearnerProgressService';
import { createDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import {
  PATH_GENERATION_LEASE_MS,
  PATH_GENERATION_LEASE_OWNER,
  assertGenerationRunFence,
  assertStageTasksPresent,
  buildGenerationRunStatus,
  calculateStageProgress,
  claimExpiredGenerationRun,
  createAndClaimPathGenerationRun,
  getSafeGenerationErrorMessage,
  isGenerationRunStale,
  isStageDesignStale,
  resolveGenerationRetry,
  type PathGenerationRollbackSnapshotV1,
  type PathGenerationPhase,
  type PathGenerationRetryType,
  type PersistedPathGenerationRun,
} from './path-generation-status';
import {
  assertPathMutationSafe,
  buildPathReplanSnapshot,
  claimPathReplanSnapshot,
  createPathVersioningUnsupportedError,
  isPathMutationConflictError,
  PathMutationConflictError,
  type PathMutationKind,
  type PathMutationScope,
  type PathReplanSnapshot,
} from './path-mutation-safety';

// Path 任务画像 Skills
import { executeSkill } from '../../skills';
import { buildFramedNormalizedInput } from './path-planning-hints';
import { assembleStageDesignerChannels } from '../field-dispatcher';
import { stageDesignerDefinition } from '../../skills/stage-designer';
import { pathAgentDefinition } from '../../skills/path-planning';
import { pathReviewerDefinition } from '../../skills/path-reviewer';
import { buildPathReviewerGoalContext } from './path-reviewer-context';
import { kcMapperDefinition } from '../../skills/kc-mapper';
import { sessionFinalizationService } from '../ai-teaching/SessionFinalizationService';

// 模块级类型 / 常量 / 纯工具函数已抽离到同目录下的 learning.types / learning.constants / learning.helpers
import {
  type CreateGoalData,
  type GeneratePathData,
  type PathReplanRequest,
  type PathGenerationLogPayload,
  type PathGenerationStatusPatch,
  type ParsedPathGenerationStatus,
  type PathSceneFramingNormalizedInput,
  type PathSceneFraming,
  type GoalToPathHandoffSnapshot,
  type PathCognitiveConcept,
  type PathCognitiveDesign,
  type NewPathTaskType,
  type PathAdjustmentPolicy,
  type PathAdjustmentEvidence,
  type NormalizedPathTask,
  type NormalizedPathMilestone,
  type PathNormalizedInputSnapshot,
  type PathStageTraceItem,
  type CompleteTaskData,
} from './learning.types';
import {
  STALE_GENERATING_PATH_MINUTES,
  ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES,
  TERMINAL_STAGE_DESIGN_RETRY_CODES,
  DISPLAY_LABEL_MAP,
} from './learning.constants';
import {
  normalizePathHoursFromTasks,
  parsePathSummary,
  cleanPathTitle,
  resolvePathSubject,
  normalizeSessionDurationMinutes,
  normalizeStringArray,
  normalizeConceptText,
  resolveTaskConcept,
  resolveMilestoneConcept,
  inferMilestoneConceptFromTasks,
  getSceneFramingNormalizedInput,
  resolvePersistedNormalizedInput,
  resolveNormalizedInputSnapshot,
  getSceneFramingFallbackDomain,
  parsePathCognitiveDesign,
  parsePathMilestoneConceptBindings,
  parsePathAdjustmentPolicy,
  parsePathAdjustmentEvidence,
  buildSceneSummaryFromFraming,
  slugifyConceptId,
  parsePathGenerationStatus,
  parseJsonSafe,
  isSuspiciousCognitiveDomain,
  isSuspiciousCoreConceptName,
  parseTaskLearningObjectives,
  normalizePathTaskType,
  buildNormalizedPathInputSnapshot,
  buildGoalToPathHandoffSnapshot,
  normalizeStageTraceStatus,
  normalizeStageTracePhase,
} from './learning.helpers';

export { normalizePathHoursFromTasks } from './learning.helpers';

class LearningService {
  private createGenerationId(prefix: 'pgr' | 'pgsi'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  private async createAndClaimGenerationRun(
    pathId: string,
    phase: PathGenerationPhase,
    retryType: PathGenerationRetryType | null = null,
    totalItems = 0,
    mutationKind?: PathMutationKind,
    expectedActiveGenerationRunId?: string | null,
    mutationScope: PathMutationScope = {}
  ): Promise<any> {
    const runId = this.createGenerationId('pgr');
    return createAndClaimPathGenerationRun(prisma, {
      runId,
      pathId,
      phase,
      retryType,
      totalItems,
      ...(expectedActiveGenerationRunId === undefined ? {} : { expectedActiveGenerationRunId }),
      guard: mutationKind
        ? (tx) => assertPathMutationSafe(tx, pathId, mutationKind, mutationScope)
        : undefined
    });
  }

  private async restorePathAfterMutationConflict(
    pathId: string,
    runId: string,
    error: unknown,
    options: {
      runStatus?: 'cancelled' | 'failed';
      retryAllowed?: boolean;
      errorCode?: string;
    } = {}
  ): Promise<void> {
    const now = new Date();
    const errorCode = options.errorCode || (isPathMutationConflictError(error)
      ? error.code
      : 'PATH_MUTATION_CONFLICT');
    const runStatus = options.runStatus || 'cancelled';

    await prisma.$transaction(async (tx) => {
      const path = await tx.learning_paths.findUnique({
        where: { id: pathId },
        select: {
          activeGenerationRunId: true,
          aiPromptTemplate: true,
          status: true
        }
      });
      if (!path || path.activeGenerationRunId !== runId) return;

      const run = await tx.path_generation_runs.findUnique({
        where: { id: runId },
        select: { rollbackSnapshot: true }
      });
      let rollbackSnapshot: PathGenerationRollbackSnapshotV1 | null = null;
      try {
        const parsed = run?.rollbackSnapshot ? JSON.parse(run.rollbackSnapshot) : null;
        rollbackSnapshot = parsed?.version === 1 ? parsed as PathGenerationRollbackSnapshotV1 : null;
      } catch {
        rollbackSnapshot = null;
      }

      await tx.path_generation_runs.updateMany({
        where: {
          id: runId,
          learningPathId: pathId,
          status: { in: ['queued', 'processing'] }
        },
        data: {
          status: runStatus,
          retryAllowed: options.retryAllowed === true,
          heartbeatAt: now,
          leaseExpiresAt: now,
          finishedAt: now,
          errorCode,
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      });

      const restoringCorePath = rollbackSnapshot?.path.restoreStatus === true;
      if (restoringCorePath && path.status !== 'generating') return;

      const restored = await tx.learning_paths.updateMany({
        where: {
          id: pathId,
          activeGenerationRunId: runId,
          ...(restoringCorePath ? { status: 'generating' } : {})
        },
        data: {
          activeGenerationRunId: runStatus === 'failed'
            ? runId
            : rollbackSnapshot?.supersededRun
              ? null
              : rollbackSnapshot?.path.activeGenerationRunId || null,
          aiPromptTemplate: rollbackSnapshot ? rollbackSnapshot.path.aiPromptTemplate : path.aiPromptTemplate,
          ...(rollbackSnapshot?.path.restoreStatus && path.status === 'generating'
            ? { status: rollbackSnapshot.path.status }
            : {}),
          updatedAt: now
        }
      });
      if (restored.count !== 1) return;

      if (!rollbackSnapshot) {
        logger.warn('路径生成任务缺少回滚快照，仅释放当前生成指针', { pathId, runId });
      }
    });
  }

  private async claimQueuedGenerationRun(pathId: string, runId: string): Promise<any | null> {
    const now = new Date();
    const claimed = await prisma.path_generation_runs.updateMany({
      where: {
        id: runId,
        learningPathId: pathId,
        phase: 'stageDesign',
        status: 'queued',
        learningPath: { activeGenerationRunId: runId }
      },
      data: {
        status: 'processing',
        leaseOwner: PATH_GENERATION_LEASE_OWNER,
        claimedAt: now,
        startedAt: now,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + PATH_GENERATION_LEASE_MS)
      }
    });
    if (claimed.count !== 1) return null;
    return this.getActiveGenerationRun(pathId, runId);
  }

  private async heartbeatGenerationRun(
    pathId: string,
    runId: string,
    progressPatch: { completedItems?: number; totalItems?: number; progress?: number } = {}
  ): Promise<void> {
    const now = new Date();
    const result = await prisma.path_generation_runs.updateMany({
      where: {
        id: runId,
        learningPathId: pathId,
        status: 'processing',
        learningPath: { activeGenerationRunId: runId }
      },
      data: {
        ...progressPatch,
        leaseOwner: PATH_GENERATION_LEASE_OWNER,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + PATH_GENERATION_LEASE_MS)
      }
    });
    if (result.count !== 1) throw new Error('GENERATION_RUN_FENCED');
  }

  private startGenerationHeartbeat(pathId: string, runId: string): () => void {
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void this.heartbeatGenerationRun(pathId, runId)
        .catch((error) => {
          if (!(error instanceof Error) || error.message !== 'GENERATION_RUN_FENCED') {
            logger.warn('刷新路径生成任务心跳失败', {
              pathId,
              runId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, Math.max(30_000, Math.floor(PATH_GENERATION_LEASE_MS / 3)));
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async failGenerationRun(
    pathId: string,
    runId: string,
    error: unknown,
    errorCode: string,
    retryType: PathGenerationRetryType,
    pathStatus?: 'failed' | 'active'
  ): Promise<boolean> {
    const now = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);

    return prisma.$transaction(async (tx) => {
      const failed = await tx.path_generation_runs.updateMany({
        where: {
          id: runId,
          learningPathId: pathId,
          status: { in: ['queued', 'processing'] }
        },
        data: {
          status: 'failed',
          retryType,
          retryAllowed: true,
          heartbeatAt: now,
          leaseExpiresAt: now,
          finishedAt: now,
          errorCode,
          errorMessage
        }
      });
      if (failed.count !== 1) return false;

      const updatedPath = await tx.learning_paths.updateMany({
        where: { id: pathId, activeGenerationRunId: runId },
        data: {
          ...(pathStatus ? { status: pathStatus } : {}),
          updatedAt: now
        }
      });
      return updatedPath.count === 1;
    });
  }

  private async getActiveGenerationRun(pathId: string, activeGenerationRunId?: string | null): Promise<any | null> {
    if (!activeGenerationRunId) return null;
    return prisma.path_generation_runs.findFirst({
      where: { id: activeGenerationRunId, learningPathId: pathId }
    });
  }

  private buildPathProcessDetail(path: any) {
    const parsedTemplate = this.parsePathPromptTemplate(path.aiPromptTemplate || null);
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
          riskFlags: normalizeStringArray(sceneFraming.riskFlags),
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

  private async getPathStageTraces(pathId: string, sourceConversationId?: string | null): Promise<PathStageTraceItem[]> {
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

  private normalizeCognitiveDesign(
    candidate: PathCognitiveDesign | null | undefined,
    fallbackDomain: string,
    fallbackConceptNames: string[] = []
  ): PathCognitiveDesign {
    const rawConcepts = Array.isArray(candidate?.coreConcepts) ? candidate!.coreConcepts! : [];
    const seenIds = new Set<string>();
    const normalizedConcepts: PathCognitiveConcept[] = [];

    for (let index = 0; index < rawConcepts.length; index += 1) {
      const concept = rawConcepts[index];
      const name = typeof concept?.name === 'string' ? concept.name.trim() : '';
      if (!name) continue;

      let id = typeof concept?.id === 'string' && concept.id.trim()
        ? concept.id.trim()
        : slugifyConceptId(name, index);
      if (seenIds.has(id)) {
        id = `${id}-${index + 1}`;
      }
      seenIds.add(id);

      normalizedConcepts.push({
        id,
        name,
        role: concept?.role === 'hub' ? 'hub' : 'supporting',
        description: typeof concept?.description === 'string' && concept.description.trim()
          ? concept.description.trim()
          : undefined,
      });
    }

    if (normalizedConcepts.length === 0) {
      fallbackConceptNames.slice(0, 4).forEach((name, index) => {
        normalizedConcepts.push({
          id: `concept-${index + 1}`,
          name,
          role: index === 0 ? 'hub' : 'supporting',
          description: index === 0
            ? `优先围绕「${name}」建立第一层可迁移能力。`
            : `作为后续阶段补充，用来支撑「${name}」相关任务推进。`
        });
      });
    }

    const hubIndex = normalizedConcepts.findIndex((concept) => concept.role === 'hub');
    normalizedConcepts.forEach((concept, index) => {
      concept.role = hubIndex === -1
        ? (index === 0 ? 'hub' : 'supporting')
        : (index === hubIndex ? 'hub' : 'supporting');
    });

    return {
      cognitiveDomain: typeof candidate?.cognitiveDomain === 'string' && candidate.cognitiveDomain.trim()
        ? candidate.cognitiveDomain.trim()
        : fallbackDomain,
      coreConcepts: normalizedConcepts,
      ...(candidate?.prerequisiteTree ? { prerequisiteTree: candidate.prerequisiteTree } : {}),
      ...(candidate?.loadProfile ? { loadProfile: candidate.loadProfile } : {}),
    };
  }

  private normalizeMilestoneTasks(
    tasks: any[],
    conceptIds: string[]
  ): NormalizedPathTask[] {
    const fallbackConceptId = conceptIds[0];

    return (Array.isArray(tasks) ? tasks : []).map((task: any) => {
      const requestedConceptId = typeof task?.linkedConcept === 'string' ? task.linkedConcept.trim() : '';
      const linkedConcept = requestedConceptId && conceptIds.includes(requestedConceptId)
        ? requestedConceptId
        : fallbackConceptId;

      return {
        title: task?.title || '',
        description: task?.description || '',
        type: normalizePathTaskType(task?.type),
        estimatedMinutes: task?.estimatedMinutes || 30,
        acceptanceCriteria: task?.acceptanceCriteria || '',
        linkedConcept,
      };
    });
  }

  private normalizeMilestonesWithConcepts(milestonesData: any[], cognitiveDesign: PathCognitiveDesign): NormalizedPathMilestone[] {
    const conceptIds = Array.isArray(cognitiveDesign.coreConcepts)
      ? cognitiveDesign.coreConcepts.map((concept) => concept.id)
      : [];
    const fallbackConceptId = conceptIds[0] || null;

    return (Array.isArray(milestonesData) ? milestonesData : []).map((milestone: any, index: number) => {
      const requestedCoreConcept = typeof milestone?.coreConcept === 'string' ? milestone.coreConcept.trim() : '';
      const inferredCoreConcept = inferMilestoneConceptFromTasks(milestone?.tasks || []);
      const coreConcept = requestedCoreConcept && conceptIds.includes(requestedCoreConcept)
        ? requestedCoreConcept
        : inferredCoreConcept && conceptIds.includes(inferredCoreConcept)
          ? inferredCoreConcept
          : fallbackConceptId;
      const tasks = this.normalizeMilestoneTasks(milestone?.tasks || [], conceptIds).map((task) => ({
        ...task,
        linkedConcept: task.linkedConcept || coreConcept || undefined,
      }));

      return {
        ...milestone,
        stage: milestone?.stage || index + 1,
        name: milestone?.name || milestone?.title || `里程碑${index + 1}`,
        description: milestone?.description || '',
        goal: milestone?.goal || '',
        estimatedHours: milestone?.estimatedHours || 0,
        coreConcept,
        tasks,
      };
    });
  }

  private getPathLearningAccessState(
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
      learningBlockedReason: '阶段任务还在生成中，请稍候再开始学习。'
    };
  }

  private getNextEnrichmentRetryDelayMinutes(retryCount: number): number {
    return ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES[
      Math.min(retryCount, ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length - 1)
    ];
  }

  private getEnrichmentRetryReferenceTime(
    path: { updatedAt: Date },
    generationStatus: ParsedPathGenerationStatus | null
  ): number {
    const rawTime = generationStatus?.updatedAt
      || generationStatus?.lastStageDesignRetryAt
      || path.updatedAt?.toISOString?.()
      || path.updatedAt;

    const timestamp = new Date(rawTime).getTime();
    return Number.isFinite(timestamp) ? timestamp : Date.now();
  }

  private async queuePathEnrichmentRetry(
    path: {
      id: string;
      userId: string;
      title?: string | null;
      name?: string | null;
      description?: string | null;
      subject?: string | null;
      deadline?: Date | null;
      deadlineText?: string | null;
      aiPromptTemplate?: string | null;
      activeGenerationRunId?: string | null;
    },
    generationStatus: ParsedPathGenerationStatus | null
  ): Promise<{ retryCount: number; runId: string }> {
    const retryCount = (generationStatus?.stageDesignRetryCount || 0) + 1;
    const retryAt = new Date().toISOString();
    const run = await this.createAndClaimGenerationRun(
      path.id,
      'stageDesign',
      'stageDesign',
      0,
      'replace-tasks',
      path.activeGenerationRunId
    );

    await this.updatePathGenerationStatus(path.id, {
      stageDesign: 'processing',
      lastError: null,
      stageDesignRetryCount: retryCount,
      lastStageDesignRetryAt: retryAt,
      updatedAt: retryAt
    }, run.id);

    const analysis = {
      ...this.parsePathPromptTemplate(path.aiPromptTemplate || null),
      subject: path.subject || '综合'
    };

    runBackgroundTask('learning.path.stage-enrichment-retry', () => this.enrichLearningPathWithAnderson(path.id, run.id, {
      userId: path.userId,
      description: path.description || path.title || path.name || '个性化学习路径',
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      sourceConversationId: generationStatus?.sourceConversationId || undefined,
      generationRunId: run.id,
      userProfile: {}
    }, analysis), { pathId: path.id, runId: run.id, userId: path.userId });

    return { retryCount, runId: run.id };
  }

  /** 列出"零子任务且未完成"的阶段 id（追加式补齐的合法目标）。 */
  private async listEmptyMilestoneIds(pathId: string): Promise<string[]> {
    const milestones = await prisma.milestones.findMany({
      where: {
        learningPathId: pathId,
        status: { not: 'completed' },
        subtasks: { none: {} }
      },
      select: { id: true },
      orderBy: { stageNumber: 'asc' }
    });
    return milestones.map((milestone) => milestone.id);
  }

  /**
   * 追加式补齐的目标阶段（无则空数组）：生成在途时返回空（避免与在途生成重复）。
   * 供后台自愈环在 replace 通道不可用/预算耗尽时选路。
   */
  private async resolveAppendMilestoneIds(
    pathId: string,
    generationStatus: ParsedPathGenerationStatus | null,
    activeRun: PersistedPathGenerationRun | null,
    pathUpdatedAt: Date
  ): Promise<string[]> {
    const generationInFlight = (activeRun != null
        && (activeRun.status === 'queued' || activeRun.status === 'processing')
        && !isGenerationRunStale(activeRun))
      || (generationStatus?.stageDesign === 'processing'
        && !isStageDesignStale(generationStatus, pathUpdatedAt));
    if (generationInFlight) return [];
    return this.listEmptyMilestoneIds(pathId);
  }

  /**
   * 追加式补齐：仅对"零子任务"阶段生成任务（不删除、不覆盖既有任务）。
   *
   * 场景：`replace-tasks` 被路径变更保护拦下（路径已有已完成课堂证据）而阶段却为空的死局
   * （实测：3 条路径共 11 个零子任务里程碑）——**创建任务不构成"删除或覆盖"**，
   * 故走 `append-tasks` 契约（自带"必须限定到空白阶段"约束），合规且不丢任何证据。
   */
  private async queuePathEnrichmentAppend(
    path: {
      id: string; userId: string; subject?: string | null; description?: string | null;
      title?: string | null; name?: string | null; deadline?: Date | null; deadlineText?: string | null;
      aiPromptTemplate?: string | null; activeGenerationRunId?: string | null;
    },
    generationStatus: ParsedPathGenerationStatus | null,
    milestoneIds: string[]
  ): Promise<{ retryCount: number; runId: string }> {
    const appendCount = (generationStatus?.stageDesignAppendCount || 0) + 1;
    const retryAt = new Date().toISOString();
    const run = await this.createAndClaimGenerationRun(
      path.id,
      'stageDesign',
      'stageDesign',
      0,
      'append-tasks',
      path.activeGenerationRunId,
      { milestoneIds }
    );

    await this.updatePathGenerationStatus(path.id, {
      stageDesign: 'processing',
      lastError: null,
      // 独立预算：不占用 replace 的重试次数（replace 可能已被永久冲突耗尽）
      stageDesignAppendCount: appendCount,
      lastStageDesignRetryAt: retryAt,
      updatedAt: retryAt
    }, run.id);

    const analysis = {
      ...this.parsePathPromptTemplate(path.aiPromptTemplate || null),
      subject: path.subject || '综合'
    };

    runBackgroundTask('learning.path.stage-enrichment-append', () => this.enrichLearningPathWithAnderson(path.id, run.id, {
      userId: path.userId,
      description: path.description || path.title || path.name || '个性化学习路径',
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      sourceConversationId: generationStatus?.sourceConversationId || undefined,
      generationRunId: run.id,
      userProfile: {}
    }, analysis, { appendOnly: true }), { pathId: path.id, runId: run.id, userId: path.userId });

    return { retryCount: appendCount, runId: run.id };
  }

  private generateDisplayLabel(knowledgeType?: string | null, cognitiveLevel?: string | null): string | null {
    if (!knowledgeType || !cognitiveLevel) return null;
    const typeMap = DISPLAY_LABEL_MAP[knowledgeType];
    if (typeMap && typeMap[cognitiveLevel]) {
      return typeMap[cognitiveLevel];
    }
    return null;
  }

  private parsePathPromptTemplate(raw: string | null): Record<string, any> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private buildPathCognitiveDesign(data: GeneratePathData, analysis: any): PathCognitiveDesign {
    const sceneFraming = (analysis?.sceneFraming as PathSceneFraming | undefined)
      || (data.userProfile?.pathSceneFraming as PathSceneFraming | undefined);
    const generatedCognitiveDesignRaw = analysis?.cognitiveCore || analysis?.cognitiveDesign;
    const generatedCognitiveDesign = generatedCognitiveDesignRaw && typeof generatedCognitiveDesignRaw === 'object'
      ? generatedCognitiveDesignRaw
      : null;
    const confirmedStages = Array.isArray(data.userProfile?.confirmedProposal?.key_stages)
      ? data.userProfile.confirmedProposal.key_stages.filter((item: any) => typeof item === 'string' && item.trim())
      : [];
    const milestoneNames = Array.isArray(analysis?.suggestedMilestones)
      ? analysis.suggestedMilestones
          .map((milestone: any) => milestone?.name || milestone?.title || milestone?.goal)
          .filter((item: any) => typeof item === 'string' && item.trim())
      : [];
    const normalizedSceneInput = getSceneFramingNormalizedInput(sceneFraming);
    const normalizedSceneStages = normalizeStringArray(normalizedSceneInput?.confirmedProposal?.keyStages);
    const focusSource = normalizedSceneStages.length > 0
      ? normalizedSceneStages
      : confirmedStages.length > 0
        ? confirmedStages
        : milestoneNames;

    const generatedCoreConcepts = Array.isArray(generatedCognitiveDesign?.coreConcepts)
      ? generatedCognitiveDesign.coreConcepts
          .map((concept: any, index: number) => {
            const name = typeof concept?.name === 'string' ? concept.name.trim() : '';
            if (!name) return null;
            return {
              id: typeof concept?.id === 'string' && concept.id.trim() ? concept.id.trim() : `concept-${index + 1}`,
              name,
              role: concept?.role === 'hub' ? 'hub' as const : 'supporting' as const,
              description: typeof concept?.description === 'string' && concept.description.trim()
                ? concept.description.trim()
                : undefined,
            };
          })
          .filter(Boolean) as PathCognitiveConcept[]
      : [];

    return this.normalizeCognitiveDesign(
      {
        cognitiveDomain: typeof generatedCognitiveDesign?.cognitiveDomain === 'string' && generatedCognitiveDesign.cognitiveDomain.trim()
          ? generatedCognitiveDesign.cognitiveDomain.trim()
          : getSceneFramingFallbackDomain(sceneFraming) || analysis?.subject || data.description,
        coreConcepts: generatedCoreConcepts,
        prerequisiteTree: (generatedCognitiveDesign as any)?.prerequisiteTree ?? undefined,
        loadProfile: (generatedCognitiveDesign as any)?.loadProfile ?? undefined,
      },
      getSceneFramingFallbackDomain(sceneFraming) || analysis?.subject || data.description,
      focusSource,
    );
  }

  private buildPathAdjustmentPolicy(): PathAdjustmentPolicy {
    return {
      allowedModes: ['expand', 'compress', 'replan'],
      recommendedMode: null,
      triggerSource: null,
    };
  }

  private buildPathAdjustmentEvidence(data: GeneratePathData): PathAdjustmentEvidence | null {
    const learnerProjection = data.userProfile?.replan?.learnerReplanProjection;
    if (!learnerProjection || typeof learnerProjection !== 'object') {
      return null;
    }

    const stableConcepts = normalizeStringArray(learnerProjection?.mastery?.stableConcepts);
    const fragileConcepts = normalizeStringArray(learnerProjection?.mastery?.fragileConcepts);
    const strugglingConcepts = normalizeStringArray(learnerProjection?.mastery?.strugglingConcepts);
    const prerequisiteGaps = Array.isArray(learnerProjection?.risk?.prerequisiteGaps)
      ? learnerProjection.risk.prerequisiteGaps
          .map((item: any) => typeof item?.label === 'string' ? item.label.trim() : '')
          .filter(Boolean)
      : [];

    const evidence: PathAdjustmentEvidence = {
      stableConcepts,
      fragileConcepts,
      strugglingConcepts,
      prerequisiteGaps,
      pacingSignal: null,
    };

    if (
      stableConcepts.length === 0
      && fragileConcepts.length === 0
      && strugglingConcepts.length === 0
      && prerequisiteGaps.length === 0
    ) {
      return null;
    }

    return evidence;
  }

  private getPathSceneSummary(raw: string | null, fallbackMilestones?: any[]): Record<string, any> | null {
    const generationScene = parsePathGenerationStatus(raw)?.scene;
    if (generationScene && typeof generationScene === 'object') {
      return generationScene;
    }

    const parsed = this.parsePathPromptTemplate(raw);
    const sceneFraming = parsed?.sceneFraming && typeof parsed.sceneFraming === 'object'
      ? parsed.sceneFraming as PathSceneFraming
      : null;
    const milestoneCount = Array.isArray(fallbackMilestones) ? fallbackMilestones.length : undefined;
    const taskCount = Array.isArray(fallbackMilestones)
      ? fallbackMilestones.reduce((sum: number, milestone: any) => sum + ((milestone?.subtasks || []).length), 0)
      : undefined;

    return buildSceneSummaryFromFraming(sceneFraming, milestoneCount, taskCount);
  }

  private async updatePathGenerationStatus(
    pathId: string,
    patch: PathGenerationStatusPatch,
    runId?: string,
    expectedRunStatus: 'processing' | 'failed' = 'processing'
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        if (runId) await assertGenerationRunFence(tx, pathId, runId, expectedRunStatus);
        const existing = await tx.learning_paths.findUnique({
          where: { id: pathId },
          select: { aiPromptTemplate: true }
        });
        if (!existing) return;

        const currentTemplate = this.parsePathPromptTemplate(existing.aiPromptTemplate);
        const currentGeneration = currentTemplate._generation && typeof currentTemplate._generation === 'object'
          ? currentTemplate._generation
          : {};

        await tx.learning_paths.update({
          where: { id: pathId },
          data: {
            aiPromptTemplate: JSON.stringify({
              ...currentTemplate,
              _generation: {
                ...currentGeneration,
                ...patch,
                updatedAt: patch.updatedAt || new Date().toISOString()
              }
            }),
            updatedAt: new Date()
          }
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'GENERATION_RUN_FENCED') throw error;
      logger.warn('更新路径生成状态失败', {
        pathId,
        patch,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async recordPathGenerationStageLog(payload: PathGenerationLogPayload): Promise<void> {
    try {
      await prisma.agent_call_logs.create({
        data: {
          id: `acl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          agentId: 'path-agent',
          userId: payload.userId,
          sourceEntry: 'platform',
          input: JSON.stringify({
            phase: payload.phase,
            status: payload.status,
            pathId: payload.pathId || null,
            sourceConversationId: payload.sourceConversationId || null,
            triggerSource: payload.triggerSource || null,
            ...(payload.input || {})
          }),
          output: payload.output ? JSON.stringify(payload.output) : null,
          success: payload.status !== 'failed',
          durationMs: payload.durationMs || 0,
          error: payload.error || null,
          errorCode: payload.errorCode || null,
          calledAt: new Date(),
          metadata: JSON.stringify({
            eventType: 'path-generation-stage',
            executionLayer: 'flow-event',
            phase: payload.phase,
            status: payload.status,
            pathId: payload.pathId || null,
            sourceConversationId: payload.sourceConversationId || null,
            triggerSource: payload.triggerSource || null
          })
        }
      });
    } catch (error) {
      logger.warn('记录路径阶段日志失败', {
        phase: payload.phase,
        status: payload.status,
        pathId: payload.pathId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async recoverStaleGeneratingPaths(): Promise<number> {
    const now = new Date();
    const staleRuns = await prisma.path_generation_runs.findMany({
      where: {
        status: { in: ['queued', 'processing'] },
        OR: [
          { leaseExpiresAt: { lte: now } },
          { status: 'processing', leaseExpiresAt: null }
        ]
      },
      select: {
        id: true,
        learningPathId: true,
        phase: true,
        attempt: true,
        inputSnapshot: true,
        rollbackSnapshot: true,
        learningPath: { select: { activeGenerationRunId: true } }
      }
    });
    let recoveredRuns = 0;
    for (const run of staleRuns) {
      if (run.learningPath.activeGenerationRunId !== run.id) {
        await prisma.path_generation_runs.updateMany({
          where: { id: run.id, status: { in: ['queued', 'processing'] } },
          data: {
            status: 'cancelled',
            retryAllowed: false,
            leaseExpiresAt: now,
            finishedAt: now,
            errorCode: 'SUPERSEDED',
            errorMessage: '已由新的生成任务接管'
          }
        });
        continue;
      }
      let inputSnapshot: GeneratePathData | null = null;
      let rollbackSnapshot: PathGenerationRollbackSnapshotV1 | null = null;
      try {
        inputSnapshot = run.inputSnapshot ? JSON.parse(run.inputSnapshot) as GeneratePathData : null;
      } catch {
        inputSnapshot = null;
      }
      try {
        const parsed = run.rollbackSnapshot ? JSON.parse(run.rollbackSnapshot) : null;
        rollbackSnapshot = parsed?.version === 1 ? parsed as PathGenerationRollbackSnapshotV1 : null;
      } catch {
        rollbackSnapshot = null;
      }
      const restoreExistingCorePath = run.phase === 'core'
        && inputSnapshot?.createdPlaceholder !== true
        && rollbackSnapshot?.path.status !== 'generating'
        && rollbackSnapshot?.path.status !== 'failed'
        && rollbackSnapshot?.path.restoreStatus === true;
      const claimOutcome = await claimExpiredGenerationRun(prisma, {
        runId: run.id,
        pathId: run.learningPathId,
        expiredAt: now,
        restorePath: restoreExistingCorePath
          ? {
              status: rollbackSnapshot.path.status,
              aiPromptTemplate: rollbackSnapshot.path.aiPromptTemplate
            }
          : undefined
      });
      if (claimOutcome.claimed) {
        const pathStateChanged = claimOutcome.pathState?.status !== 'generating';
        const hasExistingContent = run.phase === 'core'
          && inputSnapshot?.createdPlaceholder !== true
          && (claimOutcome.pathState?.milestoneCount || 0) > 0;
        const unsafeExistingCoreState = run.phase === 'core'
          && inputSnapshot?.createdPlaceholder !== true
          && (!rollbackSnapshot || !claimOutcome.pathRestored)
          && hasExistingContent;
        const existingPathRestoreFailed = restoreExistingCorePath && !claimOutcome.pathRestored;
        const preserveCurrentPath = run.phase === 'core'
          && (pathStateChanged || unsafeExistingCoreState || existingPathRestoreFailed);

        if (!claimOutcome.pathRestored && !preserveCurrentPath) {
          await this.updatePathGenerationStatus(run.learningPathId, run.phase === 'stageDesign'
            ? { stageDesign: 'failed', lastError: 'GENERATION_LEASE_EXPIRED' }
            : { core: 'failed', lastError: 'GENERATION_LEASE_EXPIRED' }, run.id, 'failed');
        }
        if (run.phase === 'core' && !claimOutcome.pathRestored && !preserveCurrentPath) {
          await prisma.learning_paths.updateMany({
            where: {
              id: run.learningPathId,
              activeGenerationRunId: run.id,
              status: 'generating'
            },
            data: { status: 'failed', updatedAt: new Date() }
          });
        }
        recoveredRuns += 1;
        const canAutoReplace = run.phase === 'core'
          && inputSnapshot
          && run.attempt < 3
          && !pathStateChanged
          && !unsafeExistingCoreState
          && (inputSnapshot.createdPlaceholder === true || claimOutcome.pathRestored);
        if (canAutoReplace) {
          try {
            const replacement = await this.createAndClaimGenerationRun(
              run.learningPathId,
              'core',
              'core',
              0,
              undefined,
              run.id
            );
            const recoveredInput: GeneratePathData = {
              ...inputSnapshot,
              existingPathId: run.learningPathId,
              generationRunId: replacement.id,
              createdPlaceholder: inputSnapshot.createdPlaceholder,
              deadline: inputSnapshot.deadline ? new Date(inputSnapshot.deadline) : undefined
            };
            runBackgroundTask(
              'learning.path.core-recovery',
              () => this.generateLearningPath(recoveredInput),
              { pathId: run.learningPathId, runId: replacement.id }
            );
          } catch (error) {
            logger.warn('核心路径生成输入快照不可恢复', {
              pathId: run.learningPathId,
              runId: run.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    const staleBefore = new Date(Date.now() - STALE_GENERATING_PATH_MINUTES * 60 * 1000);

    const stalePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'generating',
        activeGenerationRunId: null,
        updatedAt: { lt: staleBefore }
      },
      select: { id: true }
    });

    const result = await prisma.learning_paths.updateMany({
      where: {
        status: 'generating',
        activeGenerationRunId: null,
        updatedAt: { lt: staleBefore }
      },
      data: {
        status: 'failed',
        updatedAt: new Date()
      }
    });

    if (result.count > 0) {
      logger.warn('发现并回收陈旧 generating 路径', {
        staleMinutes: STALE_GENERATING_PATH_MINUTES,
        recoveredCount: result.count
      });

      await Promise.all(stalePaths.map((path) => this.updatePathGenerationStatus(path.id, {
        core: 'failed',
        lastError: 'GENERATION_TIMEOUT_ORPHANED'
      })));
    }

    return recoveredRuns + result.count;
  }

  async retryEligibleFailedPathPreparations(): Promise<number> {
    const candidatePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'active',
        aiGenerated: true
      },
      select: {
        id: true,
        status: true,
        userId: true,
        title: true,
        name: true,
        description: true,
        subject: true,
        deadline: true,
        deadlineText: true,
        aiPromptTemplate: true,
        activeGenerationRunId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' }
    });

    let retriedCount = 0;

    for (const path of candidatePaths) {
      const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
      const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
      const retry = resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt);
      const canReplace = retry.allowed && retry.retryType === 'stageDesign';
      const replaceBudgetLeft = (generationStatus.stageDesignRetryCount || 0) < ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length;
      const useReplace = canReplace && replaceBudgetLeft;

      // 追加式自愈（两个入口）：
      //  ① replace 不可用（既非 failed 也非 stale）；或
      //  ② replace 预算已被耗尽（典型：被课堂证据永久冲突反复顶满）
      // 只要仍有"空白阶段"就改走追加通道（只创建、不删除，不会与证据冲突）。
      // 生成在途时一律不追加（resolveAppendMilestoneIds 内已判，避免与在途生成重复）。
      let appendMilestoneIds: string[] = [];
      if (!useReplace) {
        appendMilestoneIds = await this.resolveAppendMilestoneIds(path.id, generationStatus, activeRun, path.updatedAt);
        if (appendMilestoneIds.length === 0) continue;
      }

      const retryCount = useReplace
        ? (generationStatus.stageDesignRetryCount || 0)
        : (generationStatus.stageDesignAppendCount || 0);
      if (retryCount >= ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length) {
        continue;
      }

      const retryReferenceTime = this.getEnrichmentRetryReferenceTime(path, generationStatus);
      const requiredDelayMs = this.getNextEnrichmentRetryDelayMinutes(retryCount) * 60 * 1000;
      if (Date.now() - retryReferenceTime < requiredDelayMs) {
        continue;
      }

      try {
        if (useReplace) {
          await this.queuePathEnrichmentRetry(path, generationStatus);
        } else {
          await this.queuePathEnrichmentAppend(path, generationStatus, appendMilestoneIds);
        }
        retriedCount += 1;
      } catch (error) {
        const rawCode = (error as { code?: unknown })?.code;
        const errorCode = typeof rawCode === 'string' ? rawCode : '';
        // P4：失败也必须把重试计数落库。原实现只在 queuePathEnrichmentRetry 成功、
        // 且预检通过之后才自增计数（createAndClaimGenerationRun 的 guard 在计数写入之前），
        // 预检一抛错计数就停在 0，于是每分钟按「第 1 次、延迟 1 分钟」无限重试。
        // 对不可自愈的路径变更冲突直接把次数顶到上限，终止自动重试
        //（replace 顶满后，下一次轮询会自动改用追加通道，见上）。
        const terminal = TERMINAL_STAGE_DESIGN_RETRY_CODES.has(errorCode);
        const nextRetryCount = terminal
          ? ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length
          : retryCount + 1;
        await this.updatePathGenerationStatus(path.id, {
          ...(useReplace
            ? { stageDesignRetryCount: nextRetryCount }
            : { stageDesignAppendCount: nextRetryCount }),
          lastStageDesignRetryAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString()
        });
        logger.warn('自动继续生成阶段任务失败', {
          pathId: path.id,
          retryCount: nextRetryCount,
          appendMode: !useReplace,
          terminal,
          ...(errorCode ? { errorCode } : {}),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (retriedCount > 0) {
      logger.info('已触发阶段任务自动继续生成', { retriedCount });
    }

    return retriedCount;
  }

  private async attachActualMinutesToPath(path: any): Promise<any> {
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

  async markTaskInProgress(taskId: string, userId: string) {
    const subtask = await prisma.subtasks.findUnique({
      where: { id: taskId },
      include: {
        milestones: {
          include: {
            learning_paths: {
              select: {
                userId: true,
              }
            }
          }
        }
      }
    });

    if (!subtask) {
      throw new Error('任务不存在');
    }

    const pathOwner = subtask.milestones?.learning_paths?.userId;
    if (pathOwner && pathOwner !== userId) {
      throw new Error('无权访问此任务');
    }

    if (subtask.status === 'todo') {
      await prisma.subtasks.update({
        where: { id: taskId },
        data: {
          status: 'in_progress',
          updatedAt: new Date(),
        }
      });
    }
  }

  // 创建学习目标
  async createLearningGoal(data: CreateGoalData) {
    try {
      const goal = await prisma.learning_goals.create({
        data: {
          id: `lg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          title: data.description,
          description: data.description,
          updatedAt: new Date()
        }
      });

      logger.info(`学习目标创建：${goal.id}`);

      return goal;
    } catch (error) {
      logger.error('创建学习目标失败:', error);
      throw error;
    }
  }

  // 创建简单的学习路径
  async createLearningPath(data: {
    userId: string;
    name: string;
    title?: string;
    description?: string;
  }) {
    try {
      const learningPath = await prisma.learning_paths.create({
        data: {
          id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          name: data.name,
          title: data.title || data.name,
          description: data.description || '',
          updatedAt: new Date()
        }
      });

      logger.info(`学习路径创建：${learningPath.id}`);

      return learningPath;
    } catch (error) {
      logger.error('创建学习路径失败:', error);
      throw error;
    }
  }

  // 获取用户的学习目标
  async getLearningGoals(userId: string, status?: string) {
    try {
      const goals = await prisma.learning_goals.findMany({
        where: { userId, ...(status ? { status } : {}) },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
      });

      return goals;
    } catch (error) {
      logger.error('获取学习目标失败:', error);
      throw error;
    }
  }

  // 更新学习目标（多目标预算台账元数据：status/pathId/priority/plannedMinutesPerDay/cognitiveBandwidth）
  async updateLearningGoal(
    userId: string,
    goalId: string,
    data: {
      status?: 'active' | 'paused' | 'completed' | 'archived';
      pathId?: string | null;
      priority?: number;
      plannedMinutesPerDay?: number | null;
      cognitiveBandwidth?: string | null;
    }
  ) {
    const goal = await prisma.learning_goals.findFirst({ where: { id: goalId, userId } });
    if (!goal) throw new Error('学习目标不存在');
    return prisma.learning_goals.update({
      where: { id: goalId },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.pathId !== undefined ? { pathId: data.pathId } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.plannedMinutesPerDay !== undefined ? { plannedMinutesPerDay: data.plannedMinutesPerDay } : {}),
        ...(data.cognitiveBandwidth !== undefined ? { cognitiveBandwidth: data.cognitiveBandwidth } : {}),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 今日预算视图（多目标调度 · learn agent 台账）：
   * active goals（含预算）+ 今日 ledger + 活跃教学会话，产出每个目标的预算/已耗/建议
   *
   * 口径（拍板 2026-08-21）：
   * - 日界按服务器本地时区（此前 UTC 导致 UTC+8 用户清晨的学习记进「昨天」）
   * - todayMinutes = 今日开课的教学会话时长（终态取 duration，进行中取已流逝分钟）
   * - consumedMinutes：ledger 有值用 ledger；否则从今日会话经 task→milestone→path 反查到目标推导
   */
  async getTodaySchedule(userId: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [goals, ledgers, activeSessions, todaySessions] = await Promise.all([
      prisma.learning_goals.findMany({
        where: { userId, status: 'active' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.goal_scheduling_ledger.findMany({
        where: { userId, date: today },
      }),
      prisma.teaching_sessions.findMany({
        where: { userId, status: 'active' },
        select: { id: true, taskId: true, startTime: true },
      }),
      prisma.teaching_sessions.findMany({
        where: { userId, startTime: { gte: dayStart } },
        select: { taskId: true, duration: true, status: true, startTime: true },
      }),
    ]);

    const ledgerByGoal = new Map(ledgers.map((l) => [l.goalId, l]));

    // 今日真实学习分钟：终态会话取落库 duration；进行中的取「开课至今」流逝分钟
    const settledMinutes = todaySessions.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const activeElapsedMinutes = activeSessions.reduce((sum, s) => {
      const started = new Date(s.startTime).getTime();
      return Number.isFinite(started) ? sum + Math.max(0, Math.round((Date.now() - started) / 60000)) : sum;
    }, 0);
    const todayMinutes = settledMinutes + activeElapsedMinutes;

    // task → milestone → path 反查，把今日会话时长归账到对应目标（ledger 缺失时的诚实推导）
    const taskIds = [...new Set(todaySessions.map((s) => s.taskId).filter((id): id is string => !!id))];
    const minutesByPath = new Map<string, number>();
    if (taskIds.length) {
      const subtaskRows = await prisma.subtasks.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, milestoneId: true },
      });
      const milestoneIds = [...new Set(subtaskRows.map((s) => s.milestoneId).filter((id): id is string => !!id))];
      const milestoneRows = milestoneIds.length
        ? await prisma.milestones.findMany({ where: { id: { in: milestoneIds } }, select: { id: true, learningPathId: true } })
        : [];
      const milestoneToPath = new Map(milestoneRows.map((m) => [m.id, m.learningPathId]));
      const durationByTask = new Map<string, number>();
      for (const s of todaySessions) {
        if (!s.taskId) continue;
        durationByTask.set(s.taskId, (durationByTask.get(s.taskId) ?? 0) + (s.duration ?? 0));
      }
      for (const st of subtaskRows) {
        const pathId = milestoneToPath.get(st.milestoneId);
        if (!pathId) continue;
        minutesByPath.set(pathId, (minutesByPath.get(pathId) ?? 0) + (durationByTask.get(st.id) ?? 0));
      }
    }

    return {
      date: today,
      totalPlanned: goals.reduce((sum, g) => sum + (g.plannedMinutesPerDay ?? 0), 0),
      activeGoals: goals.map((goal) => {
        const ledger = ledgerByGoal.get(goal.id);
        // ledger 无记录时用今日会话推导，消除「恒 0 假进度条」
        const derivedMinutes = goal.pathId ? minutesByPath.get(goal.pathId) ?? 0 : 0;
        const consumedMinutes = ledger?.consumedMinutes ?? derivedMinutes;
        return {
          goalId: goal.id,
          title: goal.title,
          pathId: goal.pathId,
          priority: goal.priority,
          cognitiveBandwidth: goal.cognitiveBandwidth,
          plannedMinutes: goal.plannedMinutesPerDay ?? 30,
          consumedMinutes,
          loadAvg: ledger?.loadAvg ?? null,
          remainingMinutes: Math.max((goal.plannedMinutesPerDay ?? 30) - consumedMinutes, 0),
        };
      }),
      activeSessions: activeSessions.length,
      todayMinutes,
    };
  }

  /** 今日台账写入（幂等 upsert：userId×goalId×date） */
  async planTodaySchedule(userId: string, plan: Array<{ goalId: string; budgetMinutes: number; plannedTasks?: string[] }>) {
    const today = new Date().toISOString().slice(0, 10);
    const results = [];
    for (const item of plan) {
      const goal = await prisma.learning_goals.findFirst({ where: { id: item.goalId, userId } });
      if (!goal) continue;
      const ledger = await prisma.goal_scheduling_ledger.upsert({
        where: { userId_goalId_date: { userId, goalId: item.goalId, date: today } },
        update: {
          budgetMinutes: item.budgetMinutes,
          plannedTasks: item.plannedTasks?.length ? JSON.stringify(item.plannedTasks) : null,
          updatedAt: new Date(),
        },
        create: {
          id: `gsl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          userId,
          goalId: item.goalId,
          date: today,
          budgetMinutes: item.budgetMinutes,
          plannedTasks: item.plannedTasks?.length ? JSON.stringify(item.plannedTasks) : null,
        },
      });
      results.push(ledger);
    }
    return results;
  }

  private buildPathAgentInput(data: GeneratePathData): AgentInput {
    const skillLevel = data.userProfile?.skillLevel || data.userProfile?.currentSkillLevel;
    const currentLevel = (skillLevel === 'beginner' || skillLevel === 'intermediate' || skillLevel === 'advanced')
      ? skillLevel as 'beginner' | 'intermediate' | 'advanced'
      : undefined;

    return {
      type: 'standard',
      goal: data.description,
      currentLevel: currentLevel || 'beginner',
      timePerDay: data.userProfile?.timePerDay,
      structuredData: data.userProfile?.structuredData,
      confirmedProposal: data.userProfile?.confirmedProposal,
      confidenceScores: data.userProfile?.confidenceScores,
      conversationHistory: data.userProfile?.conversationHistory,
      metadata: {
        availableTime: data.userProfile?.timePerDay,
        deadline: data.deadline,
        deadlineText: data.deadlineText,
        totalWeeks: data.userProfile?.totalWeeks,
        userId: data.userId,
        replan: data.userProfile?.replan,
        goalFinalPayload: data.userProfile?.goalFinalPayload || null,
        normalizedInput: data.userProfile?.normalizedInput || null,
        conversationHistory: Array.isArray(data.userProfile?.conversationHistory) ? data.userProfile.conversationHistory : [],
      }
    };
  }

  private async analyzePathWithAgent(data: GeneratePathData): Promise<any> {
    try {
      const agentInput = this.buildPathAgentInput(data);
      const agentContext: any = {
        userId: data.userId,
        metadata: data.systemPromptOverrides?.pathAgent
          ? { pathAgentSystemPromptOverride: data.systemPromptOverrides.pathAgent }
          : undefined
      };

      // path 输入定帧：skill:path-scene-framing 已移除（LLM 环节信息零增量、输出被 seed 覆盖），
      // normalizedInput 由确定性 buildFramedNormalizedInput 清洗并附加 planningHints。
      // API/裸输入模式（无结构化 normalizedInput）用最小兜底结构，保证 planningHints 不缺失。
      const framedNormalizedInput = buildFramedNormalizedInput(data.userProfile?.normalizedInput || null)
        || buildFramedNormalizedInput({
          version: '1.0',
          learnerProfile: { surfaceGoal: data.description },
          problemSpace: { realProblem: data.description },
          resources: { timeBudget: data.userProfile?.timePerDay || null },
        });
      if (framedNormalizedInput) {
        // 学习者学习证据回注（仅新建路径）：同一个学习者第二次建路径时，之前踩过的坑要影响首版难度，
        // 否则首版是"盲排"。无学习历史 → 不注入（冷启动行为不变）。best-effort，失败不影响生成。
        try {
          const snapshot = await learnerSnapshotRefreshService.refresh({
            userId: data.userId,
            scope: 'global',
          });
          const planningProjection = learnerProjectionService.toPlanningProjection(snapshot);
          if (planningProjection) {
            framedNormalizedInput.learnerLearningContext = planningProjection;
            logger.info('[path-generation] 注入学习者学习证据（首版难度校准）', {
              userId: data.userId,
              fragile: planningProjection.fragileConcepts.length,
              struggling: planningProjection.strugglingConcepts.length,
              blocked: planningProjection.blockedFoundations.length,
            });
          }
        } catch (error) {
          logger.warn('[path-generation] 学习者学习证据注入失败（按盲排生成）', {
            userId: data.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        data.userProfile = {
          ...(data.userProfile || {}),
          normalizedInput: framedNormalizedInput,
        };
        agentInput.metadata = {
          ...(agentInput.metadata || {}),
          normalizedInput: framedNormalizedInput,
        };
      }

      const agentResult = await executeSkill(pathAgentDefinition, {
        input: agentInput,
        context: agentContext,
      });

      const normalizedPathResult = normalizeAgentOutput('skill:path-planning', agentResult);
      const pathPayload =
        normalizedPathResult.internal?.ext?.path?.path
        || normalizedPathResult.internal?.path
        || agentResult.path;

      if (!normalizedPathResult.success || !pathPayload) {
        const agentErrorMessage = typeof normalizedPathResult.error === 'string'
          ? normalizedPathResult.error
          : normalizedPathResult.error?.message;
        throw new Error(agentErrorMessage || 'PATH_AGENT_FAILED');
      }

      const path = pathPayload;
      const taskChainMilestones = Array.isArray(path.milestones)
        ? path.milestones
        : [];
      const pathAgentRaw = typeof (path as any)?._debug?.rawModelOutput === 'string'
        ? (path as any)._debug.rawModelOutput
        : null;
      const pathAgentInput = {
        goal: agentInput.goal,
        currentLevel: agentInput.currentLevel,
        timePerDay: agentInput.timePerDay,
        metadata: agentInput.metadata || {},
        confirmedProposal: agentInput.confirmedProposal || null,
        conversationHistory: Array.isArray(agentInput.conversationHistory) ? agentInput.conversationHistory : [],
      };
      logger.info('PathAgent 调用成功', { userId: data.userId, pathId: path.id });

      return {
        pathName: path.name,
        subject: path.subject || '综合',
        difficulty: data.userProfile?.skillLevel || 'beginner',
        estimatedTotalHours: path.estimatedHours || 0,
        // AI 生成的路径简短摘要（path-planning 输出），随 aiPromptTemplate 持久化，
        // 供列表接口 parsePathSummary 读取、前端卡片展示
        summary: typeof path.summary === 'string' && path.summary.trim() ? path.summary.trim() : null,
        sceneFraming: framedNormalizedInput ? { normalizedInput: framedNormalizedInput } : null,
        sceneFramingRaw: null,
        sceneFramingInput: null,
        pathAgentInput,
        pathAgentRaw,
        suggestedMilestones: taskChainMilestones.map((m: any, idx: number) => ({
          stage: m.stageNumber || idx + 1,
          name: m.title,
          coreConcept: typeof m.coreConcept === 'string' ? m.coreConcept : undefined,
          description: m.description,
          goal: m.goal,
          estimatedHours: m.estimatedHours,
          tasks: []
        })),
        cognitiveCore: path.cognitiveCore || path.cognitiveDesign,
        recommendations: [],
        feasibility: 'high'
      };
    } catch (agentError: any) {
      logger.error('PathAgent 调用失败，终止生成', {
        error: agentError?.message || String(agentError),
        userId: data.userId
      });
      throw new Error(`PATH_GENERATION_FAILED: ${agentError?.message || 'unknown error'}`);
    }
  }

  private async persistGeneratedPath(data: GeneratePathData, analysis: any, milestonesData: any[], runId?: string) {
    const cognitiveDesign = this.buildPathCognitiveDesign(data, analysis);
    const normalizedMilestonesData = this.normalizeMilestonesWithConcepts(milestonesData, cognitiveDesign);
    const adjustmentPolicy = this.buildPathAdjustmentPolicy();
    const adjustmentEvidence = this.buildPathAdjustmentEvidence(data);
    const generationUpdatedAt = new Date().toISOString();
    const promptTemplatePayload = {
        ...analysis,
        source: data.source || (data.sourceConversationId ? 'goal' : 'api'),
        mode: data.mode || 'generate',
        goalFinalPayload: buildGoalToPathHandoffSnapshot(data),
        normalizedInput: buildNormalizedPathInputSnapshot(data),
        normalizedInputSnapshot: buildNormalizedPathInputSnapshot(data),
        sceneFramingInput: analysis.sceneFramingInput || data.userProfile?.pathSceneFramingInput || null,
        sceneFramingRaw: analysis.sceneFramingRaw || data.userProfile?.pathSceneFramingRaw || null,
        pathAgentInput: analysis.pathAgentInput || null,
        pathAgentRaw: analysis.pathAgentRaw || null,
        suggestedMilestones: normalizedMilestonesData,
        cognitiveCore: cognitiveDesign,
        adjustmentPolicy,
        adjustmentEvidence,
        _generation: {
          core: 'succeeded',
          coreStep: 'completed',
          stageDesign: 'pending',
          lastError: null,
          sourceConversationId: data.sourceConversationId || null,
          triggerSource: data.sourceConversationId ? 'goal-conversation' : data.source === 'learn' ? 'ai-teaching' : data.source === 'replan' ? 'system' : 'api',
          updatedAt: generationUpdatedAt,
        }
    };

    // subject 兜底：path-planning 的 analysis.subject 可能是目标原文（其 analyzeInput 用 input.goal），
    // 过长会污染教学 prompt / 管理端列表 / Dashboard 副标题，超阈值时用清洗后的路径名兜底。
    const pathTitle = cleanPathTitle(analysis.pathName || `${analysis.subject || '个性化'}学习路径`);
    const pathSubject = resolvePathSubject(analysis.subject, pathTitle);

    const learningPath = await prisma.$transaction(async (tx) => {
      let path;
      if (data.existingPathId) {
        if (!runId) throw new Error('GENERATION_RUN_REQUIRED');
        await assertGenerationRunFence(tx, data.existingPathId, runId);
        const lockedPath = await tx.learning_paths.updateMany({
          where: { id: data.existingPathId, activeGenerationRunId: runId },
          data: { updatedAt: new Date() }
        });
        if (lockedPath.count !== 1) throw new Error('GENERATION_RUN_FENCED');
        await assertPathMutationSafe(tx, data.existingPathId, 'replace-path', {
          allowCompleted: (data.userProfile as any)?.replan?.forceReplace === true,
        });
        path = await tx.learning_paths.update({
          where: { id: data.existingPathId },
          data: {
            title: pathTitle,
            name: pathTitle,
            description: (data.description && !data.description.includes('\uFFFD'))
              ? data.description
              : (normalizedMilestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
            subject: pathSubject,
            status: 'active',
            difficulty: analysis.difficulty || 'beginner',
            totalMilestones: normalizedMilestonesData.length || 1,
            estimatedHours: analysis.estimatedTotalHours || 0,
            deadline: data.deadline || null,
            deadlineText: data.deadlineText || null,
            sourcePathId: (data.userProfile as any)?.replan?.sourcePathId || null,
            replanMode: (data.userProfile as any)?.replan?.mode || null,
            replanTriggerSource: (data.userProfile as any)?.replan?.triggerSource || null,
            replanReason: data.description || null,
            aiGenerated: true,
            aiPromptTemplate: JSON.stringify(promptTemplatePayload),
            updatedAt: new Date()
          }
        });

        // G1 数据质量修复（孤儿清理）：重建里程碑前清除本路径旧 run 遗留的 stage items。
        // path_generation_stage_items.milestoneId 无 FK（schema 仅 cascade runId），
        // 旧 run 的 stage items 在 milestones.deleteMany 后 milestoneId 悬空成孤儿。
        // 仅清理非当前 run 的 items；当前 core run 不产 stage items，stageDesign run 才会。
        await tx.path_generation_stage_items.deleteMany({
          where: {
            run: { learningPathId: path.id },
            ...(runId ? { runId: { not: runId } } : {})
          }
        });

        await (tx.milestones as any).deleteMany({
          where: { learningPathId: path.id }
        });
      } else {
        path = await tx.learning_paths.create({
          data: {
            id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            userId: data.userId,
            title: pathTitle,
            name: pathTitle,
            description: (data.description && !data.description.includes('\uFFFD'))
              ? data.description
              : (normalizedMilestonesData.map((m: any) => m.goal || m.name).join('; ') || data.description || ''),
            subject: pathSubject,
            difficulty: analysis.difficulty || 'beginner',
            totalMilestones: normalizedMilestonesData.length || 1,
            estimatedHours: analysis.estimatedTotalHours || 0,
            deadline: data.deadline || null,
            deadlineText: data.deadlineText || null,
            sourcePathId: (data.userProfile as any)?.replan?.sourcePathId || null,
            replanMode: (data.userProfile as any)?.replan?.mode || null,
            replanTriggerSource: (data.userProfile as any)?.replan?.triggerSource || null,
            replanReason: data.description || null,
            aiGenerated: true,
            aiPromptTemplate: JSON.stringify(promptTemplatePayload),
            status: 'active',
            updatedAt: new Date()
          }
        });
      }

      for (let i = 0; i < normalizedMilestonesData.length; i++) {
        const milestoneData = normalizedMilestonesData[i];
        const stageNum = milestoneData.stage || i + 1;

        const milestone = await (tx.milestones as any).create({
          data: {
            id: `ms_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${i}`,
            learningPathId: path.id,
            stageNumber: stageNum,
            title: milestoneData.name || `里程碑${stageNum}`,
            description: milestoneData.description || '',
            goal: milestoneData.goal || '',
            coreConceptId: typeof milestoneData.coreConcept === 'string' ? milestoneData.coreConcept : null,
            coreConceptName: resolveMilestoneConcept(
              typeof milestoneData.coreConcept === 'string' ? milestoneData.coreConcept : null,
              cognitiveDesign,
              typeof milestoneData.coreConcept === 'string' ? milestoneData.coreConcept : null,
            ).coreConceptName,
            estimatedHours: milestoneData.estimatedHours || 0,
            status: stageNum === 1 ? 'active' : 'locked',
            order: i,
            updatedAt: new Date()
          }
        });

      }

      await tx.learning_paths.update({
        where: { id: path.id },
        data: { totalMilestones: normalizedMilestonesData.length }
      });

      if (runId) {
        await assertGenerationRunFence(tx, path.id, runId);
        await tx.path_generation_runs.update({
          where: { id: runId },
          data: {
            status: 'succeeded',
            retryAllowed: false,
            completedItems: normalizedMilestonesData.length,
            totalItems: normalizedMilestonesData.length,
            progress: 100,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(),
            finishedAt: new Date(),
            errorCode: null,
            errorMessage: null
          }
        });

        const stageRunId = this.createGenerationId('pgr');
        const stageRollbackSnapshot: PathGenerationRollbackSnapshotV1 = {
          version: 1,
          path: {
            activeGenerationRunId: runId,
            aiPromptTemplate: path.aiPromptTemplate,
            status: path.status,
            restoreStatus: false
          },
          supersededRun: null
        };
        await tx.path_generation_runs.create({
          data: {
            id: stageRunId,
            learningPathId: path.id,
            phase: 'stageDesign',
            status: 'queued',
            retryAllowed: false,
            attempt: await tx.path_generation_runs.count({
              where: { learningPathId: path.id, phase: 'stageDesign' }
            }) + 1,
            totalItems: normalizedMilestonesData.length,
            completedItems: 0,
            progress: 0,
            rollbackSnapshot: JSON.stringify(stageRollbackSnapshot),
            leaseExpiresAt: new Date(Date.now() + PATH_GENERATION_LEASE_MS)
          }
        });
        await tx.learning_paths.update({
          where: { id: path.id },
          data: { activeGenerationRunId: stageRunId, updatedAt: new Date() }
        });
        (path as any).activeGenerationRunId = stageRunId;
      }

      await enqueueDomainEvent(tx, createDomainEvent({
        type: 'path:created',
        aggregateType: 'path',
        aggregateId: path.id,
        userId: data.userId,
        source: 'learning-service',
        data: {
          pathId: path.id,
          title: path.title,
          subject: path.subject,
          milestoneCount: normalizedMilestonesData.length,
          sourceConversationId: data.sourceConversationId || null
        }
      }));

      return path;
    });

    return this.getLearningPath(learningPath.id);
  }

  private async enrichLearningPathWithAnderson(
    pathId: string,
    runId: string,
    data: GeneratePathData,
    analysis: any,
    options: { appendOnly?: boolean } = {}
  ): Promise<void> {
    const startTime = Date.now();
    const triggerSource = data.sourceConversationId ? 'goal-conversation' : 'api';
    let stopHeartbeat = () => undefined;
    let inFlightStageItemIds: Set<string> | null = null;

    try {
      const persistedRun = await this.getActiveGenerationRun(pathId, runId);
      const run = persistedRun?.phase === 'stageDesign'
        ? persistedRun.status === 'queued'
          ? await this.claimQueuedGenerationRun(pathId, runId)
          : persistedRun
        : null;
      if (!run || run.status !== 'processing') throw new Error('GENERATION_RUN_FENCED');
      // 追加模式：只对"空白阶段"生成任务（不删除、不覆盖）→ 走 append-tasks 契约。
      const appendOnly = options.appendOnly === true;
      const appendMilestoneIds = appendOnly ? await this.listEmptyMilestoneIds(pathId) : [];
      if (appendOnly && appendMilestoneIds.length === 0) throw new Error('PATH_APPEND_NO_EMPTY_STAGE');
      await assertGenerationRunFence(prisma, pathId, runId);
      await assertPathMutationSafe(
        prisma,
        pathId,
        appendOnly ? 'append-tasks' : 'replace-tasks',
        appendOnly ? { milestoneIds: appendMilestoneIds } : {}
      );
      stopHeartbeat = this.startGenerationHeartbeat(pathId, runId);

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'stageDesign',
        status: 'started',
        input: { goal: data.description }
      });

      await this.updatePathGenerationStatus(pathId, {
        stageDesign: 'processing',
        lastError: null,
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      }, runId);

      logger.info('开始阶段任务设计...', { userId: data.userId, pathId });

      const learningPath = await prisma.learning_paths.findUnique({
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

      if (!learningPath) {
        throw new Error('PATH_ENRICHMENT_TARGET_NOT_FOUND');
      }
      if (appendOnly) {
        // 追加模式只处理"空白阶段"：其余阶段一概不碰（不删除、不覆盖任何既有任务）。
        learningPath.milestones = learningPath.milestones.filter((milestone) => appendMilestoneIds.includes(milestone.id));
        if (learningPath.milestones.length === 0) throw new Error('PATH_APPEND_NO_EMPTY_STAGE');
      }
      if (learningPath.milestones.length === 0) {
        throw new Error('PATH_STAGE_DESIGN_HAS_NO_STAGES');
      }
      await this.heartbeatGenerationRun(pathId, runId, {
        totalItems: learningPath.milestones.length,
        completedItems: 0,
        progress: 0
      });

      const pathCognitiveDesign = parsePathCognitiveDesign(learningPath.aiPromptTemplate || null);
      const parsedTemplate = this.parsePathPromptTemplate(learningPath.aiPromptTemplate || null);
      const sceneFraming = parsedTemplate?.sceneFraming && typeof parsedTemplate.sceneFraming === 'object'
        ? parsedTemplate.sceneFraming
        : null;
      const normalizedInput = getSceneFramingNormalizedInput(sceneFraming)
        || resolvePersistedNormalizedInput(parsedTemplate)
        || null;
      const stageDesignerBaseInput = {
        cognitiveCore: pathCognitiveDesign,
        normalizedInput,
      };
      const stageDesignRawOutputs: Record<string, any> = {};
      const stageDesignOutputs: Array<{
        milestoneId: string;
        stageNumber: number;
        subtasks: any[];
      }> = [];
      let designedTaskCount = 0;

      // 阶段任务设计并发度：串行 M 次 LLM 是纯时钟浪费；
      // 限流 2 路，兼顾 LLM 速率限制与 SQLite 写入串行化。
      const STAGE_DESIGN_CONCURRENCY = 2;
      inFlightStageItemIds = new Set<string>();
      let completedStageCount = 0;

      const processStageDesign = async (stageIndex: number): Promise<void> => {
        const milestone = learningPath.milestones[stageIndex];
        const stageStartedAt = new Date();
        const stageItemId = this.createGenerationId('pgsi');
        inFlightStageItemIds.add(stageItemId);
        await prisma.path_generation_stage_items.create({
          data: {
            id: stageItemId,
            runId,
            milestoneId: milestone.id,
            stageNumber: milestone.stageNumber,
            status: 'processing',
            heartbeatAt: stageStartedAt,
            startedAt: stageStartedAt
          }
        });
        const previousMilestone = stageIndex > 0 ? learningPath.milestones[stageIndex - 1] : null;
        // 配置式跨轮上下文（第三条链）：routings 表 path-agent 注入行抽值优先，回退手拼
        const { channels: designerChannels, skipped: designerSkipped } =
          await assembleStageDesignerChannels({
            previousMilestone: previousMilestone ? {
              stageNumber: previousMilestone.stageNumber,
              title: previousMilestone.title,
              coreConcept: previousMilestone.coreConceptId || null,
            } : null,
          }).catch(() => ({ channels: {}, skipped: [] }));
        if (designerSkipped.length > 0) {
          logger.warn('[path-generation] stage-designer channels skipped (config-driven extraction)', {
            runId,
            milestoneId: milestone.id,
            skipped: designerSkipped,
          });
        }
        const stageDesignerInput = {
          milestone: {
            stageNumber: milestone.stageNumber,
            title: milestone.title,
            coreConcept: milestone.coreConceptId || null,
            description: milestone.description || null,
            goal: milestone.goal || null,
            estimatedHours: milestone.estimatedHours || null,
          },
          ...(designerChannels['previousMilestone'] || previousMilestone ? {
            previousMilestone: designerChannels['previousMilestone'] || (previousMilestone ? {
              stageNumber: previousMilestone.stageNumber,
              title: previousMilestone.title,
              coreConcept: previousMilestone.coreConceptId || null,
            } : null),
          } : {}),
          ...stageDesignerBaseInput,
          repairHints: null,
        };
        const stageResult = await executeSkill(stageDesignerDefinition, stageDesignerInput);

        const stageTasks = Array.isArray(stageResult?.subtasks) ? stageResult.subtasks : [];
        assertStageTasksPresent(milestone.stageNumber, stageTasks);
        stageDesignRawOutputs[`stage-${milestone.stageNumber}`] = {
          inputPayload: stageDesignerInput,
          rawModelOutput: stageResult?._debug?.rawModelOutput || null,
          extractedJson: stageResult?._debug?.extractedJson || null,
          normalizedOutput: {
            subtasks: stageTasks,
          }
        };
        stageDesignOutputs.push({
          milestoneId: milestone.id,
          stageNumber: milestone.stageNumber,
          subtasks: stageTasks,
        });
        const stageFinishedAt = new Date();
        await prisma.path_generation_stage_items.update({
          where: { id: stageItemId },
          data: {
            status: 'succeeded',
            taskCount: stageTasks.length,
            heartbeatAt: stageFinishedAt,
            finishedAt: stageFinishedAt,
            errorCode: null,
            errorMessage: null
          }
        });
        inFlightStageItemIds.delete(stageItemId);
        completedStageCount += 1;
        await this.heartbeatGenerationRun(
          pathId,
          runId,
          calculateStageProgress(completedStageCount, learningPath.milestones.length)
        );
      };

      for (let batchStart = 0; batchStart < learningPath.milestones.length; batchStart += STAGE_DESIGN_CONCURRENCY) {
        const batchIndexes = learningPath.milestones
          .map((_, index) => index)
          .slice(batchStart, batchStart + STAGE_DESIGN_CONCURRENCY);
        await Promise.all(batchIndexes.map(processStageDesign));
      }

      // KC 映射（kc-mapper）：stage-designer 全部完成后，将概念与子任务分解为知识组件 + 依赖图
      let kcAnnotation: any = null;
      try {
        const parsedTemplate = this.parsePathPromptTemplate(learningPath.aiPromptTemplate || null);
        const kcResult = await executeSkill(kcMapperDefinition, {
          cognitiveCore: (parsedTemplate as any)?.cognitiveCore || (parsedTemplate as any)?.cognitiveDesign || null,
          milestones: learningPath.milestones.map((m) => ({
            stageNumber: m.stageNumber,
            title: m.title,
            coreConcept: m.coreConceptName || m.coreConceptId,
            description: m.description,
            goal: m.goal,
          })),
          subtasks: stageDesignOutputs.flatMap((s) => s.subtasks.map((t: any) => ({
            title: t.title,
            type: t.type,
            linkedConcept: t.linkedConcept,
            knowledgeType: t.knowledgeType,
            cognitiveLevel: t.cognitiveLevel,
          }))),
          prerequisiteTree: ((parsedTemplate as any)?.cognitiveCore || (parsedTemplate as any)?.cognitiveDesign)?.prerequisiteTree || null,
        });
        if (kcResult?.success && kcResult?.output) {
          kcAnnotation = kcResult.output;
          logger.info('[kc-mapper] KC 映射完成', {
            userId: data.userId,
            pathId,
            kcCount: kcAnnotation?.conceptKcs?.length || 0,
          });
        }
      } catch (kcError) {
        logger.warn('[kc-mapper] 映射失败（best-effort，不阻断路径生成）', {
          userId: data.userId,
          pathId,
          error: kcError instanceof Error ? kcError.message : String(kcError),
        });
      }

      // KC 映射持久化（kc-mapper 下游激活 3a）：写回 aiPromptTemplate，结束"写后无读者"，供 teaching-turn 按 KC 粒度消费
      if (kcAnnotation) {
        try {
          const currentPath = await prisma.learning_paths.findUnique({
            where: { id: pathId },
            select: { aiPromptTemplate: true },
          });
          const currentTemplate = this.parsePathPromptTemplate(currentPath?.aiPromptTemplate || null);
          await prisma.learning_paths.update({
            where: { id: pathId },
            data: {
              aiPromptTemplate: JSON.stringify({ ...currentTemplate, kcAnnotation }),
              updatedAt: new Date(),
            },
          });
          logger.info('[kc-mapper] KC 映射已持久化到 aiPromptTemplate', {
            pathId,
            kcCount: kcAnnotation?.conceptKcs?.length || 0,
            taskKcLinkCount: kcAnnotation?.taskKcLinks?.length || 0,
          });
        } catch (persistError) {
          logger.warn('[kc-mapper] KC 映射持久化失败（best-effort，不阻断路径生成）', {
            pathId,
            error: persistError instanceof Error ? persistError.message : String(persistError),
          });
        }
      }

      await prisma.$transaction(async (tx) => {
        await assertGenerationRunFence(tx, pathId, runId);
        const lockedPath = await tx.learning_paths.updateMany({
          where: { id: pathId, activeGenerationRunId: runId },
          data: { updatedAt: new Date() }
        });
        if (lockedPath.count !== 1) throw new Error('GENERATION_RUN_FENCED');
        await assertPathMutationSafe(
          tx,
          pathId,
          appendOnly ? 'append-tasks' : 'replace-tasks',
          appendOnly ? { milestoneIds: appendMilestoneIds } : {}
        );
        for (const milestone of learningPath.milestones) {
          if (!appendOnly) {
            await tx.subtasks.deleteMany({ where: { milestoneId: milestone.id } });
          }
          const stageOutput = stageDesignOutputs.find((item) => item.milestoneId === milestone.id);
          const stageTasks = stageOutput?.subtasks || [];
          // 阶段估时回写：以本阶段任务分钟汇总为准（ceil 到整小时），供各处展示与路径汇总使用
          const stageTotalMinutes = (stageTasks as Array<{ estimatedMinutes?: number }>)
            .reduce((sum, t) => sum + (Number(t?.estimatedMinutes) || 0), 0);
          const stageNormalizedHours = stageTasks.length > 0 ? Math.max(1, Math.ceil(stageTotalMinutes / 60)) : null;

          for (let j = 0; j < stageTasks.length; j++) {
            const taskData = stageTasks[j];
            const resolvedConcept = resolveTaskConcept(
              typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
              pathCognitiveDesign,
              typeof taskData.linkedConcept === 'string' ? taskData.linkedConcept : null,
            );
            const displayLabel = this.generateDisplayLabel(taskData.knowledgeType || null, taskData.cognitiveLevel || null)
              || (taskData.knowledgeType && taskData.cognitiveLevel ? `${taskData.knowledgeType} + ${taskData.cognitiveLevel}` : null);

            await tx.subtasks.create({
              data: {
                id: `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${milestone.stageNumber}_${j}`,
                milestoneId: milestone.id,
                userId: data.userId,
                title: taskData.title || `任务${j + 1}`,
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
                order: j,
                status: 'todo',
                updatedAt: new Date()
              }
            });
            designedTaskCount += 1;
          }
        }

        // 阶段/路径估时回写：任务分钟汇总（ceil 整小时）覆盖骨架期 LLM 粗估
        let pathNormalizedHours = 0;
        for (const milestone of learningPath.milestones) {
          const stageOutput = stageDesignOutputs.find((item) => item.milestoneId === milestone.id);
          const stageTasks = stageOutput?.subtasks || [];
          const stageTotalMinutes = (stageTasks as Array<{ estimatedMinutes?: number }>)
            .reduce((sum, t) => sum + (Number(t?.estimatedMinutes) || 0), 0);
          const stageHours = stageTasks.length > 0 ? Math.max(1, Math.ceil(stageTotalMinutes / 60)) : null;
          if (stageHours !== null) {
            pathNormalizedHours += stageHours;
            await tx.milestones.update({
              where: { id: milestone.id },
              data: { estimatedHours: stageHours, updatedAt: new Date() }
            });
          }
        }
        const pathHoursToWrite = pathNormalizedHours > 0 ? pathNormalizedHours : undefined;

        await tx.learning_paths.update({
          where: { id: learningPath.id },
          data: {
            ...(pathHoursToWrite !== undefined ? { estimatedHours: pathHoursToWrite } : {}),
            aiPromptTemplate: JSON.stringify({
              ...parsedTemplate,
              stageDesigns: stageDesignRawOutputs,
              kcAnnotation,
              _generation: {
                ...(parsedTemplate?._generation && typeof parsedTemplate._generation === 'object' ? parsedTemplate._generation : {}),
                stageDesign: 'succeeded',
                kcMapping: kcAnnotation ? 'succeeded' : 'skipped',
                lastError: null,
                sourceConversationId: data.sourceConversationId || null,
                triggerSource,
                updatedAt: new Date().toISOString()
              }
            }),
            updatedAt: new Date(),
          }
        });
        await tx.path_generation_runs.update({
          where: { id: runId },
          data: {
            status: 'succeeded',
            retryAllowed: false,
            completedItems: learningPath.milestones.length,
            totalItems: learningPath.milestones.length,
            progress: 100,
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(),
            finishedAt: new Date(),
            errorCode: null,
            errorMessage: null
          }
        });
        await enqueueDomainEvent(tx, createDomainEvent({
          type: 'path:generated',
          aggregateType: 'path',
          aggregateId: pathId,
          userId: data.userId,
          source: 'learning-service',
          data: {
            pathId,
            taskCount: designedTaskCount,
            milestoneCount: learningPath.milestones.length,
            sourceConversationId: data.sourceConversationId || null,
            triggerSource
          }
        }));
      });

      logger.info('阶段任务设计完成', {
        pathId,
        userId: data.userId,
        taskCount: designedTaskCount,
        milestoneCount: learningPath.milestones.length,
      });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'stageDesign',
        status: 'succeeded',
        durationMs: Date.now() - startTime,
        output: {
          taskCount: designedTaskCount,
          designedStages: learningPath.milestones.length
        }
      });
      dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'path-created');
    } catch (andersonError: any) {
      if (andersonError instanceof Error && andersonError.message === 'GENERATION_RUN_FENCED') {
        logger.info('忽略已失效阶段生成任务', { pathId, runId });
        return;
      }
      if (isPathMutationConflictError(andersonError)) {
        await this.restorePathAfterMutationConflict(pathId, runId, andersonError);
        logger.info('阶段任务生成因学习已开始而取消', {
          pathId,
          runId,
          code: andersonError.code
        });
        return;
      }

      logger.warn('阶段任务设计失败，路径保持骨架可用', {
        pathId,
        userId: data.userId,
        error: andersonError?.message || String(andersonError)
      });

      if (inFlightStageItemIds && inFlightStageItemIds.size > 0) {
        const failedAt = new Date();
        await prisma.path_generation_stage_items.updateMany({
          where: { id: { in: [...inFlightStageItemIds] }, runId, status: 'processing' },
          data: {
            status: 'failed',
            heartbeatAt: failedAt,
            finishedAt: failedAt,
            errorCode: 'PATH_STAGE_DESIGN_ITEM_FAILED',
            errorMessage: andersonError?.message || String(andersonError)
          }
        });
      }
      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'stageDesign',
        status: 'failed',
        durationMs: Date.now() - startTime,
        error: andersonError?.message || String(andersonError),
        errorCode: 'PATH_ENRICHMENT_FAILED'
      });
      try {
        await this.updatePathGenerationStatus(pathId, {
          stageDesign: 'failed',
          lastError: andersonError?.message || String(andersonError),
          sourceConversationId: data.sourceConversationId || null,
          triggerSource,
          updatedAt: new Date().toISOString()
        }, runId);
        await this.failGenerationRun(
          pathId,
          runId,
          andersonError,
          andersonError?.message?.includes('EMPTY_TASKS') ? 'PATH_STAGE_DESIGN_ZERO_TASKS' : 'PATH_ENRICHMENT_FAILED',
          'stageDesign'
        );
      } catch (fenceError) {
        if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
        logger.info('忽略已失效阶段生成任务的迟到失败', { pathId, runId });
      }
    } finally {
      stopHeartbeat();
    }
  }

  private async generateLearningPathCore(data: GeneratePathData) {
    const startTime = Date.now();
    const triggerSource = data.sourceConversationId
      ? 'goal-conversation'
      : data.source === 'learn'
        ? 'ai-teaching'
        : data.source === 'replan'
          ? 'system'
          : 'api';

    const coreRun = data.existingPathId
      ? data.generationRunId
        ? await this.getActiveGenerationRun(data.existingPathId, data.generationRunId)
        : null
      : null;
    if (data.existingPathId && (!coreRun || coreRun.status !== 'processing')) {
      throw new Error(data.generationRunId ? 'GENERATION_RUN_FENCED' : 'GENERATION_RUN_REQUIRED');
    }
    const coreRunId = coreRun?.id as string | undefined;

    if (data.existingPathId && coreRunId) {
      await prisma.path_generation_runs.updateMany({
        where: {
          id: coreRunId,
          learningPathId: data.existingPathId,
          status: 'processing'
        },
        data: {
          inputSnapshot: JSON.stringify({
            ...data,
            deadline: data.deadline?.toISOString?.() || data.deadline || null,
            generationRunId: undefined
          })
        }
      });
    }
    const stopHeartbeat = data.existingPathId && coreRunId
      ? this.startGenerationHeartbeat(data.existingPathId, coreRunId)
      : null;

    await this.recordPathGenerationStageLog({
      userId: data.userId,
      pathId: data.existingPathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'core',
      status: 'started',
        input: {
          goal: data.description,
          existingPathId: data.existingPathId || null,
          source: data.source || null,
          mode: data.mode || 'generate',
        }
      });

    if (data.existingPathId) {
      await this.updatePathGenerationStatus(data.existingPathId, {
        core: 'processing',
        stageDesign: 'pending',
        lastError: null,
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      }, coreRunId);
    }

    try {
      logger.info('开始生成学习路径...', { userId: data.userId, goal: data.description });
      let analysis = await this.analyzePathWithAgent(data);
      // 路径评审（CIDDP 五维度）：best-effort，不阻断路径生成
      let pathReview: any = null;
      try {
        const reviewResult = await executeSkill(pathReviewerDefinition, {
          pathPlan: {
            name: analysis.pathName,
            summary: analysis.summary,
            cognitiveCore: analysis.cognitiveCore || analysis.cognitiveDesign,
            milestones: analysis.suggestedMilestones,
            estimatedHours: analysis.estimatedTotalHours,
          },
          // 目标上下文（含 successCriteria——yaml 声明且 Practicality 评分要用，此前漏传，§3.19 P1⑥）
          goalContext: buildPathReviewerGoalContext({
            description: (data as any).description,
            confirmedProposal: (data as any).confirmedProposal,
            learnerProfile: (data as any).userProfile?.learnerProfile,
            analysis,
          }),
          prerequisiteTree: ((analysis.cognitiveCore || analysis.cognitiveDesign) as any)?.prerequisiteTree,
        });
        if (reviewResult?.success && reviewResult?.output) {
          pathReview = reviewResult.output;
          if (pathReview.passed === false && pathReview.replanInstructions) {
            logger.info('[path-reviewer] 路径未通过评审，触发一次自动重规划', {
              score: pathReview.score,
              replanInstructions: pathReview.replanInstructions,
            });
            try {
              const replanData: GeneratePathData = {
                ...data,
                source: 'replan',
                mode: 'replan',
                userProfile: {
                  ...(data.userProfile || {}),
                  replan: {
                    ...(data.userProfile?.replan || {}),
                    triggerSource: 'path-reviewer',
                    reviewerFeedback: pathReview.replanInstructions,
                  },
                },
              };
              const replannedAnalysis = await this.analyzePathWithAgent(replanData);
              if (replannedAnalysis?.suggestedMilestones?.length) {
                analysis = replannedAnalysis;
                pathReview = { ...pathReview, replanned: true };
                logger.info('[path-reviewer] 自动重规划完成，采用重规划结果', {
                  score: pathReview.score,
                  replanInstructions: pathReview.replanInstructions,
                });
              } else {
                logger.warn('[path-reviewer] 重规划结果为空，保留原路径', { score: pathReview.score });
              }
            } catch (replanError) {
              logger.warn('[path-reviewer] 自动重规划失败（best-effort，保留原路径）', {
                error: replanError instanceof Error ? replanError.message : String(replanError),
              });
            }
          }
        }
      } catch (reviewError) {
        logger.warn('[path-reviewer] 评审调用失败（best-effort，不阻断生成）', {
          error: reviewError instanceof Error ? reviewError.message : String(reviewError),
        });
      }
      if (data.existingPathId && coreRunId) {
        await this.heartbeatGenerationRun(data.existingPathId, coreRunId, { progress: 50 });
      }

      if (!analysis) {
        throw new Error('PATH_GENERATION_FAILED: empty analysis');
      }

      if (!analysis.suggestedMilestones || analysis.suggestedMilestones.length === 0) {
        throw new Error('PATH_GENERATION_FAILED: suggestedMilestones is empty');
      }

      const milestonesData = analysis.suggestedMilestones || [];
      const cognitiveDesign = this.buildPathCognitiveDesign(data, analysis);
      const normalizedMilestonesData = this.normalizeMilestonesWithConcepts(milestonesData, cognitiveDesign);
      const fullPath = await this.persistGeneratedPath(data, {
        ...analysis,
        cognitiveDesign,
        pathReview,
      }, normalizedMilestonesData, coreRunId);
      const duration = Date.now() - startTime;
      const sceneSummary = buildSceneSummaryFromFraming(
        analysis.sceneFraming || data.userProfile?.pathSceneFraming || null,
        normalizedMilestonesData.length,
        normalizedMilestonesData.reduce((sum: number, milestone: any) => sum + ((milestone?.tasks || []).length), 0)
      );

        logger.info(`学习路径核心生成完成：${fullPath.id}`, {
          userId: data.userId,
          milestoneCount: normalizedMilestonesData.length,
          durationMs: duration
        });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId: fullPath.id,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'core',
        status: 'succeeded',
        durationMs: duration,
        output: {
          pathId: fullPath.id,
          milestoneCount: normalizedMilestonesData.length,
          estimatedHours: fullPath.estimatedHours || analysis.estimatedTotalHours || 0
        }
      });

      if (sceneSummary) {
        const persistedTemplate = this.parsePathPromptTemplate(fullPath.aiPromptTemplate || null);
        await prisma.learning_paths.updateMany({
          where: {
            id: fullPath.id,
            ...(fullPath.activeGenerationRunId ? { activeGenerationRunId: fullPath.activeGenerationRunId } : {})
          },
          data: {
            aiPromptTemplate: JSON.stringify({
              ...persistedTemplate,
              _generation: {
                ...(persistedTemplate._generation || {}),
                scene: sceneSummary
              }
            })
          }
        });
      }

      return { fullPath, analysis };
    } catch (error: any) {
      if (data.existingPathId && coreRunId) {
        if (isPathMutationConflictError(error)) {
          await this.restorePathAfterMutationConflict(data.existingPathId, coreRunId, error);
          throw error;
        }
        if (!data.createdPlaceholder) {
          await this.restorePathAfterMutationConflict(data.existingPathId, coreRunId, error, {
            runStatus: 'failed',
            retryAllowed: true,
            errorCode: 'PATH_GENERATION_CORE_FAILED'
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.error('生成学习路径失败', {
        error: error?.message || String(error),
        stack: error?.stack,
        userId: data.userId,
        goal: data.description,
        durationMs: duration
      });

      await this.recordPathGenerationStageLog({
        userId: data.userId,
        pathId: data.existingPathId,
        sourceConversationId: data.sourceConversationId,
        triggerSource,
        phase: 'core',
        status: 'failed',
        durationMs: duration,
        error: error?.message || String(error),
        errorCode: 'PATH_GENERATION_CORE_FAILED'
      });

      if (data.existingPathId && data.createdPlaceholder) {
        try {
          await this.updatePathGenerationStatus(data.existingPathId, {
            core: 'failed',
            lastError: error?.message || String(error),
            sourceConversationId: data.sourceConversationId || null,
            triggerSource,
            updatedAt: new Date().toISOString()
          }, coreRunId);
          if (coreRunId) {
            await this.failGenerationRun(
              data.existingPathId,
              coreRunId,
              error,
              'PATH_GENERATION_CORE_FAILED',
              'core',
              'failed'
            );
          }
        } catch (fenceError) {
          if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
          logger.info('忽略已失效核心生成任务的迟到失败', { pathId: data.existingPathId, runId: coreRunId });
        }
      }

      throw new Error(`生成学习路径失败：${error?.message || '未知错误'}。请稍后重试或联系支持。`);
    } finally {
      stopHeartbeat?.();
    }
  }

  // 使用 AI 生成学习路径 (阶段化设计)
  async generateLearningPath(data: GeneratePathData) {
    let generationData = data;
    if (!data.existingPathId) {
      const placeholder = await prisma.learning_paths.create({
        data: {
          id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          title: data.description || '个性化学习路径',
          name: data.description || '个性化学习路径',
          description: data.description,
          subject: data.subject || '综合',
          status: 'generating',
          difficulty: data.userProfile?.skillLevel || 'beginner',
          estimatedHours: 0,
          aiGenerated: true,
          deadline: data.deadline || null,
          deadlineText: data.deadlineText || null,
          updatedAt: new Date()
        }
      });
      const run = await this.createAndClaimGenerationRun(placeholder.id, 'core', null, 0, undefined, null);
      generationData = {
        ...data,
        existingPathId: placeholder.id,
        generationRunId: run.id,
        createdPlaceholder: true
      };
    }

    const { fullPath, analysis } = await this.generateLearningPathCore(generationData);

    const stageRunId = fullPath.activeGenerationRunId;
    if (!stageRunId) throw new Error('GENERATION_RUN_REQUIRED');
    runBackgroundTask(
      'learning.path.stage-enrichment',
      () => this.enrichLearningPathWithAnderson(fullPath.id, stageRunId, generationData, analysis),
      { pathId: fullPath.id, runId: stageRunId, userId: generationData.userId }
    );
    dashboardGuidanceSnapshotService.refreshInBackground(generationData.userId, 'path-created');

    return fullPath;
  }

  async getLearningPath(pathId: string) {
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

      const pathWithActualMinutes = await this.attachActualMinutesToPath(path);
      const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
      const taskCount = pathWithActualMinutes.milestones.reduce(
        (sum: number, milestone: any) => sum + ((milestone.subtasks || []).length),
        0
      );
      const accessState = this.getPathLearningAccessState(
        path.status,
        path.aiPromptTemplate,
        activeRun,
        path.aiGenerated,
        taskCount
      );
      const processDetail = this.buildPathProcessDetail(pathWithActualMinutes);
      const stageTraces = await this.getPathStageTraces(path.id, processDetail.sourceConversationId || null);

      // 「预计投入」以任务分钟汇总为准（LLM 骨架期粗估仅作内部参考，见 normalizePathHoursFromTasks 说明）
      const normalized = normalizePathHoursFromTasks(pathWithActualMinutes);

      return {
        ...pathWithActualMinutes,
        estimatedHours: normalized.estimatedHours,
        estimatedHoursRaw: normalized.estimatedHoursRaw,
        summary: parsePathSummary(path.aiPromptTemplate),
        generationStatus: accessState.generationStatus,
        generationRun: buildGenerationRunStatus(activeRun),
        sceneSummary: this.getPathSceneSummary(path.aiPromptTemplate, normalized.milestones),
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
        milestones: normalized.milestones,
        stages: normalized.milestones,
        totalStages: path.totalMilestones
      };
    } catch (error) {
      logger.error('获取学习路径详情失败:', error);
      throw error;
    }
  }

  async getPathGenerationLifecycle(pathId: string, userId: string) {
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
    // 活动 stageDesign run 的工作量以 run.totalItems 为准（整路径生成 = 全部阶段；
    // 后续阶段重排 = 被重排的子集，仅展示该部分进度）；
    // 无活动 run（core 完成等待/历史状态）时退回路径阶段数。
    const runTotal = (run?.phase === 'stageDesign' || !run) ? (run?.totalItems || 0) : 0;
    const totalStages = runTotal > 0
      ? runTotal
      : Math.max(path.totalMilestones || 0, path.milestones.length, 0);
    const taskCount = path.milestones.reduce((sum, milestone) => sum + milestone.subtasks.length, 0);
    const accessState = this.getPathLearningAccessState(
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
      if (run.status === 'succeeded' && run.phase === 'stageDesign') {
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
      errorMessage: getSafeGenerationErrorMessage(
        run?.phase || (phase === 'stage_design' ? 'stageDesign' : phase),
        status,
        run?.errorCode
      ),
      canStartLearning: phase === 'ready' && accessState.canStartLearning
    };
  }

// 获取用户的学习路径列表
  async getUserLearningPaths(userId: string) {
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
        const accessState = this.getPathLearningAccessState(
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
          sceneSummary: this.getPathSceneSummary(path.aiPromptTemplate, normalized.milestones),
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

// 获取任务详情
  async getTaskDetail(taskId: string, userId?: string) {
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
        ? this.getPathLearningAccessState(
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

  // 获取任务详情（别名，用于路由）
  async getTaskById(taskId: string, userId?: string) {
    return this.getTaskDetail(taskId, userId);
  }

  async retryPathEnrichment(pathId: string, userId: string) {
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId }
    });

    if (!path) {
      throw new Error('学习路径不存在');
    }

    if (path.userId !== userId) {
      throw new Error('无权访问此学习路径');
    }

    if (path.status !== 'active') {
      throw new Error('学习路径主结构尚未完成，暂不能继续生成阶段任务');
    }

    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
    const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
    const retry = resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt);
    if (retry.allowed && retry.retryType === 'stageDesign') {
      const queued = await this.queuePathEnrichmentRetry(path, generationStatus);
      return {
        accepted: true,
        retryType: 'stageDesign' as const,
        mode: 'replace' as const,
        retryCount: queued.retryCount,
        runId: queued.runId
      };
    }

    // 标准 replace-tasks 不可用（典型：路径已有课堂证据被保护，删除/覆盖被拒）时，
    // 若仍存在"空白阶段"，用**追加式**补齐（只创建、不删除 → 合规且不丢证据）。
    // 注意：生成仍在进行中（且未超时）时不得追加，否则与在途生成重复。
    const generationInFlight = (activeRun != null
        && (activeRun.status === 'queued' || activeRun.status === 'processing')
        && !isGenerationRunStale(activeRun))
      || (generationStatus?.stageDesign === 'processing'
        && !isStageDesignStale(generationStatus, path.updatedAt));
    if (!generationInFlight) {
      const emptyMilestoneIds = await this.listEmptyMilestoneIds(path.id);
      if (emptyMilestoneIds.length > 0) {
        const queued = await this.queuePathEnrichmentAppend(path, generationStatus, emptyMilestoneIds);
        return {
          accepted: true,
          retryType: 'stageDesign' as const,
          mode: 'append' as const,
          retryCount: queued.retryCount,
          runId: queued.runId,
          emptyMilestoneCount: emptyMilestoneIds.length
        };
      }
    }

    throw new Error(activeRun?.status === 'succeeded' || generationStatus?.stageDesign === 'succeeded'
      ? '阶段任务已经准备完成，无需重试'
      : '阶段任务仍在生成中，请稍后查看');
  }

  async getPathGenerationRetry(pathId: string, userId: string) {
    const path = await prisma.learning_paths.findUnique({ where: { id: pathId } });
    if (!path) throw new Error('学习路径不存在');
    if (path.userId !== userId) throw new Error('无权访问此学习路径');

    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
    const activeRun = await this.getActiveGenerationRun(path.id, path.activeGenerationRunId);
    return {
      ...resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt),
      expectedActiveGenerationRunId: path.activeGenerationRunId
    };
  }

  async claimPathCoreGeneration(
    pathId: string,
    expectedActiveGenerationRunId?: string | null,
    options: { allowCompleted?: boolean } = {}
  ): Promise<string> {
    const run = await this.createAndClaimGenerationRun(
      pathId,
      'core',
      'core',
      0,
      'replace-path',
      expectedActiveGenerationRunId,
      options.allowCompleted ? { allowCompleted: true } : {}
    );
    return run.id;
  }

  async markActiveGenerationFailed(pathId: string, error: unknown, runId?: string): Promise<void> {
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId },
      select: { activeGenerationRunId: true }
    });
    const activeRunId = runId || path?.activeGenerationRunId;
    if (!activeRunId || path?.activeGenerationRunId !== activeRunId) return;
    const run = await this.getActiveGenerationRun(pathId, activeRunId);
    if (!run || run.status === 'failed' || run.status === 'succeeded' || run.status === 'cancelled') return;

    try {
      await this.updatePathGenerationStatus(pathId, run.phase === 'stageDesign'
        ? { stageDesign: 'failed', lastError: error instanceof Error ? error.message : String(error) }
        : { core: 'failed', lastError: error instanceof Error ? error.message : String(error) }, activeRunId);
      await this.failGenerationRun(
        pathId,
        activeRunId,
        error,
        run.phase === 'stageDesign' ? 'PATH_ENRICHMENT_FAILED' : 'PATH_GENERATION_CORE_FAILED',
        run.phase === 'stageDesign' ? 'stageDesign' : 'core',
        run.phase === 'core' ? 'failed' : undefined
      );
    } catch (fenceError) {
      if (!(fenceError instanceof Error) || fenceError.message !== 'GENERATION_RUN_FENCED') throw fenceError;
    }
  }

  async assertTaskReadyForLearning(
    taskId: string,
    userId: string,
    options: { requireTaskIncomplete?: boolean } = {}
  ) {
    const task = await prisma.subtasks.findUnique({
      where: { id: taskId },
      include: {
        milestones: {
          include: {
            learning_paths: {
              select: {
                id: true,
                userId: true,
                status: true,
                aiPromptTemplate: true,
                activeGenerationRunId: true
              }
            }
          }
        }
      }
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    // 已完成任务默认不允许再开「上课」会话（避免直接访问 /learn/<taskId> 又新建一节课）；
    // 由用户上课路由显式传入 requireTaskIncomplete 生效——复习课 / quick-learn 等
    // 既有调用方行为保持不变（复习课本就作用于已完成任务）。
    if (options.requireTaskIncomplete && task.status === 'completed') {
      const error = new Error('该任务已完成，请查看学习反馈，或从学习路径页选择重学');
      (error as { code?: string; status?: number }).code = 'TASK_ALREADY_COMPLETED';
      (error as { code?: string; status?: number }).status = 409;
      throw error;
    }

    const milestone = task.milestones;
    const learningPath = milestone?.learning_paths;

    if (!learningPath) {
      return;
    }

    if (learningPath.userId !== userId) {
      throw new Error('无权访问此任务');
    }

    // 校验 milestone 是否已解锁
    if (milestone && milestone.status === 'locked') {
      throw new Error('此阶段尚未解锁，请先完成前置阶段');
    }

    const activeRun = await this.getActiveGenerationRun(learningPath.id, learningPath.activeGenerationRunId);
    const accessState = this.getPathLearningAccessState(
      learningPath.status,
      learningPath.aiPromptTemplate,
      activeRun,
      true,
      1
    );

    if (!accessState.canStartLearning) {
      throw new Error(accessState.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    }
  }

  // 删除学习路径
  async deleteLearningPath(pathId: string, userId: string) {
    try {
      await prisma.$transaction(async (tx) => {
        const path = await tx.learning_paths.findUnique({
          where: { id: pathId },
          select: { userId: true }
        });

        if (!path) {
          throw new Error('学习路径不存在');
        }

        if (path.userId !== userId) {
          throw new Error('无权删除此学习路径');
        }

        const lockedPath = await tx.learning_paths.updateMany({
          where: { id: pathId },
          data: { updatedAt: new Date() }
        });
        if (lockedPath.count !== 1) throw new Error('学习路径不存在');
        await assertPathMutationSafe(tx, pathId, 'delete-path');
        await tx.learning_paths.delete({
          where: { id: pathId }
        });
      });

      dashboardGuidanceSnapshotService.refreshInBackground(userId, 'path-deleted');

      logger.info(`学习路径删除：${pathId}`);
    } catch (error) {
      logger.error('删除学习路径失败:', error);
      throw error;
    }
  }

  // 预留：基于已学内容重调学习路径（默认 new_version）
  private resolveStageReplanTarget(path: any, requestedStageNumber?: number | null) {
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

  private async redesignMilestoneTasks(
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
    const { skipFinalizeRun = false, eventRunTotal = 1 } = options;    const parsedTemplate = this.parsePathPromptTemplate(path.aiPromptTemplate || null);
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

    await prisma.$transaction(async (tx) => {
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
        const displayLabel = this.generateDisplayLabel(taskData.knowledgeType || null, taskData.cognitiveLevel || null)
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
      // 路径汇总：以全部阶段任务分钟真实汇总（含重设计阶段新任务 + 其它阶段既有任务）
      const allPathTasks = await tx.subtasks.findMany({
        where: { milestones: { learningPathId: path.id } },
        select: { estimatedMinutes: true },
      });
      const pathTotalMinutes = allPathTasks.reduce((sum: number, t: any) => sum + (Number(t?.estimatedMinutes) || 0), 0);
      const pathHours = allPathTasks.length > 0 ? Math.max(1, Math.ceil(pathTotalMinutes / 60)) : 0;

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
  private resolveDownstreamReplanTargets(
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
  private async redesignMilestoneRange(
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
      const result = await this.redesignMilestoneTasks(
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
      await this.heartbeatGenerationRun(
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
  private async executeDownstreamReplan(context: {
    pathId: string;
    userId: string;
    fromStageNumber: number;
    stageCount: number;
    data: PathReplanRequest;
    learnerReplanProjection: any;
    runId: string;
  }): Promise<void> {
    const { pathId, userId, fromStageNumber, stageCount, data, learnerReplanProjection, runId } = context;
    const stopHeartbeat = this.startGenerationHeartbeat(pathId, runId);
    try {
      // 执行期重读路径（请求期快照可能已被其它后台写触碰；以执行期一致状态为准）
      const freshPath = await prisma.learning_paths.findUnique({
        where: { id: pathId },
        include: { milestones: { include: { subtasks: true } } }
      });
      if (!freshPath) throw new Error('学习路径不存在');
      const milestones = this.resolveDownstreamReplanTargets(freshPath, fromStageNumber);
      if (milestones.length !== stageCount) {
        throw new PathMutationConflictError(
          '调整范围内阶段状态已变化，请刷新后重新调整',
          'PATH_REPLAN_RANGE_CHANGED'
        );
      }

      // 预检：无进行中任务/未结束课堂（提交期逐阶段各自乐观锁 claim + 安全检查）
      await prisma.$transaction(async (tx) => {
        await assertGenerationRunFence(tx, pathId, runId);
        await assertPathMutationSafe(tx, pathId, 'replan-stage', {
          milestoneIds: milestones.map((m: any) => m.id),
          ...(Array.isArray((data.evidence as any)?.clearedSessionIds) && (data.evidence as any).clearedSessionIds.length
            ? { ignoreCompletedSessionIds: (data.evidence as any).clearedSessionIds as string[] }
            : {})
        });
      });

      await this.redesignMilestoneRange(
        freshPath,
        milestones,
        data,
        learnerReplanProjection,
        runId
      );

      // 收尾：run 成功落库（阶段任务已逐阶段写入）
      await prisma.$transaction(async (tx) => {
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
        await this.restorePathAfterMutationConflict(pathId, runId, error);
        throw error;
      }
      try {
        await this.updatePathGenerationStatus(pathId, {
          stageDesign: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
          triggerSource: data.triggerSource || 'api',
          updatedAt: new Date().toISOString()
        }, runId);
        await this.failGenerationRun(
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

  async requestPathReplan(data: PathReplanRequest) {
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
      ? this.resolveDownstreamReplanTargets(path, data.fromStageNumber)
      : null;

    const targetMilestone = downstreamTargets && downstreamTargets.length > 0
      ? downstreamTargets[0]
      : this.resolveStageReplanTarget(path, data.stageNumber || null);
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
      const rangeRun = await this.createAndClaimGenerationRun(
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

      await this.updatePathGenerationStatus(data.pathId, {
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
        () => this.executeDownstreamReplan(rangeContext as any),
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
    const run = await this.createAndClaimGenerationRun(
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
    const stopHeartbeat = this.startGenerationHeartbeat(data.pathId, run.id);
    let redesignResult;
    try {
      await this.updatePathGenerationStatus(data.pathId, {
        stageDesign: 'processing',
        lastError: null,
        triggerSource,
        updatedAt: new Date().toISOString()
      }, run.id);
      redesignResult = await this.redesignMilestoneTasks(path, targetMilestone, data, {
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
        await this.restorePathAfterMutationConflict(data.pathId, run.id, error);
        throw error;
      }

      try {
        await this.updatePathGenerationStatus(data.pathId, {
          stageDesign: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
          triggerSource,
          updatedAt: new Date().toISOString()
        }, run.id);
        await this.failGenerationRun(
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

  // 完成任务
  async completeTask(data: CompleteTaskData) {
    try {
      const observedSubtask = await prisma.subtasks.findUnique({
        where: { id: data.taskId },
        include: {
          milestones: {
            include: {
              learning_paths: {
                select: { id: true, userId: true }
              }
            }
          }
        }
      });

      if (!observedSubtask) {
        throw new Error('任务不存在');
      }

      if (
        observedSubtask.userId !== data.userId
        || observedSubtask.milestones?.learning_paths?.userId !== data.userId
      ) {
        throw new Error('无权访问此任务');
      }

      const pathId = observedSubtask.milestones?.learningPathId;
      const milestoneId = observedSubtask.milestoneId;
      if (!pathId || !milestoneId) {
        throw new PathMutationConflictError(
          '任务所属学习路径已变化，请刷新后重试',
          'PATH_TASK_PARENT_CHANGED'
        );
      }

      // 日期模拟：任务结算的业务时间戳（subtasks.completedAt / 完成类 evidence / 里程碑）
      // 必须在模拟时钟下落到模拟日；无模拟上下文时 asOf 缺省 → new Date()，现网行为不变。
      const completedAt = data.asOf ?? new Date();
      const completionResult = await prisma.$transaction(async (tx) => {
        const lockedPath = await tx.learning_paths.updateMany({
          where: { id: pathId, userId: data.userId },
          data: { updatedAt: completedAt }
        });
        if (lockedPath.count !== 1) {
          throw new PathMutationConflictError(
            '任务所属学习路径已变化，请刷新后重试',
            'PATH_TASK_PARENT_CHANGED'
          );
        }

        const lockedMilestone = await tx.milestones.updateMany({
          where: { id: milestoneId, learningPathId: pathId },
          data: { updatedAt: completedAt }
        });
        if (lockedMilestone.count !== 1) {
          throw new PathMutationConflictError(
            '任务所属阶段已变化，请刷新后重试',
            'PATH_TASK_PARENT_CHANGED'
          );
        }

        const currentSubtask = await tx.subtasks.findUnique({
          where: { id: data.taskId },
          include: {
            milestones: {
              include: {
                learning_paths: {
                  select: { id: true, userId: true }
                }
              }
            }
          }
        });
        if (!currentSubtask) {
          throw new PathMutationConflictError(
            '任务已被学习路径调整替换，请刷新后重试',
            'PATH_TASK_REPLACED'
          );
        }
        if (
          currentSubtask.userId !== data.userId
          || currentSubtask.milestoneId !== milestoneId
          || currentSubtask.milestones?.learningPathId !== pathId
          || currentSubtask.milestones?.learning_paths?.userId !== data.userId
        ) {
          throw new PathMutationConflictError(
            '任务所属学习路径已变化，请刷新后重试',
            'PATH_TASK_PARENT_CHANGED'
          );
        }
        if (currentSubtask.status === 'completed') {
          return { task: currentSubtask, alreadyCompleted: true };
        }

        const completion = await tx.subtasks.updateMany({
          where: {
            id: data.taskId,
            userId: data.userId,
            status: { not: 'completed' }
          },
          data: {
            status: 'completed',
            completedAt,
            rating: data.rating,
            updatedAt: completedAt
          }
        });
        if (completion.count !== 1) {
          throw new PathMutationConflictError(
            '任务状态已变化，请刷新后重试',
            'PATH_TASK_STATE_CHANGED'
          );
        }

        await achievementService.addXp(data.userId, 50, tx);

        await enqueueDomainEvent(tx, createDomainEvent({
          type: 'task:completed',
          aggregateType: 'task',
          aggregateId: data.taskId,
          userId: data.userId,
          source: 'learning-service',
          occurredAt: completedAt,
          data: {
            taskId: data.taskId,
            taskTitle: currentSubtask.title,
            pathId,
            milestoneId: currentSubtask.milestoneId,
            actualMinutes: data.actualMinutes || null,
            subjectiveDifficulty: data.subjectiveDifficulty || null,
            rating: data.rating || null,
            linkedConceptName: currentSubtask.linkedConceptName || currentSubtask.coreConcept || null
          }
        }));

        if (pathId) {
          const remainingMilestoneTasks = await tx.subtasks.count({
            where: {
              milestoneId: currentSubtask.milestoneId,
              status: { not: 'completed' }
            }
          });
          if (remainingMilestoneTasks === 0) {
            await tx.milestones.updateMany({
              where: { id: currentSubtask.milestoneId, status: { not: 'completed' } },
              data: { status: 'completed', completedAt, updatedAt: completedAt }
            });
            const nextMilestone = await tx.milestones.findFirst({
              where: {
                learningPathId: pathId,
                stageNumber: { gt: currentSubtask.milestones.stageNumber },
                status: 'locked'
              },
              orderBy: { stageNumber: 'asc' }
            });
            if (nextMilestone) {
              await tx.milestones.update({
                where: { id: nextMilestone.id },
                data: { status: 'active', unlockedAt: nextMilestone.unlockedAt || completedAt, updatedAt: completedAt }
              });
            }
            const completedMilestones = await tx.milestones.count({
              where: { learningPathId: pathId, status: 'completed' }
            });
            await tx.learning_paths.update({
              where: { id: pathId },
              data: { completedMilestones, updatedAt: completedAt }
            });
          }

          const remainingTasks = await tx.subtasks.count({
            where: {
              milestones: { learningPathId: pathId },
              status: { not: 'completed' }
            }
          });
          if (remainingTasks === 0) {
            const completedMilestones = await tx.milestones.count({ where: { learningPathId: pathId, status: 'completed' } });
            const completedPath = await tx.learning_paths.updateMany({
              where: { id: pathId, status: { not: 'completed' } },
              data: { status: 'completed', completedMilestones, updatedAt: completedAt }
            });
            if (completedPath.count === 1) {
              await enqueueDomainEvent(tx, createDomainEvent({
                type: 'path:completed',
                aggregateType: 'path',
                aggregateId: pathId,
                userId: data.userId,
                source: 'learning-service',
                occurredAt: completedAt,
                data: { pathId, completedByTaskId: data.taskId }
              }));
            }
          }
        }

        const updatedTask = await tx.subtasks.findUnique({
          where: { id: data.taskId },
          include: {
            milestones: {
              include: {
                learning_paths: {
                  select: { id: true, userId: true }
                }
              }
            }
          }
        });
        if (!updatedTask) {
          throw new PathMutationConflictError(
            '任务已被学习路径调整替换，请刷新后重试',
            'PATH_TASK_REPLACED'
          );
        }
        return { task: updatedTask, alreadyCompleted: false };
      });

      const subtask = completionResult.task;
      const updatedSubtask = completionResult.task;

      if (completionResult.alreadyCompleted) {
        return {
          task: completionResult.task,
          learningReport: undefined,
          alreadyCompleted: true
        };
      }

      // 检查成就达成
      try {
        await achievementService.triggerAchievementCheck(data.userId, 'task_completed');
      } catch (error) {
        logger.warn('检查成就失败（不影响任务完成）:', error);
      }

      // 今日调度台账（拍板 2026-08-21 中期项）：任务真实结算时按实际用时累加消耗，
      // 消除「今日预算」恒零。幂等性由上方 alreadyCompleted 早退保证；
      // 无 actualMinutes 时不写（不虚构消耗）。失败不阻断任务完成主流程。
      try {
        const actualMinutes = Number(data.actualMinutes);
        if (Number.isFinite(actualMinutes) && actualMinutes > 0 && pathId) {
          const linkedGoal = await prisma.learning_goals.findFirst({
            where: { userId: data.userId, pathId },
            select: { id: true }
          });
          if (linkedGoal) {
            const nowDate = data.asOf ?? new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            // 模拟时钟（asOf）下用 UTC 日（与日期模拟/当日课量同口径）；缺省保持本地日（现网不变）
            const todayKey = data.asOf
              ? nowDate.toISOString().slice(0, 10)
              : `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`;
            await prisma.goal_scheduling_ledger.upsert({
              where: { userId_goalId_date: { userId: data.userId, goalId: linkedGoal.id, date: todayKey } },
              update: { consumedMinutes: { increment: actualMinutes }, updatedAt: nowDate },
              create: {
                id: `gsl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                userId: data.userId,
                goalId: linkedGoal.id,
                date: todayKey,
                consumedMinutes: actualMinutes
              }
            });
          }
        }
      } catch (error) {
        logger.warn('写入今日调度台账失败（不影响任务完成）:', error);
      }

      // 更新连续学习天数（best-effort，不影响任务完成）
      try {
        const today = data.asOf ?? new Date();
        const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

        const user = await prisma.users.findUnique({
          where: { id: data.userId },
          select: { streakDays: true, streakLastDate: true, longestStreak: true }
        });

        if (user) {
          let newStreak = user.streakDays;
          const lastDate = user.streakLastDate?.toISOString().slice(0, 10);

          if (lastDate !== todayStr) {
            if (!lastDate) {
              newStreak = 1;
            } else {
              const last = new Date(lastDate + 'T00:00:00Z');
              const diffDays = Math.floor((today.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
              if (diffDays === 1) {
                newStreak = user.streakDays + 1;
              } else {
                newStreak = 1;
              }
            }

            const newLongest = Math.max(newStreak, user.longestStreak);
            await prisma.users.update({
              where: { id: data.userId },
              data: {
                streakDays: newStreak,
                streakLastDate: today,
                longestStreak: newLongest
              }
            });
          }
        }
      } catch (error) {
        logger.warn('更新学习连续天数失败（不影响任务完成）:', error);
      }

      // 基于学习者状态中心生成学习报告
      let learningReport: { reasoning?: string; suggestion?: string; recommendations?: string[] } | undefined;
      
      try {
        const progressResult = await learnerProgressService.evaluateTaskCompletion(data.userId, {
          taskTitle: subtask.title,
          timeSpent: data.actualMinutes && data.actualMinutes > 0 ? data.actualMinutes : 1,
          subjectiveDifficulty: data.subjectiveDifficulty,
          difficulty: subtask.estimatedMinutes ? Math.min(subtask.estimatedMinutes / 30, 10) : 5
        });

        learningReport = {
          reasoning: progressResult.metrics?.reasoning,
          suggestion: progressResult.metrics?.suggestion,
          recommendations: progressResult.recommendations
        };
      } catch (error) {
        logger.warn('生成学习报告失败（不影响任务完成）:', error);
      }

      logger.info(`任务完成：${subtask.id}`, { userId: data.userId });

      runBackgroundTask('learner-snapshot.task-completed', () => learnerSnapshotRefreshService.refresh({
        userId: data.userId,
        pathId: subtask.milestones?.learningPathId || undefined,
        taskId: data.taskId,
        milestoneId: subtask.milestoneId,
        scope: 'teaching',
      }), { userId: data.userId, taskId: data.taskId });
      dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'task-completed');
      learnerStateReviewService.refreshInBackground(data.userId);
      conceptConsolidatorService.refreshInBackground(data.userId);

      return {
        task: updatedSubtask,
        learningReport
      };
    } catch (error) {
      logger.error('完成任务失败:', error);
      throw error;
    }
  }

  // 获取学习进度统计
  async getLearningStats(userId: string) {
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
}

export default new LearningService();
