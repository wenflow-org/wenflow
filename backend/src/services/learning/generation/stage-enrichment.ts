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
import { clampHintsToOneSitting, clampStageTasksToHints, ONE_SITTING_MAX_HOURS } from '../path-planning-hints';
import { buildStageFillNote } from './stage-fill-note';
import { detectStageFiller, isStageFiller, detectCrossStageFiller, isCrossStageFiller } from './stage-filler';
import { buildSupplementRequest, mergeSupplementTasks, needsLessonSupplement } from './stage-task-supplement';
import { resolveSchoolAnchorForPathDesign, schoolAnchorCoverage } from './school-anchor';
import { mapAndPersistKcAnnotation, mergeKcStageAnnotation, type KcAnnotation } from './kc-annotation';
import { assembleStageDesignerChannels } from '../../field-dispatcher';
import { extractPromptMaterials, STAGE_MATERIAL_LIMITS } from '../../materials/material-prompt-projection';
import type { PreviousStageOutcome } from './progressive-design';
import {
  assertGenerationRunFence,
  assertStageTasksPresent,
  calculateStageProgress,
} from '../path-generation-status';
import { assertPathMutationSafe, isPathMutationConflictError } from '../path-mutation-safety';
import { conceptRegistryService } from '../../learner/concept-registry.service';
import { conceptGraphService } from '../../learner/concept-graph.service';
import { normalizeConceptKey } from '../../memory/concept-key';
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

/** 只依赖 deleteMany 的最小客户端面（便于单测注入假实现） */
export interface StageItemPruneClient {
  path_generation_stage_items: {
    deleteMany: (args: {
      where: { run: { learningPathId: string }; runId: { not: string } };
    }) => Promise<unknown>;
  };
}

/**
 * 清理被取代 run 遗留的 stage items（重试不留脏行）。
 *
 * 背景：`path_generation_stage_items` 的唯一约束是 `[runId, stageNumber]`，
 * 而一次 stageDesign 失败后重试会产生**新的 runId**，两轮的 stage items 并存 ⇒
 * 同阶段出现互相矛盾的状态行（`succeeded/4` 与 `succeeded/6`）与永不解决的
 * `processing/0` 废弃行（实测 74 个「路径×阶段」组合、20/118 条路径受影响）。
 *
 * 语义：replace 模式下本轮 run 取代此前所有尝试，故清掉非本轮 run 的行
 * （与 `path-generation.core.ts` 的孤儿清理同口径）；
 * **append 模式不清**——其行是既有阶段的追加记录，不是被取代的尝试。
 */
export async function pruneSupersededStageItems(
  client: StageItemPruneClient,
  pathId: string,
  runId: string,
  options: { appendOnly?: boolean } = {},
): Promise<number> {
  if (options.appendOnly) return 0;
  const result: any = await client.path_generation_stage_items.deleteMany({
    where: { run: { learningPathId: pathId }, runId: { not: runId } },
  });
  return Number(result?.count) || 0;
}

export async function enrichLearningPathWithAnderson(
  pathId: string,
  runId: string,
  data: GeneratePathData,
  analysis: any,
  options: {
    appendOnly?: boolean;
    /**
     * 渐进式（批次 D）：restrict 到指定阶段（stage N 完成后只设计 N+1）；
     * true 时 designer 输入带学习者信号、kc 走增量合并、template 记 _generation.progressive。
     */
    progressive?: boolean;
    restrictMilestoneIds?: string[];
    previousStageOutcome?: PreviousStageOutcome | null;
  } = {}
): Promise<void> {
  const startTime = Date.now();
  const triggerSource = data.sourceConversationId ? 'goal-conversation' : 'api';
  const progressive = options.progressive === true;
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
    // 渐进 restrict（批次 D）：显式指定目标阶段（跳过 listEmptyMilestoneIds 的全量空白枚举——
    // 渐进语义是「到哪设计哪」，不是「一次补齐所有空白」）。仍过滤掉非空阶段防御重复设计。
    const restrictMilestoneIds = Array.isArray(options.restrictMilestoneIds) ? options.restrictMilestoneIds : null;
    let appendMilestoneIds = appendOnly ? await listEmptyMilestoneIds(pathId) : [];
    if (restrictMilestoneIds) {
      const emptySet = new Set(appendOnly ? appendMilestoneIds : await listEmptyMilestoneIds(pathId));
      appendMilestoneIds = restrictMilestoneIds.filter((id) => emptySet.has(id));
    }
    if (appendOnly && appendMilestoneIds.length === 0) throw new Error('PATH_APPEND_NO_EMPTY_STAGE');
    await assertGenerationRunFence(prisma, pathId, runId);
    await assertPathMutationSafe(
      prisma,
      pathId,
      appendOnly ? 'append-tasks' : 'replace-tasks',
      appendOnly ? { milestoneIds: appendMilestoneIds } : {}
    );
    // 重试不留脏行：replace 语义下本轮 run 取代此前所有 stageDesign 尝试，
    // 但 stage items 的唯一约束是 [runId, stageNumber]，两轮 runId 不同故并存——
    // 导致同阶段出现互相矛盾的状态行（succeeded/4 与 succeeded/6）与永不解决的
    // processing/0 废弃行（实测 74 个「路径×阶段」组合、20/118 条路径受影响）。
    // 与 path-generation.core.ts 的孤儿清理同口径。
    await pruneSupersededStageItems(prisma, pathId, runId, { appendOnly });
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
    if (appendOnly || restrictMilestoneIds) {
      // 追加/渐进 restrict：只处理目标阶段，其余阶段一概不碰（不删除、不覆盖任何既有任务）。
      learningPath.milestones = learningPath.milestones.filter(
        (milestone) => appendMilestoneIds.includes(milestone.id)
      );
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
    // 出口不变量 B 的**下游一半**（2026-09-21）：Path 层已自检为"一次性操作"时，
    // 它产出的路径总量 ≤ 1 小时（见 path-planning 的"一次性操作"规则）。若不在这里
    // 把 hints 一起收紧，stage-designer 会按 standard 档默认 30–90 分钟/任务把学时撑回 7 小时
    // ——「学时 = 阶段数 × 每段任务数 × 单任务分钟」这条链必须两端都收。
    const oneSittingPath = Number.isFinite(Number(learningPath.estimatedHours))
      && Number(learningPath.estimatedHours) > 0
      && Number(learningPath.estimatedHours) <= ONE_SITTING_MAX_HOURS;
    if (oneSittingPath && normalizedInput && (normalizedInput as any).planningHints) {
      const before = (normalizedInput as any).planningHints;
      (normalizedInput as any).planningHints = clampHintsToOneSitting(before);
      logger.info('[stage-enrichment] 一次性操作：hints 收紧到一节课量级', {
        pathId: learningPath.id,
        estimatedHours: learningPath.estimatedHours,
        milestoneRange: (normalizedInput as any).planningHints.milestoneRange,
        subtasksPerStageRange: (normalizedInput as any).planningHints.subtasksPerStageRange,
        subtaskMinutesRange: (normalizedInput as any).planningHints.subtaskMinutesRange,
      });
    }
    const stageDesignerBaseInput = {
      cognitiveCore: pathCognitiveDesign,
      normalizedInput,
      // 资料 → 任务（下游 learn 的第一段）：把附件/联网资料**投影后**交给 stage-designer，
      // 让任务长在资料的具体章节/条目上，而不是只长在里程碑标题上。
      ...(extractPromptMaterials(normalizedInput, STAGE_MATERIAL_LIMITS)
        ? { materials: extractPromptMaterials(normalizedInput, STAGE_MATERIAL_LIMITS) }
        : {}),
    };
    const stageDesignRawOutputs: Record<string, any> = {};
    const stageDesignOutputs: Array<{
      milestoneId: string;
      stageNumber: number;
      subtasks: any[];
    }> = [];
    let designedTaskCount = 0;

    // 校内锚（2026-09-30 维度 G 评审）：学习者身处某套教材/考试体系时，把册次单元、
    // 考试范围、学校进度确定性抽取出来喂给 stage-designer（提示词规则 33 要求阶段目标与
    // 课标题引用）；抽取不到就不注入该键，非校内路径行为与原先完全一致。
    const pathSchoolAnchor = resolveSchoolAnchorForPathDesign(normalizedInput);
    if (pathSchoolAnchor) {
      logger.info('[school-anchor] 校内锚已解析，注入 stage-designer', {
        runId,
        textbook: pathSchoolAnchor.textbook,
        hasExamScope: !!pathSchoolAnchor.examScope,
        hasPace: !!pathSchoolAnchor.schoolPace,
      });
    }

    // 阶段任务设计并发度：串行 M 次 LLM 是纯时钟浪费；
    // 限流 2 路，兼顾 LLM 速率限制与 SQLite 写入串行化。
    const STAGE_DESIGN_CONCURRENCY = 2;
    inFlightStageItemIds = new Set<string>();
    let completedStageCount = 0;

    /**
     * 逐阶段任务锚（2026-09-28 去等分）：按**本阶段实际学时**反推该阶段该出几个任务，
     * 注入 planningHints.targetSubtasksForStage（stage-designer 规则 8 优先采用）。
     * 全局 targetSubtasksPerStage 按总学时均摊，配合「恰好 N 课」强规则会把路径切成
     * 5×10 式等分（真实案例：90h 预算 → 5×10，且单课分钟被扩容块顶穿会话档）。
     * 锚分钟取 targetMinutesPerTask（已被会话档钳过），缺省退分钟上界 / 60。
     */
    const buildStageHints = (milestone: { estimatedHours: number | null }): any | null => {
      const baseHints = (normalizedInput as any)?.planningHints || null;
      if (!baseHints) return null;
      const stageHours = Number(milestone.estimatedHours);
      if (!Number.isFinite(stageHours) || stageHours <= 0) return { ...baseHints };
      const anchorMinutes = Number(baseHints.targetMinutesPerTask)
        || Number(baseHints.subtaskMinutesRange?.[1])
        || 60;
      const cap = Number(baseHints.subtasksPerStageRange?.[1]) || 14;
      return {
        ...baseHints,
        targetSubtasksForStage: Math.max(2, Math.min(cap, Math.round((stageHours * 60) / anchorMinutes))),
      };
    };

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
      // 逐阶段任务锚（2026-09-28 去等分）：按本阶段实际学时反推 targetSubtasksForStage，
      // 替换共享 baseInput 里的全局 planningHints（全局锚按总学时均摊 + 「恰好 N 课」规则
      // = 5×10 式等分的来源）。clamp 用同一份逐阶段 hints，保证锚与硬上界一致。
      const stageHints = buildStageHints(milestone);
      const stageNormalizedInput = stageHints && (normalizedInput as any)
        ? { ...(normalizedInput as any), planningHints: stageHints }
        : normalizedInput;
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
        normalizedInput: stageNormalizedInput,
        // 渐进式（批次 D）：上一阶段的学习者账本信号——脆弱/挣扎概念、先修缺口、
        // wrapup 里仍未掌握的点。stage-designer 据此调整下一阶段的坡度与回补任务。
        ...(progressive && options.previousStageOutcome
          ? { previousStageOutcome: options.previousStageOutcome }
          : {}),
        repairHints: null,
        ...(pathSchoolAnchor ? { schoolAnchor: pathSchoolAnchor } : {}),
      };
      const stageResult = await executeSkill(stageDesignerDefinition, stageDesignerInput);

      const rawStageTasks = Array.isArray(stageResult?.subtasks) ? stageResult.subtasks : [];
      // hints 硬执行：模型把 subtasksPerStageRange 当软参考（实测 hints=[2,2] 仍给 5 任务/段），
      // 这里按上界兜底裁剪，否则体量锚在上端失效（输出不随锚变化 ⇒ 连校准都测不了）。
      let stageTasks = clampStageTasksToHints(rawStageTasks, stageHints || (normalizedInput as any)?.planningHints);
      if (stageTasks.length !== rawStageTasks.length) {
        logger.warn(`[stage-hints-clamp] 任务数按 hints 兜底裁剪：stage${milestone.stageNumber} ${rawStageTasks.length} → ${stageTasks.length}`);
      }
      // 补课（2026-09-30）：targetSubtasksForStage 是**下限**（提示词规则 30 早已写明），
      // 但模型惯性仍用长课时顶掉课数（法考案例：每阶段要 30 课、8 阶段 7 个只给 5-10 课，
      // 实交付 0.18×自述预算）。不足锚的 70% 时做**一次**补课调用，补的是清单外的新方向；
      // 同阶段标题近似的换皮课一律丢弃（评审实证：强填产同质化）。补不齐留缺口账，不硬塞。
      const wantedLessons = Number((stageHints as any)?.targetSubtasksForStage);
      let supplementAudit: Record<string, unknown> | null = null;
      if (needsLessonSupplement(stageTasks, wantedLessons)) {
        const initialCount = stageTasks.length;
        const supplementRequest = buildSupplementRequest(
          stageTasks,
          wantedLessons,
          milestone.stageNumber,
          ((stageHints as any)?.subtaskMinutesRange as [number, number]) || null,
        );
        const supplementResult = await executeSkill(stageDesignerDefinition, {
          ...stageDesignerInput,
          supplementRequest,
        }).catch((error: unknown) => {
          logger.warn(`[stage-supplement] 补课调用失败，保留原产出：stage${milestone.stageNumber}`, {
            runId,
            milestoneId: milestone.id,
            error: String(error).slice(0, 200),
          });
          return null;
        });
        const incoming = Array.isArray((supplementResult as any)?.subtasks)
          ? (supplementResult as any).subtasks
          : [];
        if (incoming.length > 0) {
          const { merged, added, dropped, dropReasons } = mergeSupplementTasks(stageTasks, incoming, {
            upper: Number((stageHints as any)?.subtasksPerStageRange?.[1]) || null,
            // 只补首轮缺失的动作族：新增课若把首轮整个认知弧原样重跑，学习者感知到的
            // 就是「同一件事换说法」（评审实证：类型分布逐族重复，字面相似度却 <0.5）。
            requireTypeNovelty: 'taskType',
          });
          if (added.length > 0) {
            stageTasks = clampStageTasksToHints(merged, stageHints || (normalizedInput as any)?.planningHints);
          }
          supplementAudit = {
            requested: wantedLessons,
            initial: initialCount,
            incoming: incoming.length,
            added: added.length,
            dropped: dropped.length,
            dropReasons,
            final: stageTasks.length,
          };
          logger.warn(`[stage-supplement] stage${milestone.stageNumber} 补课：要 ${wantedLessons} 首轮 ${initialCount} → 新增 ${added.length}（丢弃近重复 ${dropped.length}）→ ${stageTasks.length}`, {
            runId,
            milestoneId: milestone.id,
          });
        }
      }
      assertStageTasksPresent(milestone.stageNumber, stageTasks);
      // 校内锚覆盖观测（只 warn 不阻断）：阶段目标+课标题是否真的引用了教材册次/考试范围。
      // 评审实证：锚传进上下文却没落进任何阶段——这里把它变成可复盘的事实。
      if (pathSchoolAnchor) {
        const coverage = schoolAnchorCoverage(pathSchoolAnchor, [
          milestone.goal || milestone.title || '',
          ...stageTasks.map((t: any) => String(t?.title || '')),
        ]);
        if (!coverage.referenced) {
          logger.warn(`[school-anchor] stage${milestone.stageNumber} 阶段目标未引用锚要素：${coverage.missing.join('/')}`, {
            runId,
            milestoneId: milestone.id,
            textbook: pathSchoolAnchor.textbook,
          });
        }
      }
      stageDesignRawOutputs[`stage-${milestone.stageNumber}`] = {
        inputPayload: stageDesignerInput,
        rawModelOutput: stageResult?._debug?.rawModelOutput || null,
        extractedJson: stageResult?._debug?.extractedJson || null,
        normalizedOutput: {
          subtasks: stageTasks,
        },
        ...(supplementAudit ? { supplement: supplementAudit } : {}),
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

    // KC 映射（kc-mapper）：stage-designer 全部完成后，将概念与子任务分解为知识组件 + 依赖图，
    // 写回 aiPromptTemplate.kcAnnotation，结束"写后无读者"，供 teaching-turn 按 KC 粒度消费。
    // 契约收口在 kc-annotation 模块（executeSkillWithResult；2026-09-22 判空错配事故修复见该文件头注）。
    // 渐进式（批次 D）：单阶段输出走 **增量合并**（mergeKcStageAnnotation，v2 顶层与 v1 同形、
    // byStage 存阶段快照）——整包调用会把单阶段输出当全量覆写、抹掉其他阶段的 KC。
    // persist 注入 no-op：合并结果经本函数返回值交给下方 final 事务统一写 template（避免双写竞争）。
    let kcAnnotation: KcAnnotation | null;
    if (progressive) {
      const { executeSkillWithResult } = await import('../../../skills');
      const { kcMapperDefinition } = await import('../../../skills/kc-mapper');
      const kcParams = {
        pathId,
        userId: data.userId,
        template: parsedTemplate,
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
      };
      let stageKc: KcAnnotation | null = null;
      try {
        const kcResult = await executeSkillWithResult(kcMapperDefinition, {
          cognitiveCore: parsedTemplate?.cognitiveCore || parsedTemplate?.cognitiveDesign || null,
          milestones: kcParams.milestones,
          subtasks: kcParams.subtasks,
          prerequisiteTree: parsedTemplate?.cognitiveCore?.prerequisiteTree
            || parsedTemplate?.cognitiveDesign?.prerequisiteTree
            || null,
        });
        stageKc = kcResult?.success && kcResult?.output ? kcResult.output : null;
      } catch (kcError) {
        logger.warn('[stage-enrichment] 渐进 KC 映射失败（best-effort）', {
          pathId,
          error: kcError instanceof Error ? kcError.message : String(kcError),
        });
      }
      if (stageKc) {
        const currentTemplate = parsePathPromptTemplate(
          (await prisma.learning_paths.findUnique({
            where: { id: pathId },
            select: { aiPromptTemplate: true },
          }))?.aiPromptTemplate || null
        );
        kcAnnotation = mergeKcStageAnnotation(
          currentTemplate?.kcAnnotation as KcAnnotation | null,
          learningPath.milestones[0]?.stageNumber ?? 1,
          stageKc
        );
        try {
          await conceptGraphService.materializePathGraph({
            userId: data.userId,
            pathId,
            kcAnnotation,
            cognitiveCore: parsedTemplate?.cognitiveCore || parsedTemplate?.cognitiveDesign || null,
          });
        } catch (graphError) {
          logger.warn('[stage-enrichment] 渐进概念图物化失败（best-effort）', {
            pathId,
            error: graphError instanceof Error ? graphError.message : String(graphError),
          });
        }
      } else {
        kcAnnotation = null;
      }
    } else {
    kcAnnotation = await mapAndPersistKcAnnotation({
      pathId,
      userId: data.userId,
      template: parsePathPromptTemplate(learningPath.aiPromptTemplate || null),
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
    });
    }

    // 任务级资料引用收集（key = subtaskId；写进模板 JSON，不新增表列）
    const materialRefsByTask: Record<string, any[]> = {};
    // 任务级迷思预判收集（key = subtaskId；同 sidecar 模式，2026-09-26 课前注入）
    const misconceptionHintsByTask: Record<string, any[]> = {};

    // 概念身份预解析（canonical，best-effort）：**必须在事务外**——SQLite 下事务持有写锁，
    // 事务内再写 concepts/aliases 会撞锁。设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3.4
    //
    // 键必须与写入侧一致：写入用的是 `resolveTaskConcept(...).linkedConceptName`（命中认知设计时
    // 取**设计里的概念名**，非原始 linkedConcept 文本），故这里复用同一个解析函数取同一个值。
    // （首版误用原始文本做键 → 实测子任务 6/0 全部落空。）
    //
    // 只收 `conceptSource === 'linked-concept'`：回退文本（'fallback-text'）可能是 path 内局部序号
    // `concept-N`，把它当 canonical 注册会重造"同键不同义"污染（实测别名表出现 aliasRaw="concept-1"）。
    const subtaskConceptIds = new Map<string, string>();
    try {
      const names = stageDesignOutputs
        .flatMap((s) => s.subtasks)
        .map((t: any) => {
          const linked = typeof t?.linkedConcept === 'string' ? t.linkedConcept : null;
          const resolved = resolveTaskConcept(linked, pathCognitiveDesign, linked);
          return resolved.conceptSource === 'linked-concept' ? resolved.linkedConceptName : null;
        })
        .filter((name): name is string => !!name && !!name.trim());
      if (names.length > 0) {
        const resolved = await conceptRegistryService.resolveMany(data.userId, names, {
          source: 'write_time', level: 'concept', originPathId: pathId,
        });
        for (const [key, conceptId] of resolved) subtaskConceptIds.set(key, conceptId);
      }
    } catch (error) {
      logger.warn('[stage-enrichment] 子任务概念身份预解析失败（best-effort，conceptId 留空）', {
        pathId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await withTransaction(async (tx) => {
      // 事务可能因瞬时冲突整体重试：计数必须随每次尝试重置，避免重复累加
      designedTaskCount = 0;
      // 同理：资料引用收集器声明在事务外，重试不清空会把上一次尝试的条目累加进模板
      for (const key of Object.keys(materialRefsByTask)) delete materialRefsByTask[key];
      for (const key of Object.keys(misconceptionHintsByTask)) delete misconceptionHintsByTask[key];
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
        // R6-1 filler 观测（只观测不阻断）：R5 容量扩容后评审实证 filler ~10-15%
        //（同对象第三遍、同卡三遍、循环多跑轮次、回锅填空四模式）。强删会误伤合法
        // consolidation（同对象第二遍整合是设计内），故只落 log 供后续决策。
        const fillerReport = detectStageFiller(stageTasks as Array<{ title?: string }>);
        if (isStageFiller(fillerReport)) {
          logger.warn('[stage-enrichment] 阶段任务检出 filler 形态（观测，不阻断）', {
            pathId: learningPath.id,
            milestoneId: milestone.id,
            stageNumber: milestone.stageNumber,
            tasks: stageTasks.length,
            duplicatePairs: fillerReport.duplicatePairs.slice(0, 3).map((p) => `${p.a.slice(0, 18)}≈${p.b.slice(0, 18)}`),
            repeatedObjects: fillerReport.repeatedObjects.slice(0, 4).map((o) => `${o.object}×${o.hits}`),
          });
        }
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

          const subtaskId = `st_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${milestone.stageNumber}_${j}`;
          // 任务 → 资料条目（skill 侧已逐字核对）：按 subtaskId 落进 aiPromptTemplate.materialRefs.byTask
          if (Array.isArray((taskData as any).materialRefs) && (taskData as any).materialRefs.length) {
            materialRefsByTask[subtaskId] = (taskData as any).materialRefs;
          }
          // 任务 → 迷思预判（课前注入半条链）：规范化后按 subtaskId 落进 aiPromptTemplate.misconceptionHints.byTask
          if (Array.isArray((taskData as any).anticipatedMisconceptions) && (taskData as any).anticipatedMisconceptions.length) {
            misconceptionHintsByTask[subtaskId] = (taskData as any).anticipatedMisconceptions
              .map((hint: any) => ({
                conceptKey: typeof hint?.conceptKey === 'string' ? hint.conceptKey.trim() : '',
                label: typeof hint?.label === 'string' ? hint.label.trim() : '',
                why: typeof hint?.why === 'string' ? hint.why.trim() : '',
              }))
              .filter((hint: { conceptKey: string; label: string }) => hint.conceptKey && hint.label)
              .slice(0, 2);
          }
          await tx.subtasks.create({
            data: {
              id: subtaskId,
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
              // canonical 身份（事务外预解析；未命中留 null，回填脚本可补）
              conceptId: subtaskConceptIds.get(normalizeConceptKey(resolvedConcept.linkedConceptName)) ?? null,
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
          // R3 欠 fill 诚实声明：锚必须在回写前读（回写后 estimatedHours 即任务汇总，锚丢失）
          const fillNote = buildStageFillNote(
            Number(milestone.estimatedHours) || null,
            stageHours,
            (milestone as { description?: string | null }).description,
          );
          if (fillNote) {
            logger.info('[stage-enrichment] 阶段课时欠 fill，已追加容量说明', {
              pathId: learningPath.id,
              milestoneId: milestone.id,
              stageNumber: milestone.stageNumber,
              anchorHours: Number(milestone.estimatedHours) || null,
              stageHours,
            });
          }
          await tx.milestones.update({
            where: { id: milestone.id },
            data: {
              estimatedHours: stageHours,
              ...(fillNote ? { description: fillNote } : {}),
              updatedAt: new Date(),
            }
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
            ...(Object.keys(materialRefsByTask).length
              ? {
                  materialRefs: {
                    ...(parsedTemplate?.materialRefs && typeof parsedTemplate.materialRefs === 'object' ? parsedTemplate.materialRefs : {}),
                    // 追加/渐进设计**合并**既有 byTask（否则 stage N+1 的设计会抹掉 stage N 的
                    // 引用——append 不删既有任务，refs 也不能丢）；eager replace 保持整体替换
                    // （旧 subtaskId 已随 replace 失效，合并只会留垃圾键）。
                    byTask: (appendOnly || progressive)
                      ? {
                          ...((parsedTemplate?.materialRefs as any)?.byTask && typeof (parsedTemplate as any).materialRefs.byTask === 'object'
                            ? (parsedTemplate as any).materialRefs.byTask
                            : {}),
                          ...materialRefsByTask,
                        }
                      : materialRefsByTask,
                  },
                }
              : {}),
            ...(Object.keys(misconceptionHintsByTask).length
              ? {
                  // 迷思预判 sidecar：合并语义与 materialRefs 相同（append/progressive 保留旧任务）
                  misconceptionHints: {
                    ...(parsedTemplate?.misconceptionHints && typeof parsedTemplate.misconceptionHints === 'object' ? parsedTemplate.misconceptionHints : {}),
                    byTask: (appendOnly || progressive)
                      ? {
                          ...((parsedTemplate?.misconceptionHints as any)?.byTask && typeof (parsedTemplate as any).misconceptionHints.byTask === 'object'
                            ? (parsedTemplate as any).misconceptionHints.byTask
                            : {}),
                          ...misconceptionHintsByTask,
                        }
                      : misconceptionHintsByTask,
                  },
                }
              : {}),
            _generation: {
              ...(parsedTemplate?._generation && typeof parsedTemplate._generation === 'object' ? parsedTemplate._generation : {}),
              stageDesign: 'succeeded',
              kcMapping: kcAnnotation ? 'succeeded' : 'skipped',
              lastError: null,
              sourceConversationId: data.sourceConversationId || null,
              triggerSource,
              ...(progressive ? { progressive: true } : {}),
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

    // 跨阶段复读观测（2026-09-29 实测驱动，只观测不阻断）：单阶段检测看不见「同一节课排在
    // 相邻两个阶段」（实测 pe-rw-acad-05：M1-2 与 M2-1 相似度 0.739，两节课产出同一知识点）。
    // 渐进模式（每次只设计一个阶段）下也成立——这里读的是**库里全部阶段**的现状，不是本轮的产物。
    try {
      const stages = await prisma.milestones.findMany({
        where: { learningPathId: pathId },
        select: {
          stageNumber: true,
          subtasks: { select: { title: true }, orderBy: { order: 'asc' } },
        },
        orderBy: { stageNumber: 'asc' },
      });
      const crossReport = detectCrossStageFiller(
        stages.map((s: any) => ({ stageNumber: s.stageNumber, tasks: s.subtasks || [] })),
      );
      if (isCrossStageFiller(crossReport)) {
        logger.warn('[stage-enrichment] 跨阶段检出 filler 形态（观测，不阻断）', {
          pathId,
          pairs: crossReport.pairs.slice(0, 4).map((p) => `M${p.stageA}「${p.a.slice(0, 14)}」≈M${p.stageB}「${p.b.slice(0, 14)}」${p.similarity}`),
          repeatedObjects: crossReport.repeatedObjects.slice(0, 4).map((o) => `${o.object}×${o.hits}(M${o.stages.join(',')})`),
        });
      }
    } catch (error) {
      logger.warn('[stage-enrichment] 跨阶段 filler 观测失败（best-effort）', {
        pathId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

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

