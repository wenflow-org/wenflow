/**
 * 虚拟学习者记忆回写与读取（三链统一：assisted / blackbox / quick-learn）
 *
 * 目标：让虚拟学习者「记得自己学过什么、做过什么」。
 * - writeProfileConceptsAfterLesson：课后把知识看板状态回写画像
 *   （mastered → knownConcepts；review/learning → struggleConcepts），
 *   三链共用，修复「黑盒跑完整个故事画像零更新」。
 * - buildLearnerMemorySnapshot：读取画像 + memory_traces（ACT-R 到期复习点），
 *   组装「学习者记忆快照」供 learn-turn-simulator 的 knowledgeSnapshot 消费，
 *   让虚拟学习者带着「上次学的我还记得/有点忘了」的状态上下一节课。
 * - recordCompletedArtifact：任务结算时登记「做完的事」（轻量成果物记录），
 *   故事与开场可引用，让「做完了」在虚拟学习者世界里持续存在。
 *
 * 设计边界：只做虚拟学习者侧的记忆/成果物，不改教学系统。
 * best-effort：任何失败都不阻断主流程。
 */

import prisma from '../config/database';
import { logger } from '../utils/logger';
import { memoryTraceService } from '../services/memory/memory-trace.service';

/** 轻量 JSON 解析（不依赖 session-factory，避免经 blackbox-runner 的循环依赖） */
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** 与教学端 KnowledgePointStatus 对齐的知识看板条目 */
export interface LessonKnowledgePoint {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

/**
 * 模拟器自述的学习者状态（learn-turn-simulator 输出，收束轮持久化在私有状态轨迹里）。
 * 这是虚拟学习者「自己觉得」的状态——内部提炼的记忆来源。
 */
export interface SelfReportedLearnerState {
  /** 本节课概念（知识看板当前点，学习者自评的对照物） */
  conceptName?: string | null;
  /** 概念掌握自评 0-1（learnerState.conceptualMastery） */
  conceptualMastery?: number | null;
  /** 任务理解自评 0-1（learnerState.taskUnderstanding） */
  taskUnderstanding?: number | null;
  /** 程序性掌握自评 0-1（learnerState.proceduralMastery） */
  proceduralMastery?: number | null;
  /** 是否自认任务已完成（learnerFeedback.selfReportedTaskDone） */
  selfReportedTaskDone?: boolean | null;
  /** 自评信心 0-1（learnerFeedback.confidence） */
  confidence?: number | null;
  /** 还想要更多帮助（learnerFeedback.wantsMoreHelp） */
  wantsMoreHelp?: boolean | null;
  /** 剩余的卡点（learnerFeedback.remainingBlockers） */
  remainingBlockers?: string[] | null;
  /** 是否想要提示（learnerState.wantsHint） */
  wantsHint?: boolean | null;
}

/**
 * 内部提炼：从虚拟学习者自述状态判断「自己觉得学会了什么 / 卡在哪」。
 * 不是抄老师侧 knowledgeState，而是模拟器自己的主观认知：
 * - 概念自评高（≥0.65）且自认完成 → 归入 mastered（自己觉得学会了）
 * - 概念自评中低 / 想要提示 / 有剩余卡点 → 归入 struggle（自己觉得没学会）
 * 纯确定性规则，零 LLM。
 */
export function selfExtractLearnerMemory(
  selfState: SelfReportedLearnerState | null | undefined,
): { mastered: string[]; struggling: string[] } {
  const mastered: string[] = [];
  const struggling: string[] = [];
  if (!selfState) return { mastered, struggling };

  const concept = typeof selfState.conceptName === 'string' && selfState.conceptName.trim()
    ? selfState.conceptName.trim()
    : null;
  if (!concept) return { mastered, struggling };

  const mastery = Number(selfState.conceptualMastery);
  const taskDone = selfState.selfReportedTaskDone === true;
  const confidence = Number(selfState.confidence);
  const wantsHelp = selfState.wantsMoreHelp === true;
  const wantsHint = selfState.wantsHint === true;
  const blockers = Array.isArray(selfState.remainingBlockers) && selfState.remainingBlockers.length > 0;

  const confidentEnough = Number.isFinite(mastery)
    ? mastery >= 0.65
    : Number.isFinite(confidence)
      ? confidence >= 0.6
      : false;
  const stuck = wantsHelp || wantsHint || blockers || (Number.isFinite(mastery) && mastery < 0.4);

  if (confidentEnough && taskDone && !stuck) {
    mastered.push(concept);
  } else if (stuck || !confidentEnough) {
    struggling.push(concept);
  }
  return { mastered, struggling };
}

/**
 * 从模拟器私有状态轨迹（learnerPrivateStateTrace）中提炼收束轮的自我状态。
 * 轨迹元素结构：{ stage, taskId, state: { ...learnerState, learnerFeedback } }。
 * 取该 task 最近一个 teaching 轨迹条目；找不到时回退到整条轨迹最后一个 teaching 条目。
 */
export function extractSelfStateFromTrace(
  trace: Array<Record<string, any>> | null | undefined,
  taskId?: string | null,
): SelfReportedLearnerState | null {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const teaching = trace.filter((entry) => entry?.stage === 'teaching');
  if (teaching.length === 0) return null;

  const target = taskId
    ? [...teaching].reverse().find((entry) => String(entry?.taskId || '') === String(taskId))
    : undefined;
  const latest = target || teaching[teaching.length - 1];
  const state = (latest?.state && typeof latest.state === 'object' ? latest.state : {}) as Record<string, any>;
  const feedback = (state.learnerFeedback && typeof state.learnerFeedback === 'object'
    ? state.learnerFeedback : {}) as Record<string, any>;

  return {
    conceptName: typeof state.conceptName === 'string' ? state.conceptName
      : (typeof state.currentConcept === 'string' ? state.currentConcept : null),
    conceptualMastery: typeof state.conceptualMastery === 'number' ? state.conceptualMastery : null,
    taskUnderstanding: typeof state.taskUnderstanding === 'number' ? state.taskUnderstanding : null,
    proceduralMastery: typeof state.proceduralMastery === 'number' ? state.proceduralMastery : null,
    selfReportedTaskDone: typeof feedback.selfReportedTaskDone === 'boolean' ? feedback.selfReportedTaskDone : null,
    confidence: typeof feedback.confidence === 'number' ? feedback.confidence : null,
    wantsMoreHelp: typeof feedback.wantsMoreHelp === 'boolean' ? feedback.wantsMoreHelp : null,
    remainingBlockers: Array.isArray(feedback.remainingBlockers) ? feedback.remainingBlockers : null,
    wantsHint: typeof state.wantsHint === 'boolean' ? state.wantsHint : null,
  };
}

/** 学习者记忆快照：喂给 learn-turn-simulator 的 knowledgeSnapshot 部分 */
export interface LearnerMemorySnapshot {
  /** 已掌握概念（画像 knownConcepts ∪ memory_traces stable/mastered） */
  mastered: Array<{ name: string; status: 'mastered' }>;
  /** 到期复习点（memory_traces 保留率低于阈值，learn 侧注入 review） */
  dueReview: Array<{ name: string; status: 'review'; progress: number }>;
  /** 仍在学习 / 易混淆（画像 struggleConcepts） */
  struggling: Array<{ name: string; status: 'learning' }>;
  /** 最近完成的事项（成果物），供故事/开场引用 */
  recentCompleted: Array<{
    taskId: string | null;
    title: string;
    artifactType: string | null;
    deliverable: string | null;
    completedAt: string;
    /** 记忆提炼 skill 的一句话记忆增量 */
    memoryDelta?: string | null;
    /** 记忆提炼 skill 的自评校准说明 */
    selfCalibration?: string | null;
  }>;
  /** 最近完成任务的标题列表（轻量版，供模拟器自然引用） */
  recentTaskTitles: string[];
}

const MASTERED_STATUSES = new Set(['mastered']);
const STRUGGLE_STATUSES = new Set(['review', 'learning', 'pending']);

/**
 * 课后回写画像概念：掌握 → knownConcepts，仍在学/需复习 → struggleConcepts。
 * 记忆来源 = 虚拟学习者「自己提炼」的自述状态（selfState），
 * 而非老师侧 knowledgeState（后者只作 fallback 与成果物证据）。
 * 三链共用（assisted / blackbox / quick-learn）。
 */
export async function writeProfileConceptsAfterLesson(
  userId: string,
  knowledgePoints: LessonKnowledgePoint[],
  options: {
    source?: string;
    /** 虚拟学习者自述状态（内部提炼的优先来源） */
    selfState?: SelfReportedLearnerState | null;
  } = {},
): Promise<void> {
  if (!userId) return;
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId } });
    if (!profile) return;

    const mastered = new Set<string>();
    const struggling = new Set<string>();

    // ① 优先：虚拟学习者自己提炼（selfState）
    if (options.selfState) {
      const self = selfExtractLearnerMemory(options.selfState);
      for (const name of self.mastered) mastered.add(name);
      for (const name of self.struggling) struggling.add(name);
    }

    // ② fallback：老师侧 knowledgeState（仅当 selfState 缺失或没提炼出任何概念时）
    if (mastered.size === 0 && struggling.size === 0 && Array.isArray(knowledgePoints)) {
      for (const kp of knowledgePoints) {
        const name = String(kp?.name || '').trim();
        if (!name) continue;
        if (MASTERED_STATUSES.has(kp.status)) mastered.add(name);
        else if (STRUGGLE_STATUSES.has(kp.status)) struggling.add(name);
      }
    }

    if (mastered.size === 0 && struggling.size === 0) return;

    const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
    const existingKnown = Array.isArray(profileData.knownConcepts) ? profileData.knownConcepts : [];
    const existingStruggle = Array.isArray(profileData.struggleConcepts) ? profileData.struggleConcepts : [];
    const knownConcepts = Array.from(new Set([...existingKnown, ...mastered]));
    const struggleConcepts = Array.from(
      new Set([...existingStruggle, ...struggling].filter((c) => !mastered.has(c)))
    );

    if (knownConcepts.length === existingKnown.length && struggleConcepts.length === existingStruggle.length) {
      return;
    }

    await prisma.virtual_learner_profiles.update({
      where: { userId },
      data: {
        profile: JSON.stringify({ ...profileData, knownConcepts, struggleConcepts }),
        knownConcepts: JSON.stringify(knownConcepts),
        struggleConcepts: JSON.stringify(struggleConcepts),
        updatedAt: new Date(),
      },
    });
    logger.info(`[vlab-memory] 画像概念已回写（${options.source || 'unknown'}）`, {
      userId,
      known: knownConcepts.length,
      struggle: struggleConcepts.length,
    });
  } catch (error) {
    logger.warn('[vlab-memory] 画像概念回写失败', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 组装学习者记忆快照：
 * - 画像 knownConcepts / struggleConcepts（人设 + 历次课后回写的沉淀）
 * - memory_traces 到期复习点（ACT-R 保留率，源由教学 endSession 写入）
 * - 画像内 recentCompleted（成果物，本模块登记）
 */
export async function buildLearnerMemorySnapshot(
  userId: string,
  options: { limit?: number } = {},
): Promise<LearnerMemorySnapshot> {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(30, Math.round(Number(options.limit) || 8))) : 8;
  const empty: LearnerMemorySnapshot = {
    mastered: [],
    dueReview: [],
    struggling: [],
    recentCompleted: [],
    recentTaskTitles: [],
  };
  if (!userId) return empty;

  const [profile, dueTraces] = await Promise.all([
    prisma.virtual_learner_profiles.findUnique({ where: { userId } }).catch(() => null),
    memoryTraceService.getDueTraces(userId, { limit }).catch(() => []),
  ]);
  if (!profile) return empty;

  const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
  const knownConcepts = Array.isArray(profileData.knownConcepts) ? profileData.knownConcepts : [];
  const struggleConcepts = Array.isArray(profileData.struggleConcepts) ? profileData.struggleConcepts : [];
  const recentCompletedRaw = Array.isArray(profileData.recentCompleted) ? profileData.recentCompleted : [];

  // memory_traces 到期点优先（比画像 struggleConcepts 更「现在时」）
  const dueNames = new Set(dueTraces.map((t) => t.conceptKey));
  const mastered = knownConcepts
    .filter((name: unknown): name is string => typeof name === 'string' && !!name.trim() && !dueNames.has(name.trim()))
    .slice(0, limit)
    .map((name: string) => ({ name, status: 'mastered' as const }));
  const dueReview = dueTraces.map((t) => ({
    name: t.conceptKey,
    status: 'review' as const,
    progress: Math.round((t.retention ?? 0.5) * 100),
  }));
  const struggling = struggleConcepts
    .filter((name: unknown): name is string => typeof name === 'string' && !!name.trim() && !dueNames.has(name.trim()))
    .slice(0, limit)
    .map((name: string) => ({ name, status: 'learning' as const }));

  const recentCompleted = recentCompletedRaw
    .filter((item: any): item is Record<string, any> => !!item && typeof item === 'object')
    .slice(0, 6)
    .map((item: Record<string, any>) => ({
      taskId: typeof item.taskId === 'string' ? item.taskId : null,
      title: typeof item.title === 'string' ? item.title : '未命名事项',
      artifactType: typeof item.artifactType === 'string' ? item.artifactType : null,
      deliverable: typeof item.deliverable === 'string' ? item.deliverable : null,
      completedAt: typeof item.completedAt === 'string' ? item.completedAt : '',
      memoryDelta: typeof item.memoryDelta === 'string' ? item.memoryDelta : null,
      selfCalibration: typeof item.selfCalibration === 'string' ? item.selfCalibration : null,
    }));

  return {
    mastered,
    dueReview,
    struggling,
    recentCompleted,
    recentTaskTitles: recentCompleted.map((item) => item.title),
  };
}

/**
 * 任务结算后登记「做完的事」（轻量成果物）。
 * 写入画像 profile.recentCompleted（去重 + 上限 12），供故事/开场引用。
 * 数据来源：subtasks 的验收标准 + 虚拟学习者自述掌握的提炼（best-effort）。
 */
export async function recordCompletedArtifact(input: {
  userId: string;
  taskId: string;
  taskTitle: string;
  artifactType?: string | null;
  deliverable?: string | null;
  knowledgePoints?: LessonKnowledgePoint[];
  /** 虚拟学习者自述状态（内部提炼：自己觉得掌握了什么） */
  selfState?: SelfReportedLearnerState | null;
  milestoneTitle?: string | null;
  /** 记忆提炼 skill 的 memoryDelta（一句话记忆增量） */
  memoryDelta?: string | null;
  /** 记忆提炼 skill 的完整结果（供记忆池展示"自己怎么想的"） */
  memoryCurated?: {
    mastered: string[];
    struggling: string[];
    selfCalibration: string;
  } | null;
}): Promise<void> {
  if (!input.userId || !input.taskId) return;
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId: input.userId } });
    if (!profile) return;
    const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
    const existing = Array.isArray(profileData.recentCompleted) ? profileData.recentCompleted : [];

    // 优先用自述提炼（内部记忆），缺失时回退老师侧 mastered 概念
    const selfExtracted = input.selfState ? selfExtractLearnerMemory(input.selfState) : null;
    const masteredNames = input.memoryCurated?.mastered?.length
      ? input.memoryCurated.mastered
      : selfExtracted && selfExtracted.mastered.length > 0
        ? selfExtracted.mastered
        : (input.knowledgePoints || [])
            .filter((kp) => kp?.status === 'mastered' && typeof kp.name === 'string' && kp.name.trim())
            .map((kp) => kp.name.trim());
    const entry = {
      taskId: input.taskId,
      title: input.taskTitle || '未命名事项',
      artifactType: input.artifactType || null,
      deliverable: input.deliverable || null,
      milestoneTitle: input.milestoneTitle || null,
      masteredConcepts: masteredNames.slice(0, 8),
      memoryDelta: input.memoryDelta || null,
      selfCalibration: input.memoryCurated?.selfCalibration || null,
      completedAt: new Date().toISOString(),
    };
    const next = [
      entry,
      ...existing.filter((item: any) => !item || item?.taskId !== input.taskId),
    ].slice(0, 12);
    profileData.recentCompleted = next;

    // TIR 反馈闭环：curator 的 selfCalibration 分析 → 自动回写 profile 的 selfAssessmentAccuracy
    const calibration = input.memoryCurated?.selfCalibration || '';
    if (calibration.includes('高估') || calibration.includes('偏高估')) {
      profileData.selfAssessmentAccuracy = 'overconfident';
    } else if (calibration.includes('低估') || calibration.includes('偏低')) {
      profileData.selfAssessmentAccuracy = 'underconfident';
    }

    await prisma.virtual_learner_profiles.update({
      where: { userId: input.userId },
      data: {
        profile: JSON.stringify(profileData),
        updatedAt: new Date(),
      },
    });
    logger.info('[vlab-memory] 已完成事项已登记', {
      userId: input.userId,
      taskId: input.taskId,
      title: input.taskTitle,
      artifactType: input.artifactType || null,
    });
  } catch (error) {
    logger.warn('[vlab-memory] 已完成事项登记失败', {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
