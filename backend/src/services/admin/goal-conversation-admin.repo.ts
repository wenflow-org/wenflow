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

  // 澄清轮次与约束条件（2026-10-01 对齐原型「澄清进度/约束条件」两列，同列裁剪纪律：
  // 库内 JSON 取数不整包出库。轮次 = messages 里 role=user 的条数（json_each 计数，
  // 不传原文）；约束 = understanding 里的可用时间/期限文案（buildGoalNormalizedState
  // 同源字段，仅理解阶段收集到时非空，稀疏属真实分布）。原型 meter 的分母
  // targetTurns 本系统不存在，前端只呈现「N 轮」不造分母。
  const ids = rows.map((r) => r.id);
  const extraMap = new Map<string, { turns: number; availableTime: string | null; deadlineText: string | null }>();
  if (ids.length) {
    const extras = await prisma.$queryRaw<Array<{ id: string; ut: number; at: string | null; dl: string | null }>>`
      SELECT gc.id,
             (SELECT COUNT(*) FROM json_each(gc.messages) je
               WHERE json_extract(je.value, '$.role') = 'user') AS ut,
             json_extract(gc.collectedData, '$.understanding.background.available_time') AS at,
             json_extract(gc.collectedData, '$.understanding.deadline_text') AS dl
      FROM goal_conversations gc
      WHERE gc.id IN (${Prisma.join(ids)})`;
    for (const e of extras) {
      extraMap.set(e.id, { turns: Number(e.ut) || 0, availableTime: e.at == null ? null : String(e.at), deadlineText: e.dl == null ? null : String(e.dl) });
    }
  }
  return rows.map((r) => {
    const extra = extraMap.get(r.id);
    return Object.assign(r, {
      summary: r.description || goalMap.get(r.id) || '—',
      turns: extra ? extra.turns : null,
      constraints: extra
        ? [extra.availableTime, extra.deadlineText].filter((v): v is string => !!v)
        : [] as string[],
    });
  });
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

/** 参与用户数（去重）：发起过目标对话的 distinct 用户（口径随 userWhere，与状态计数同源同开关） */
export function countDistinctGoalConversationUsers(userWhere: Prisma.usersWhereInput) {
  return prisma.goal_conversations
    .groupBy({ by: ['userId'], where: { users: userWhere } })
    .then((rows) => rows.length);
}
