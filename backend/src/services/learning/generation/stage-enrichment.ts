/**
 * 阶段任务设计（Anderson enrichment）执行体（架构审计 §5 行动 #2：learning.service.ts 拆分——生成域）
 *
 * 职责：认领 stageDesign run → 并发（限 2 路）逐阶段 stage-designer 生成任务 →
 * KC 映射（kc-mapper，best-effort）→ 事务落库子任务与估时回写 → 事件发出。
 * 追加模式（appendOnly）只对空白阶段生成，不删除/覆盖既有任务。
 * 行为与拆分前 learning.service 同名私有方法逐一等价（P1-8 事务事故即发生在此链路，
 * 事务统一走 withTransaction 封装）。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { withTransaction } from '../../../utils/with-transaction';
import { executeSkill } from '../../../skills';
import { stageDesignerDefinition } from '../../../skills/stage-designer';
import { kcMapperDefinition } from '../../../skills/kc-mapper';
import { assembleStageDesignerChannels } from '../../field-dispatcher';
import {
  assertGenerationRunFence,
  assertStageTasksPresent,
  calculateStageProgress,
} from '../path-generation-status';
import { assertPathMutationSafe, isPathMutationConflictError } from '../path-mutation-safety';
import {
  generateDisplayLabel,
  getSceneFramingNormalizedInput,
  normalizePathTaskType,
  parsePathCognitiveDesign,
  parsePathPromptTemplate,
  resolvePersistedNormalizedInput,
  resolveTaskConcept,
} from '../learning.helpers';
import type { GeneratePathData } from '../learning.types';
import { createDomainEvent } from '../../../events/contracts';
import { enqueueDomainEvent } from '../../../events/outbox.repository';
import { dashboardGuidanceSnapshotService } from '../../learner/DashboardGuidanceSnapshotService';
import {
  claimQueuedGenerationRun,
  failGenerationRun,
  getActiveGenerationRun,
  heartbeatGenerationRun,
  recordPathGenerationStageLog,
  restorePathAfterMutationConflict,
  startGenerationHeartbeat,
  updatePathGenerationStatus,
  createGenerationId,
} from './run-lifecycle';
import { listEmptyMilestoneIds } from './retry-policy';

export async function enrichLearningPathWithAnderson(
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
    const persistedRun = await getActiveGenerationRun(pathId, runId);
    const run = persistedRun?.phase === 'stageDesign'
      ? persistedRun.status === 'queued'
        ? await claimQueuedGenerationRun(pathId, runId)
        : persistedRun
      : null;
    if (!run || run.status !== 'processing') throw new Error('GENERATION_RUN_FENCED');
    // 追加模式：只对"空白阶段"生成任务（不删除、不覆盖）→ 走 append-tasks 契约。
    const appendOnly = options.appendOnly === true;
    const appendMilestoneIds = appendOnly ? await listEmptyMilestoneIds(pathId) : [];
    if (appendOnly && appendMilestoneIds.length === 0) throw new Error('PATH_APPEND_NO_EMPTY_STAGE');
    await assertGenerationRunFence(prisma, pathId, runId);
    await assertPathMutationSafe(
      prisma,
      pathId,
      appendOnly ? 'append-tasks' : 'replace-tasks',
      appendOnly ? { milestoneIds: appendMilestoneIds } : {}
    );
    stopHeartbeat = startGenerationHeartbeat(pathId, runId);

    await recordPathGenerationStageLog({
      userId: data.userId,
      pathId,
      sourceConversationId: data.sourceConversationId,
      triggerSource,
      phase: 'stageDesign',
      status: 'started',
      input: { goal: data.description }
    });

    await updatePathGenerationStatus(pathId, {
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
    await heartbeatGenerationRun(pathId, runId, {
      totalItems: learningPath.milestones.length,
      completedItems: 0,
      progress: 0
    });

    const pathCognitiveDesign = parsePathCognitiveDesign(learningPath.aiPromptTemplate || null);
    const parsedTemplate = parsePathPromptTemplate(learningPath.aiPromptTemplate || null);
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
      const stageItemId = createGenerationId('pgsi');
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
      await heartbeatGenerationRun(
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
      const parsedTemplate = parsePathPromptTemplate(learningPath.aiPromptTemplate || null);
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
        const currentTemplate = parsePathPromptTemplate(currentPath?.aiPromptTemplate || null);
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

    await withTransaction(async (tx) => {
      // 事务可能因瞬时冲突整体重试：计数必须随每次尝试重置，避免重复累加
      designedTaskCount = 0;
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
          const displayLabel = generateDisplayLabel(taskData.knowledgeType || null, taskData.cognitiveLevel || null)
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

    await recordPathGenerationStageLog({
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
      await restorePathAfterMutationConflict(pathId, runId, andersonError);
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
    await recordPathGenerationStageLog({
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
      await updatePathGenerationStatus(pathId, {
        stageDesign: 'failed',
        lastError: andersonError?.message || String(andersonError),
        sourceConversationId: data.sourceConversationId || null,
        triggerSource,
        updatedAt: new Date().toISOString()
      }, runId);
      await failGenerationRun(
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

