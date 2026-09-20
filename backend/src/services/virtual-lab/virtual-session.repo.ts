import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 虚拟模拟会话仓储（routes/admin/virtual-learners.ts 的取数层）。
 * 由 route 下沉：virtual_sessions / goal_conversations / admin_audit_logs /
 * virtual_experiment_leases 的直连集中于此；租约与事务编排仍留在路由/协调器。
 */

export function findSessionById(sessionId: string) {
  return prisma.virtual_sessions.findUnique({ where: { id: sessionId } });
}

/** 会话详情视图：带画像与用户信息 */
export function findSessionWithProfileAndUser(sessionId: string) {
  return prisma.virtual_sessions.findUnique({
    where: { id: sessionId },
    include: {
      virtual_learner_profiles: {
        include: {
          users: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        }
      }
    }
  });
}

/** 会话绑定的目标对话（详情组装用） */
export function findGoalConversationById(id: string) {
  return prisma.goal_conversations.findFirst({
    where: { id }
  });
}

/** runDayLearning 前置探测：当前阶段与状态 */
export function findSessionStageFields(sessionId: string) {
  return prisma.virtual_sessions.findUnique({
    where: { id: sessionId },
    select: { currentStage: true, status: true },
  });
}

/** 逐节循环后的完成态探测 */
export function findSessionStatus(sessionId: string) {
  return prisma.virtual_sessions.findUnique({ where: { id: sessionId }, select: { status: true } });
}

/** stageResults 回写（含 updatedAt 触碰）：simulation-config / clock / 暂停恢复等 */
export function updateSessionStageResults(sessionId: string, stageResultsJson: string) {
  return prisma.virtual_sessions.update({
    where: { id: sessionId },
    data: { stageResults: stageResultsJson, updatedAt: new Date() }
  });
}

/** 仅覆写 stageResults（不触碰 updatedAt）：回归运行的系统提示词覆盖 */
export function overwriteSessionStageResults(sessionId: string, stageResultsJson: string) {
  return prisma.virtual_sessions.update({
    where: { id: sessionId },
    data: { stageResults: stageResultsJson }
  });
}

/** 批量终止候选：按 sessionIds 或 profileIds 圈定的非终态会话（最多 50 条） */
export function findSessionsForTerminate(ids: string[], profileIds: string[]) {
  return prisma.virtual_sessions.findMany({
    where: {
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(profileIds.length ? [{ virtualProfileId: { in: profileIds } }] : [])
      ]
    },
    select: {
      id: true,
      virtualProfileId: true,
      status: true,
      currentStage: true,
      stageResults: true,
      logs: true,
      updatedAt: true,
      virtual_learner_profiles: { select: { userId: true } }
    },
    orderBy: { updatedAt: 'desc' },
    take: 50
  });
}

/** 终止前撤销活跃租约（模型可能缺失，调用方自带 catch） */
export function deleteSessionLeases(sessionId: string) {
  return prisma.virtual_experiment_leases?.deleteMany({ where: { sessionId } });
}

/** 单会话终态化（operator 批量终止）：abandoned + 终态时间戳 */
export function markSessionAbandoned(sessionId: string, terminatedAt: Date, stageResultsJson: string, logsJson: string) {
  return prisma.virtual_sessions.update({
    where: { id: sessionId },
    data: {
      status: 'abandoned',
      completedAt: terminatedAt,
      stageResults: stageResultsJson,
      logs: logsJson,
      updatedAt: terminatedAt
    }
  });
}

export function createAdminAuditLog(args: { data: Prisma.admin_audit_logsCreateInput }) {
  return prisma.admin_audit_logs.create(args);
}

/** 全量会话状态聚合（列表状态条 / 仿真看板共用） */
export function getSessionStatusAggregates() {
  return prisma.virtual_sessions.groupBy({
    by: ['status'],
    _count: { _all: true }
  });
}

/** 页内画像的会话状态聚合（运行/失败分区用） */
export function getPerProfileStatusAggregates(profileIds: string[]) {
  return prisma.virtual_sessions.groupBy({
    by: ['virtualProfileId', 'status'],
    where: { virtualProfileId: { in: profileIds } },
    _count: { _all: true }
  });
}

/** 页内画像的卡死会话（running 且超过阈值无写入） */
export function findStaleSessionsByProfiles(profileIds: string[], staleBefore: Date) {
  return prisma.virtual_sessions.findMany({
    where: {
      virtualProfileId: { in: profileIds },
      status: 'running',
      updatedAt: { lt: staleBefore }
    },
    select: { id: true, virtualProfileId: true, stageResults: true }
  });
}

/** 卡死候选全集（列表 staleCount 用；不含 updatedAt） */
export function findStaleSessionCandidates(staleBefore: Date) {
  return prisma.virtual_sessions.findMany({
    where: { status: { in: ['running', 'created'] }, updatedAt: { lt: staleBefore } },
    select: { id: true, stageResults: true }
  });
}

/** 仿真看板卡死候选（含 updatedAt，供 maxStaleMins 计算） */
export function findStaleSessionsForStats(staleBefore: Date) {
  return prisma.virtual_sessions.findMany({
    where: { status: { in: ['running', 'created'] }, updatedAt: { lt: staleBefore } },
    select: { id: true, stageResults: true, updatedAt: true }
  });
}

/** 运行中口径细分（识别 autopilot=stopped 的「已暂停」） */
export function findRunningSessionsByProfiles(profileIds: string[]) {
  return prisma.virtual_sessions.findMany({
    where: { virtualProfileId: { in: profileIds }, status: 'running' },
    select: { id: true, virtualProfileId: true, stageResults: true }
  });
}

/** 终态会话（平均时长计算用） */
export function findTerminalSessions() {
  return prisma.virtual_sessions.findMany({
    where: { status: { in: ['completed', 'failed', 'abandoned'] } },
    select: { createdAt: true, updatedAt: true }
  });
}

/** 今日虚拟/测试账号调用数（agent_call_logs）；仿真看板核心指标，与总览页真实口径互斥 */
export async function countTodayVirtualAgentCalls(): Promise<number> {
  const virtualIds = (
    await prisma.users.findMany({
      where: {
        OR: [
          { isVirtualLearner: true },
          { email: { startsWith: 'virtual_' } },
          { email: { endsWith: '@test.local' } }
        ]
      },
      select: { id: true }
    })
  ).map(u => u.id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return prisma.agent_call_logs.count({
    where: {
      calledAt: { gte: today, lt: tomorrow },
      userId: { in: virtualIds }
    }
  });
}

/** 回归对比：成对取两个会话 */
export function findSessionsByIdPair(sessionA: string, sessionB: string) {
  return Promise.all([
    prisma.virtual_sessions.findUnique({ where: { id: sessionA } }),
    prisma.virtual_sessions.findUnique({ where: { id: sessionB } })
  ]);
}
