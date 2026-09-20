import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 数据导出仓储（routes/admin/export.ts 的取数层）。
 * 六类 CSV 导出的行拉取；CSV 组装/转义留在路由层。
 */

export function listExportUsers(where: Prisma.usersWhereInput, take: number) {
  return prisma.users.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, name: true, email: true, role: true, isAdmin: true, isVirtualLearner: true,
      xp: true, currentLevel: true, createdAt: true, lastLoginAt: true, deletedAt: true,
    },
  });
}

export function listExportAgentLogs(limit: number) {
  return prisma.agent_call_logs.findMany({
    orderBy: { calledAt: 'desc' },
    take: limit,
    select: {
      id: true, agentId: true, userId: true, sourceEntry: true, traceId: true,
      success: true, durationMs: true, errorCode: true, errorCategory: true, error: true,
      model: true, promptTokens: true, completionTokens: true, calledAt: true,
    },
  });
}

export function listExportTeachingSessions(take: number) {
  return prisma.teaching_sessions.findMany({
    orderBy: { startTime: 'desc' },
    take,
    select: {
      id: true, userId: true, taskId: true, subject: true, topic: true, taskType: true,
      mode: true, status: true, duration: true, startTime: true, endTime: true,
    },
  });
}

export function listExportFeedback(take: number) {
  return prisma.content_feedback.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, userId: true, sessionId: true, agentId: true, rating: true,
      difficulty: true, comment: true, status: true, createdAt: true,
    },
  });
}

export function listExportGoalConversations(take: number) {
  return prisma.goal_conversations.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, userId: true, status: true, stage: true, description: true, createdAt: true, updatedAt: true },
  });
}

export function listExportAuditLogs(limit: number) {
  return prisma.admin_audit_logs.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, adminName: true, action: true, targetType: true, targetId: true,
      method: true, path: true, statusCode: true, success: true, ip: true, durationMs: true, createdAt: true,
    },
  });
}
