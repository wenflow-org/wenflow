/**
 * 运营可观测读写（管理端路由的数据库边界，2026-10-22 架构审计）。
 */
import prisma from '../../config/database';
import { ACTIVE_SESSION_STALE_MINUTES, BATCH_HEARTBEAT_STALE_MINUTES } from './throughput';

export async function loadThroughputSnapshot(since: Date, now: Date) {
  return Promise.all([
    prisma.llm_execution_attempts.findMany({
      where: { startedAt: { gte: since } },
      select: { startedAt: true, success: true, errorCategory: true },
    }),
    prisma.virtual_sessions.count({
      where: {
        status: 'running',
        updatedAt: { gte: new Date(now.getTime() - ACTIVE_SESSION_STALE_MINUTES * 60_000) },
      },
    }),
    prisma.virtual_batch_jobs.count({
      where: {
        status: { in: ['running', 'pending'] },
        updatedAt: { gte: new Date(now.getTime() - BATCH_HEARTBEAT_STALE_MINUTES * 60_000) },
      },
    }),
    prisma.virtual_experiment_leases.count({ where: { expiresAt: { gt: now } } }),
  ]);
}

export async function markBatchHeartbeat(id: string) {
  await prisma.virtual_batch_jobs.upsert({
    where: { id },
    create: { id, kind: 'throughput-heartbeat', status: 'running', note: 'ops throughput heartbeat' },
    update: { status: 'running', completedAt: null, error: null },
  });
}

export async function stopBatchHeartbeat(id: string) {
  const result = await prisma.virtual_batch_jobs.updateMany({
    where: { id, status: 'running' },
    data: { status: 'done', completedAt: new Date() },
  });
  return result.count;
}
