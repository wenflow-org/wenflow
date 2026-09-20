import prisma from '../../config/database';
import { isTestAccountUser } from '../../utils/test-account';
import { REAL_USER_WHERE } from './real-user-where';
import { deriveTeachingSessionProgress } from '../teaching-session-progress.service';

/**
 * 教学会话调试视图（GET /api/admin/teaching-sessions 的数据层）。
 * 由 routes/admin/platform.ts 下沉：聚焦 wrapup / advisory，列表进度由 milestones/subtasks 现表推导。
 */
function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function listTeachingSessionsDebug(params: {
  page: number;
  limit: number;
  userId?: string;
  status?: string;
  onlyWithAdvisory: boolean;
  onlyMissingWrapup: boolean;
  includeTest: boolean;
}): Promise<unknown> {
  const { page, limit, userId, status, onlyWithAdvisory, onlyMissingWrapup, includeTest } = params;
  const where: any = {
    ...(userId ? { userId } : {}),
    ...(status ? { status } : {}),
    ...(onlyWithAdvisory ? { advisory: { not: null } } : {}),
    // wrapup 为 JSON 文本列：缺失 = 无记录或内容中不含 topicSummary
    ...(onlyMissingWrapup
      ? { OR: [{ wrapup: null }, { NOT: { wrapup: { contains: 'topicSummary' } } }] }
      : {}),
    ...(includeTest ? {} : { users: REAL_USER_WHERE }),
  };

  const [total, sessions] = await Promise.all([
    prisma.teaching_sessions.count({ where }),
    prisma.teaching_sessions.findMany({
      where,
      orderBy: { startTime: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        users: {
          select: { id: true, name: true, email: true, isVirtualLearner: true }
        }
      }
    })
  ]);

  const progressById = await deriveTeachingSessionProgress(sessions);

  const items = sessions.map((session) => {
    const wrapup = parseJsonSafe<any>(session.wrapup, null);
    const advisory = parseJsonSafe<any>(session.advisory, null);
    const messages = parseJsonSafe<any[]>(session.messages, []);
    const knowledgePoints = parseJsonSafe<any[]>(session.knowledgeState, []);

    return {
      id: session.id,
      userId: session.userId,
      userName: session.users?.name || null,
      email: session.users?.email || null,
      /** 数据隔离标记（includeTest=true 时供前端灰标：虚拟学习者 / 测试账号） */
      isVirtualLearner: !!session.users?.isVirtualLearner,
      isTestAccount: isTestAccountUser(session.users),
      taskId: session.taskId,
      learningPathId: session.learningPathId,
      milestoneId: session.milestoneId,
      subject: session.subject,
      topic: session.topic,
      taskType: session.taskType,
      status: session.status,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      messageCount: Array.isArray(messages) ? messages.filter((m: any) => m?.role === 'user').length : 0,
      knowledgePointCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
      progress: progressById.get(session.id) || null,
      wrapup,
      advisory,
    };
  });

  return { page, limit, total, items };
}
