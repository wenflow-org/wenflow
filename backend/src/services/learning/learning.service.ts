// 学习服务
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { withTransaction } from '../../utils/with-transaction';
import achievementService from '../achievements/achievement.service';
import { dashboardGuidanceSnapshotService } from '../learner/DashboardGuidanceSnapshotService';
import { learnerStateReviewService } from '../learner/LearnerStateReviewService';
import { conceptConsolidatorService } from '../learner/ConceptConsolidatorService';
import { runBackgroundTask } from '../background-task-tracker.service';
import { learnerSnapshotRefreshService } from '../learner/LearnerSnapshotRefreshService';
import { learnerProgressService } from '../learner/LearnerProgressService';
import { createDomainEvent } from '../../events/contracts';
import { enqueueDomainEvent } from '../../events/outbox.repository';
import {
  claimExpiredGenerationRun,
  isGenerationRunStale,
  isStageDesignStale,
  resolveGenerationRetry,
  type PathGenerationRollbackSnapshotV1,
} from './path-generation-status';
import {
  assertPathMutationSafe,
  PathMutationConflictError,
} from './path-mutation-safety';

// Path 任务画像 Skills

// 模块级类型 / 常量 / 纯工具函数已抽离到同目录下的 learning.types / learning.constants / learning.helpers
import {
  type CreateGoalData,
  type GeneratePathData,
  type PathReplanRequest,
  type ParsedPathGenerationStatus,
  type CompleteTaskData,
} from './learning.types';
import {
  STALE_GENERATING_PATH_MINUTES,
  ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES,
  TERMINAL_STAGE_DESIGN_RETRY_CODES,
} from './learning.constants';
import {
  parsePathGenerationStatus,
  parsePathPromptTemplate,
} from './learning.helpers';
import {
  createAndClaimGenerationRun as createAndClaimGenerationRunImpl,
  restorePathAfterMutationConflict as restorePathAfterMutationConflictImpl,
  getActiveGenerationRun,
  updatePathGenerationStatus as updatePathGenerationStatusImpl,
} from './generation/run-lifecycle';
import {
  getNextEnrichmentRetryDelayMinutes,
  getEnrichmentRetryReferenceTime as getEnrichmentRetryReferenceTimeImpl,
  listEmptyMilestoneIds as listEmptyMilestoneIdsImpl,
  isAppendBlockedByInFlightGeneration,
} from './generation/retry-policy';
import { requestPathReplan } from './replan/path-replan.service';
import {
  getPathLearningAccessState,
  getLearningPath,
  getPathGenerationLifecycle,
  getUserLearningPaths,
  getTaskDetail,
  getTaskById,
  getLearningStats,
} from './queries/path-views.queries';
import {
  createLearningGoal,
  getLearningGoals,
  updateLearningGoal,
  getTodaySchedule,
  planTodaySchedule,
} from './goals/goal-schedule.service';
import {
  generateLearningPath,
  claimPathCoreGeneration,
  markActiveGenerationFailed,
} from './generation/path-generation.core';
import { enrichLearningPathWithAnderson } from './generation/stage-enrichment';

export { normalizePathHoursFromTasks } from './learning.helpers';

class LearningService {
  private createAndClaimGenerationRun(
    pathId: string,
    phase: 'core' | 'stageDesign',
    retryType: 'core' | 'stageDesign' | null = null,
    totalItems = 0,
    mutationKind?: any,
    expectedActiveGenerationRunId?: string | null,
    mutationScope: any = {}
  ): Promise<any> {
    return createAndClaimGenerationRunImpl(pathId, phase, retryType, totalItems, mutationKind, expectedActiveGenerationRunId, mutationScope);
  }

  private async updatePathGenerationStatus(
    pathId: string,
    patch: any,
    runId?: string,
    expectedRunStatus: 'processing' | 'failed' = 'processing'
  ): Promise<void> {
    return updatePathGenerationStatusImpl(pathId, patch, runId, expectedRunStatus);
  }

  private getEnrichmentRetryReferenceTime(path: { updatedAt: Date }, generationStatus: any): number {
    return getEnrichmentRetryReferenceTimeImpl(path, generationStatus);
  }

  private async listEmptyMilestoneIds(pathId: string): Promise<string[]> {
    return listEmptyMilestoneIdsImpl(pathId);
  }

  private async restorePathAfterMutationConflict(
    pathId: string,
    runId: string,
    error: unknown,
    options: {
      runStatus?: 'cancelled' | 'failed';
      retryAllowed?: boolean;
      errorCode?: string;
    } = {}
  ): Promise<void> {
    return restorePathAfterMutationConflictImpl(pathId, runId, error, options);
  }

  /** 追加式补齐的目标阶段（无则空数组）：生成在途时返回空（避免与在途生成重复）。 */
  private async resolveAppendMilestoneIds(
    pathId: string,
    generationStatus: any,
    activeRun: any,
    pathUpdatedAt: Date
  ): Promise<string[]> {
    if (isAppendBlockedByInFlightGeneration(generationStatus, activeRun, pathUpdatedAt)) return [];
    return this.listEmptyMilestoneIds(pathId);
  }
  private async queuePathEnrichmentRetry(
    path: {
      id: string;
      userId: string;
      title?: string | null;
      name?: string | null;
      description?: string | null;
      subject?: string | null;
      deadline?: Date | null;
      deadlineText?: string | null;
      aiPromptTemplate?: string | null;
      activeGenerationRunId?: string | null;
    },
    generationStatus: ParsedPathGenerationStatus | null
  ): Promise<{ retryCount: number; runId: string }> {
    const retryCount = (generationStatus?.stageDesignRetryCount || 0) + 1;
    const retryAt = new Date().toISOString();
    const run = await this.createAndClaimGenerationRun(
      path.id,
      'stageDesign',
      'stageDesign',
      0,
      'replace-tasks',
      path.activeGenerationRunId
    );

    await this.updatePathGenerationStatus(path.id, {
      stageDesign: 'processing',
      lastError: null,
      stageDesignRetryCount: retryCount,
      lastStageDesignRetryAt: retryAt,
      updatedAt: retryAt
    }, run.id);

    const analysis = {
      ...parsePathPromptTemplate(path.aiPromptTemplate || null),
      subject: path.subject || '综合'
    };

    runBackgroundTask('learning.path.stage-enrichment-retry', () => enrichLearningPathWithAnderson(path.id, run.id, {
      userId: path.userId,
      description: path.description || path.title || path.name || '个性化学习路径',
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      sourceConversationId: generationStatus?.sourceConversationId || undefined,
      generationRunId: run.id,
      userProfile: {}
    }, analysis), { pathId: path.id, runId: run.id, userId: path.userId });

    return { retryCount, runId: run.id };
  }

  /**
   * 追加式补齐：仅对"零子任务"阶段生成任务（不删除、不覆盖既有任务）。
   *
   * 场景：`replace-tasks` 被路径变更保护拦下（路径已有已完成课堂证据）而阶段却为空的死局
   * （实测：3 条路径共 11 个零子任务里程碑）——**创建任务不构成"删除或覆盖"**，
   * 故走 `append-tasks` 契约（自带"必须限定到空白阶段"约束），合规且不丢任何证据。
   */
  private async queuePathEnrichmentAppend(
    path: {
      id: string; userId: string; subject?: string | null; description?: string | null;
      title?: string | null; name?: string | null; deadline?: Date | null; deadlineText?: string | null;
      aiPromptTemplate?: string | null; activeGenerationRunId?: string | null;
    },
    generationStatus: ParsedPathGenerationStatus | null,
    milestoneIds: string[]
  ): Promise<{ retryCount: number; runId: string }> {
    const appendCount = (generationStatus?.stageDesignAppendCount || 0) + 1;
    const retryAt = new Date().toISOString();
    const run = await this.createAndClaimGenerationRun(
      path.id,
      'stageDesign',
      'stageDesign',
      0,
      'append-tasks',
      path.activeGenerationRunId,
      { milestoneIds }
    );

    await this.updatePathGenerationStatus(path.id, {
      stageDesign: 'processing',
      lastError: null,
      // 独立预算：不占用 replace 的重试次数（replace 可能已被永久冲突耗尽）
      stageDesignAppendCount: appendCount,
      lastStageDesignRetryAt: retryAt,
      updatedAt: retryAt
    }, run.id);

    const analysis = {
      ...parsePathPromptTemplate(path.aiPromptTemplate || null),
      subject: path.subject || '综合'
    };

    runBackgroundTask('learning.path.stage-enrichment-append', () => enrichLearningPathWithAnderson(path.id, run.id, {
      userId: path.userId,
      description: path.description || path.title || path.name || '个性化学习路径',
      subject: path.subject || undefined,
      deadline: path.deadline || undefined,
      deadlineText: path.deadlineText || undefined,
      sourceConversationId: generationStatus?.sourceConversationId || undefined,
      generationRunId: run.id,
      userProfile: {}
    }, analysis, { appendOnly: true }), { pathId: path.id, runId: run.id, userId: path.userId });

    return { retryCount: appendCount, runId: run.id };
  }
  async recoverStaleGeneratingPaths(): Promise<number> {
    const now = new Date();
    const staleRuns = await prisma.path_generation_runs.findMany({
      where: {
        status: { in: ['queued', 'processing'] },
        OR: [
          { leaseExpiresAt: { lte: now } },
          { status: 'processing', leaseExpiresAt: null }
        ]
      },
      select: {
        id: true,
        learningPathId: true,
        phase: true,
        attempt: true,
        inputSnapshot: true,
        rollbackSnapshot: true,
        learningPath: { select: { activeGenerationRunId: true } }
      }
    });
    let recoveredRuns = 0;
    for (const run of staleRuns) {
      if (run.learningPath.activeGenerationRunId !== run.id) {
        await prisma.path_generation_runs.updateMany({
          where: { id: run.id, status: { in: ['queued', 'processing'] } },
          data: {
            status: 'cancelled',
            retryAllowed: false,
            leaseExpiresAt: now,
            finishedAt: now,
            errorCode: 'SUPERSEDED',
            errorMessage: '已由新的生成任务接管'
          }
        });
        continue;
      }
      let inputSnapshot: GeneratePathData | null = null;
      let rollbackSnapshot: PathGenerationRollbackSnapshotV1 | null = null;
      try {
        inputSnapshot = run.inputSnapshot ? JSON.parse(run.inputSnapshot) as GeneratePathData : null;
      } catch {
        inputSnapshot = null;
      }
      try {
        const parsed = run.rollbackSnapshot ? JSON.parse(run.rollbackSnapshot) : null;
        rollbackSnapshot = parsed?.version === 1 ? parsed as PathGenerationRollbackSnapshotV1 : null;
      } catch {
        rollbackSnapshot = null;
      }
      const restoreExistingCorePath = run.phase === 'core'
        && inputSnapshot?.createdPlaceholder !== true
        && rollbackSnapshot?.path.status !== 'generating'
        && rollbackSnapshot?.path.status !== 'failed'
        && rollbackSnapshot?.path.restoreStatus === true;
      const claimOutcome = await claimExpiredGenerationRun(prisma, {
        runId: run.id,
        pathId: run.learningPathId,
        expiredAt: now,
        restorePath: restoreExistingCorePath
          ? {
              status: rollbackSnapshot.path.status,
              aiPromptTemplate: rollbackSnapshot.path.aiPromptTemplate
            }
          : undefined
      });
      if (claimOutcome.claimed) {
        const pathStateChanged = claimOutcome.pathState?.status !== 'generating';
        const hasExistingContent = run.phase === 'core'
          && inputSnapshot?.createdPlaceholder !== true
          && (claimOutcome.pathState?.milestoneCount || 0) > 0;
        const unsafeExistingCoreState = run.phase === 'core'
          && inputSnapshot?.createdPlaceholder !== true
          && (!rollbackSnapshot || !claimOutcome.pathRestored)
          && hasExistingContent;
        const existingPathRestoreFailed = restoreExistingCorePath && !claimOutcome.pathRestored;
        const preserveCurrentPath = run.phase === 'core'
          && (pathStateChanged || unsafeExistingCoreState || existingPathRestoreFailed);

        if (!claimOutcome.pathRestored && !preserveCurrentPath) {
          await this.updatePathGenerationStatus(run.learningPathId, run.phase === 'stageDesign'
            ? { stageDesign: 'failed', lastError: 'GENERATION_LEASE_EXPIRED' }
            : { core: 'failed', lastError: 'GENERATION_LEASE_EXPIRED' }, run.id, 'failed');
        }
        if (run.phase === 'core' && !claimOutcome.pathRestored && !preserveCurrentPath) {
          await prisma.learning_paths.updateMany({
            where: {
              id: run.learningPathId,
              activeGenerationRunId: run.id,
              status: 'generating'
            },
            data: { status: 'failed', updatedAt: new Date() }
          });
        }
        recoveredRuns += 1;
        const canAutoReplace = run.phase === 'core'
          && inputSnapshot
          && run.attempt < 3
          && !pathStateChanged
          && !unsafeExistingCoreState
          && (inputSnapshot.createdPlaceholder === true || claimOutcome.pathRestored);
        if (canAutoReplace) {
          try {
            const replacement = await this.createAndClaimGenerationRun(
              run.learningPathId,
              'core',
              'core',
              0,
              undefined,
              run.id
            );
            const recoveredInput: GeneratePathData = {
              ...inputSnapshot,
              existingPathId: run.learningPathId,
              generationRunId: replacement.id,
              createdPlaceholder: inputSnapshot.createdPlaceholder,
              deadline: inputSnapshot.deadline ? new Date(inputSnapshot.deadline) : undefined
            };
            runBackgroundTask(
              'learning.path.core-recovery',
              () => this.generateLearningPath(recoveredInput),
              { pathId: run.learningPathId, runId: replacement.id }
            );
          } catch (error) {
            logger.warn('核心路径生成输入快照不可恢复', {
              pathId: run.learningPathId,
              runId: run.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    }

    const staleBefore = new Date(Date.now() - STALE_GENERATING_PATH_MINUTES * 60 * 1000);

    const stalePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'generating',
        activeGenerationRunId: null,
        updatedAt: { lt: staleBefore }
      },
      select: { id: true }
    });

    const result = await prisma.learning_paths.updateMany({
      where: {
        status: 'generating',
        activeGenerationRunId: null,
        updatedAt: { lt: staleBefore }
      },
      data: {
        status: 'failed',
        updatedAt: new Date()
      }
    });

    if (result.count > 0) {
      logger.warn('发现并回收陈旧 generating 路径', {
        staleMinutes: STALE_GENERATING_PATH_MINUTES,
        recoveredCount: result.count
      });

      await Promise.all(stalePaths.map((path) => this.updatePathGenerationStatus(path.id, {
        core: 'failed',
        lastError: 'GENERATION_TIMEOUT_ORPHANED'
      })));
    }

    return recoveredRuns + result.count;
  }

  async retryEligibleFailedPathPreparations(): Promise<number> {
    const candidatePaths = await prisma.learning_paths.findMany({
      where: {
        status: 'active',
        aiGenerated: true
      },
      select: {
        id: true,
        status: true,
        userId: true,
        title: true,
        name: true,
        description: true,
        subject: true,
        deadline: true,
        deadlineText: true,
        aiPromptTemplate: true,
        activeGenerationRunId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' }
    });

    let retriedCount = 0;

    for (const path of candidatePaths) {
      const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
      const activeRun = await getActiveGenerationRun(path.id, path.activeGenerationRunId);
      const retry = resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt);
      const canReplace = retry.allowed && retry.retryType === 'stageDesign';
      const replaceBudgetLeft = (generationStatus?.stageDesignRetryCount || 0) < ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length;
      const useReplace = canReplace && replaceBudgetLeft;

      // 追加式自愈（两个入口）：
      //  ① replace 不可用（既非 failed 也非 stale）；或
      //  ② replace 预算已被耗尽（典型：被课堂证据永久冲突反复顶满）
      // 只要仍有"空白阶段"就改走追加通道（只创建、不删除，不会与证据冲突）。
      // 生成在途时一律不追加（resolveAppendMilestoneIds 内已判，避免与在途生成重复）。
      let appendMilestoneIds: string[] = [];
      if (!useReplace) {
        appendMilestoneIds = await this.resolveAppendMilestoneIds(path.id, generationStatus, activeRun, path.updatedAt);
        if (appendMilestoneIds.length === 0) continue;
      }

      const retryCount = useReplace
        ? (generationStatus?.stageDesignRetryCount || 0)
        : (generationStatus?.stageDesignAppendCount || 0);
      if (retryCount >= ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length) {
        continue;
      }

      const retryReferenceTime = this.getEnrichmentRetryReferenceTime(path, generationStatus);
      const requiredDelayMs = getNextEnrichmentRetryDelayMinutes(retryCount) * 60 * 1000;
      if (Date.now() - retryReferenceTime < requiredDelayMs) {
        continue;
      }

      try {
        if (useReplace) {
          await this.queuePathEnrichmentRetry(path, generationStatus);
        } else {
          await this.queuePathEnrichmentAppend(path, generationStatus, appendMilestoneIds);
        }
        retriedCount += 1;
      } catch (error) {
        const rawCode = (error as { code?: unknown })?.code;
        const errorCode = typeof rawCode === 'string' ? rawCode : '';
        // P4：失败也必须把重试计数落库。原实现只在 queuePathEnrichmentRetry 成功、
        // 且预检通过之后才自增计数（createAndClaimGenerationRun 的 guard 在计数写入之前），
        // 预检一抛错计数就停在 0，于是每分钟按「第 1 次、延迟 1 分钟」无限重试。
        // 对不可自愈的路径变更冲突直接把次数顶到上限，终止自动重试
        //（replace 顶满后，下一次轮询会自动改用追加通道，见上）。
        const terminal = TERMINAL_STAGE_DESIGN_RETRY_CODES.has(errorCode);
        const nextRetryCount = terminal
          ? ENRICHMENT_AUTO_RETRY_DELAYS_MINUTES.length
          : retryCount + 1;
        await this.updatePathGenerationStatus(path.id, {
          ...(useReplace
            ? { stageDesignRetryCount: nextRetryCount }
            : { stageDesignAppendCount: nextRetryCount }),
          lastStageDesignRetryAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString()
        });
        logger.warn('自动继续生成阶段任务失败', {
          pathId: path.id,
          retryCount: nextRetryCount,
          appendMode: !useReplace,
          terminal,
          ...(errorCode ? { errorCode } : {}),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (retriedCount > 0) {
      logger.info('已触发阶段任务自动继续生成', { retriedCount });
    }

    return retriedCount;
  }
  async markTaskInProgress(taskId: string, userId: string) {
    const subtask = await prisma.subtasks.findUnique({
      where: { id: taskId },
      include: {
        milestones: {
          include: {
            learning_paths: {
              select: {
                userId: true,
              }
            }
          }
        }
      }
    });

    if (!subtask) {
      throw new Error('任务不存在');
    }

    const pathOwner = subtask.milestones?.learning_paths?.userId;
    if (pathOwner && pathOwner !== userId) {
      throw new Error('无权访问此任务');
    }

    if (subtask.status === 'todo') {
      await prisma.subtasks.update({
        where: { id: taskId },
        data: {
          status: 'in_progress',
          updatedAt: new Date(),
        }
      });
    }
  }

  // 创建简单的学习路径
  async createLearningPath(data: {
    userId: string;
    name: string;
    title?: string;
    description?: string;
  }) {
    try {
      const learningPath = await prisma.learning_paths.create({
        data: {
          id: `lp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          userId: data.userId,
          name: data.name,
          title: data.title || data.name,
          description: data.description || '',
          updatedAt: new Date()
        }
      });

      logger.info(`学习路径创建：${learningPath.id}`);

      return learningPath;
    } catch (error) {
      logger.error('创建学习路径失败:', error);
      throw error;
    }
  }

  // 使用 AI 生成学习路径 (阶段化设计)
  async generateLearningPath(data: GeneratePathData) {
    return generateLearningPath(data);
  }

  async retryPathEnrichment(pathId: string, userId: string) {
    const path = await prisma.learning_paths.findUnique({
      where: { id: pathId }
    });

    if (!path) {
      throw new Error('学习路径不存在');
    }

    if (path.userId !== userId) {
      throw new Error('无权访问此学习路径');
    }

    if (path.status !== 'active') {
      throw new Error('学习路径主结构尚未完成，暂不能继续生成阶段任务');
    }

    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
    const activeRun = await getActiveGenerationRun(path.id, path.activeGenerationRunId);
    const retry = resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt);
    if (retry.allowed && retry.retryType === 'stageDesign') {
      const queued = await this.queuePathEnrichmentRetry(path, generationStatus);
      return {
        accepted: true,
        retryType: 'stageDesign' as const,
        mode: 'replace' as const,
        retryCount: queued.retryCount,
        runId: queued.runId
      };
    }

    // 标准 replace-tasks 不可用（典型：路径已有课堂证据被保护，删除/覆盖被拒）时，
    // 若仍存在"空白阶段"，用**追加式**补齐（只创建、不删除 → 合规且不丢证据）。
    // 注意：生成仍在进行中（且未超时）时不得追加，否则与在途生成重复。
    const generationInFlight = (activeRun != null
        && (activeRun.status === 'queued' || activeRun.status === 'processing')
        && !isGenerationRunStale(activeRun))
      || (generationStatus?.stageDesign === 'processing'
        && !isStageDesignStale(generationStatus, path.updatedAt));
    if (!generationInFlight) {
      const emptyMilestoneIds = await this.listEmptyMilestoneIds(path.id);
      if (emptyMilestoneIds.length > 0) {
        const queued = await this.queuePathEnrichmentAppend(path, generationStatus, emptyMilestoneIds);
        return {
          accepted: true,
          retryType: 'stageDesign' as const,
          mode: 'append' as const,
          retryCount: queued.retryCount,
          runId: queued.runId,
          emptyMilestoneCount: emptyMilestoneIds.length
        };
      }
    }

    throw new Error(activeRun?.status === 'succeeded' || generationStatus?.stageDesign === 'succeeded'
      ? '阶段任务已经准备完成，无需重试'
      : '阶段任务仍在生成中，请稍后查看');
  }

  async getPathGenerationRetry(pathId: string, userId: string) {
    const path = await prisma.learning_paths.findUnique({ where: { id: pathId } });
    if (!path) throw new Error('学习路径不存在');
    if (path.userId !== userId) throw new Error('无权访问此学习路径');

    const generationStatus = parsePathGenerationStatus(path.aiPromptTemplate);
    const activeRun = await getActiveGenerationRun(path.id, path.activeGenerationRunId);
    return {
      ...resolveGenerationRetry(path.status, generationStatus, activeRun, path.updatedAt),
      expectedActiveGenerationRunId: path.activeGenerationRunId
    };
  }

  async claimPathCoreGeneration(
    pathId: string,
    expectedActiveGenerationRunId?: string | null,
    options: { allowCompleted?: boolean } = {}
  ): Promise<string> {
    return claimPathCoreGeneration(pathId, expectedActiveGenerationRunId, options);
  }

  async markActiveGenerationFailed(pathId: string, error: unknown, runId?: string): Promise<void> {
    return markActiveGenerationFailed(pathId, error, runId);
  }

  async assertTaskReadyForLearning(
    taskId: string,
    userId: string,
    options: { requireTaskIncomplete?: boolean } = {}
  ) {
    const task = await prisma.subtasks.findUnique({
      where: { id: taskId },
      include: {
        milestones: {
          include: {
            learning_paths: {
              select: {
                id: true,
                userId: true,
                status: true,
                aiPromptTemplate: true,
                activeGenerationRunId: true
              }
            }
          }
        }
      }
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    // 已完成任务默认不允许再开「上课」会话（避免直接访问 /learn/<taskId> 又新建一节课）；
    // 由用户上课路由显式传入 requireTaskIncomplete 生效——复习课 / quick-learn 等
    // 既有调用方行为保持不变（复习课本就作用于已完成任务）。
    if (options.requireTaskIncomplete && task.status === 'completed') {
      const error = new Error('该任务已完成，请查看学习反馈，或从学习路径页选择重学');
      (error as { code?: string; status?: number }).code = 'TASK_ALREADY_COMPLETED';
      (error as { code?: string; status?: number }).status = 409;
      throw error;
    }

    const milestone = task.milestones;
    const learningPath = milestone?.learning_paths;

    if (!learningPath) {
      return;
    }

    if (learningPath.userId !== userId) {
      throw new Error('无权访问此任务');
    }

    // 校验 milestone 是否已解锁
    if (milestone && milestone.status === 'locked') {
      throw new Error('此阶段尚未解锁，请先完成前置阶段');
    }

    const activeRun = await getActiveGenerationRun(learningPath.id, learningPath.activeGenerationRunId);
    const accessState = getPathLearningAccessState(
      learningPath.status,
      learningPath.aiPromptTemplate,
      activeRun,
      true,
      1
    );

    if (!accessState.canStartLearning) {
      throw new Error(accessState.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    }
  }

  // 删除学习路径
  async deleteLearningPath(pathId: string, userId: string) {
    try {
      await withTransaction(async (tx) => {
        const path = await tx.learning_paths.findUnique({
          where: { id: pathId },
          select: { userId: true }
        });

        if (!path) {
          throw new Error('学习路径不存在');
        }

        if (path.userId !== userId) {
          throw new Error('无权删除此学习路径');
        }

        const lockedPath = await tx.learning_paths.updateMany({
          where: { id: pathId },
          data: { updatedAt: new Date() }
        });
        if (lockedPath.count !== 1) throw new Error('学习路径不存在');
        await assertPathMutationSafe(tx, pathId, 'delete-path');
        await tx.learning_paths.delete({
          where: { id: pathId }
        });
      });

      dashboardGuidanceSnapshotService.refreshInBackground(userId, 'path-deleted');

      logger.info(`学习路径删除：${pathId}`);
    } catch (error) {
      logger.error('删除学习路径失败:', error);
      throw error;
    }
  }

  // 预留：基于已学内容重调学习路径（默认 new_version）

  async requestPathReplan(data: PathReplanRequest) {
    return requestPathReplan(data);
  }

  // 完成任务
  async completeTask(data: CompleteTaskData) {
    try {
      const observedSubtask = await prisma.subtasks.findUnique({
        where: { id: data.taskId },
        include: {
          milestones: {
            include: {
              learning_paths: {
                select: { id: true, userId: true }
              }
            }
          }
        }
      });

      if (!observedSubtask) {
        throw new Error('任务不存在');
      }

      if (
        observedSubtask.userId !== data.userId
        || observedSubtask.milestones?.learning_paths?.userId !== data.userId
      ) {
        throw new Error('无权访问此任务');
      }

      const pathId = observedSubtask.milestones?.learningPathId;
      const milestoneId = observedSubtask.milestoneId;
      if (!pathId || !milestoneId) {
        throw new PathMutationConflictError(
          '任务所属学习路径已变化，请刷新后重试',
          'PATH_TASK_PARENT_CHANGED'
        );
      }

      // 日期模拟：任务结算的业务时间戳（subtasks.completedAt / 完成类 evidence / 里程碑）
      // 必须在模拟时钟下落到模拟日；无模拟上下文时 asOf 缺省 → new Date()，现网行为不变。
      const completedAt = data.asOf ?? new Date();
      const completionResult = await withTransaction(async (tx) => {
        const lockedPath = await tx.learning_paths.updateMany({
          where: { id: pathId, userId: data.userId },
          data: { updatedAt: completedAt }
        });
        if (lockedPath.count !== 1) {
          throw new PathMutationConflictError(
            '任务所属学习路径已变化，请刷新后重试',
            'PATH_TASK_PARENT_CHANGED'
          );
        }

        const lockedMilestone = await tx.milestones.updateMany({
          where: { id: milestoneId, learningPathId: pathId },
          data: { updatedAt: completedAt }
        });
        if (lockedMilestone.count !== 1) {
          throw new PathMutationConflictError(
            '任务所属阶段已变化，请刷新后重试',
            'PATH_TASK_PARENT_CHANGED'
          );
        }

        const currentSubtask = await tx.subtasks.findUnique({
          where: { id: data.taskId },
          include: {
            milestones: {
              include: {
                learning_paths: {
                  select: { id: true, userId: true }
                }
              }
            }
          }
        });
        if (!currentSubtask) {
          throw new PathMutationConflictError(
            '任务已被学习路径调整替换，请刷新后重试',
            'PATH_TASK_REPLACED'
          );
        }
        if (
          currentSubtask.userId !== data.userId
          || currentSubtask.milestoneId !== milestoneId
          || currentSubtask.milestones?.learningPathId !== pathId
          || currentSubtask.milestones?.learning_paths?.userId !== data.userId
        ) {
          throw new PathMutationConflictError(
            '任务所属学习路径已变化，请刷新后重试',
            'PATH_TASK_PARENT_CHANGED'
          );
        }
        if (currentSubtask.status === 'completed') {
          return { task: currentSubtask, alreadyCompleted: true };
        }

        const completion = await tx.subtasks.updateMany({
          where: {
            id: data.taskId,
            userId: data.userId,
            status: { not: 'completed' }
          },
          data: {
            status: 'completed',
            completedAt,
            rating: data.rating,
            updatedAt: completedAt
          }
        });
        if (completion.count !== 1) {
          throw new PathMutationConflictError(
            '任务状态已变化，请刷新后重试',
            'PATH_TASK_STATE_CHANGED'
          );
        }

        await achievementService.addXp(data.userId, 50, tx);

        await enqueueDomainEvent(tx, createDomainEvent({
          type: 'task:completed',
          aggregateType: 'task',
          aggregateId: data.taskId,
          userId: data.userId,
          source: 'learning-service',
          occurredAt: completedAt,
          data: {
            taskId: data.taskId,
            taskTitle: currentSubtask.title,
            pathId,
            milestoneId: currentSubtask.milestoneId,
            actualMinutes: data.actualMinutes || null,
            subjectiveDifficulty: data.subjectiveDifficulty || null,
            rating: data.rating || null,
            linkedConceptName: currentSubtask.linkedConceptName || currentSubtask.coreConcept || null
          }
        }));

        if (pathId) {
          const remainingMilestoneTasks = await tx.subtasks.count({
            where: {
              milestoneId: currentSubtask.milestoneId,
              status: { not: 'completed' }
            }
          });
          if (remainingMilestoneTasks === 0) {
            await tx.milestones.updateMany({
              where: { id: currentSubtask.milestoneId, status: { not: 'completed' } },
              data: { status: 'completed', completedAt, updatedAt: completedAt }
            });
            const nextMilestone = await tx.milestones.findFirst({
              where: {
                learningPathId: pathId,
                stageNumber: { gt: currentSubtask.milestones.stageNumber },
                status: 'locked'
              },
              orderBy: { stageNumber: 'asc' }
            });
            if (nextMilestone) {
              await tx.milestones.update({
                where: { id: nextMilestone.id },
                data: { status: 'active', unlockedAt: nextMilestone.unlockedAt || completedAt, updatedAt: completedAt }
              });
            }
            const completedMilestones = await tx.milestones.count({
              where: { learningPathId: pathId, status: 'completed' }
            });
            await tx.learning_paths.update({
              where: { id: pathId },
              data: { completedMilestones, updatedAt: completedAt }
            });
          }

          const remainingTasks = await tx.subtasks.count({
            where: {
              milestones: { learningPathId: pathId },
              status: { not: 'completed' }
            }
          });
          if (remainingTasks === 0) {
            const completedMilestones = await tx.milestones.count({ where: { learningPathId: pathId, status: 'completed' } });
            const completedPath = await tx.learning_paths.updateMany({
              where: { id: pathId, status: { not: 'completed' } },
              data: { status: 'completed', completedMilestones, updatedAt: completedAt }
            });
            if (completedPath.count === 1) {
              await enqueueDomainEvent(tx, createDomainEvent({
                type: 'path:completed',
                aggregateType: 'path',
                aggregateId: pathId,
                userId: data.userId,
                source: 'learning-service',
                occurredAt: completedAt,
                data: { pathId, completedByTaskId: data.taskId }
              }));
            }
          }
        }

        const updatedTask = await tx.subtasks.findUnique({
          where: { id: data.taskId },
          include: {
            milestones: {
              include: {
                learning_paths: {
                  select: { id: true, userId: true }
                }
              }
            }
          }
        });
        if (!updatedTask) {
          throw new PathMutationConflictError(
            '任务已被学习路径调整替换，请刷新后重试',
            'PATH_TASK_REPLACED'
          );
        }
        return { task: updatedTask, alreadyCompleted: false };
      });

      const subtask = completionResult.task;
      const updatedSubtask = completionResult.task;

      if (completionResult.alreadyCompleted) {
        return {
          task: completionResult.task,
          learningReport: undefined,
          alreadyCompleted: true
        };
      }

      // 检查成就达成
      try {
        await achievementService.triggerAchievementCheck(data.userId, 'task_completed');
      } catch (error) {
        logger.warn('检查成就失败（不影响任务完成）:', error);
      }

      // 今日调度台账（拍板 2026-08-21 中期项）：任务真实结算时按实际用时累加消耗，
      // 消除「今日预算」恒零。幂等性由上方 alreadyCompleted 早退保证；
      // 无 actualMinutes 时不写（不虚构消耗）。失败不阻断任务完成主流程。
      try {
        const actualMinutes = Number(data.actualMinutes);
        if (Number.isFinite(actualMinutes) && actualMinutes > 0 && pathId) {
          const linkedGoal = await prisma.learning_goals.findFirst({
            where: { userId: data.userId, pathId },
            select: { id: true }
          });
          if (linkedGoal) {
            const nowDate = data.asOf ?? new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            // 模拟时钟（asOf）下用 UTC 日（与日期模拟/当日课量同口径）；缺省保持本地日（现网不变）
            const todayKey = data.asOf
              ? nowDate.toISOString().slice(0, 10)
              : `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`;
            await prisma.goal_scheduling_ledger.upsert({
              where: { userId_goalId_date: { userId: data.userId, goalId: linkedGoal.id, date: todayKey } },
              update: { consumedMinutes: { increment: actualMinutes }, updatedAt: nowDate },
              create: {
                id: `gsl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                userId: data.userId,
                goalId: linkedGoal.id,
                date: todayKey,
                consumedMinutes: actualMinutes
              }
            });
          }
        }
      } catch (error) {
        logger.warn('写入今日调度台账失败（不影响任务完成）:', error);
      }

      // 更新连续学习天数（best-effort，不影响任务完成）
      try {
        const today = data.asOf ?? new Date();
        const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

        const user = await prisma.users.findUnique({
          where: { id: data.userId },
          select: { streakDays: true, streakLastDate: true, longestStreak: true }
        });

        if (user) {
          let newStreak = user.streakDays;
          const lastDate = user.streakLastDate?.toISOString().slice(0, 10);

          if (lastDate !== todayStr) {
            if (!lastDate) {
              newStreak = 1;
            } else {
              const last = new Date(lastDate + 'T00:00:00Z');
              const diffDays = Math.floor((today.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
              if (diffDays === 1) {
                newStreak = user.streakDays + 1;
              } else {
                newStreak = 1;
              }
            }

            const newLongest = Math.max(newStreak, user.longestStreak);
            await prisma.users.update({
              where: { id: data.userId },
              data: {
                streakDays: newStreak,
                streakLastDate: today,
                longestStreak: newLongest
              }
            });
          }
        }
      } catch (error) {
        logger.warn('更新学习连续天数失败（不影响任务完成）:', error);
      }

      // 基于学习者状态中心生成学习报告
      let learningReport: { reasoning?: string; suggestion?: string; recommendations?: string[] } | undefined;
      
      try {
        const progressResult = await learnerProgressService.evaluateTaskCompletion(data.userId, {
          taskTitle: subtask.title,
          timeSpent: data.actualMinutes && data.actualMinutes > 0 ? data.actualMinutes : 1,
          subjectiveDifficulty: data.subjectiveDifficulty,
          difficulty: subtask.estimatedMinutes ? Math.min(subtask.estimatedMinutes / 30, 10) : 5
        });

        learningReport = {
          reasoning: progressResult.metrics?.reasoning,
          suggestion: progressResult.metrics?.suggestion,
          recommendations: progressResult.recommendations
        };
      } catch (error) {
        logger.warn('生成学习报告失败（不影响任务完成）:', error);
      }

      logger.info(`任务完成：${subtask.id}`, { userId: data.userId });

      runBackgroundTask('learner-snapshot.task-completed', () => learnerSnapshotRefreshService.refresh({
        userId: data.userId,
        pathId: subtask.milestones?.learningPathId || undefined,
        taskId: data.taskId,
        milestoneId: subtask.milestoneId,
        scope: 'teaching',
      }), { userId: data.userId, taskId: data.taskId });
      dashboardGuidanceSnapshotService.refreshInBackground(data.userId, 'task-completed');
      learnerStateReviewService.refreshInBackground(data.userId);
      conceptConsolidatorService.refreshInBackground(data.userId);

      return {
        task: updatedSubtask,
        learningReport
      };
    } catch (error) {
      logger.error('完成任务失败:', error);
      throw error;
    }
  }

  async getLearningPath(pathId: string) {
    return getLearningPath(pathId);
  }

  async getPathGenerationLifecycle(pathId: string, userId: string) {
    return getPathGenerationLifecycle(pathId, userId);
  }

  async getUserLearningPaths(userId: string) {
    return getUserLearningPaths(userId);
  }

  async getTaskDetail(taskId: string, userId?: string) {
    return getTaskDetail(taskId, userId);
  }

  async getTaskById(taskId: string, userId?: string) {
    return getTaskById(taskId, userId);
  }

  async getLearningStats(userId: string) {
    return getLearningStats(userId);
  }

  async createLearningGoal(data: CreateGoalData) {
    return createLearningGoal(data);
  }

  async getLearningGoals(userId: string, status?: string) {
    return getLearningGoals(userId, status);
  }

  async updateLearningGoal(
    userId: string,
    goalId: string,
    data: {
      status?: 'active' | 'paused' | 'completed' | 'archived';
      pathId?: string | null;
      priority?: number;
      plannedMinutesPerDay?: number | null;
      cognitiveBandwidth?: string | null;
    }
  ) {
    return updateLearningGoal(userId, goalId, data);
  }

  async getTodaySchedule(userId: string) {
    return getTodaySchedule(userId);
  }

  async planTodaySchedule(userId: string, plan: Array<{ goalId: string; budgetMinutes: number; plannedTasks?: string[] }>) {
    return planTodaySchedule(userId, plan);
  }
}

export default new LearningService();
