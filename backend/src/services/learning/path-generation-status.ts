export type PathGenerationPhase = 'core' | 'stageDesign';
export type PathGenerationRunStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
export type PathGenerationRetryType = 'core' | 'stageDesign';
export type StageDesignStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export interface PersistedPathGenerationRun {
  id: string;
  phase: PathGenerationPhase | string;
  status: PathGenerationRunStatus | string;
  retryType?: string | null;
  retryAllowed?: boolean;
  progress?: number;
  completedItems?: number;
  totalItems?: number;
  heartbeatAt?: Date | string | null;
  leaseExpiresAt?: Date | string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

interface StageDesignGenerationStatus {
  core?: StageDesignStatus;
  stageDesign?: StageDesignStatus;
  updatedAt?: string | null;
  lastStageDesignRetryAt?: string | null;
}

export interface RetryDecision {
  allowed: boolean;
  retryType: PathGenerationRetryType | null;
  reason: 'failed' | 'stale' | 'not-failed' | 'completed';
}

export const PATH_GENERATION_LEASE_MS = 5 * 60 * 1000;
export const PATH_GENERATION_LEASE_OWNER = process.env.INSTANCE_ID || `process-${process.pid}`;
const STALE_STAGE_DESIGN_MINUTES = 4;
const STALE_CORE_MINUTES = 15;

export function calculateStageProgress(completedItems: number, totalItems: number) {
  if (totalItems <= 0) return { completedItems: 0, totalItems: 0, progress: 0 };
  const completed = Math.min(Math.max(0, completedItems), totalItems);
  return {
    completedItems: completed,
    totalItems,
    progress: Math.floor((completed / totalItems) * 100)
  };
}

export function assertStageTasksPresent(stageNumber: number, tasks: unknown[]): void {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error(`PATH_STAGE_DESIGN_EMPTY_TASKS:${stageNumber}`);
  }
}

export function isGenerationRunStale(
  run: Pick<PersistedPathGenerationRun, 'status' | 'leaseExpiresAt'> | null | undefined,
  now = Date.now()
): boolean {
  if (!run || (run.status !== 'queued' && run.status !== 'processing')) return false;
  if (!run.leaseExpiresAt) return run.status === 'processing';
  const leaseExpiresAt = new Date(run.leaseExpiresAt).getTime();
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= now;
}

export function resolveGenerationRetry(
  pathStatus: string | null | undefined,
  generationStatus: StageDesignGenerationStatus | null,
  activeRun: PersistedPathGenerationRun | null | undefined,
  pathUpdatedAt: Date,
  now = Date.now()
): RetryDecision {
  if (activeRun) {
    if (activeRun.status === 'succeeded') {
      if (activeRun.phase === 'core' && generationStatus?.stageDesign === 'failed') {
        return { allowed: true, retryType: 'stageDesign', reason: 'failed' };
      }
      if (activeRun.phase === 'core' && isStageDesignStale(generationStatus, pathUpdatedAt, now)) {
        return { allowed: true, retryType: 'stageDesign', reason: 'stale' };
      }
      return { allowed: false, retryType: null, reason: 'completed' };
    }
    if (activeRun.status === 'failed' && activeRun.retryAllowed !== false) {
      return {
        allowed: true,
        retryType: activeRun.phase === 'stageDesign' ? 'stageDesign' : 'core',
        reason: 'failed'
      };
    }
    if (isGenerationRunStale(activeRun, now)) {
      return {
        allowed: true,
        retryType: activeRun.phase === 'stageDesign' ? 'stageDesign' : 'core',
        reason: 'stale'
      };
    }
    return { allowed: false, retryType: null, reason: 'not-failed' };
  }

  if (generationStatus?.core === 'failed' || pathStatus === 'failed') {
    return { allowed: true, retryType: 'core', reason: 'failed' };
  }
  if (generationStatus?.stageDesign === 'failed') {
    return { allowed: true, retryType: 'stageDesign', reason: 'failed' };
  }
  if (isStageDesignStale(generationStatus, pathUpdatedAt, now)) {
    return { allowed: true, retryType: 'stageDesign', reason: 'stale' };
  }
  if (pathStatus === 'generating' && now - pathUpdatedAt.getTime() >= STALE_CORE_MINUTES * 60 * 1000) {
    return { allowed: true, retryType: 'core', reason: 'stale' };
  }
  return { allowed: false, retryType: null, reason: 'not-failed' };
}

export function isStageDesignStale(
  generationStatus: StageDesignGenerationStatus | null,
  pathUpdatedAt: Date,
  now = Date.now()
): boolean {
  if (generationStatus?.stageDesign !== 'pending' && generationStatus?.stageDesign !== 'processing') {
    return false;
  }

  const rawTime = generationStatus.updatedAt
    || generationStatus.lastStageDesignRetryAt
    || pathUpdatedAt?.toISOString?.()
    || pathUpdatedAt;
  const timestamp = new Date(rawTime).getTime();
  return Number.isFinite(timestamp) && now - timestamp >= STALE_STAGE_DESIGN_MINUTES * 60 * 1000;
}

export function buildGenerationRunStatus(run: PersistedPathGenerationRun | null | undefined) {
  if (!run) return null;
  const retryAllowed = run.retryAllowed === true || isGenerationRunStale(run);
  return {
    runId: run.id,
    phase: run.phase,
    status: run.status,
    heartbeatAt: run.heartbeatAt ? new Date(run.heartbeatAt).toISOString() : null,
    leaseExpiresAt: run.leaseExpiresAt ? new Date(run.leaseExpiresAt).toISOString() : null,
    progress: run.progress || 0,
    completedItems: run.completedItems || 0,
    totalItems: run.totalItems || 0,
    error: run.errorMessage || null,
    errorCode: run.errorCode || null,
    retryType: run.retryType || (retryAllowed ? (run.phase === 'stageDesign' ? 'stageDesign' : 'core') : null),
    retryAllowed
  };
}

export function getSafeGenerationErrorMessage(
  phase: PathGenerationPhase | string | null | undefined,
  status: string | null | undefined,
  errorCode?: string | null
): string | null {
  if (status !== 'failed' && status !== 'stale') return null;
  if (errorCode === 'GENERATION_LEASE_EXPIRED' || status === 'stale') {
    return phase === 'stageDesign'
      ? '阶段任务准备长时间没有更新，可以重新准备阶段任务。'
      : '路径主结构长时间没有更新，可以重新生成主结构。';
  }
  if (errorCode === 'PATH_STAGE_DESIGN_ZERO_TASKS') {
    return '部分阶段没有生成有效任务，可以重新准备阶段任务。';
  }
  return phase === 'stageDesign'
    ? '阶段任务准备失败，路径主结构已保留，可以重新准备阶段任务。'
    : '路径主结构生成失败，可以重新生成主结构。';
}

export async function assertGenerationRunFence(
  tx: any,
  pathId: string,
  runId: string,
  expectedStatus: PathGenerationRunStatus = 'processing'
): Promise<void> {
  const [path, run] = await Promise.all([
    tx.learning_paths.findFirst({
      where: { id: pathId, activeGenerationRunId: runId },
      select: { id: true }
    }),
    tx.path_generation_runs.findFirst({
      where: { id: runId, learningPathId: pathId, status: expectedStatus },
      select: { id: true }
    })
  ]);

  if (!path || !run) {
    throw new Error('GENERATION_RUN_FENCED');
  }
}

export async function createAndClaimPathGenerationRun(
  prisma: any,
  input: {
    runId: string;
    pathId: string;
    phase: PathGenerationPhase;
    retryType?: PathGenerationRetryType | null;
    totalItems?: number;
    now?: Date;
  }
) {
  const now = input.now || new Date();
  return prisma.$transaction(async (tx: any) => {
    const path = await tx.learning_paths.findUnique({
      where: { id: input.pathId },
      select: { id: true, activeGenerationRunId: true }
    });
    if (!path) throw new Error('学习路径不存在');

    if (path.activeGenerationRunId) {
      await tx.path_generation_runs.updateMany({
        where: {
          id: path.activeGenerationRunId,
          status: { in: ['queued', 'processing'] }
        },
        data: {
          status: 'cancelled',
          retryAllowed: false,
          finishedAt: now,
          leaseExpiresAt: now,
          errorCode: 'SUPERSEDED',
          errorMessage: '已由新的生成任务接管'
        }
      });
    }

    const attempt = await tx.path_generation_runs.count({
      where: { learningPathId: input.pathId, phase: input.phase }
    }) + 1;
    const run = await tx.path_generation_runs.create({
      data: {
        id: input.runId,
        learningPathId: input.pathId,
        phase: input.phase,
        status: 'queued',
        retryType: input.retryType || null,
        retryAllowed: false,
        attempt,
        totalItems: input.totalItems || 0,
        completedItems: 0,
        progress: 0
      }
    });

    await tx.learning_paths.update({
      where: { id: input.pathId },
      data: {
        activeGenerationRunId: input.runId,
        ...(input.phase === 'core' ? { status: 'generating' } : {}),
        updatedAt: now
      }
    });

    const leaseExpiresAt = new Date(now.getTime() + PATH_GENERATION_LEASE_MS);
    const claimed = await tx.path_generation_runs.updateMany({
      where: {
        id: input.runId,
        learningPathId: input.pathId,
        status: 'queued'
      },
      data: {
        status: 'processing',
        leaseOwner: PATH_GENERATION_LEASE_OWNER,
        claimedAt: now,
        startedAt: now,
        heartbeatAt: now,
        leaseExpiresAt
      }
    });
    if (claimed.count !== 1) throw new Error('GENERATION_RUN_CLAIM_FAILED');

    return {
      ...run,
      status: 'processing',
      claimedAt: now,
      startedAt: now,
      heartbeatAt: now,
      leaseExpiresAt
    };
  });
}

export async function claimExpiredGenerationRun(
  prisma: any,
  input: {
    runId: string;
    pathId: string;
    expiredAt: Date;
    now?: Date;
  }
): Promise<boolean> {
  const now = input.now || new Date();
  return prisma.$transaction(async (tx: any) => {
    const claimed = await tx.path_generation_runs.updateMany({
      where: {
        id: input.runId,
        learningPathId: input.pathId,
        status: { in: ['queued', 'processing'] },
        OR: [
          { leaseExpiresAt: { lte: input.expiredAt } },
          { status: 'processing', leaseExpiresAt: null }
        ],
        learningPath: { activeGenerationRunId: input.runId }
      },
      data: {
        status: 'failed',
        retryAllowed: true,
        heartbeatAt: now,
        leaseExpiresAt: now,
        finishedAt: now,
        errorCode: 'GENERATION_LEASE_EXPIRED',
        errorMessage: 'GENERATION_LEASE_EXPIRED'
      }
    });
    if (claimed.count !== 1) return false;

    await tx.learning_paths.updateMany({
      where: { id: input.pathId, activeGenerationRunId: input.runId },
      data: { updatedAt: now }
    });
    return true;
  });
}
