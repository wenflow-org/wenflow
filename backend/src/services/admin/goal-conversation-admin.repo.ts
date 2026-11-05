import prisma from '../../config/database';
import { Prisma } from '@prisma/client';

/**
 * 目标对话管理仓储（routes/admin/goal-conversations.ts 的取数层）。
 * 列表/详情/状态更新/删除/重生成前置计数/漏斗统计；where 组装（请求筛选语义）留在路由层。
 */

/**
 * 文本是否为编码损坏（含 U+FFFD 替换符）。2026-11-04：少数历史 goal 会话的 description
 * 在入库前就已固化乱码，列表摘要对这批行改读 collectedData 里的可读 goal（见取数层）。
 */
function isMojibake(text: string | null | undefined): boolean {
  return !!text && text.includes('\uFFFD');
}

export async function findGoalConversationsForAdmin(where: Prisma.goal_conversationsWhereInput, skip: number, limit: number) {
  // 列裁剪（2026-10-01 页面性能实测）：列表 1000 行整包输出 20.8MB（collectedData 均摊
  // 16.7KB/行是绝对大头），序列化+传输 2.9s。列表只需要「摘要」，不需要 collectedData
  // 原文与 messages——摘要分两步取：本查询取 description，随后仅对 description 为空
  // 或已乱码的行用 json_extract 库内取 collectedData 的 goal 字段（不整包出库），拼成 summary 返回。
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
  // goal/learningGoal/objective/target 字段。description 为空、或本身已是乱码的行才查。
  // 2026-11-04 修复：历史数据里有写入阶段即已固化为 U+FFFD 的乱码 description（编码问题在
  // 落库前就坏了，非本页显示问题）；此处仅对这批行改读 collectedData 里 AI 澄清后的可读 goal，
  // 取不到则落「—」，绝不把乱码原文上屏。只处理确实乱码的行，正常行行为零变化。
  const needGoal = rows.filter((r) => !r.description || isMojibake(r.description)).map((r) => r.id);
  const goalMap = new Map<string, string>();
  if (needGoal.length) {
    const goals = await prisma.$queryRaw<Array<{ id: string; goal: string | null; lg: string | null; obj: string | null; tgt: string | null; cg: string | null; csg: string | null }>>`
      SELECT id,
             json_extract(collectedData, '$.goal') AS goal,
             json_extract(collectedData, '$.learningGoal') AS lg,
             json_extract(collectedData, '$.objective') AS obj,
             json_extract(collectedData, '$.target') AS tgt,
             json_extract(collectedData, '$.collected.goal') AS cg,
             json_extract(collectedData, '$.collected.surface_goal') AS csg
      FROM goal_conversations
      WHERE id IN (${Prisma.join(needGoal)})
        AND collectedData IS NOT NULL`;
    for (const g of goals) {
      const v = g.goal || g.lg || g.obj || g.tgt || g.cg || g.csg;
      if (v && !isMojibake(String(v))) goalMap.set(g.id, String(v));
    }
  }

  // 澄清轮次与约束条件（2026-10-01 对齐原型「澄清进度/约束条件」两列，同列裁剪纪律：
  // 库内 JSON 取数不整包出库。轮次 = messages 里 role=user 的条数（json_each 计数，
  // 不传原文）；约束 = understanding 里的可用时间/期限文案（仅理解阶段收集到时非空，
  // 稀疏属真实分布）。原型 meter 的分母
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

  /* 关联路径名（2026-11-01 外部评审 P1）：一次 IN 查询取回本页用到的路径标题，
     避免为列表逐行 join；learning_paths 缺失（孤儿/已删）时不兜底 id，交给前端标「未生成」。 */
  const pathTitleMap = new Map<string, string>();
  const pathIds = [...new Set(rows.map((r) => r.learningPathId).filter((id): id is string => !!id))];
  if (pathIds.length) {
    const paths = await prisma.learning_paths.findMany({
      where: { id: { in: pathIds } },
      select: { id: true, title: true }
    });
    for (const p of paths) if (p.title) pathTitleMap.set(p.id, p.title);
  }
  return rows.map((r) => {
    const extra = extraMap.get(r.id);
    // 2026-11-04：乱码 description 绝不上屏——可读 goal 优先，取不到就落空占位 '—'（不把 U+FFFD 原文渲染给运营）
    const rawSummary = goalMap.get(r.id) || r.description || '';
    return Object.assign(r, {
      summary: isMojibake(rawSummary) ? '—' : (rawSummary || '—'),
      turns: extra ? extra.turns : null,
      constraints: extra
        ? [extra.availableTime, extra.deadlineText].filter((v): v is string => !!v)
        : [] as string[],
      /* 关联路径名（2026-11-01 外部评审 P1）：KPI 卡报「未生成路径 N」，而列表里没有任何
         一列能指出是哪一条——信息全在状态列（已完成即已生成）里，运营只能逐行点进座舱。
         这里按 id 批量取路径名下发；无路径时不下发（由前端渲染「未生成」）。 */
      learningPathTitle: r.learningPathId ? (pathTitleMap.get(r.learningPathId) || null) : null,
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

/** 漏斗统计：按状态计数（口径 userWhere 由路由层单点定义）。
 *  2026-11-02 P2-2：原先只数 total/active/completed/cancelled——failed 从来没被统计，
 *  而列表的「已取消」档实际含 cancelled / canceled / abandoned（前端 CANCELLED_STATUSES），
 *  单数一个 'cancelled' 既漏了失败档、也盖不住取消档。改成一次 groupBy 交出全状态，
 *  由下面的 bucketGoalConversationStatusCounts 按列表档位分桶。 */
export function getGoalConversationStatusCounts(userWhere: Prisma.usersWhereInput) {
  return prisma.goal_conversations.groupBy({
    by: ['status'],
    where: { users: userWhere },
    _count: { _all: true }
  });
}

/** 状态行 → 列表那四档的桶（与前端 gcStatusPills 一一对应）+ 总数。
 *  「已取消」= cancelled / canceled / abandoned（与列表该档的筛法同一判据），「失败」单列 failed；
 *  total 是全部状态之和（含列表没单列一档的 discarded，故四档之和可以不等于 total）。
 *  分桶从路由里提出来，是为了能直接对「哪些状态算哪一档」下断言。 */
export function bucketGoalConversationStatusCounts(
  rows: Array<{ status?: string | null; _count: { _all: number } }>
) {
  const countOf = (...statuses: string[]) =>
    rows.reduce(
      (sum, row) => (statuses.includes(String(row.status || '').toLowerCase()) ? sum + row._count._all : sum),
      0
    );
  return {
    total: rows.reduce((sum, row) => sum + row._count._all, 0),
    active: countOf('active'),
    completed: countOf('completed'),
    cancelled: countOf('cancelled', 'canceled', 'abandoned'),
    failed: countOf('failed')
  };
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
