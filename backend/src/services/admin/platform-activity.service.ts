import prisma from '../../config/database';
import { REAL_USER_WHERE } from './real-user-where';
import { classifyFailureCategory } from './failure-classification';

/**
 * 平台最近动态（GET /api/admin/activity 的数据层）。
 * 由 routes/admin/platform.ts 下沉：近 24h 窗口内的会话/注册/完成任务/失败事件/管理端授权使用。
 */
export async function getPlatformActivityFeed(params: {
  limit: number;
  excludeTest: boolean;
}): Promise<unknown> {
  const { limit, excludeTest } = params;
  const ACTIVITY_USER_WHERE = excludeTest
    ? REAL_USER_WHERE
    : { isVirtualLearner: false };
  // 动态时间窗：仅近 24h（前端卡片标注「近 24h」；7 天前旧条目不再混入）
  const activityWindowStart = new Date(Date.now() - 24 * 3600000);

  // 最近的学习会话
  const recentSessions = await prisma.teaching_sessions.findMany({
    take: limit,
    orderBy: { startTime: 'desc' },
    where: {
      users: ACTIVITY_USER_WHERE,
      startTime: { gte: activityWindowStart },
    },
    include: {
      users: {
        select: { id: true, email: true, name: true }
      }
    }
  });

  const sessionTaskIds = Array.from(new Set(recentSessions.map((session) => session.taskId).filter(Boolean)));
  const sessionTasks = sessionTaskIds.length > 0
    ? await prisma.subtasks.findMany({
        where: { id: { in: sessionTaskIds } },
        select: { id: true, title: true },
      })
    : [];
  const sessionTaskMap = new Map(sessionTasks.map((task) => [task.id, task]));

  // 最近注册的用户（excludeTest 时排除虚拟学习者/测试账号；软删账号一律隐藏）
  const recentUsers = await prisma.users.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' },
    where: {
      ...(excludeTest ? REAL_USER_WHERE : { deletedAt: null }),
      createdAt: { gte: activityWindowStart },
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true
    }
  });

  // 最近完成的任务（excludeTest 时排除虚拟学习者/测试账号）
  const completedTasks = await prisma.subtasks.findMany({
    take: 20,
    where: {
      status: 'completed',
      users: ACTIVITY_USER_WHERE,
      completedAt: { gte: activityWindowStart },
    },
    orderBy: { completedAt: 'desc' },
    include: {
      users: {
        select: { id: true, email: true, name: true }
      }
    }
  });

  // 近 24h 失败事件（异常流：动态 feed 的 bad/warn 事件源，含类别/错误码供跳转筛选）
  // 排除系统金丝雀探针：自检超时/中断不应作为业务失败进入异常流
  const recentFailures = await prisma.agent_call_logs.findMany({
    take: 10,
    where: {
      calledAt: { gte: activityWindowStart },
      success: false,
      // sourceEntry 非空（String @default("platform")）：直接 not 过滤，勿用 { sourceEntry: null }
      sourceEntry: { not: 'system-canary' },
    },
    orderBy: { calledAt: 'desc' },
    select: {
      id: true,
      agentId: true,
      executionLayer: true,
      errorCode: true,
      errorCategory: true,
      error: true,
      calledAt: true,
      statusCode: true,
    },
  });

  const [recentProjectionGrantUses, activeProjectionGrantCount] = await Promise.all([
    prisma.projection_access_grants.findMany({
      take: 20,
      where: {
        lastUsedAt: { not: null }
      },
      orderBy: { lastUsedAt: 'desc' },
      include: {
        users: {
          select: { id: true, email: true, name: true }
        }
      }
    }),
    prisma.projection_access_grants.count({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() }
      }
    })
  ]);

  const adminIds = Array.from(new Set(
    recentProjectionGrantUses
      .map((grant) => grant.lastUsedByAdminId)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  ));

  const adminUsers = adminIds.length > 0
    ? await prisma.users.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, email: true, name: true }
      })
    : [];
  const adminUserMap = new Map(adminUsers.map((user) => [user.id, user]));

  return {
    recentSessions: recentSessions.map((session) => ({
      ...session,
      user: session.users
        ? {
            id: session.users.id,
            email: session.users.email,
            name: session.users.name,
          }
        : null,
      task: sessionTaskMap.get(session.taskId)
        ? {
            id: session.taskId,
            title: sessionTaskMap.get(session.taskId)?.title,
          }
        : null,
    })),
    recentUsers,
    completedTasks,
    recentFailures: recentFailures.map((log) => ({
      id: log.id,
      agentId: log.agentId,
      executionLayer: log.executionLayer,
      errorCode: log.errorCode,
      // 归一到归因同款类别（空类别行启发式归并），保证跳转筛选计数一致
      errorCategory: classifyFailureCategory({
        errorCategory: log.errorCategory,
        errorCode: log.errorCode,
        error: log.error,
      }),
      error: log.error,
      calledAt: log.calledAt,
      statusCode: log.statusCode,
    })),
    activeProjectionGrantCount,
    recentProjectionGrantUses: recentProjectionGrantUses.map((grant) => ({
      id: grant.id,
      scope: grant.scope,
      purpose: grant.purpose || null,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
      useCount: grant.useCount,
      lastUsedAt: grant.lastUsedAt,
      user: grant.users
        ? {
            id: grant.users.id,
            email: grant.users.email,
            name: grant.users.name,
          }
        : null,
      adminUser: grant.lastUsedByAdminId
        ? (() => {
            const adminUser = adminUserMap.get(grant.lastUsedByAdminId)
            return adminUser
              ? {
                  id: adminUser.id,
                  email: adminUser.email,
                  name: adminUser.name,
                }
              : {
                  id: grant.lastUsedByAdminId,
                  email: null,
                  name: '管理员'
                }
          })()
        : null,
    }))
  };
}
