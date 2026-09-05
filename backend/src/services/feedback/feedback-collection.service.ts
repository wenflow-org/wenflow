import { randomUUID } from 'crypto';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export type FeedbackStatus = 'new' | 'triaged' | 'resolved' | 'dismissed';
export type DifficultyFit = 'too_easy' | 'appropriate' | 'too_hard';

export interface SubmitFeedbackParams {
  userId: string;
  sessionId: string;
  taskId: string;
  rating: number;
  helpfulness?: number;
  clarity?: number;
  difficulty?: number;
  difficultyFit?: DifficultyFit;
  comment?: string;
  suggestions?: string;
  confusionPoint?: string;
  reasonCodes?: string[];
}

export class FeedbackCollectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'FeedbackCollectionError';
  }
}

interface FeedbackMessage {
  role?: string;
  strategies?: string[];
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 稳定字符串哈希（FNV-1a 32bit → hex）：用于消息内容去重 key，不依赖消息 id（会话内同内容幂等） */
function simpleHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function mapFeedback(record: any) {
  return {
    id: record.id,
    userId: record.userId,
    sessionId: record.sessionId,
    taskId: record.subtaskId,
    agentId: record.agentId,
    rating: record.rating,
    helpfulness: record.helpfulness,
    clarity: record.clarity,
    difficulty: record.difficulty,
    difficultyFit: record.difficultyFit,
    comment: record.comment,
    suggestions: record.suggestions,
    confusionPoint: record.confusionPoint,
    reasonCodes: parseJson<string[]>(record.reasonCodes, []),
    strategy: record.strategy,
    uiType: record.uiType,
    roundNumber: record.roundNumber,
    status: record.status,
    assigneeAdminId: record.assigneeAdminId,
    internalNote: record.internalNote,
    resolvedAt: record.resolvedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.users ? { user: record.users } : {})
  };
}

export class FeedbackCollectionService {
  async submitFeedback(params: SubmitFeedbackParams) {
    const session = await prisma.teaching_sessions.findUnique({
      where: { id: params.sessionId },
      select: {
        id: true,
        userId: true,
        taskId: true,
        messages: true
      }
    });

    if (!session) {
      throw new FeedbackCollectionError('学习会话不存在', 404, 'FEEDBACK_SESSION_NOT_FOUND');
    }
    if (session.userId !== params.userId) {
      throw new FeedbackCollectionError('无权评价此学习会话', 403, 'FEEDBACK_FORBIDDEN');
    }
    if (session.taskId !== params.taskId) {
      throw new FeedbackCollectionError('反馈任务与学习会话不一致', 409, 'FEEDBACK_TASK_MISMATCH');
    }

    const messages = parseJson<FeedbackMessage[]>(session.messages, []);
    const latestStrategy = [...messages]
      .reverse()
      .find(message => Array.isArray(message.strategies) && message.strategies.length > 0)
      ?.strategies?.[0] || null;
    const roundNumber = messages.filter(message => message.role === 'user').length || null;
    const feedbackKey = `${params.userId}:${params.sessionId}`;
    const reasonCodes = Array.from(new Set(params.reasonCodes || [])).slice(0, 10);

    const record = await prisma.content_feedback.upsert({
      where: { feedbackKey },
      update: {
        subtaskId: session.taskId,
        agentId: 'teaching-agent',
        rating: params.rating,
        helpfulness: params.helpfulness ?? null,
        clarity: params.clarity ?? null,
        difficulty: params.difficulty ?? null,
        difficultyFit: params.difficultyFit ?? null,
        comment: normalizeOptionalText(params.comment),
        suggestions: normalizeOptionalText(params.suggestions),
        confusionPoint: normalizeOptionalText(params.confusionPoint),
        reasonCodes: reasonCodes.length > 0 ? JSON.stringify(reasonCodes) : null,
        strategy: latestStrategy,
        uiType: 'session-report-v1',
        roundNumber,
        status: 'new',
        resolvedAt: null
      },
      create: {
        id: `cf_${randomUUID()}`,
        feedbackKey,
        userId: params.userId,
        sessionId: params.sessionId,
        subtaskId: session.taskId,
        agentId: 'teaching-agent',
        rating: params.rating,
        helpfulness: params.helpfulness ?? null,
        clarity: params.clarity ?? null,
        difficulty: params.difficulty ?? null,
        difficultyFit: params.difficultyFit ?? null,
        comment: normalizeOptionalText(params.comment),
        suggestions: normalizeOptionalText(params.suggestions),
        confusionPoint: normalizeOptionalText(params.confusionPoint),
        reasonCodes: reasonCodes.length > 0 ? JSON.stringify(reasonCodes) : null,
        strategy: latestStrategy,
        uiType: 'session-report-v1',
        roundNumber,
        status: 'new'
      }
    });

    logger.info('[Feedback] 收到用户反馈', {
      feedbackId: record.id,
      userId: params.userId,
      sessionId: params.sessionId,
      taskId: session.taskId,
      rating: params.rating
    });

    return mapFeedback(record);
  }

  /**
   * 消息级点赞/点踩（message-thumbs）。
   * 与会话级反馈（feedbackKey=userId:sessionId）不同：以「消息内容哈希」为 key，
   * 同一句 AI 回复去重，不同内容各自独立；管理端反馈中心零改动即可看到（uiType 区分来源）。
   */
  async submitMessageFeedback(params: {
    userId: string;
    sessionId: string;
    messageText: string;
    thumbsUp: boolean;
    comment?: string;
  }) {
    const session = await prisma.teaching_sessions.findUnique({
      where: { id: params.sessionId },
      select: { id: true, userId: true, taskId: true, messages: true }
    });
    if (!session) {
      throw new FeedbackCollectionError('学习会话不存在', 404, 'FEEDBACK_SESSION_NOT_FOUND');
    }
    if (session.userId !== params.userId) {
      throw new FeedbackCollectionError('无权评价此学习会话', 403, 'FEEDBACK_FORBIDDEN');
    }

    const text = String(params.messageText || '').trim();
    if (!text) {
      throw new FeedbackCollectionError('消息内容为空', 400, 'FEEDBACK_MESSAGE_EMPTY');
    }

    const messages = parseJson<FeedbackMessage[]>(session.messages, []);
    const latestStrategy = [...messages]
      .reverse()
      .find(message => Array.isArray(message.strategies) && message.strategies.length > 0)
      ?.strategies?.[0] || null;
    const roundNumber = messages.filter(message => message.role === 'user').length || null;

    // 消息内容哈希做去重 key（会话内唯一；同一句回复重复点踩只保留最新值）
    const hash = simpleHash(text);
    const feedbackKey = `${params.userId}:${params.sessionId}:thumbs:${hash}`;

    const record = await prisma.content_feedback.upsert({
      where: { feedbackKey },
      update: {
        subtaskId: session.taskId,
        agentId: 'teaching-agent',
        rating: params.thumbsUp ? 1 : 0,
        comment: normalizeOptionalText(params.comment),
        strategy: latestStrategy,
        uiType: 'message-thumbs-v1',
        roundNumber,
        status: 'new',
        resolvedAt: null
      },
      create: {
        id: `cf_${randomUUID()}`,
        feedbackKey,
        userId: params.userId,
        sessionId: params.sessionId,
        subtaskId: session.taskId,
        agentId: 'teaching-agent',
        rating: params.thumbsUp ? 1 : 0,
        comment: normalizeOptionalText(params.comment),
        strategy: latestStrategy,
        uiType: 'message-thumbs-v1',
        roundNumber,
        status: 'new'
      }
    });

    logger.info('[Feedback] 收到消息级点赞/点踩', {
      feedbackId: record.id,
      userId: params.userId,
      sessionId: params.sessionId,
      rating: record.rating,
      hash
    });

    return mapFeedback(record);
  }

  async getSessionFeedback(userId: string, sessionId: string) {
    const feedback = await prisma.content_feedback.findUnique({
      where: { feedbackKey: `${userId}:${sessionId}` }
    });
    return feedback ? mapFeedback(feedback) : null;
  }

  async getUserFeedback(userId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.content_feedback.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit
      }),
      prisma.content_feedback.count({ where: { userId } })
    ]);

    return {
      items: items.map(mapFeedback),
      total
    };
  }

  async listAdminFeedback(input: {
    page: number;
    limit: number;
    maxRating?: number;
    status?: FeedbackStatus;
    userId?: string;
    taskId?: string;
  }) {
    const where: Record<string, any> = {
      ...(input.maxRating ? { rating: { lte: input.maxRating } } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.taskId ? { subtaskId: input.taskId } : {})
    };
    const [items, total] = await Promise.all([
      prisma.content_feedback.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: {
          users: { select: { email: true, name: true } }
        }
      }),
      prisma.content_feedback.count({ where })
    ]);

    return { items: items.map(mapFeedback), total };
  }

  async getAdminFeedback(feedbackId: string) {
    const feedback = await prisma.content_feedback.findUnique({
      where: { id: feedbackId },
      include: {
        users: { select: { email: true, name: true } }
      }
    });
    return feedback ? mapFeedback(feedback) : null;
  }

  async updateAdminFeedback(
    feedbackId: string,
    input: {
      status?: FeedbackStatus;
      assigneeAdminId?: string | null;
      internalNote?: string | null;
    }
  ) {
    const existing = await prisma.content_feedback.findUnique({ where: { id: feedbackId } });
    if (!existing) {
      throw new FeedbackCollectionError('反馈不存在', 404, 'FEEDBACK_NOT_FOUND');
    }

    const status = input.status || existing.status as FeedbackStatus;
    const updated = await prisma.content_feedback.update({
      where: { id: feedbackId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.assigneeAdminId !== undefined ? { assigneeAdminId: input.assigneeAdminId } : {}),
        ...(input.internalNote !== undefined ? { internalNote: normalizeOptionalText(input.internalNote || undefined) } : {}),
        resolvedAt: status === 'resolved' || status === 'dismissed' ? new Date() : null
      },
      include: {
        users: { select: { email: true, name: true } }
      }
    });
    return mapFeedback(updated);
  }

  async getTaskFeedbackStats(taskId: string) {
    return prisma.content_feedback.aggregate({
      where: { subtaskId: taskId },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: { _all: true }
    });
  }

  async getStrategyFeedbackStats() {
    return prisma.content_feedback.groupBy({
      by: ['strategy'],
      where: { strategy: { not: null } },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: { _all: true },
      orderBy: { _count: { strategy: 'desc' } }
    });
  }

  async getUITypeFeedbackStats() {
    return prisma.content_feedback.groupBy({
      by: ['uiType'],
      where: { uiType: { not: null } },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: { _all: true },
      orderBy: { _count: { uiType: 'desc' } }
    });
  }

  async getTimeRangeFeedbackStats(startDate: Date, endDate: Date) {
    return prisma.content_feedback.groupBy({
      by: ['strategy', 'uiType'],
      where: { createdAt: { gte: startDate, lte: endDate } },
      _avg: {
        rating: true,
        helpfulness: true,
        clarity: true,
        difficulty: true
      },
      _count: { _all: true }
    });
  }

  async getFeedbackTrend(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const feedbacks = await prisma.content_feedback.findMany({
      where: { createdAt: { gte: startDate } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, rating: true }
    });
    const byDay = new Map<string, { sum: number; count: number }>();

    for (const feedback of feedbacks) {
      const day = feedback.createdAt.toISOString().split('T')[0];
      const current = byDay.get(day) || { sum: 0, count: 0 };
      current.sum += feedback.rating;
      current.count += 1;
      byDay.set(day, current);
    }

    return Array.from(byDay.entries()).map(([date, data]) => ({
      date,
      avgRating: data.sum / data.count,
      count: data.count
    }));
  }
}

export const feedbackCollectionService = new FeedbackCollectionService();
