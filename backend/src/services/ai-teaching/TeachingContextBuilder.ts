import prisma from '../../config/database';
import { loadTeachingMessagesForIds } from './teaching-session-message-store';
import learningStateService from '../learning/learning-state.service';
import { getSceneFramingNormalizedInput, resolveNormalizedInputSnapshot, resolvePersistedNormalizedInput } from '../learning/learning.helpers';
import { extractPromptMaterials, TEACHING_MATERIAL_LIMITS, type PromptMaterial } from '../materials/material-prompt-projection';
import { extractSectionWindow, type ActiveTaskMaterialExcerpt } from '../materials/material-sections';
import { isMaterialSemanticEnabled, recallMaterialChunks } from '../materials/material-semantic.service';
import { findWebRecordBySourceUrl } from '../materials/material-web-ingest.service';
import { readMaterial } from '../materials/material-store';
import { learnerSnapshotRefreshService, type LearnerSnapshotRefreshInput } from '../learner/LearnerSnapshotRefreshService';
import { teachingStrategyConfig } from '../../config/pedagogy.config';
import type { TeachingKnowledgePointState, TeachingSessionRecord } from './TeachingSessionRepository';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import { decideTaskDifficulty, resolveBaselineLevel } from '../learner/TaskDifficultyAdjustmentService';
import { classifyLoad } from '../learning/learning-load-verdict';
import { resolveSuccessBandVerdict } from '../learner/independent-success-band.service';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { executeSkill } from '../../skills';
import { learningPredictorDefinition, type LearningPredictorOutput } from '../../skills/learning-predictor';
import { predictionCalibrationService } from '../learner/PredictionCalibrationService';
import { getActiveForConcepts } from '../learner/misconception-ledger.service';
import type { ReviewPlan } from '../memory/review-plan.service';
import { buildMasteredLastSeenAtMap } from './anchor-probe-emit';
import { logger } from '../../utils/logger';
import { conceptRegistryService } from '../learner/concept-registry.service';
import { conceptGraphService, RELATION_PREREQUISITE, RELATION_PART_OF } from '../learner/concept-graph.service';
// 2026-10-24 架构优化批 1 拆分：类型与纯助手迁至 teaching-context-* 四模块；此处再导出保持既有导入路径
import {
  buildInteractionProfile,
  buildCognitiveFrame,
  buildTaskKnowledgeSeeds,
  dedupeConcepts,
  determineTaskMode,
  fetchGraphNeighbors,
  normalizeConcept,
  parseLearningObjectives,
  parsePathSummary,
  pickPrerequisiteConcepts,
  resolveTaskConceptFromPath,
  resolveTaskKcsFromPath,
} from './teaching-context-knowledge';
import {
  buildPriorMilestoneMastery,
  computeTemporalGap,
  fetchLatestPriorSessionEndTime,
  fetchPriorLearningRecap,
  readRecentFrustrationStreak,
  resolveTemporalLongGapThresholdDays,
} from './teaching-context-recap';
import {
  buildPlannedMisconceptionRows,
  buildTeachingStrategyGuidance,
  resolveActiveTaskMaterialExcerpts,
  resolvePathMaterialsForTeaching,
  resolveSchoolAnchorForTeaching,
  resolveTaskMisconceptionHints,
} from './teaching-context-materials';
import type {
  InteractionMetaRecord,
  LearnerPredictionContext,
  TeachingScenarioContext,
} from './teaching-context-types';
export * from './teaching-context-types';
export * from './teaching-context-knowledge';
export * from './teaching-context-recap';
export * from './teaching-context-materials';
export async function loadLearnerSnapshotForContext(
  input: LearnerSnapshotRefreshInput,
  options?: { forceLearnerSnapshotRefresh?: boolean },
) {
  return options?.forceLearnerSnapshotRefresh
    ? learnerSnapshotRefreshService.refresh(input)
    : learnerSnapshotRefreshService.getLatest(input);
}

export async function buildTeachingScenarioContext(
  userId: string,
  taskId: string,
  previousSession?: TeachingSessionRecord | null,
  interactionMeta?: InteractionMetaRecord | null,
  options?: {
    /**
     * #52 P-26 ①：终评（wrapup/收束）必须用**收束时刻重算**的快照，
     * 不能复用本轮判「是否可完成」时读到的缓存快照。终评先于判完成的旧口径
     * 会让「判完成看到的掌握度」与「终评写回的掌握度」错位。
     */
    forceLearnerSnapshotRefresh?: boolean;
  }
): Promise<TeachingScenarioContext> {
  const task = await prisma.subtasks.findUnique({
    where: { id: taskId },
    include: {
      milestones: {
        include: {
          subtasks: {
            orderBy: { order: 'asc' },
          },
          learning_paths: true,
        }
      }
    }
  });

  if (!task || !task.milestones?.learning_paths) {
    throw new Error('任务不存在');
  }

  const path = task.milestones.learning_paths;
  if (path.userId !== userId) {
    throw new Error('无权访问此任务');
  }

  // 续课（active 会话）同样走自然衰减：跨日恢复一节没结完的课时，不能把上次课内最后一回合的
  // runtime 值原样当先验（此前直读 teachingState，跨日恢复会带着"昨天的疲劳"上课）。
  // restoreMetrics 按日粒度折算：同日续课 dayDiff=0 无影响，仅跨日恢复生效。
  const resumedLearningState = previousSession?.status === 'active'
    ? learningStateService.coerceMetrics(previousSession.teachingState)
    : null;
  const runtimeLearningState = resumedLearningState
    ? learningStateService.restoreMetrics(resumedLearningState)
    : null;
  const learningState = runtimeLearningState || await learningStateService.getCurrentState(userId);
  const learnerSnapshotInput = {
    userId,
    pathId: path.id,
    milestoneId: task.milestoneId,
    taskId: task.id,
    scope: 'teaching' as const,
  };
  const learnerSnapshot = await loadLearnerSnapshotForContext(learnerSnapshotInput, options);
  const learnerProjection = learnerProjectionService.toTeachingProjection(learnerSnapshot, {
    // 任务级难度：由学习者状态（课内=本路径、全局=总负担）确定档位，代码判定、可审计（不用 LLM）
    taskDifficulty: decideTaskDifficulty({
      baselineLevel: resolveBaselineLevel({
        cognitiveLoad: (task as any).cognitiveLoad,
        cognitiveLevel: (task as any).cognitiveLevel,
      }),
      globalMetrics: learnerSnapshot.dynamicState.metrics,
      lessonMetrics: learnerSnapshot.dynamicState.lessonMetrics ?? null,
      learningControlState: learnerSnapshot.learningControlState,
      fatigueRisk: learnerSnapshot.dynamicState.fatigueRisk,
      recommendedPacing: learnerSnapshot.dynamicState.recommendedPacing,
      knowledgeSignals: {
        fragileCount: learnerSnapshot.knowledgeMemory.globalSignals.fragileConcepts.length,
        strugglingCount: learnerSnapshot.knowledgeMemory.globalSignals.strugglingConcepts.length,
        // #59/#60 第 6 条：只有高严重度卡点/真缺口才否决升档
        severeStrugglingCount: learnerSnapshot.knowledgeMemory.globalSignals.severeStrugglingConcepts.length,
        prerequisiteGapCount: learnerSnapshot.knowledgeMemory.currentPath?.prerequisiteGaps.length ?? 0,
      },
      // 情感（软传感器，§4.5）：取**上一节课**留下的连续受挫轮数——软传感器只允许降档/减速，
      // 服务内部把它归入 LOAD_BASED_DECREASE_REASONS（结构上不可能成为升档依据）。
      recentFrustrationStreak: readRecentFrustrationStreak(previousSession),
      // 独立成功率带（§7 P1-1）：只用**代码裁决**的检查点结果驱动档位；
      // 无样本 → hold → 退回旧的 canIncrease 口径（行为与改造前一致）
      successBand: await resolveSuccessBandVerdict(userId, { pathId: path.id }).catch(() => null),
    }),
  });
  // Q8 延迟锚题数据供给修复：从**未截断**的权威来源为所有已掌握概念派生 lastSeenAt。
  // 优先 currentPath.conceptStates（全量、正是 masteredConcepts 的出处），再并入全局账本；
  // 两条都不受 recentConceptLedger.slice(0,12)（乃至账本内部 40/60 条）截断——否则排在后面的
  // 老概念永远拿不到时间戳，延迟锚题在真实长跑中永不触发。只在此处查表（probe 保持纯函数无 I/O）。
  const anchorMasteredLastSeenAt = buildMasteredLastSeenAtMap(
    [
      ...(learnerSnapshot.knowledgeMemory.currentPath?.conceptStates ?? []),
      ...learnerSnapshot.knowledgeMemory.globalBackground.conceptLedger,
    ],
    learnerSnapshot.knowledgeMemory.globalSignals.masteredConcepts,
  );
  const resolvedConcept = resolveTaskConceptFromPath(task, path);
  const persistedLearningObjectives = parseLearningObjectives((task as any).learningObjectives);
  const taskKnowledgeSeeds = buildTaskKnowledgeSeeds({ task, path, resolvedConcept });
  const primaryConcepts = persistedLearningObjectives.length > 0
    ? persistedLearningObjectives
    : taskKnowledgeSeeds.map((point) => point.name).slice(0, 2);
  // 前置概念：`prerequisiteGaps` 本来就是按**本任务**的上游闭包算出来的，`source==='graph'` 可直接采用。
  // 回落口径（`source==='fallback'`）给的是"本任务自身薄弱概念"，不是前置 → 只保留能对上本课概念的（旧行为）。
  // 锚点不再只依赖 `primaryConcepts`：它曾恒为空，使这一格结构性永远为空（2026-09-23 修）。
  const prerequisiteAnchor = primaryConcepts.length > 0
    ? primaryConcepts
    : [normalizeConcept(resolvedConcept.name)].filter((name): name is string => !!name);
  const prerequisiteConcepts = pickPrerequisiteConcepts(
    learnerSnapshot.knowledgeMemory.currentPath?.prerequisiteGaps || [],
    prerequisiteAnchor,
  );

  const canStartLearning = previousSession?.status === 'active'
    ? true
    : path.status === 'active';
  const learningSignalRaw = (learnerSnapshot.profile as any)?.narratives?.learningSignal;
  const learningSignal = typeof learningSignalRaw === 'string' && learningSignalRaw.trim()
    ? learningSignalRaw.trim()
    : null;
  // 开场画像摘要（2026-10-14）：goal 阶段的叙述性理解此前只有 learningSignal 一根管子通到教学层，
  // 开场生成器只能看到课程文本+三个运行信号（实测两条不同人设 VL 的首课载荷逐字节相同，
  // 「个性化」全靠采样运气）。这里把画像压成最小摘要带出；叙述按 narrativeSource 单目标留存，
  // 不做跨目标并集。全程可选：无 goal 对话数据时为 null。
  const personaNarratives = learnerSnapshot.profile?.narratives;
  const personaInsights = learnerSnapshot.profile?.narrativeInsights;
  const personaStr = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;
  const learnerPersona: TeachingScenarioContext['learnerPersona'] = (personaNarratives || personaInsights)
    ? {
        surfaceGoal: personaStr(personaNarratives?.surfaceGoal),
        realProblem: personaStr(personaNarratives?.realProblem),
        background: personaStr(personaNarratives?.backgroundExperience) ?? personaStr(personaInsights?.backgroundContextNote),
        currentLevel: personaStr(personaNarratives?.currentLevel) ?? personaStr(personaInsights?.selfAssessmentNote),
        motivation: personaStr(personaNarratives?.motivation) ?? personaStr(personaInsights?.motivationNarrative),
        sourceGoal: personaStr(learnerSnapshot.profile?.narrativeSource?.goalTitle),
      }
    : null;
  // 传入本节课（进行中）会话：行为画像/求助软拦截必须看到"本课内"的表现（18 号报告 N9）
  const behavioralProfile = await fetchBehavioralProfile(userId, previousSession);
  const milestone = task.milestones;
  const taskProfile = {
    knowledgeType: (task as any).knowledgeType || null,
    cognitiveLevel: (task as any).cognitiveLevel || null,
    displayLabel: (task as any).displayLabel || null,
    learningObjectives: primaryConcepts,
    coreConcept: resolvedConcept.name,
    linkedConceptId: resolvedConcept.id,
    linkedConceptName: resolvedConcept.name,
  } as TeachingScenarioContext['taskProfile'];
  // 概念图 1-hop 邻域（L3 接入）：优先用物化后的 concept_edges 拿"有语义依据的邻居"
  // （前置优先——教学需要先唤醒基础），图缺失/无邻居时回落旧行为（见 buildCognitiveFrame 内的兜底）。
  const graphNeighbors = await fetchGraphNeighbors({
    userId,
    pathId: path.id,
    conceptName: resolvedConcept.name,
  });
  const cognitiveFrame = buildCognitiveFrame({
    task,
    milestone,
    path,
    resolvedConcept,
    primaryConcepts,
    prerequisiteConcepts,
    taskProfile,
    graphNeighbors,
  });
  // 本课知识组件（kc-mapper 拆出的最小单元）：既是注入字段，也参与误解台账检索——
  // 台账的 conceptKey 往往就是 KC 名（教学回合按 KC 粒度报误解），只按上面三个概念槽位去查
  // 会一条都拉不到；模型看不到既往标签就只能每轮重编一个 hypothesis（实测 22 行里 6 行标签为 null）。
  const taskKcs = resolveTaskKcsFromPath(task, path);
  const supportingConcepts = dedupeConcepts([
    ...cognitiveFrame.neighboringConcepts,
    ...prerequisiteConcepts,
  ])
    // 三个槽位各占其位：本课概念（primary）与前置（prerequisite）已有自己的格子，
    // 不再重复出现在"支撑概念"里（前置恒空时看不出，前置修好后会重复）。
    .filter((concept) => !primaryConcepts.includes(concept) && !prerequisiteConcepts.includes(concept))
    .slice(0, 3);
  // 误解台账（G-R-R Phase 2）：拉取当前任务相关概念的活跃误解，注入教学上下文
  // 2026-09-26 课前注入：任务设计期的迷思预判（source='planned'）合成进同一通道，
  // teaching-turn 按 source 区分话术（预判→诊断性提问；已观察→可引用过往错误）
  const priorMisconceptions = await getActiveForConcepts(userId, dedupeConcepts([
    ...primaryConcepts,
    ...prerequisiteConcepts,
    ...supportingConcepts,
    ...taskKcs.map((kc) => kc.name).filter((name) => !!name),
  ]), 5).then((rows) => {
    const observed = rows.map((r) => ({
      conceptKey: r.conceptKey,
      hypothesis: r.hypothesis,
      canonicalLabel: r.canonicalLabel,
      confidence: r.confidence,
      status: r.status,
      occurrenceCount: r.occurrenceCount,
      source: 'observed' as const,
    }));
    const planned = buildPlannedMisconceptionRows(resolveTaskMisconceptionHints({
      aiPromptTemplate: path.aiPromptTemplate,
      taskId: task.id,
    }));
    const merged = [...observed, ...planned];
    return merged.length > 0 ? merged : null;
  });
  const orderedTasks = Array.isArray(milestone?.subtasks) ? milestone.subtasks : [];
  const currentTaskOrder = typeof (task as any).order === 'number'
    ? (task as any).order
    : Math.max(1, orderedTasks.findIndex((item: any) => item.id === task.id) + 1);

  // 前序学习上下文：按路径位置接续（同阶段前一任务 → 上一阶段 → 同任务历史 → 最近任意）
  const { recap: lastLessonRecap, sameTaskSessions, lastSourceEndTime } = await fetchPriorLearningRecap({
    userId,
    learningPathId: path.id,
    currentMilestoneId: task.milestoneId,
    currentTaskId: task.id,
    currentStageNumber: Number.isFinite(Number(milestone.stageNumber)) ? Number(milestone.stageNumber) : 1,
    milestoneTitle: milestone.title || milestone.goal || '当前阶段',
  });
  // 真实侧时间信号：优先"同路径最近一节已完成课"的 endTime；查询无果/异常时兜底用 recap 源课 endTime。
  // 无任何前序（含 endTime）→ null，调用方省略 controls.temporalGap，行为与改造前一致。
  const latestPriorSessionEndTime = await fetchLatestPriorSessionEndTime({
    userId,
    learningPathId: path.id,
    excludeSessionId: previousSession?.id ?? null,
  });
  const temporalGap = computeTemporalGap(
    latestPriorSessionEndTime ?? lastSourceEndTime,
    new Date(),
    resolveTemporalLongGapThresholdDays(process.env.TEACHING_TEMPORAL_LONG_GAP_DAYS),
  );
  const priorMilestoneMastery = buildPriorMilestoneMastery(learnerSnapshot);
  const priorLearningContext: TeachingScenarioContext['priorLearningContext'] = (lastLessonRecap || sameTaskSessions > 0 || priorMilestoneMastery.length > 0)
    ? {
        hasPriorLearning: true,
        adjacent: lastLessonRecap && (lastLessonRecap.relation === 'same-milestone-prev-task' || lastLessonRecap.relation === 'prev-milestone')
          ? {
              relation: lastLessonRecap.relation,
              stageNumber: lastLessonRecap.sourceStageNumber ?? 0,
              milestoneTitle: lastLessonRecap.sourceMilestoneTitle || '',
              taskTitle: lastLessonRecap.sourceTaskTitle || '',
              topicSummary: lastLessonRecap.topicSummary,
              retrievalCue: lastLessonRecap.retrievalCue,
              unresolvedPoints: lastLessonRecap.unresolvedPoints,
              actionPlan: lastLessonRecap.sameTaskHistory?.lastActionPlan || [],
              newlyMastered: [],
              stillLearning: lastLessonRecap.unresolvedPoints,
            }
          : null,
        sameTask: sameTaskSessions > 0 && lastLessonRecap?.relation === 'same-task'
          ? {
              attemptCount: sameTaskSessions,
              lastStatus: lastLessonRecap.sameTaskHistory?.lastStatus || 'completed',
              lastSummary: lastLessonRecap.sameTaskHistory?.lastSummary || null,
              lastUnresolved: lastLessonRecap.sameTaskHistory?.lastUnresolvedPoints || [],
              lastActionPlan: lastLessonRecap.sameTaskHistory?.lastActionPlan || [],
              lastEndTime: lastLessonRecap.sameTaskHistory?.lastEndTime || null,
            }
          : null,
        priorMilestoneMastery,
      }
    : null;

  // 诊断洞察回注（设计 §4：top-N active insights）：只读投影、不调 LLM；失败即视为无洞察。
  // 动态 import 避免与 LearnerStateReviewService 形成静态循环依赖（同 sandbox-resolver 的既有写法）。
  let learnerInsights: TeachingScenarioContext['learnerInsights'] = null;
  try {
    const { learnerStateReviewService } = await import('../learner/LearnerStateReviewService');
    const insights = await learnerStateReviewService.getActiveInsights(userId, path.id, { limit: 3 });
    if (insights.length > 0) {
      learnerInsights = insights;
      logger.info('[teaching-context] 注入活跃诊断洞察', {
        userId,
        pathId: path.id,
        count: insights.length,
        types: insights.map((item) => item.type),
      });
    }
  } catch (error) {
    logger.warn('[teaching-context] 诊断洞察注入失败（教学照常）', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const context = {
    userId,
    taskId: task.id,
    learningPathId: path.id,
    milestoneId: task.milestoneId,
    subject: path.subject || '综合',
    topic: task.title,
    taskTitle: task.title,
    taskDescription: task.description || '',
    taskType: (task.taskType as 'reading' | 'practice' | 'project' | 'quiz') || 'practice',
    taskKnowledgeScope: {
      primaryConcepts,
      prerequisiteConcepts,
      supportingConcepts,
    },
    taskKcs,
    taskKnowledgeSeeds,
    taskProfile,
    currentTaskContext: {
      description: task.description || null,
      acceptanceCriteria: (task as any).acceptanceCriteria || null,
    },
    teachingStrategyGuidance: buildTeachingStrategyGuidance(taskProfile),
    cognitiveFrame,
    canStartLearning,
    learningBlockedReason: canStartLearning ? null : '学习内容还在准备中，请稍候再开始学习',
    pathProgress: {
      pathTitle: path.title || path.name || '当前学习路径',
      pathSummary: parsePathSummary(path.aiPromptTemplate),
      currentMilestoneTitle: milestone.title || milestone.goal || '当前阶段',
      currentStageNumber: Number.isFinite(Number(milestone.stageNumber)) ? Number(milestone.stageNumber) : 1,
      currentTaskOrder,
      totalTasksInMilestone: orderedTasks.length,
    },
    schoolAnchor: resolveSchoolAnchorForTeaching(path.aiPromptTemplate) ?? { background: null, baselineEvidence: null },
    learnerPersona,
    learningState: learningState ? {
      lss: learningState.lss,
      ktl: learningState.ktl,
      lf: learningState.lf,
      lsb: learningState.lsb,
    } : null,
    learnerProjection,
    anchorMasteredLastSeenAt,
    pathContext: {
      pathTitle: path.title || path.name,
      pathSummary: parsePathSummary(path.aiPromptTemplate),
      subject: path.subject,
    },
    // 资料 → 课堂：从路径模板里取回资料包并投影（见 resolvePathMaterialsForTeaching）
    materials: resolvePathMaterialsForTeaching(path.aiPromptTemplate),
    // 章节 → 课堂：当前任务引用的章节原文窗口（按章节取回；无引用时语义兜底，两者皆空则 null）
    activeTaskMaterialExcerpts: await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: path.aiPromptTemplate,
      taskId: task.id,
      userId,
      // 语义召回的查询词 = 本任务标题 + 描述（结构化引用缺失/未命中时的兜底依据）
      query: [task.title, task.description].filter(Boolean).join(' '),
    }),
    previousSession: previousSession ? {
      sessionId: previousSession.id,
      messages: previousSession.messages,
        knowledgePoints: previousSession.knowledgeState,
      } : null,
    learningSignal,
    lastLessonRecap,
    temporalGap,
    priorLearningContext,
    learnerInsights,
    interactionProfile: buildInteractionProfile(interactionMeta, previousSession?.messages ?? []),
    learnerPrediction: null,
    priorMisconceptions,
    taskMode: determineTaskMode(task, persistedLearningObjectives, cognitiveFrame),
    behavioralProfile,
  };

  // 学习表现预测（P2 闭环）：幂等复用 + 超时保护；结果直接进入教学上下文
  // - 已有该任务未回写的预测记录 → 复用（重试/恢复不重复调 LLM）
  // - 无 → await LLM 预测（≤8s，超时降级 null）→ 记录校准行
  // - 失败/超时 → null，教学照常
  context.learnerPrediction = await buildLearnerPrediction(userId, path.id, task.id, milestone?.id, previousSession?.id, {
    fatigueSignal: learningState ? classifyLoad({ ktl: learningState.ktl, lf: learningState.lf }).fatigueRisk : undefined,
    taskContext: {
      title: task.title,
      knowledgeType: (task as any).knowledgeType,
      learningObjectives: primaryConcepts,
    },
  });

  return context;
}

/** 预测超时（LLM 调用 3-8s，8s 封顶保证会话创建不被拖死） */
const PREDICTION_TIMEOUT_MS = 8000;
/** 实证可靠性的最低样本数：低于此值不给 reliability（防小样本误导） */
export const PREDICTION_RELIABILITY_MIN_SAMPLE = 5;

/** 幂等获取/生成学习表现预测：优先复用未回写记录，否则调 LLM 并记录（超时→null） */
async function buildLearnerPrediction(
  userId: string,
  pathId: string,
  taskId: string,
  milestoneId: string | undefined,
  sessionId: string | undefined,
  opts: {
    fatigueSignal?: 'low' | 'medium' | 'high';
    taskContext: { title: string; knowledgeType?: string; learningObjectives?: string[] };
  },
): Promise<LearnerPredictionContext | null> {
  try {
    // 1) 幂等复用：该任务已有未回写的预测 → 直接用（零 LLM 成本）
    const existing = await prisma.prediction_records.findFirst({
      where: { userId, taskId, outcome: null },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return await withReliability(userId, {
        stallRisk: existing.stallRisk,
        predictedTone: existing.predictedTone as LearnerPredictionContext['predictedTone'],
        suggestedDepth: existing.suggestedDepth as LearnerPredictionContext['suggestedDepth'],
        focusConcepts: safeParseStringArray(existing.focusConcepts),
        rationale: existing.rationale,
      });
    }

    // 2) 无记录 → LLM 预测（读取最近知识状态摘要）+ 超时保护
    const summary = await fetchLatestKnowledgeSummary(userId);
    const prediction = (await Promise.race([
      executeSkill(learningPredictorDefinition, process.env.PAYLOAD_STABLE_PREFIX !== '0'
        ? {
            fatigueSignal: opts.fatigueSignal || 'low',
            knowledgeStateSummary: summary || '无历史摘要',
            taskContext: opts.taskContext,
          }
        : {
            knowledgeStateSummary: summary || '无历史摘要',
            fatigueSignal: opts.fatigueSignal || 'low',
            taskContext: opts.taskContext,
          }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PREDICTION_TIMEOUT_MS)),
    ])) as LearningPredictorOutput | null;

    if (!prediction) return null;

    // 3) 记录校准行（await：保证 outcome 回写时能找到记录）
    await predictionCalibrationService.recordPrediction({
      userId,
      pathId,
      taskId,
      milestoneId: milestoneId || undefined,
      sessionId: sessionId || undefined,
      prediction,
      summaryEcho: summary?.slice(0, 300),
    });

    return await withReliability(userId, prediction);
  } catch (error) {
    logger.debug('[TeachingContext] 学习表现预测失败（非阻塞）', {
      userId, taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 附加实证可靠性（样本 ≥ MIN 才给，防小样本误导） */
async function withReliability(userId: string, prediction: LearningPredictorOutput): Promise<LearnerPredictionContext> {
  try {
    const stats = await predictionCalibrationService.empiricalStats(userId);
    const reliable = stats.total >= PREDICTION_RELIABILITY_MIN_SAMPLE
      ? { total: stats.total, stallHitRate: stats.stallHitRate }
      : null;
    return { ...prediction, reliability: reliable };
  } catch {
    return { ...prediction, reliability: null };
  }
}

function safeParseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** 从最近一次 session-knowledge-distilled 证据中读取知识状态摘要 */
async function fetchLatestKnowledgeSummary(userId: string): Promise<string | undefined> {
  try {
    const row = await prisma.learner_evidence.findFirst({
      where: { userId, evidenceType: 'session-knowledge-distilled' },
      orderBy: { occurredAt: 'desc' },
      select: { payload: true },
    });
    if (!row) return undefined;
    const parsed = JSON.parse(row.payload);
    return typeof parsed.knowledgeStateSummary === 'string' && parsed.knowledgeStateSummary.trim()
      ? parsed.knowledgeStateSummary.trim()
      : undefined;
  } catch { return undefined; }
}

/** 行为投影器（LLM-KT Behavioral Dynamics Projector）：近期回合级行为动态压缩 */
export async function fetchBehavioralProfile(
  userId: string,
  currentSession?: { messages?: unknown } | null,
): Promise<TeachingScenarioContext['behavioralProfile']> {
  try {
    // messages 大列已侧表化（2026-10-01 列裁剪）：直读热表大列会让本查询拖上
    // 全表 246MB 的 blob 页（实测列表基础扫描 3.5s），改走 store 权威读 + 批量。
    const recentSessions = await prisma.teaching_sessions.findMany({
      where: { userId, status: 'completed' },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      // messages 保留作回退源（侧表无行的老会话）；侧表有行即权威内容。
      // 直读不再整包扫热表——列已在 2026-10-01 侧表化清理中置 NULL（仅侧表有行的会话）。
      select: { id: true, messages: true },
    });
    const messagesById = await loadTeachingMessagesForIds(recentSessions.map((s) => s.id));
    // **本节课（进行中）的消息也必须计入**（18 号报告 N9）：求助软拦截最需要生效的场景正是
    // "本节课里连续直接要答案"，而此前只统计 status='completed' 的历史会话 → 本节课计数恒为 0。
    // 顺序按时间升序（历史由旧到新 + 本节课最后），这样 `recentHelpSeeking.slice(-5)` 取的是最近 5 条。
    const orderedMessageLists: unknown[][] = [
      ...[...recentSessions]
        .reverse()
        .map((session) => messagesById.get(session.id) ?? (Array.isArray(session.messages) ? session.messages : [])),
      ...(currentSession && Array.isArray(currentSession.messages) ? [currentSession.messages] : []),
    ];
    const allAnalysis: any[] = [];
    for (const msgs of orderedMessageLists) {
      for (const msg of msgs as any[]) {
        if (msg?.role === 'assistant' && msg?.analysis) allAnalysis.push(msg.analysis);
      }
    }
    if (allAnalysis.length === 0) return null;

    const avg = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length || 0;
    const understandings = allAnalysis.map((a) => a.understanding).filter((v) => Number.isFinite(v));
    const loadIndices = allAnalysis.map((a) => a.loadIndex).filter((v) => Number.isFinite(v));
    const engagements = allAnalysis.map((a) => a.engagement).filter((v) => Number.isFinite(v));
    const emotions = allAnalysis.map((a) => a.emotionalState).filter((v) => typeof v === 'string');
    const frustratedCount = emotions.filter((e) => e === 'frustrated').length;

    const ktEmaRows = await prisma.memory_traces.findMany({
      where: { userId, ktMasteryEma: { not: null } },
      select: { ktMasteryEma: true },
    });
    const ktMasteryAvg = ktEmaRows.length > 0
      ? ktEmaRows.reduce((sum, r) => sum + (r.ktMasteryEma ?? 0), 0) / ktEmaRows.length
      : null;

    // 主导情绪
    const emotionCounts = new Map<string, number>();
    for (const e of emotions) emotionCounts.set(e, (emotionCounts.get(e) || 0) + 1);
    let dominantEmotion: string | null = null;
    let maxCount = 0;
    for (const [e, count] of emotionCounts) { if (count > maxCount) { maxCount = count; dominantEmotion = e; } }

    // 求助行为（2026-09-17 起被消费；此前 teaching-turn 每轮产出 helpSeekingType 却没人读，审计 §5.2 P2 尾巴）：
    // 只给"最近几轮的原话 + 次数"，供提示词做**软拦截**——学生反复直接要答案时，先给最小提示/反问，
    // 而不是把答案交出去（该字段的产出方注释本就写着"供后台统计与软拦截"）。
    const helpSeeking = allAnalysis
      .map((analysis) => (typeof analysis?.helpSeekingType === 'string' ? analysis.helpSeekingType.trim() : ''))
      .filter((value) => value.length > 0);

    return {
      avgUnderstanding: understandings.length > 0 ? Math.round(avg(understandings) * 100) / 100 : null,
      avgLoadIndex: loadIndices.length > 0 ? Math.round(avg(loadIndices) * 100) / 100 : null,
      avgEngagement: engagements.length > 0 ? Math.round(avg(engagements) * 100) / 100 : null,
      dominantEmotion,
      frustrationRate: emotions.length > 0 ? Math.round((frustratedCount / emotions.length) * 100) / 100 : null,
      knowledgeMasteryEma: ktMasteryAvg !== null ? Math.round(ktMasteryAvg * 100) / 100 : null,
      sampleSize: allAnalysis.length,
      ...(helpSeeking.length > 0
        ? { recentHelpSeeking: helpSeeking.slice(-5), helpSeekingCount: helpSeeking.length }
        : {}),
    };
  } catch { return null; }
}

