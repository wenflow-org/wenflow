// 学习服务
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { runBackgroundTask } from '../background-task-tracker.service';
import {
  claimExpiredGenerationRun,
  isGenerationRunStale,
  isStageDesignStale,
  resolveGenerationRetry,
  type PathGenerationRollbackSnapshotV1,
} from './path-generation-status';
import {
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
import {
  markTaskInProgress,
  assertTaskReadyForLearning,
  deleteLearningPath,
  completeTask,
} from './tasks/task-completion.service';

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

  // 预留：基于已学内容重调学习路径（默认 new_version）


  async markTaskInProgress(taskId: string, userId: string) {
    return markTaskInProgress(taskId, userId);
  }

  async assertTaskReadyForLearning(
    taskId: string,
    userId: string,
    options: { requireTaskIncomplete?: boolean } = {}
  ) {
    return assertTaskReadyForLearning(taskId, userId, options);
  }

  // 删除学习路径
  async deleteLearningPath(pathId: string, userId: string) {
    return deleteLearningPath(pathId, userId);
  }

  async requestPathReplan(data: PathReplanRequest) {
    return requestPathReplan(data);
  }


  // 完成任务
  async completeTask(data: CompleteTaskData) {
    return completeTask(data);
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
