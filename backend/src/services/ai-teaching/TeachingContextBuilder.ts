import prisma from '../../config/database';
import learningStateService from '../learning/learning-state.service';
import { learnerSnapshotService } from '../learner/LearnerSnapshotService';
import { teachingStrategyConfig } from '../../config/pedagogy.config';
import type { TeachingKnowledgePointState, TeachingSessionRecord } from './TeachingSessionRepository';
import { learnerProjectionService } from '../learner/LearnerProjectionService';
import type { TeachingLearnerProjection } from '../../agents/learner-model-agent/types';

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
  /** 同一路径上最近一节已完结课程的摘要，供跨节承接（"老师记得我"） */
  lastLessonRecap: {
    sourceTopic: string | null;
    topicSummary: string | null;
    retrievalCue: string | null;
    unresolvedPoints: string[];
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
  return promptTemplate?.cognitiveCore || promptTemplate?.cognitiveDesign || null;
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

/**
 * 拉取同一路径上最近一节已完结课程的摘要（跨节承接数据源）。
 * 只取轻量字段，任何异常都静默降级为 null，不影响开课主流程。
 */
async function fetchLastLessonRecap(
  userId: string,
  learningPathId: string,
  currentTaskId: string
): Promise<TeachingScenarioContext['lastLessonRecap']> {
  try {
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
    const wrapup = lastEnded ? parseJsonSafe(lastEnded.wrapup as any) : null;
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
      sourceTopic: typeof lastEnded?.topic === 'string' && lastEnded.topic.trim() ? lastEnded.topic.trim() : null,
      topicSummary: typeof wrapup.topicSummary === 'string' && wrapup.topicSummary.trim() ? wrapup.topicSummary.trim() : null,
      retrievalCue: actionPlan[0] || null,
      unresolvedPoints,
    };
  } catch {
    return null;
  }
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
  const learnerSnapshot = await learnerSnapshotService.getSnapshot({
    userId,
    learningPathId: path.id,
    milestoneId: task.milestoneId,
    taskId: task.id,
    mode: 'teaching',
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
  const lastLessonRecap = await fetchLastLessonRecap(userId, path.id, task.id);
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
  const orderedTasks = Array.isArray(milestone?.subtasks) ? milestone.subtasks : [];
  const currentTaskOrder = typeof (task as any).order === 'number'
    ? (task as any).order
    : Math.max(1, orderedTasks.findIndex((item: any) => item.id === task.id) + 1);

  return {
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
    interactionProfile: buildInteractionProfile(interactionMeta, previousSession?.messages ?? []),
  };
}
