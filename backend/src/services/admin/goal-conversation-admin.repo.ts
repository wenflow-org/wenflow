import prisma from '../../config/database';
import { Prisma } from '@prisma/client';

/**
 * 目标对话管理仓储（routes/admin/goal-conversations.ts 的取数层）。
 * 列表/详情/状态更新/删除/重生成前置计数/漏斗统计；where 组装（请求筛选语义）留在路由层。
 */

export async function findGoalConversationsForAdmin(where: Prisma.goal_conversationsWhereInput, skip: number, limit: number) {
  // 列裁剪（2026-10-01 页面性能实测）：列表 1000 行整包输出 20.8MB（collectedData 均摊
  // 16.7KB/行是绝对大头），序列化+传输 2.9s。列表只需要「摘要」，不需要 collectedData
  // 原文与 messages——摘要分两步取：本查询取 description，随后仅对 description 为空的行
  // 用 json_extract 库内取 collectedData 的 goal 字段（不整包出库），拼成 summary 返回。
  // 抽屉全量走 getDetail 单行查询，不受影响。
  const rows = await prisma.goal_conversations.findMany({
    where,
    skip,
    take: limit,
    select: {
      id: true,
      userId: true,
      status: true,
      stage: true,
      description: true,
      learningPathId: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
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
  if (!rows.length) return rows;

  // 摘要补齐（与前端 summaryOf 同口径）：description 优先，其次 collectedData 的
  // goal/learningGoal/objective/target 字段。仅查 description 为空的行。
  const needGoal = rows.filter((r) => !r.description).map((r) => r.id);
  const goalMap = new Map<string, string>();
  if (needGoal.length) {
    const goals = await prisma.$queryRaw<Array<{ id: string; goal: string | null; lg: string | null; obj: string | null; tgt: string | null }>>`
      SELECT id,
             json_extract(collectedData, '$.goal') AS goal,
             json_extract(collectedData, '$.learningGoal') AS lg,
             json_extract(collectedData, '$.objective') AS obj,
             json_extract(collectedData, '$.target') AS tgt
      FROM goal_conversations
      WHERE id IN (${Prisma.join(needGoal)})
        AND collectedData IS NOT NULL`;
    for (const g of goals) {
      const v = g.goal || g.lg || g.obj || g.tgt;
      if (v) goalMap.set(g.id, String(v));
    }
  }
  return rows.map((r) => Object.assign(r, {
    summary: r.description || goalMap.get(r.id) || '—',
  }));
}

/** 列表行摘要（与前端 summaryOf 同口径）：description 优先，其次 collectedData 的 goal 字段 */
function listRowSummary(description: string | null, collectedData: string | null): string {
  if (description) return description;
  try {
    const cd = JSON.parse(collectedData || '{}');
    return String(cd.goal || cd.learningGoal || cd.objective || cd.target || '—');
  } catch {
    return '—';
  }
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
