/**
 * 路径生成运行（path_generation_runs）生命周期原语
 * （架构审计 §5 行动 #2：learning.service.ts 按领域拆分——生成运行域）
 *
 * 职责：run 的创建/认领、租约心跳、失败落库、冲突恢复、生成状态（aiPromptTemplate._generation）
 * 写入与阶段日志记录。与 path-generation-status.ts（纯函数，显式传 prisma）的区别：
 * 本模块绑定本仓 prisma 单例与 withTransaction 封装，供 learning.service facade 与
 * replan 域复用；行为与拆分前 learning.service 同名私有方法逐一等价。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { withTransaction } from '../../../utils/with-transaction';
import {
  PATH_GENERATION_LEASE_MS,
  PATH_GENERATION_LEASE_OWNER,
  assertGenerationRunFence,
  createAndClaimPathGenerationRun,
  type PathGenerationRollbackSnapshotV1,
  type PathGenerationPhase,
  type PathGenerationRetryType,
} from '../path-generation-status';
import {
  assertPathMutationSafe,
  isPathMutationConflictError,
  type PathMutationKind,
  type PathMutationScope,
} from '../path-mutation-safety';
import { parsePathPromptTemplate } from '../learning.helpers';
import type { PathGenerationLogPayload, PathGenerationStatusPatch } from '../learning.types';

export function createGenerationId(prefix: 'pgr' | 'pgsi'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export async function createAndClaimGenerationRun(
  pathId: string,
  phase: PathGenerationPhase,
  retryType: PathGenerationRetryType | null = null,
  totalItems = 0,
  mutationKind?: PathMutationKind,
  expectedActiveGenerationRunId?: string | null,
  mutationScope: PathMutationScope = {}
): Promise<any> {
  const runId = createGenerationId('pgr');
  return createAndClaimPathGenerationRun(prisma, {
    runId,
    pathId,
    phase,
    retryType,
    totalItems,
    ...(expectedActiveGenerationRunId === undefined ? {} : { expectedActiveGenerationRunId }),
    guard: mutationKind
      ? (tx) => assertPathMutationSafe(tx, pathId, mutationKind, mutationScope)
      : undefined
  });
}

export async function restorePathAfterMutationConflict(
  pathId: string,
  runId: string,
  error: unknown,
  options: {
    runStatus?: 'cancelled' | 'failed';
    retryAllowed?: boolean;
    errorCode?: string;
  } = {}
): Promise<void> {
  const now = new Date();
  const errorCode = options.errorCode || (isPathMutationConflictError(error)
    ? error.code
    : 'PATH_MUTATION_CONFLICT');
  const runStatus = options.runStatus || 'cancelled';

  await withTransaction(async (tx) => {
    const path = await tx.learning_paths.findUnique({
      where: { id: pathId },
      select: {
        activeGenerationRunId: true,
        aiPromptTemplate: true,
        status: true
      }
    });
    if (!path || path.activeGenerationRunId !== runId) return;

    const run = await tx.path_generation_runs.findUnique({
      where: { id: runId },
      select: { rollbackSnapshot: true }
    });
    let rollbackSnapshot: PathGenerationRollbackSnapshotV1 | null = null;
    try {
      const parsed = run?.rollbackSnapshot ? JSON.parse(run.rollbackSnapshot) : null;
      rollbackSnapshot = parsed?.version === 1 ? parsed as PathGenerationRollbackSnapshotV1 : null;
    } catch {
      rollbackSnapshot = null;
    }

    await tx.path_generation_runs.updateMany({
      where: {
        id: runId,
        learningPathId: pathId,
        status: { in: ['queued', 'processing'] }
      },
      data: {
        status: runStatus,
        retryAllowed: options.retryAllowed === true,
        heartbeatAt: now,
        leaseExpiresAt: now,
        finishedAt: now,
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });

    const restoringCorePath = rollbackSnapshot?.path.restoreStatus === true;
    if (restoringCorePath && path.status !== 'generating') return;

    const restored = await tx.learning_paths.updateMany({
      where: {
        id: pathId,
        activeGenerationRunId: runId,
        ...(restoringCorePath ? { status: 'generating' } : {})
      },
      data: {
        activeGenerationRunId: runStatus === 'failed'
          ? runId
          : rollbackSnapshot?.supersededRun
            ? null
            : rollbackSnapshot?.path.activeGenerationRunId || null,
        aiPromptTemplate: rollbackSnapshot ? rollbackSnapshot.path.aiPromptTemplate : path.aiPromptTemplate,
        ...(rollbackSnapshot?.path.restoreStatus && path.status === 'generating'
          ? { status: rollbackSnapshot.path.status }
          : {}),
        updatedAt: now
      }
    });
    if (restored.count !== 1) return;

    if (!rollbackSnapshot) {
      logger.warn('路径生成任务缺少回滚快照，仅释放当前生成指针', { pathId, runId });
    }
  });
}

export async function claimQueuedGenerationRun(pathId: string, runId: string): Promise<any | null> {
  const now = new Date();
  const claimed = await prisma.path_generation_runs.updateMany({
    where: {
      id: runId,
      learningPathId: pathId,
      phase: 'stageDesign',
      status: 'queued',
      learningPath: { activeGenerationRunId: runId }
    },
    data: {
      status: 'processing',
      leaseOwner: PATH_GENERATION_LEASE_OWNER,
      claimedAt: now,
      startedAt: now,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + PATH_GENERATION_LEASE_MS)
    }
  });
  if (claimed.count !== 1) return null;
  return getActiveGenerationRun(pathId, runId);
}

export async function heartbeatGenerationRun(
  pathId: string,
  runId: string,
  progressPatch: { completedItems?: number; totalItems?: number; progress?: number } = {}
): Promise<void> {
  const now = new Date();
  const result = await prisma.path_generation_runs.updateMany({
    where: {
      id: runId,
      learningPathId: pathId,
      status: 'processing',
      learningPath: { activeGenerationRunId: runId }
    },
    data: {
      ...progressPatch,
      leaseOwner: PATH_GENERATION_LEASE_OWNER,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + PATH_GENERATION_LEASE_MS)
    }
  });
  if (result.count !== 1) throw new Error('GENERATION_RUN_FENCED');
}

export function startGenerationHeartbeat(pathId: string, runId: string): () => void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void heartbeatGenerationRun(pathId, runId)
      .catch((error) => {
        if (!(error instanceof Error) || error.message !== 'GENERATION_RUN_FENCED') {
          logger.warn('刷新路径生成任务心跳失败', {
            pathId,
            runId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })
      .finally(() => {
        inFlight = false;
      });
  }, Math.max(30_000, Math.floor(PATH_GENERATION_LEASE_MS / 3)));
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function failGenerationRun(
  pathId: string,
  runId: string,
  error: unknown,
  errorCode: string,
  retryType: PathGenerationRetryType,
  pathStatus?: 'failed' | 'active'
): Promise<boolean> {
  const now = new Date();
  const errorMessage = error instanceof Error ? error.message : String(error);

  return withTransaction(async (tx) => {
    const failed = await tx.path_generation_runs.updateMany({
      where: {
        id: runId,
        learningPathId: pathId,
        status: { in: ['queued', 'processing'] }
      },
      data: {
        status: 'failed',
        retryType,
        retryAllowed: true,
        heartbeatAt: now,
        leaseExpiresAt: now,
        finishedAt: now,
        errorCode,
        errorMessage
      }
    });
    if (failed.count !== 1) return false;

    const updatedPath = await tx.learning_paths.updateMany({
      where: {
        id: pathId,
        activeGenerationRunId: runId,
        // 'active' 只用于复位陈旧的 'generating'（#238）：archived/completed 是治理/结业态，
        // 后台失败不得把它们翻回可学。'failed' 保持原语义（core 失败无条件落库）。
        ...(pathStatus === 'active' ? { status: 'generating' } : {})
      },
      data: {
        ...(pathStatus ? { status: pathStatus } : {}),
        updatedAt: now
      }
    });
    return updatedPath.count === 1;
  });
}

/**
 * 收尾复位（#238）：learning_paths.status 只由 core 认领写成 'generating'，但 stageDesign /
 * replan 可以抢占 core run——被抢占的 core 之后必然撞 GENERATION_RUN_FENCED，永远不再写回
 * 'active'，于是路径永久卡在「生成中」（无法开课、与 generation-status 的矛盾、重试入口报错）。
 * 因此接管的 run 在成功/失败收尾时都必须负责把陈旧的 'generating' 复位。
 *
 * 只从 'generating' 复位：archived（管理员下线）/ completed（结业）等状态保持不变。
 */
export async function restorePathStatusAfterRunSettled(
  tx: any,
  pathId: string,
  runId: string,
  settledStatus: 'active' | 'failed' = 'active'
): Promise<void> {
  await tx.learning_paths.updateMany({
    where: { id: pathId, activeGenerationRunId: runId, status: 'generating' },
    data: { status: settledStatus, updatedAt: new Date() }
  });
}

export async function getActiveGenerationRun(pathId: string, activeGenerationRunId?: string | null): Promise<any | null> {
  if (!activeGenerationRunId) return null;
  return prisma.path_generation_runs.findFirst({
    where: { id: activeGenerationRunId, learningPathId: pathId }
  });
}

export async function updatePathGenerationStatus(
  pathId: string,
  patch: PathGenerationStatusPatch,
  runId?: string,
  expectedRunStatus: 'processing' | 'failed' = 'processing'
): Promise<void> {
  try {
    await withTransaction(async (tx) => {
      if (runId) await assertGenerationRunFence(tx, pathId, runId, expectedRunStatus);
      const existing = await tx.learning_paths.findUnique({
        where: { id: pathId },
        select: { aiPromptTemplate: true }
      });
      if (!existing) return;

      const currentTemplate = parsePathPromptTemplate(existing.aiPromptTemplate);
      const currentGeneration = currentTemplate._generation && typeof currentTemplate._generation === 'object'
        ? currentTemplate._generation
        : {};

      await tx.learning_paths.update({
        where: { id: pathId },
        data: {
          aiPromptTemplate: JSON.stringify({
            ...currentTemplate,
            _generation: {
              ...currentGeneration,
              ...patch,
              updatedAt: patch.updatedAt || new Date().toISOString()
            }
          }),
          updatedAt: new Date()
        }
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'GENERATION_RUN_FENCED') throw error;
    logger.warn('更新路径生成状态失败', {
      pathId,
      patch,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function recordPathGenerationStageLog(payload: PathGenerationLogPayload): Promise<void> {
  try {
    await prisma.agent_call_logs.create({
      data: {
        id: `acl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        agentId: 'path-agent',
        userId: payload.userId,
        sourceEntry: 'platform',
        input: JSON.stringify({
          phase: payload.phase,
          status: payload.status,
          pathId: payload.pathId || null,
          sourceConversationId: payload.sourceConversationId || null,
          triggerSource: payload.triggerSource || null,
          ...(payload.input || {})
        }),
        output: payload.output ? JSON.stringify(payload.output) : null,
        success: payload.status !== 'failed',
        durationMs: payload.durationMs || 0,
        error: payload.error || null,
        errorCode: payload.errorCode || null,
        calledAt: new Date(),
        metadata: JSON.stringify({
          eventType: 'path-generation-stage',
          executionLayer: 'flow-event',
          phase: payload.phase,
          status: payload.status,
          pathId: payload.pathId || null,
          sourceConversationId: payload.sourceConversationId || null,
          triggerSource: payload.triggerSource || null
        })
      }
    });
  } catch (error) {
    logger.warn('记录路径阶段日志失败', {
      phase: payload.phase,
      status: payload.status,
      pathId: payload.pathId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
