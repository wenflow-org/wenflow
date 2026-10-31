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
