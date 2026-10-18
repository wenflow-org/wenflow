import prisma from '../../config/database';
import { findLearningPathById } from './learning-content.repo';

/**
 * 会话控制台仓储（routes/admin/session-console.ts 的取数层）。
 * teaching_sessions / goal_conversations 两种载荷的关联实体组装取数。
 */

export { findLearningPathById };

export function findMilestonesByPathId(learningPathId: string) {
  return prisma.milestones.findMany({
    where: { learningPathId },
    orderBy: { stageNumber: 'asc' },
    include: { subtasks: { orderBy: { order: 'asc' } } },
  });
}

export function findLatestGoalConversationByPathId(learningPathId: string) {
  return prisma.goal_conversations.findFirst({
    where: { learningPathId },
    orderBy: { createdAt: 'desc' },
  });
}

/** 会话维度的学习证据（sessionId 或 taskId 命中） */
export function findSessionEvidence(sessionId: string | null, taskId: string | null) {
  return prisma.learner_evidence.findMany({
    where: {
      OR: [
        ...(sessionId ? [{ sessionId }] : []),
        ...(taskId ? [{ taskId }] : []),
      ],
    },
    orderBy: { occurredAt: 'asc' },
  });
}

export function findSubtaskById(taskId: string) {
  return prisma.subtasks.findUnique({ where: { id: taskId } });
}

/**
 * 本节课的负荷聚合行（teaching-session-views.commitSessionLoadMetric 写入）。
 * 该行此前无任何读取方，属「写了没人看」；控制台总结页是本会话唯一面向人的消费点。
 */
export function findSessionLoadMetric(sessionId: string) {
  return prisma.learning_metrics.findUnique({
    where: { sourceKey: `session-load:${sessionId}` },
    select: { value: true, metadata: true },
  });
}

export function findTeachingSessionsByPathId(learningPathId: string) {
  return prisma.teaching_sessions.findMany({
    where: { learningPathId, status: { not: 'superseded' } },
    orderBy: { startTime: 'desc' },
    take: 20,
  });
}

export function findPathEvidence(pathId: string | null | undefined) {
  return prisma.learner_evidence.findMany({
    where: { pathId: pathId || undefined },
    orderBy: { occurredAt: 'asc' },
  });
}

export function findTeachingSessionWithUser(sessionId: string) {
  return prisma.teaching_sessions.findUnique({
    where: { id: sessionId },
    include: { users: { select: { id: true, name: true, email: true } } },
  });
}

export function findGoalConversationWithUser(sessionId: string) {
  return prisma.goal_conversations.findUnique({
    where: { id: sessionId },
    include: { users: { select: { id: true, name: true, email: true } } },
  });
}
