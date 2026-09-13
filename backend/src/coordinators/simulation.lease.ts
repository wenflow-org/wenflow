// 模拟协调器 - 会话租约（自 simulation.coordinator.ts 抽离，行为保持不变；无 this，仅 prisma / logger）
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { isPrismaErrorCode, isLeaseDatabaseBusyError } from './simulation.helpers';
import {
  VirtualSessionLeaseBusyError,
  VirtualSessionLeaseLostError,
  VirtualSessionDatabaseBusyError
} from './simulation.errors';
import {
  ASSISTED_SESSION_LEASE_MS,
  LEASE_RETRY_DELAYS_MS,
  STALE_RUNNING_SESSION_MS
} from './simulation.constants';
import type { LeaseClientLike } from '../virtual-lab/vlab-types';

export async function acquireSessionLease(sessionId: string, ownerId: string): Promise<Date> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ASSISTED_SESSION_LEASE_MS);
  try {
    const updated = await prisma.virtual_experiment_leases.updateMany({
      where: { sessionId, expiresAt: { lt: now } },
      data: { ownerId, expiresAt }
    });
    if (updated.count === 1) return expiresAt;
  } catch (error) {
    if (isLeaseDatabaseBusyError(error)) throw new VirtualSessionDatabaseBusyError(error);
    throw error;
  }

  try {
    await prisma.virtual_experiment_leases.create({
      data: { sessionId, ownerId, expiresAt }
    });
    return expiresAt;
  } catch (error) {
    if (isPrismaErrorCode(error, 'P2002')) throw new VirtualSessionLeaseBusyError();
    if (isLeaseDatabaseBusyError(error)) throw new VirtualSessionDatabaseBusyError(error);
    throw error;
  }
}

export async function releaseSessionLease(sessionId: string, ownerId: string) {
  try {
    await prisma.virtual_experiment_leases.deleteMany({ where: { sessionId, ownerId } });
  } catch (error) {
    if (isLeaseDatabaseBusyError(error)) throw new VirtualSessionDatabaseBusyError(error);
    throw error;
  }
}

export async function detectStaleRunningSession(sessionId: string) {
  try {
    const session = await prisma.virtual_sessions.findUnique({
      where: { id: sessionId },
      select: { status: true, currentStage: true, updatedAt: true }
    });
    if (!session || session.status !== 'running') return;
    const updatedAt = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_RUNNING_SESSION_MS) {
      logger.warn('[simulation-coordinator] 检测到疑似卡死的 running 会话：无活跃租约且长时间未写入，请人工确认后重启', {
        sessionId,
        currentStage: session.currentStage,
        staleMs: Date.now() - updatedAt,
        thresholdMs: STALE_RUNNING_SESSION_MS
      });
    }
  } catch (error) {
    logger.warn('[simulation-coordinator] 检查疑似卡死会话状态失败', {
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function renewSessionLease(
  sessionId: string,
  ownerId: string,
  knownExpiresAt = Date.now() + ASSISTED_SESSION_LEASE_MS,
  leaseClient: LeaseClientLike = prisma
) {
  for (let attempt = 0; ; attempt += 1) {
    const now = new Date();
    if (now.getTime() >= knownExpiresAt) throw new VirtualSessionLeaseLostError();
    const expiresAt = new Date(now.getTime() + ASSISTED_SESSION_LEASE_MS);
    try {
      const updated = await leaseClient.virtual_experiment_leases.updateMany({
        where: { sessionId, ownerId, expiresAt: { gt: now } },
        data: { expiresAt }
      });
      if (updated.count !== 1) throw new VirtualSessionLeaseLostError();
      return expiresAt;
    } catch (error) {
      if (!isLeaseDatabaseBusyError(error)) throw error;
      const delayMs = LEASE_RETRY_DELAYS_MS[attempt];
      const remainingMs = knownExpiresAt - Date.now();
      if (delayMs === undefined || remainingMs <= delayMs) {
        throw new VirtualSessionDatabaseBusyError(error);
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
