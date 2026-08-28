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
  }>;
  /** 最近完成任务的标题列表（轻量版，供模拟器自然引用） */
  recentTaskTitles: string[];
}

const MASTERED_STATUSES = new Set(['mastered']);
const STRUGGLE_STATUSES = new Set(['review', 'learning', 'pending']);

/**
 * 课后回写画像概念：掌握 → knownConcepts，仍在学/需复习 → struggleConcepts。
 * 三链共用（assisted 已有等价实现，本函数为统一出口）。
 */
export async function writeProfileConceptsAfterLesson(
  userId: string,
  knowledgePoints: LessonKnowledgePoint[],
  options: { source?: string } = {},
): Promise<void> {
  if (!userId || !Array.isArray(knowledgePoints) || !knowledgePoints.length) return;
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId } });
    if (!profile) return;

    const mastered = new Set<string>();
    const struggling = new Set<string>();
    for (const kp of knowledgePoints) {
      const name = String(kp?.name || '').trim();
      if (!name) continue;
      if (MASTERED_STATUSES.has(kp.status)) mastered.add(name);
      else if (STRUGGLE_STATUSES.has(kp.status)) struggling.add(name);
    }

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
 * 数据来源：subtasks 的验收标准 + 课堂知识状态（best-effort）。
 */
export async function recordCompletedArtifact(input: {
  userId: string;
  taskId: string;
  taskTitle: string;
  artifactType?: string | null;
  deliverable?: string | null;
  knowledgePoints?: LessonKnowledgePoint[];
  milestoneTitle?: string | null;
}): Promise<void> {
  if (!input.userId || !input.taskId) return;
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId: input.userId } });
    if (!profile) return;
    const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
    const existing = Array.isArray(profileData.recentCompleted) ? profileData.recentCompleted : [];

    const masteredNames = (input.knowledgePoints || [])
      .filter((kp) => kp?.status === 'mastered' && typeof kp.name === 'string' && kp.name.trim())
      .map((kp) => kp.name.trim());
    const entry = {
      taskId: input.taskId,
      title: input.taskTitle || '未命名事项',
      artifactType: input.artifactType || null,
      deliverable: input.deliverable || null,
      milestoneTitle: input.milestoneTitle || null,
      masteredConcepts: masteredNames.slice(0, 8),
      completedAt: new Date().toISOString(),
    };
    const next = [
      entry,
      ...existing.filter((item: any) => !item || item?.taskId !== input.taskId),
    ].slice(0, 12);

    await prisma.virtual_learner_profiles.update({
      where: { userId: input.userId },
      data: {
        profile: JSON.stringify({ ...profileData, recentCompleted: next }),
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
