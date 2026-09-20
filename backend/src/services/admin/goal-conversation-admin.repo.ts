import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';

/**
 * 目标对话管理仓储（routes/admin/goal-conversations.ts 的取数层）。
 * 列表/详情/状态更新/删除/重生成前置计数/漏斗统计；where 组装（请求筛选语义）留在路由层。
 */

export function findGoalConversationsForAdmin(where: Prisma.goal_conversationsWhereInput, skip: number, limit: number) {
  return prisma.goal_conversations.findMany({
    where,
    skip,
    take: limit,
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true,
          isVirtualLearner: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
}

export function countGoalConversationsWhere(where: Prisma.goal_conversationsWhereInput) {
  return prisma.goal_conversations.count({ where });
}

export function findGoalConversationDetail(id: string) {
  return prisma.goal_conversations.findUnique({
    where: { id },
    include: {
      users: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    }
  });
}

export function updateGoalConversation(id: string, data: Prisma.goal_conversationsUpdateInput) {
  return prisma.goal_conversations.update({
    where: { id },
    data
  });
}

export function deleteGoalConversation(id: string) {
  return prisma.goal_conversations.delete({
    where: { id }
  });
}

/** 重生成路径前置：该用户已有的 AI 生成路径数（版本号展示用） */
export function findGoalConversationWithUser(id: string) {
  return prisma.goal_conversations.findUnique({
    where: { id },
    include: { users: true }
  });
}

export function countAiGeneratedPathsByUser(userId: string) {
  return prisma.learning_paths.count({
    where: {
      userId,
      aiGenerated: true
    }
  });
}

/** 漏斗统计：按状态计数（口径 userWhere 由路由层单点定义） */
export function getGoalConversationStatusCounts(userWhere: Prisma.usersWhereInput) {
  return Promise.all([
    prisma.goal_conversations.count({ where: { users: userWhere } }),
    prisma.goal_conversations.count({ where: { users: userWhere, status: 'active' } }),
    prisma.goal_conversations.count({ where: { users: userWhere, status: 'completed' } }),
    prisma.goal_conversations.count({ where: { users: userWhere, status: 'cancelled' } })
  ]);
}

/** 最近 7 天趋势行（含 7 天内完成但更早创建的对话，保证「当日完成」完整） */
export function findRecentGoalConversationsForTrend(userWhere: Prisma.usersWhereInput, sevenDaysAgo: Date) {
  return prisma.goal_conversations.findMany({
    where: {
      users: userWhere,
      OR: [
        { createdAt: { gte: sevenDaysAgo } },
        { completedAt: { gte: sevenDaysAgo } },
      ],
    },
    select: {
      createdAt: true,
      status: true,
      completedAt: true,
      updatedAt: true
    }
  });
}
