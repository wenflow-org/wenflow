/**
 * 学习者模型证据读取（管理端路由的数据库边界，2026-10-22 架构审计）。
 */
import prisma from '../../config/database';

export async function findCalibrationEvidence(userId: string) {
  return prisma.learner_evidence.findMany({
    where: {
      userId,
      evidenceType: { in: ['checkpoint:result', 'review:completed', 'task:difficulty:adjustment'] },
    },
    orderBy: { occurredAt: 'desc' },
    take: 30,
    select: { evidenceType: true, payload: true, sessionId: true, taskId: true, occurredAt: true },
  });
}

/**
 * 管理端「当前进度」的展示兜底：最近一条非 abandoned 路径及其真实完成度。
 *
 * 为什么需要（2026-11-08 审计）：快照只锚 active 路径（#205，防止学员端被引导去继续学
 * 一条已下线路径）。学习者的路径一旦被运营下线（status=archived），currentPath 恒空 →
 * 管理台「当前进度」显示「尚未开始学习」，而同一页下方照常列着他 5 节已完成的课堂，
 * 同一份数据在 100 像素内自相矛盾。此查询只喂展示字段 `displayPath`，不写快照锚点，
 * 学员端行为不受影响。
 */
export async function findDisplayPathFallback(userId: string) {
  return prisma.learning_paths.findFirst({
    where: { userId, status: { not: 'abandoned' } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      milestones: {
        orderBy: { stageNumber: 'asc' },
        select: { id: true, title: true, stageNumber: true, subtasks: { select: { status: true } } },
      },
    },
  });
}
