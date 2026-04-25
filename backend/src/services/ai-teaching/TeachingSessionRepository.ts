import prisma from '../../config/database';

export interface TeachingSessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  analysis?: Record<string, any>;
}

export interface TeachingKnowledgePointState {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export interface TeachingSessionRecord {
  id: string;
  userId: string;
  taskId: string;
  learningPathId?: string | null;
  milestoneId?: string | null;
  subject: string;
  topic: string;
  taskType: string;
  mode: string;
  status: string;
  messages: TeachingSessionMessage[];
  knowledgeState: TeachingKnowledgePointState[];
  teachingState: Record<string, any> | null;
  wrapup: Record<string, any> | null;
  advisory: Record<string, any> | null;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CreateTeachingSessionInput {
  id: string;
  userId: string;
  taskId: string;
  learningPathId?: string | null;
  milestoneId?: string | null;
  subject: string;
  topic: string;
  taskType: string;
  mode?: string;
  messages?: TeachingSessionMessage[];
  knowledgeState?: TeachingKnowledgePointState[];
  teachingState?: Record<string, any> | null;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapRecord(record: any): TeachingSessionRecord {
  return {
    id: record.id,
    userId: record.userId,
    taskId: record.taskId,
    learningPathId: record.learningPathId,
    milestoneId: record.milestoneId,
    subject: record.subject,
    topic: record.topic,
    taskType: record.taskType,
    mode: record.mode,
    status: record.status,
    messages: parseJsonSafe(record.messages, []),
    knowledgeState: parseJsonSafe(record.knowledgeState, []),
    teachingState: parseJsonSafe(record.teachingState, null),
    wrapup: parseJsonSafe(record.wrapup, null),
    advisory: parseJsonSafe(record.advisory, null),
    startTime: record.startTime,
    endTime: record.endTime,
    duration: record.duration,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

class TeachingSessionRepository {
  async create(input: CreateTeachingSessionInput): Promise<TeachingSessionRecord> {
    const record = await prisma.teaching_sessions.create({
      data: {
        id: input.id,
        userId: input.userId,
        taskId: input.taskId,
        learningPathId: input.learningPathId || null,
        milestoneId: input.milestoneId || null,
        subject: input.subject,
        topic: input.topic,
        taskType: input.taskType,
        mode: input.mode || 'tutor',
        status: 'active',
        messages: JSON.stringify(input.messages || []),
        knowledgeState: JSON.stringify(input.knowledgeState || []),
        teachingState: input.teachingState ? JSON.stringify(input.teachingState) : null,
        updatedAt: new Date(),
      }
    });

    return mapRecord(record);
  }

  async getById(sessionId: string): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findUnique({
      where: { id: sessionId }
    });

    return record ? mapRecord(record) : null;
  }

  async assertOwnership(sessionId: string, userId: string): Promise<TeachingSessionRecord> {
    const session = await this.getById(sessionId);
    if (!session) {
      throw new Error('会话不存在');
    }
    if (session.userId !== userId) {
      throw new Error('无权访问此会话');
    }
    return session;
  }

  async getActiveByTask(userId: string, taskId: string): Promise<TeachingSessionRecord | null> {
    const record = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        taskId,
        status: 'active'
      },
      orderBy: { startTime: 'desc' }
    });

    return record ? mapRecord(record) : null;
  }

  async listByUser(userId: string, limit: number = 50): Promise<TeachingSessionRecord[]> {
    const records = await prisma.teaching_sessions.findMany({
      where: { userId },
      orderBy: { startTime: 'desc' },
      take: limit,
    });

    return records.map(mapRecord);
  }

  async updateTurnState(
    sessionId: string,
    payload: {
      messages: TeachingSessionMessage[];
      knowledgeState: TeachingKnowledgePointState[];
      teachingState?: Record<string, any> | null;
    }
  ): Promise<void> {
    await prisma.teaching_sessions.update({
      where: { id: sessionId },
      data: {
        messages: JSON.stringify(payload.messages),
        knowledgeState: JSON.stringify(payload.knowledgeState),
        teachingState: payload.teachingState ? JSON.stringify(payload.teachingState) : null,
        updatedAt: new Date(),
      }
    });
  }

  async complete(
    sessionId: string,
    payload: {
      messages: TeachingSessionMessage[];
      knowledgeState: TeachingKnowledgePointState[];
      teachingState?: Record<string, any> | null;
      wrapup?: Record<string, any> | null;
      advisory?: Record<string, any> | null;
      duration?: number | null;
    }
  ): Promise<void> {
    await prisma.teaching_sessions.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        endTime: new Date(),
        duration: payload.duration ?? null,
        messages: JSON.stringify(payload.messages),
        knowledgeState: JSON.stringify(payload.knowledgeState),
        teachingState: payload.teachingState ? JSON.stringify(payload.teachingState) : null,
        wrapup: payload.wrapup ? JSON.stringify(payload.wrapup) : null,
        advisory: payload.advisory ? JSON.stringify(payload.advisory) : null,
        updatedAt: new Date(),
      }
    });
  }
}

export const teachingSessionRepository = new TeachingSessionRepository();
