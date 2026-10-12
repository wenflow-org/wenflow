import prisma from '../../config/database';
import type { Prisma } from '@prisma/client';
import { buildRealUserWhere, buildTestUserWhere } from '../../utils/test-account';

/**
 * 学习内容治理仓储（routes/admin/learning-content.ts 的取数层）。
 * 全局学习路径目录/详情/下线恢复/删除/统计；内容治理默认仅真实用户口径。
 */

export function findLearningPathsForAdmin(where: Prisma.learning_pathsWhereInput, skip: number, take: number) {
  return prisma.learning_paths.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
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
}

export function countLearningPathsWhere(where: Prisma.learning_pathsWhereInput) {
  return prisma.learning_paths.count({ where });
}

/** 路径详情（含 milestones + subtasks，供治理页查看内容结构） */
export function findLearningPathDetail(id: string) {
  return prisma.learning_paths.findUnique({
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

export function deleteLearningPath(id: string) {
  return prisma.learning_paths.delete({ where: { id } });
}

/** 内容统计（治理页顶部：总数 / 按状态 / 按学科 / 里程碑与任务总量）。
 *  口径随列表页「真实/测试」视角开关联动（2026-10-10 用户拍板互斥视角）：
 *  默认真实视角（buildRealUserWhere）；测试视角（testOnly）= buildTestUserWhere，
 *  与 GET /paths 的分支同一判据（否则 KPI/分布条与列表不同源）。 */
export async function getLearningContentStats(includeTest = false, testOnly = false) {
  const userWhere = testOnly
    ? { users: await buildTestUserWhere() }
    : includeTest ? {} : { users: await buildRealUserWhere() };
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
