import prisma from '../../config/database';
import learningStateService from '../learning/learning-state.service';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { teachingStrategyConfig } from '../../config/pedagogy.config';
import type { TeachingKnowledgePointState, TeachingSessionRecord } from './TeachingSessionRepository';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';
import { executeSkill } from '../../skills';
import { learningPredictorDefinition, type LearningPredictorOutput } from '../../skills/learning-predictor';
import { predictionCalibrationService } from '../learner/PredictionCalibrationService';
import { getActiveForConcepts } from '../learner/misconception-ledger.service';
import { logger } from '../../utils/logger';

export interface TeachingScenarioContext {
  userId: string;
  taskId: string;
  learningPathId: string;
  milestoneId: string;
  subject: string;
  topic: string;
  taskTitle: string;
  taskDescription: string;
  taskType: 'reading' | 'practice' | 'project' | 'quiz' | 'acquire' | 'deconstruct' | 'model' | 'execute' | 'diagnose' | 'refine' | 'consolidate';
  taskKnowledgeScope: {
    primaryConcepts: string[];
    prerequisiteConcepts: string[];
    supportingConcepts: string[];
  };
  taskKnowledgeSeeds: TeachingKnowledgePointState[];
  taskProfile: {
    knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
    cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
    displayLabel: string | null;
    learningObjectives: string[];
    coreConcept: string | null;
    linkedConceptId: string | null;
    linkedConceptName: string | null;
  };
  currentTaskContext: {
    description: string | null;
    acceptanceCriteria: string | null;
  };
  teachingStrategyGuidance: {
    knowledgeType: 'factual' | 'conceptual' | 'procedural' | 'metacognitive' | null;
    cognitiveLevel: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create' | null;
    objectiveFocus: string[];
    coreConcept: string | null;
    explanationStyle: string;
    interactionPattern: string;
    targetDepth: string;
    preferredStrategies: string[];
    responseConstraints: string[];
  };
  cognitiveFrame: {
    currentCoreConcept: {
      id: string | null;
      name: string | null;
      description: string | null;
    };
    prerequisiteConcepts: string[];
    neighboringConcepts: string[];
    targetRelation: string | null;
    milestoneIntent: string | null;
    transferGoal: string | null;
  };
  canStartLearning: boolean;
  learningBlockedReason: string | null;
  pathProgress: {
    pathTitle: string;
    pathSummary: string | null;
    currentMilestoneTitle: string;
    currentStageNumber: number;
    currentTaskOrder: number;
    totalTasksInMilestone: number;
  };
  learningState: {
    lss: number;
    ktl: number;
    lf: number;
    lsb: number;
  } | null;
  learnerProjection: TeachingLearnerProjection;
  pathContext: {
    pathTitle?: string;
    pathSummary?: string | null;
    subject?: string | null;
  };
  previousSession?: {
    sessionId: string;
    messages: TeachingSessionRecord['messages'];
    knowledgePoints: TeachingSessionRecord['knowledgeState'];
  } | null;
  /** 学习者在 goal 阶段自然流露的交付形式偏好（learning_signal），供开场/教学兑现承诺 */
  learningSignal: string | null;
  /** 同一路径上前序课程的摘要，供跨节承接（"老师记得我"）。
   *  源选择按路径位置：同阶段前一任务 → 上一阶段 → 同任务历史 → 最近任意完成课 */
  lastLessonRecap: {
    sourceTopic: string | null;
    topicSummary: string | null;
    retrievalCue: string | null;
    unresolvedPoints: string[];
    /** 与当前课的位置关系，供 LLM/UI 判断怎么承接 */
    relation: 'same-milestone-prev-task' | 'prev-milestone' | 'same-task' | 'last-any';
    /** 来源课所在阶段号/标题（null = 不可得） */
    sourceStageNumber?: number | null;
    sourceMilestoneTitle?: string | null;
    sourceTaskTitle?: string | null;
    /** 同任务历史：当前任务自己学过的上一轮（用于"同任务重学接续自己的历史"） */
    sameTaskHistory?: {
      attemptCount: number;
      lastStatus: string;
      lastEndTime: string | null;
      lastSummary: string | null;
      lastUnresolvedPoints: string[];
      lastActionPlan: string[];
    } | null;
  } | null;
  /** 结构化前序学习上下文（供开场 UI/承接叙事消费，lastLessonRecap 的富化版） */
  priorLearningContext: {
    hasPriorLearning: boolean;
    /** 紧邻前序（位置接续） */
    adjacent?: {
      relation: 'same-milestone-prev-task' | 'prev-milestone';
      stageNumber: number;
      milestoneTitle: string;
      taskTitle: string;
      topicSummary: string | null;
      retrievalCue: string | null;
      unresolvedPoints: string[];
      actionPlan: string[];
      newlyMastered: string[];
      stillLearning: string[];
    } | null;
    /** 当前任务自己的历史 */
    sameTask?: {
      attemptCount: number;
      lastStatus: string;
      lastSummary: string | null;
      lastUnresolved: string[];
      lastActionPlan: string[];
      lastEndTime: string | null;
    } | null;
    /** 前序阶段总体掌握（milestoneProgress 汇总） */
    priorMilestoneMastery: Array<{
      stageNumber: number;
      title: string;
      masteryState: 'unknown' | 'partial' | 'stable' | 'at-risk';
      completedTasks: number;
      totalTasks: number;
    }>;
  } | null;
  /**
   * 交互特征情报（认知负荷量测 · 前端情报层）：
   * 本轮学生输入的打字节奏统计 + 近 5 轮学生消息特征对比，缺失字段为 undefined（absent）。
   * 仅供 LLM 结合文本语义判断 loadIndex，不参与任何规则计算。
   */
  interactionProfile: {
    current: InteractionMetaRecord | null;
    history: InteractionHistoryEntry[];
    absent: boolean;
  } | null;
  /**
   * 学习表现预测（任务前，learning-predictor 产出 + 校准实证可靠性）。
   * 超时/失败/低样本时为 null——教学照常，不得因预测缺失改变行为。
   */
  learnerPrediction: LearnerPredictionContext | null;
  /** 历史误解（G-R-R Phase 2）：当前任务相关概念的活跃误解，供教学回合引用（"你上次在这里犯过类似的错"） */
  priorMisconceptions: Array<{
    conceptKey: string;
    hypothesis: string;
    canonicalLabel: string | null;
    confidence: number;
    status: string;
    occurrenceCount: number;
  }> | null;
  /** 任务模式：normal（默认教学）| productiveFailure（有效失败：先让学生挣扎，后整合） */
  taskMode?: 'normal' | 'productiveFailure';
  /** 行为投影器（LLM-KT Behavioral Dynamics Projector）：近期回合级行为动态压缩 */
  behavioralProfile: {
    avgUnderstanding: number | null;
    avgLoadIndex: number | null;
    avgEngagement: number | null;
    dominantEmotion: string | null;
    frustrationRate: number | null;
    knowledgeMasteryEma: number | null;
    sampleSize: number;
  } | null;
}

/** 预测上下文（P2 闭环：预测 + 实证可靠性一起交给教学 Agent） */
export interface LearnerPredictionContext {
  stallRisk: number;
  predictedTone: 'smooth' | 'struggle' | 'fatigue';
  suggestedDepth: 'shallow' | 'standard' | 'deep';
  focusConcepts: string[];
  rationale: string;
  /** 实证可靠性（来自校准记录，不是 LLM 自报）；样本不足（<5）为 null */
  reliability: { total: number; stallHitRate: number | null } | null;
}

/**
 * 前端交互特征（认知负荷量测）：前端在输入框聚合的统计值，随消息提交。
 * 全部为可选数值；缺失字段在 prompt 层按 absent 处理。
 */
export interface InteractionMetaRecord {
  draftMs?: number;
  idleMsBefore?: number;
  lastIdleMs?: number;
  editingCount?: number;
  deleteCount?: number;
  charsPerSentence?: number;
}

/** 近轮消息的交互特征对比条目（供 LLM 判断相对异动，替代统计基线） */
export interface InteractionHistoryEntry {
  role: 'user' | 'assistant';
  timestamp: string;
  meta?: InteractionMetaRecord | null;
  textLength: number;
}

/** 仅提取每条消息中可用的数值特征（meta 中的合法数字字段） */
function extractInteractionMeta(message: { meta?: InteractionMetaRecord | null }): InteractionMetaRecord | null {
  if (!message.meta || typeof message.meta !== 'object') return null;
  const meta: InteractionMetaRecord = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(message.meta)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      (meta as Record<string, number>)[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? meta : null;
}

/** 组装 interactionProfile：本轮特征 + 近 5 轮特征对比（供 LLM 判断相对异动，替代统计基线） */
function buildInteractionProfile(
  interactionMeta: InteractionMetaRecord | null | undefined,
  messages: TeachingSessionRecord['messages']
): TeachingScenarioContext['interactionProfile'] {
  const history: InteractionHistoryEntry[] = [];
  const recent = messages.slice(-6);
  for (const message of recent) {
    history.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      timestamp: message.timestamp,
      meta: extractInteractionMeta(message as { meta?: InteractionMetaRecord | null }),
      textLength: typeof message.content === 'string' ? message.content.length : 0,
    });
  }
  const current = extractInteractionMeta({ meta: interactionMeta ?? null });
  return { current, history, absent: current === null };
}

function parseJsonSafe(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parsePathSummary(raw: string | null | undefined): string | null {
  const parsed = parseJsonSafe(raw);
  const summary = parsed?.summary;
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
}

function parsePathPromptTemplate(raw: string | null | undefined): any {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function dedupeConcepts(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeConcept(value)).filter(Boolean) as string[]));
}

function parsePathPromptTemplateCore(path: any) {
  const promptTemplate = parsePathPromptTemplate(path?.aiPromptTemplate);
  // #9 退役：统一读 cognitiveCore（旧数据需先跑 scripts/migrate-cognitive-core.ts 迁移）
  return promptTemplate?.cognitiveCore || null;
}

/** 从 kcAnnotation.taskKcLinks 解析当前任务的细粒度知识组件（KC）列表（kc-mapper 下游激活 3b） */
function resolveTaskKcsFromPath(task: any, path: any): Array<{ kcId: string; name: string; taxonomy: string }> {
  try {
    const template = path?.aiPromptTemplate ? JSON.parse(path.aiPromptTemplate) : {};
    const kcAnnotation = template?.kcAnnotation;
    if (!kcAnnotation || typeof kcAnnotation !== 'object') return [];
    const taskKcLinks = Array.isArray(kcAnnotation.taskKcLinks) ? kcAnnotation.taskKcLinks : [];
    const matched = taskKcLinks.find((link: any) => normalizeConcept(link?.taskTitle) === normalizeConcept(task?.title));
    if (!matched || !Array.isArray(matched.linkedKCs)) return [];
    const kcGraphNodes = Array.isArray(kcAnnotation.kcGraph?.nodes) ? kcAnnotation.kcGraph.nodes : [];
    return matched.linkedKCs.map((kcId: any) => {
      const node = kcGraphNodes.find((n: any) => normalizeConcept(n?.kcId) === normalizeConcept(kcId));
      return {
        kcId: normalizeConcept(kcId) || String(kcId || ''),
        name: normalizeConcept(node?.name) || '',
        taxonomy: normalizeConcept(node?.taxonomy) || '',
      };
    }).filter((item: any) => item.kcId);
  } catch {
    return [];
  }
}

function resolveTaskConceptFromPath(task: any, path: any): { id: string | null; name: string | null; description: string | null } {
  const linkedConceptId = normalizeConcept((task as any).linkedConceptId || (task as any).coreConcept);
  const cognitiveCore = parsePathPromptTemplateCore(path);
  const concepts = Array.isArray(cognitiveCore?.coreConcepts) ? cognitiveCore.coreConcepts : [];

  if (linkedConceptId) {
    const matched = concepts.find((concept: any) => normalizeConcept(concept?.id) === linkedConceptId);
    if (matched) {
      return {
        id: normalizeConcept(matched.id),
        name: normalizeConcept(matched.name),
        description: normalizeConcept(matched.description)
      };
    }
  }

  return {
    id: linkedConceptId,
    name: normalizeConcept((task as any).linkedConceptName) || linkedConceptId,
    description: null
  };
}

function buildCognitiveFrame(params: {
  task: any;
  milestone: any;
  path: any;
  resolvedConcept: { id: string | null; name: string | null; description: string | null };
  primaryConcepts: string[];
  prerequisiteConcepts: string[];
  taskProfile: TeachingScenarioContext['taskProfile'];
}) {
  const { task, milestone, path, resolvedConcept, primaryConcepts, prerequisiteConcepts, taskProfile } = params;
  const cognitiveCore = parsePathPromptTemplateCore(path);
  const coreConcepts = Array.isArray(cognitiveCore?.coreConcepts) ? cognitiveCore.coreConcepts : [];
  const currentConceptId = normalizeConcept(resolvedConcept.id);
  const currentConceptName = normalizeConcept(resolvedConcept.name);
  const neighboringConcepts = dedupeConcepts(
    coreConcepts
      .filter((concept: any) => {
        const conceptId = normalizeConcept(concept?.id);
        const conceptName = normalizeConcept(concept?.name);
        if (!conceptId && !conceptName) return false;
        return conceptId !== currentConceptId && conceptName !== currentConceptName;
      })
      .slice(0, 3)
      .map((concept: any) => normalizeConcept(concept?.name))
  );

  const milestoneIntent = normalizeConcept(
    milestone?.goal
    || milestone?.title
    || task?.milestones?.goal
    || task?.milestones?.title
    || null
  );
  const transferGoal = task?.transferable
    ? normalizeConcept(task?.description) || currentConceptName
    : null;
  const targetRelation = normalizeConcept(resolvedConcept.description)
    || currentConceptName
    || primaryConcepts[0]
    || null;

  return {
    currentCoreConcept: {
      id: currentConceptId,
      name: currentConceptName,
      description: normalizeConcept(resolvedConcept.description),
    },
    prerequisiteConcepts,
    neighboringConcepts,
    targetRelation,
    milestoneIntent,
    transferGoal,
  } as TeachingScenarioContext['cognitiveFrame'];
}

function parseLearningObjectives(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return dedupeConcepts(parsed.map((item) => String(item)));
    }
    if (typeof parsed === 'string') {
      return dedupeConcepts([parsed]);
    }
  } catch {
    return dedupeConcepts([raw]);
  }
  return [];
}



function buildTaskKnowledgeSeeds(_params: {
  task: any;
  resolvedConcept: { id: string | null; name: string | null; description: string | null };
}): TeachingKnowledgePointState[] {
  return [];
}

/** 有效失败（PF）触发条件：概念性任务 + 无既定学习目标（新概念）+ 有迁移目标 + 练习/项目型 */
function determineTaskMode(
  task: any,
  persistedLearningObjectives: string[],
  cognitiveFrame: { targetRelation: string | null },
): 'normal' | 'productiveFailure' {
  const isConceptual = task.knowledgeType === 'conceptual';
  const isNewConcept = persistedLearningObjectives.length === 0;
  const hasTransferGoal = cognitiveFrame.targetRelation !== null;
  const isPracticeOrProject = task.taskType === 'practice' || task.taskType === 'project';
  if (isConceptual && isNewConcept && hasTransferGoal && isPracticeOrProject) {
    return 'productiveFailure';
  }
  return 'normal';
}

/**
 * 拉取前序课程摘要（跨节承接数据源），按路径位置选择：
 * 1) 同 milestone 前一任务（同阶段内顺序接续）
 * 2) 上一 milestone 最近完成课（跨阶段接续）
 * 3) 当前任务自己的历史（同任务重学，attemptCount ≥ 2 才有）
 * 4) 回退：同路径最近完成课（原行为，但带 relation='last-any'）
 * 只取轻量字段，任何异常都静默降级为 null，不影响开课主流程。
 */
export async function fetchPriorLearningRecap(params: {  userId: string;
  learningPathId: string;
  currentMilestoneId: string;
  currentTaskId: string;
  currentStageNumber: number;
  milestoneTitle: string;
}): Promise<{ recap: TeachingScenarioContext['lastLessonRecap']; sameTaskSessions: number }> {
  const {
    userId,
    learningPathId,
    currentMilestoneId,
    currentTaskId,
    currentStageNumber,
    milestoneTitle,
  } = params;
  const empty = (): { recap: null; sameTaskSessions: 0 } => ({ recap: null, sameTaskSessions: 0 });

  try {
    // 同路径阶段顺序
    const pathMilestones = await prisma.milestones.findMany({
      where: { learningPathId },
      orderBy: { stageNumber: 'asc' },
      select: { id: true, stageNumber: true, title: true },
    });
    if (!pathMilestones.length) return empty();
    const currentIdx = pathMilestones.findIndex((m) => m.id === currentMilestoneId);
    const prevMilestone = currentIdx > 0 ? pathMilestones[currentIdx - 1] : null;

    // 当前 milestone 内前一任务（不含当前）
    const tasksInMilestone = await prisma.subtasks.findMany({
      where: { milestoneId: currentMilestoneId, userId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true },
    });
    const currentTaskPos = tasksInMilestone.findIndex((t) => t.id === currentTaskId);
    const prevTaskInMilestone = currentTaskPos > 0 ? tasksInMilestone[currentTaskPos - 1] : null;

    // 同任务历史（当前任务自己学过的所有终态会话）
    const sameTaskSessions = await prisma.teaching_sessions.findMany({
      where: {
        userId,
        taskId: currentTaskId,
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { endTime: 'desc' },
      select: { topic: true, wrapup: true, endTime: true, status: true },
    });
    const sameTaskLatest = sameTaskSessions[0] || null;
    const sameTaskWrapup = sameTaskLatest ? parseJsonSafe(sameTaskLatest.wrapup as any) : null;
    const sameTaskUnresolved = sameTaskWrapup
      ? (Array.isArray(sameTaskWrapup.knowledgeItems)
          ? (sameTaskWrapup.knowledgeItems as any[])
              .filter((item: any) => item && typeof item.name === 'string' && item.name.trim() && item.status !== 'mastered')
              .map((item: any) => String(item.name).trim())
              .slice(0, 3)
          : [])
      : [];
    const sameTaskActionPlan = sameTaskWrapup && Array.isArray(sameTaskWrapup.actionPlan)
      ? sameTaskWrapup.actionPlan.filter((item: any) => typeof item === 'string' && item.trim()).slice(0, 3)
      : [];

    // 从教学会话里提取 recap 数据
    const toRecap = (session: any, relation: TeachingScenarioContext['lastLessonRecap']['relation']) => {
      const wrapup = session.wrapup ? parseJsonSafe(session.wrapup) : null;
      if (!wrapup) return null;
      const actionPlan = Array.isArray(wrapup.actionPlan)
        ? wrapup.actionPlan.filter((item: any) => typeof item === 'string' && item.trim())
        : [];
      const knowledgeItems = Array.isArray(wrapup.knowledgeItems) ? wrapup.knowledgeItems : [];
      const unresolvedPoints = knowledgeItems
        .filter((item: any) => item && typeof item.name === 'string' && item.name.trim() && item.status !== 'mastered')
        .map((item: any) => String(item.name).trim())
        .slice(0, 3);
      return {
        sourceTopic: typeof session.topic === 'string' && session.topic.trim() ? session.topic.trim() : null,
        topicSummary: typeof wrapup.topicSummary === 'string' && wrapup.topicSummary.trim() ? wrapup.topicSummary.trim() : null,
        retrievalCue: actionPlan[0] || null,
        unresolvedPoints,
        relation,
        sameTaskHistory: relation === 'same-task'
          ? {
              attemptCount: sameTaskSessions.length,
              lastStatus: sameTaskLatest?.status || '',
              lastEndTime: sameTaskLatest?.endTime?.toISOString?.() || null,
              lastSummary: (typeof wrapup.topicSummary === 'string' && wrapup.topicSummary.trim()) ? wrapup.topicSummary.trim() : null,
              lastUnresolvedPoints: unresolvedPoints,
              lastActionPlan: actionPlan.slice(0, 3),
            }
          : undefined,
      };
    };

    // 候选源：同 milestone 前一任务（同路径最近完成课，且属于前一任务）
    // → 上一 milestone 最近完成课 → 同任务历史 → 全路径最近完成课
    const prevTaskSessions = prevTaskInMilestone
      ? await prisma.teaching_sessions.findFirst({
          where: {
            userId,
            learningPathId,
            taskId: prevTaskInMilestone.id,
            status: 'completed',
            wrapup: { not: null },
          },
          orderBy: { endTime: 'desc' },
          select: { topic: true, wrapup: true },
        })
      : null;
    if (prevTaskSessions) {
      const recap = toRecap(prevTaskSessions, 'same-milestone-prev-task');
      if (recap) {
        return {
          recap: {
            ...recap,
            sourceStageNumber: currentStageNumber,
            sourceMilestoneTitle: milestoneTitle,
            sourceTaskTitle: prevTaskInMilestone?.title || null,
          },
          sameTaskSessions: sameTaskSessions.length,
        };
      }
    }

    // 上一 milestone：取该 milestone 下最近完成课
    if (prevMilestone) {
      const prevMsRecentTaskIds = await prisma.subtasks.findMany({
        where: { milestoneId: prevMilestone.id, userId },
        select: { id: true },
      });
      const prevMsSessions = prevMsRecentTaskIds.length
        ? await prisma.teaching_sessions.findFirst({
            where: {
              userId,
              learningPathId,
              taskId: { in: prevMsRecentTaskIds.map((t: any) => t.id) },
              status: 'completed',
              wrapup: { not: null },
            },
            orderBy: { endTime: 'desc' },
            select: { topic: true, wrapup: true },
          })
        : null;
      if (prevMsSessions) {
        const recap = toRecap(prevMsSessions, 'prev-milestone');
        if (recap) {
          return {
            recap: {
              ...recap,
              sourceStageNumber: prevMilestone.stageNumber,
              sourceMilestoneTitle: prevMilestone.title,
              sourceTaskTitle: null,
            },
            sameTaskSessions: sameTaskSessions.length,
          };
        }
      }
    }

    // 同任务历史（第二/多次学同一任务）
    if (sameTaskSessions.length > 0 && sameTaskWrapup) {
      const recap = toRecap(sameTaskLatest, 'same-task');
      if (recap) {
        return {
          recap: {
            ...recap,
            sourceStageNumber: currentStageNumber,
            sourceMilestoneTitle: milestoneTitle,
            sourceTaskTitle: null,
          },
          sameTaskSessions: sameTaskSessions.length,
        };
      }
    }

    // 回退：同路径最近完成课（排除当前任务，原行为）
    const lastEnded = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        learningPathId,
        taskId: { not: currentTaskId },
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { endTime: 'desc' },
      select: { topic: true, wrapup: true },
    });
    if (lastEnded) {
      const recap = toRecap(lastEnded, 'last-any');
      if (recap) return { recap, sameTaskSessions: sameTaskSessions.length };
    }
    return { recap: null, sameTaskSessions: sameTaskSessions.length };
  } catch (error) {
    logger.warn('[TeachingContext] 拉取前序课程摘要失败（静默降级）', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      learningPathId,
    });
    return empty();
  }
}

/** 汇总前序阶段掌握（供 priorLearningContext.priorMilestoneMastery） */
function buildPriorMilestoneMastery(learnerSnapshot: any): TeachingScenarioContext['priorLearningContext'] extends infer _ ? NonNullable<TeachingScenarioContext['priorLearningContext']>['priorMilestoneMastery'] : never {
  const progress = learnerSnapshot?.knowledgeMemory?.currentPath?.milestoneProgress;
  if (!Array.isArray(progress)) return [];
  return progress
    .filter((item: any) => item && typeof item.stageNumber === 'number' && typeof item.masteryState === 'string')
    .map((item: any) => ({
      stageNumber: item.stageNumber,
      title: typeof item.title === 'string' ? item.title : '',
      masteryState: item.masteryState,
      completedTasks: typeof item.completedTasks === 'number' ? item.completedTasks : 0,
      totalTasks: typeof item.totalTasks === 'number' ? item.totalTasks : 0,
    }));
}

function buildTeachingStrategyGuidance(taskProfile: TeachingScenarioContext['taskProfile']) {  const knowledgeType = taskProfile.knowledgeType;
  const cognitiveLevel = taskProfile.cognitiveLevel;
  const objectiveFocus = taskProfile.learningObjectives.slice(0, 4);
  const coreConcept = taskProfile.coreConcept;

  const knowledgeGuidance = knowledgeType && teachingStrategyConfig.byKnowledgeType[knowledgeType]
    ? teachingStrategyConfig.byKnowledgeType[knowledgeType]
    : {
        explanationStyle: teachingStrategyConfig.defaults.explanationStyle,
        interactionPattern: teachingStrategyConfig.defaults.interactionPattern,
        preferredStrategies: teachingStrategyConfig.defaults.preferredStrategies,
        responseConstraints: [] as string[],
      };

  const levelGuidance = cognitiveLevel && teachingStrategyConfig.byCognitiveLevel[cognitiveLevel]
    ? teachingStrategyConfig.byCognitiveLevel[cognitiveLevel]
    : {
        targetDepth: teachingStrategyConfig.defaults.targetDepth,
        responseConstraints: [] as string[],
      };

  return {
    knowledgeType,
    cognitiveLevel,
    objectiveFocus,
    coreConcept,
    explanationStyle: knowledgeGuidance.explanationStyle,
    interactionPattern: knowledgeGuidance.interactionPattern,
    targetDepth: levelGuidance.targetDepth,
    preferredStrategies: knowledgeGuidance.preferredStrategies,
    responseConstraints: [
      ...knowledgeGuidance.responseConstraints,
      ...levelGuidance.responseConstraints,
    ],
  };
}

export async function buildTeachingScenarioContext(
  userId: string,
  taskId: string,
  previousSession?: TeachingSessionRecord | null,
  interactionMeta?: InteractionMetaRecord | null
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

  const runtimeLearningState = previousSession?.status === 'active'
    ? learningStateService.coerceMetrics(previousSession.teachingState)
    : null;
  const learningState = runtimeLearningState || await learningStateService.getCurrentState(userId);
  const learnerSnapshot = await learnerSnapshotRefreshService.getLatest({
    userId,
    pathId: path.id,
    milestoneId: task.milestoneId,
    taskId: task.id,
    scope: 'teaching',
  });
  const learnerProjection = learnerProjectionService.toTeachingProjection(learnerSnapshot);
  const resolvedConcept = resolveTaskConceptFromPath(task, path);
  const persistedLearningObjectives = parseLearningObjectives((task as any).learningObjectives);
  const taskKnowledgeSeeds = buildTaskKnowledgeSeeds({ task, resolvedConcept });
  const primaryConcepts = persistedLearningObjectives.length > 0
    ? persistedLearningObjectives
    : taskKnowledgeSeeds.map((point) => point.name).slice(0, 2);
  const prerequisiteConcepts = (learnerSnapshot.knowledgeMemory.currentPath?.prerequisiteGaps || [])
    .map((item) => item.label)
    .filter((label) => primaryConcepts.some((concept) => label.includes(concept) || concept.includes(label)))
    .slice(0, 2);

  const canStartLearning = previousSession?.status === 'active'
    ? true
    : path.status === 'active';
  const learningSignalRaw = (learnerSnapshot.profile as any)?.narratives?.learningSignal;
  const learningSignal = typeof learningSignalRaw === 'string' && learningSignalRaw.trim()
    ? learningSignalRaw.trim()
    : null;
  const behavioralProfile = await fetchBehavioralProfile(userId);
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
  const cognitiveFrame = buildCognitiveFrame({
    task,
    milestone,
    path,
    resolvedConcept,
    primaryConcepts,
    prerequisiteConcepts,
    taskProfile,
  });
  const supportingConcepts = dedupeConcepts([
    ...cognitiveFrame.neighboringConcepts,
    ...prerequisiteConcepts,
  ]).filter((concept) => !primaryConcepts.includes(concept)).slice(0, 3);
  // 误解台账（G-R-R Phase 2）：拉取当前任务相关概念的活跃误解，注入教学上下文
  const priorMisconceptions = await getActiveForConcepts(userId, [
    ...primaryConcepts,
    ...prerequisiteConcepts,
    ...supportingConcepts,
  ], 5).then((rows) => rows.length > 0 ? rows.map((r) => ({
    conceptKey: r.conceptKey,
    hypothesis: r.hypothesis,
    canonicalLabel: r.canonicalLabel,
    confidence: r.confidence,
    status: r.status,
    occurrenceCount: r.occurrenceCount,
  })) : null);
  const orderedTasks = Array.isArray(milestone?.subtasks) ? milestone.subtasks : [];
  const currentTaskOrder = typeof (task as any).order === 'number'
    ? (task as any).order
    : Math.max(1, orderedTasks.findIndex((item: any) => item.id === task.id) + 1);

  // 前序学习上下文：按路径位置接续（同阶段前一任务 → 上一阶段 → 同任务历史 → 最近任意）
  const { recap: lastLessonRecap, sameTaskSessions } = await fetchPriorLearningRecap({
    userId,
    learningPathId: path.id,
    currentMilestoneId: task.milestoneId,
    currentTaskId: task.id,
    currentStageNumber: Number.isFinite(Number(milestone.stageNumber)) ? Number(milestone.stageNumber) : 1,
    milestoneTitle: milestone.title || milestone.goal || '当前阶段',
  });
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
    taskKcs: resolveTaskKcsFromPath(task, path),
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
    learningState: learningState ? {
      lss: learningState.lss,
      ktl: learningState.ktl,
      lf: learningState.lf,
      lsb: learningState.lsb,
    } : null,
    learnerProjection,
    pathContext: {
      pathTitle: path.title || path.name,
      pathSummary: parsePathSummary(path.aiPromptTemplate),
      subject: path.subject,
    },
    previousSession: previousSession ? {
      sessionId: previousSession.id,
      messages: previousSession.messages,
        knowledgePoints: previousSession.knowledgeState,
      } : null,
    learningSignal,
    lastLessonRecap,
    priorLearningContext,
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
    fatigueSignal: learningState ? (learningState.lf >= 6 ? 'high' : learningState.lf >= 4 ? 'medium' : 'low') : undefined,
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
      executeSkill(learningPredictorDefinition, {
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
async function fetchBehavioralProfile(userId: string): Promise<TeachingScenarioContext['behavioralProfile']> {
  try {
    const recentSessions = await prisma.teaching_sessions.findMany({
      where: { userId, status: 'completed' },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { messages: true },
    });
    const allAnalysis: any[] = [];
    for (const session of recentSessions) {
      const msgs = Array.isArray(session.messages) ? session.messages : [];
      for (const msg of msgs) {
        if (msg.role === 'assistant' && msg.analysis) allAnalysis.push(msg.analysis);
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

    return {
      avgUnderstanding: understandings.length > 0 ? Math.round(avg(understandings) * 100) / 100 : null,
      avgLoadIndex: loadIndices.length > 0 ? Math.round(avg(loadIndices) * 100) / 100 : null,
      avgEngagement: engagements.length > 0 ? Math.round(avg(engagements) * 100) / 100 : null,
      dominantEmotion,
      frustrationRate: emotions.length > 0 ? Math.round((frustratedCount / emotions.length) * 100) / 100 : null,
      knowledgeMasteryEma: ktMasteryAvg !== null ? Math.round(ktMasteryAvg * 100) / 100 : null,
      sampleSize: allAnalysis.length,
    };
  } catch { return null; }
}
