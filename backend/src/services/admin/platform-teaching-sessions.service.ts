import { Prisma } from '@prisma/client';
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

/**
 * 「消息数」列（只数用户消息，口径与改造前逐字一致）改为在库里算。
 *
 * 原实现为这一列把 `messages` 整列 JSON 读进 Node 再 JSON.parse 过滤：该列合计 **197.7MB**
 * （单行最大 3.3MB），而列表页请求的是 `limit=1000`（真实用户 215 行 / 含测试 472 行），
 * 2026-09-29 实测 2.4s / 4.4s。计数搬进库后这 197MB 不再出库。
 *
 * 口径沿用双读过渡（见 schema `teaching_session_messages` 注释）：**侧表有行即权威**；
 * 无侧表行的历史会话回退 `messages` 列，回退分支用 json_each 在库内解析，同样不出库。
 */
async function countUserMessagesBySession(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const rows = await prisma.$queryRaw<Array<{ id: string; userCount: number | bigint }>>`
    SELECT s.id AS id,
      CASE
        WHEN EXISTS (SELECT 1 FROM teaching_session_messages m WHERE m.sessionId = s.id)
          THEN (SELECT COUNT(*) FROM teaching_session_messages m
                WHERE m.sessionId = s.id AND json_valid(m.payload)
                  AND json_extract(m.payload, '$.role') = 'user')
        WHEN json_valid(s.messages) AND json_type(s.messages) = 'array'
          THEN (SELECT COUNT(*) FROM json_each(s.messages)
                WHERE json_extract(value, '$.role') = 'user')
        ELSE 0
      END AS userCount
    FROM teaching_sessions s
    WHERE s.id IN (${Prisma.join(ids)})
  `;
  for (const row of rows) counts.set(row.id, Number(row.userCount));
  return counts;
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
    // select 而非 include：**排除 messages / teachingState 大 JSON 列**（前者 197.7MB，是这一页
    // 的唯一性能黑洞；消息数改由 countUserMessagesBySession 在库内聚合）
    prisma.teaching_sessions.findMany({
      where,
      orderBy: { startTime: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        userId: true,
        taskId: true,
        learningPathId: true,
        milestoneId: true,
        subject: true,
        topic: true,
        taskType: true,
        status: true,
        startTime: true,
        endTime: true,
        duration: true,
        knowledgeState: true,
        wrapup: true,
        advisory: true,
        users: {
          select: { id: true, name: true, email: true, isVirtualLearner: true }
        }
      }
    })
  ]);

  const [progressById, userMessageCount] = await Promise.all([
    deriveTeachingSessionProgress(sessions),
    countUserMessagesBySession(sessions.map((s) => s.id)),
  ]);

  const items = sessions.map((session) => {
    const wrapup = parseJsonSafe<any>(session.wrapup, null);
    const advisory = parseJsonSafe<any>(session.advisory, null);
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
      messageCount: userMessageCount.get(session.id) ?? 0,
      knowledgePointCount: Array.isArray(knowledgePoints) ? knowledgePoints.length : 0,
      progress: progressById.get(session.id) || null,
      wrapup,
      advisory,
    };
  });

  return { page, limit, total, items };
}
