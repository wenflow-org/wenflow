/**
 * 内容抽检读写（管理端路由的数据库边界，2026-10-22 架构审计）。
 *
 * 路由只做参数校验/人读投影；抽样、标签读取与证据 upsert 都在这里，
 * 避免 `src/routes/**` 直接依赖 Prisma。
 */
import prisma from '../../config/database';
import {
  CONTENT_REVIEW_EVIDENCE_KEY,
  CONTENT_REVIEW_EVIDENCE_TYPE,
  collectSampledTurns,
} from '../ai-teaching/content-correctness';

const messageEventId = (messageId: number | string) => `msg:${messageId}`;

export async function loadSampledContentTurns(params: {
  days: number;
  rate: number;
  realOnly: boolean;
  limit: number;
}) {
  const since = new Date(Date.now() - params.days * 86400000);
  const sessions = await prisma.teaching_sessions.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, userId: true, taskId: true, users: { select: { isVirtualLearner: true } } },
    orderBy: { createdAt: 'desc' },
    take: 400,
  });
  return collectSampledTurns({
    sessions,
    loadMessages: (sessionId) =>
      prisma.teaching_session_messages.findMany({
        where: { sessionId },
        orderBy: { id: 'asc' },
        select: { id: true, payload: true },
      }),
    sampleRate: params.rate,
    limit: params.limit,
    perSessionCap: 6,
    realOnly: params.realOnly,
  });
}

export async function findContentReviewLabels(messageIds: number[]) {
  if (messageIds.length === 0) return [];
  return prisma.learner_evidence.findMany({
    where: {
      evidenceType: CONTENT_REVIEW_EVIDENCE_TYPE,
      eventId: { in: messageIds.map((id) => messageEventId(id)) },
    },
    select: { eventId: true, payload: true },
  });
}

export async function countTodayContentReviewLabels(todayStart: Date) {
  return prisma.learner_evidence.count({
    where: {
      evidenceType: CONTENT_REVIEW_EVIDENCE_TYPE,
      evidenceKey: CONTENT_REVIEW_EVIDENCE_KEY,
      occurredAt: { gte: todayStart },
    },
  });
}

export async function findTeachingMessage(messageId: number) {
  return prisma.teaching_session_messages.findUnique({
    where: { id: messageId },
    select: { id: true, sessionId: true, payload: true },
  });
}

export async function findTeachingSessionBrief(sessionId: string) {
  return prisma.teaching_sessions.findUnique({
    where: { id: sessionId },
    select: { userId: true, taskId: true, learningPathId: true },
  });
}

export async function upsertContentReviewLabel(input: {
  messageId: number;
  session: { userId: string; taskId: string | null; learningPathId: string | null };
  sessionId: string;
  payload: string;
}) {
  return prisma.learner_evidence.upsert({
    where: {
      eventId_evidenceKey: {
        eventId: messageEventId(input.messageId),
        evidenceKey: CONTENT_REVIEW_EVIDENCE_KEY,
      },
    },
    create: {
      id: `ev_content_${input.messageId}`,
      eventId: messageEventId(input.messageId),
      evidenceKey: CONTENT_REVIEW_EVIDENCE_KEY,
      userId: input.session.userId,
      pathId: input.session.learningPathId ?? null,
      taskId: input.session.taskId,
      sessionId: input.sessionId,
      evidenceType: CONTENT_REVIEW_EVIDENCE_TYPE,
      payload: input.payload,
      confidence: 1,
      occurredAt: new Date(),
    },
    update: {
      payload: input.payload,
      occurredAt: new Date(),
    },
  });
}
