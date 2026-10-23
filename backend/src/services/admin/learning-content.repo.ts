import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { buildNonVirtualUserWhere } from '../../utils/test-account';
import { withTransaction } from '../../utils/with-transaction';

/**
 * 学习内容治理仓储（routes/admin/learning-content.ts 的取数层）。
 * 全局学习路径目录/详情/下线恢复/删除/统计；内容治理默认仅真实用户口径。
 */

/* ---------- 真墙钟「最近活动」派生（列表/详情共用） ----------
   虚拟学习者的日期模拟会把 `learning_paths.updatedAt` 写成模拟日（未来日期，见
   task-completion.service.ts 的 asOf 结算），污染管理端排序/展示。这里只取**不被模拟钟改写**
   的真墙钟锚点，取最大值为 lastActivityAt：
     · createdAt（Prisma 默认 now）
     · updatedAt 仅当 ≤ 现在时可信（未来值 = 模拟钟产物，丢弃）
     · 该路径名下 teaching_sessions.createdAt 的最新值（会话自动列，实测真墙钟）
   设计契约：doc/VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md §9.5/§9.11。 */

function latestOf(...dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const d of dates) if (d && (!best || d.getTime() > best.getTime())) best = d;
  return best;
}

/** pathId → 名下会话 createdAt 最大值（真墙钟）；空输入不查库 */
async function realSessionMax(pathIds: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (!pathIds.length) return map;
  const grouped = await prisma.teaching_sessions.groupBy({
    by: ['learningPathId'],
    where: { learningPathId: { in: pathIds } },
    _max: { createdAt: true },
  });
  for (const g of grouped) {
    if (g.learningPathId && g._max.createdAt) map.set(g.learningPathId, g._max.createdAt);
  }
  return map;
}

/** 单条路径的真墙钟最近活动（详情用）：updatedAt 只在非未来时才计入 */
async function lastActivityAtFor(path: { id: string; createdAt: Date; updatedAt: Date | null }): Promise<Date | null> {
  const sessionMax = await realSessionMax([path.id]);
  const now = Date.now();
  const realUpdated = path.updatedAt && path.updatedAt.getTime() <= now ? path.updatedAt : null;
  return latestOf(path.createdAt, realUpdated, sessionMax.get(path.id));
}

/**
 * 管理端学习路径列表（内容治理页取数层）。
 *
 * 排序/展示用**真墙钟**的「最近活动」，不是 `learning_paths.updatedAt`：虚拟学习者的日期模拟
 * 会把 `updatedAt` 写成模拟日（`task-completion.service.ts` 结算任务时用 `asOf` 连带写路径），
 * 而模拟日通常是未来日期 —— 直接按 updatedAt 排会让虚拟路径霸榜（真实学习者永沉底），
 * 前端 `timeAgo` 还会把未来时间渲染成「刚刚」。设计契约：运维/审计列保持真墙钟
 * （doc/VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md §9.5/§9.11）。
 *
 * 真墙钟锚点（都不被模拟钟改写）：`createdAt`（Prisma 默认 now）、`updatedAt` 仅当 ≤ 现在时可信
 * （未来值=模拟钟产物，丢弃）、该路径名下 `teaching_sessions.createdAt` 的最新值（会话自动列）。
 * 三者取最大值为 `lastActivityAt`。分页 orderBy 回落 `createdAt`（派生值无法下推 SQL）。
 */
export async function findLearningPathsForAdmin(where: Prisma.learning_pathsWhereInput, skip: number, take: number) {
  const rows = await prisma.learning_paths.findMany({
    where,
    // 真墙钟排序：不按 updatedAt（虚拟路径的 updatedAt 会被模拟钟写成未来日期）
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip,
    take,
    select: {
      id: true,
      title: true,
      subject: true,
      status: true,
      difficulty: true,
      estimatedHours: true,
      totalMilestones: true,
      completedMilestones: true,
      aiGenerated: true,
      createdAt: true,
      updatedAt: true,
      deadline: true,
      users: { select: { id: true, name: true, email: true, isVirtualLearner: true } },
      milestones: {
        select: { id: true, status: true, title: true },
      },
      _count: { select: { milestones: true } },
    },
  });

  // 「最近活动」= 真墙钟锚点的最大值（见上方派生说明）
  const now = Date.now();
  const sessionMax = await realSessionMax(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    // updatedAt 只在非未来（真墙钟）时才可信：未来值 = 模拟钟写入，丢弃
    lastActivityAt: latestOf(r.createdAt, r.updatedAt && r.updatedAt.getTime() <= now ? r.updatedAt : null, sessionMax.get(r.id)),
  }));
}

export function countLearningPathsWhere(where: Prisma.learning_pathsWhereInput) {
  return prisma.learning_paths.count({ where });
}

/** 路径详情（含 milestones + subtasks，供治理页查看内容结构）。
 *  附带真墙钟 `lastActivityAt`（同列表口径）：详情页的停滞判定也用真墙钟，不用会被模拟钟写成未来日期的 updatedAt。 */
export async function findLearningPathDetail(id: string) {
  const path = await prisma.learning_paths.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, name: true, email: true, isVirtualLearner: true } },
      milestones: {
        orderBy: { order: 'asc' },
        include: {
          subtasks: { orderBy: { order: 'asc' }, select: { id: true, title: true, status: true, taskType: true, estimatedMinutes: true, completedAt: true, cognitiveLoad: true } },
        },
      },
    },
  });
  if (!path) return path;
  return { ...path, lastActivityAt: await lastActivityAtFor(path) };
}

export function findLearningPathById(id: string) {
  return prisma.learning_paths.findUnique({ where: { id } });
}

/**
 * 路径 → 来源目标对话（管理台「路径在会话座舱打开」的反查）。
 * learning_paths 表没有 conversationId 列；指针由路径生成链维护在
 * goal_conversations.learningPathId（simulation.path-phase.ts 生成/重建后回写，带索引）。
 * 取最近一条：重规划/重建会先后产生指向记录，最新一条才是当前生效的对话。
 */
export async function findPathConversationId(id: string): Promise<string | null> {
  const conv = await prisma.goal_conversations.findFirst({
    where: { learningPathId: id },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return conv?.id ?? null;
}

/**
 * 路径 → 最新虚拟学习会话（「重试路径生成」的派发目标）。
 * 路径不直挂会话，按 learningPathId 取最近一条虚拟会话代发（与 findPathConversationId 同判据）。
 */
export async function findLatestVirtualSessionForPath(learningPathId: string) {
  return prisma.virtual_sessions.findFirst({
    where: { learningPathId },
    orderBy: { createdAt: 'desc' },
  });
}

/** 下线路径（内容治理：用户端不可继续学习；status=archived） */
export function archiveLearningPath(id: string) {
  return prisma.learning_paths.update({
    where: { id },
    data: { status: 'archived', updatedAt: new Date() },
  });
}

/** 恢复路径（archived → active） */
export function restoreLearningPath(id: string) {
  return prisma.learning_paths.update({
    where: { id },
    data: { status: 'active', updatedAt: new Date() },
  });
}

/** 删除前置：标题与里程碑计数（审计快照） */
export function findLearningPathWithMilestoneCount(id: string) {
  return prisma.learning_paths.findUnique({
    where: { id },
    include: { _count: { select: { milestones: true } } },
  });
}

/**
 * 删除路径（内容治理，危险操作）。
 *
 * 同事务「先清软指针、再删行」（issue #90）：milestones/subtasks/path_generation_* 由 FK
 * `ON DELETE CASCADE` 处理，但 `learningPathId` 在 goal_conversations / teaching_sessions /
 * virtual_sessions 三张表上是**无 FK 的软指针**（PRAGMA foreign_key_list 零行）——裸删路径会让
 * 会话/目标对话留下指向不存在路径的悬空引用，管理端的路径反查（findPathConversationId /
 * findLatestVirtualSessionForPath）从此静默对不上。
 * 口径：指针置 null 而非删会话——会话 stageResults 里保留学习历史快照，关联关系按
 * 「未关联」呈现（与读侧空结果语义一致）；正常路径（无引用）行为不变。
 */
export function deleteLearningPath(id: string) {
  return withTransaction(async (tx) => {
    await tx.goal_conversations.updateMany({ where: { learningPathId: id }, data: { learningPathId: null } });
    await tx.teaching_sessions.updateMany({ where: { learningPathId: id }, data: { learningPathId: null } });
    await tx.virtual_sessions.updateMany({ where: { learningPathId: id }, data: { learningPathId: null } });
    return tx.learning_paths.delete({ where: { id } });
  }, { label: 'admin.learning-content.deleteLearningPath' });
}

/** 内容统计（治理页顶部：总数 / 按状态 / 按学科 / 里程碑与任务总量）。
 *  口径随列表页「真实/测试」视角开关联动（2026-10-10 用户拍板互斥视角）：
 *  默认 = 全部非虚拟账号（buildNonVirtualUserWhere）；includeTest 只看全量（按 id 直查用），
 *  与 GET /paths 的分支同一判据（否则 KPI/分布条与列表不同源）。 */
export async function getLearningContentStats(includeTest = false) {
  const userWhere = includeTest ? {} : { users: await buildNonVirtualUserWhere() };
  return Promise.all([
    prisma.learning_paths.count({ where: userWhere }),
    prisma.learning_paths.groupBy({ by: ['status'], _count: { _all: true }, where: userWhere }),
    prisma.learning_paths.groupBy({ by: ['subject'], _count: { _all: true }, where: userWhere }),
    prisma.milestones.count({ where: { learning_paths: userWhere } }),
    // 口径修复：subtasks.users 关系建在 usersId（生产路径从不写入，恒为 null），
    // 改走 milestones → learning_paths → users（learning_paths.users 建在 userId 上，可靠）。
    prisma.subtasks.count({ where: { milestones: { learning_paths: userWhere } } }),
  ]);
}
