/**
 * 任务域：任务进行中标记、开课就绪校验、任务完成结算与路径删除
 * （架构审计 §5 行动 #2：learning.service.ts 按领域拆分——任务域）
 *
 * completeTask 是重写入链路：乐观锁三元组（path/milestone/subtask）+ 里程碑推进 +
 * task:completed / path:completed 事件 + XP/成就/连续天数/今日台账（均 best-effort）+
 * 学习报告与快照刷新。业务时间戳走 data.asOf（模拟时钟）。
 * 行为与拆分前 learning.service 同名方法逐一等价。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import { withTransaction } from '../../../utils/with-transaction';
import { dayKeyOf } from '../../time/day-boundary';
import { advanceStreak } from './streak';
import { cleanupPathLearningData } from '../path-learning-data-cleanup';
import achievementService from '../../achievements/achievement.service';
import { dashboardGuidanceSnapshotService } from '../../learner/DashboardGuidanceSnapshotService';
import { learnerStateReviewService } from '../../learner/LearnerStateReviewService';
import { conceptConsolidatorService } from '../../learner/ConceptConsolidatorService';
import { runBackgroundTask } from '../../background-task-tracker.service';
import { learnerSnapshotRefreshService } from '../../learner/LearnerSnapshotRefreshService';
import { learnerProgressService } from '../../learner/LearnerProgressService';
import { createDomainEvent } from '../../../events/contracts';
import { enqueueDomainEvent } from '../../../events/outbox.repository';
import { assertPathMutationSafe, PathMutationConflictError } from '../path-mutation-safety';
import type { CompleteTaskData } from '../learning.types';
import { getActiveGenerationRun } from '../generation/run-lifecycle';
import { getPathLearningAccessState } from '../queries/path-views.queries';
import { isProgressiveStageDesignEnabled, triggerNextStageDesign } from '../generation/progressive-design';

export async function markTaskInProgress(taskId: string, userId: string) {
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

export async function assertTaskReadyForLearning(
  taskId: string,
  userId: string,
  options: { requireTaskIncomplete?: boolean; allowCompletedPath?: boolean } = {}
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
  // 由用户上课路由显式传入 requireTaskIncomplete 生效——复习课等既有调用方行为保持不变
  // （复习课本就作用于已完成任务）。
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

  // 延伸学（#124）：路径可能已因本课完成而结业（status=completed），此时常规开课闸会拦下；
  // 延伸课基于已完成的本课，允许放行（归属与阶段锁已在上方校验）。
  if (options.allowCompletedPath && learningPath.status === 'completed') {
    return;
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
    // 带上 409 与稳定 code：路径已下线/仍在准备都是「当前状态不可开课」，
    // 让教学路由的 resolveTeachingError 原样回给用户，而不是吞成 500。
    const error = new Error(accessState.learningBlockedReason || '学习内容还在准备中，暂不能开始学习');
    (error as { code?: string; status?: number }).code = 'PATH_NOT_STARTABLE';
    (error as { code?: string; status?: number }).status = 409;
    throw error;
  }
}

// 删除学习路径
export async function deleteLearningPath(pathId: string, userId: string) {
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
      // issue #90：learningPathId 是无 FK 的软指针（goal_conversations / teaching_sessions /
      // virtual_sessions），裸删路径会留下指向不存在路径的悬空引用；同事务先置空再删
      // （口径与 admin 删除链 learning-content.repo.deleteLearningPath 一致）。
      await tx.goal_conversations.updateMany({ where: { learningPathId: pathId }, data: { learningPathId: null } });
      await tx.teaching_sessions.updateMany({ where: { learningPathId: pathId }, data: { learningPathId: null } });
      await tx.virtual_sessions.updateMany({ where: { learningPathId: pathId }, data: { learningPathId: null } });
      // #176-3：证据/投影的 pathId 也是无 FK 普通列，读侧只按现存路径取数——不清理会留下
      // 「永久读不到但仍占库」的孤儿行。path 级学习事实随路径删除，用户级记忆保留（traces 只置空）。
      const cleaned = await cleanupPathLearningData(tx, pathId);
      if (cleaned.evidenceDeleted || cleaned.projectionsDeleted || cleaned.tracesDetached || cleaned.pathEdgesDeleted) {
        logger.info('删除学习路径：已清理该路径的学习事实', { pathId, ...cleaned });
      }
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

// 完成任务
export async function completeTask(data: CompleteTaskData) {
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

    // #105 观测统一：收束事件带上轨道（真人 / 虚拟学习者）与完成通道，管理端统一从
    // task:completed / path:completed 统计，不再各页各算。查询失败不阻断结算（track=unknown）。
    const completionActor = await prisma.users
      .findUnique({ where: { id: data.userId }, select: { isVirtualLearner: true } })
      .catch(() => null);
    const completionTrack = completionActor
      ? (completionActor.isVirtualLearner ? 'virtual-learner' : 'human')
      : 'unknown';
    const completionContext = {
      track: completionTrack,
      completionSource: data.completionSource ?? 'unknown',
      sessionId: data.sessionId ?? null,
    };

    // 日期模拟：任务结算的**业务**时间戳（subtasks.completedAt / 完成类 evidence / 里程碑）
    // 在模拟时钟下落模拟日；无模拟上下文时 asOf 缺省 → new Date()，现网行为不变。
    const completedAt = data.asOf ?? new Date();
    // learning_paths.updatedAt 是**运维/审计列**（管理端列表排序、停滞判定、重试新鲜度都读它）：
    // 按设计契约保持真墙钟、不吃 asOf——模拟日通常是未来日期，写进去会让虚拟路径在管理端列表霸榜、
    // 且时间倒挂（createdAt < updatedAt）。见 doc/VIRTUAL_LEARNER_SIMULATED_DAY_DESIGN.md §9.5/§9.11。
    const touchedAt = new Date();
    const completionResult = await withTransaction(async (tx) => {
      // 渐进式（批次 D）：本阶段完成 → 下一阶段解锁时带出（事务外触发 stage N+1 设计）
      let nextUnlockedMilestoneId: string | null = null;
      let nextUnlockedStageNumber: number | undefined = undefined;
      const lockedPath = await tx.learning_paths.updateMany({
        where: { id: pathId, userId: data.userId },
        data: { updatedAt: touchedAt }
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
          linkedConceptName: currentSubtask.linkedConceptName || currentSubtask.coreConcept || null,
          ...completionContext,
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
            // 渐进式（批次 D）：记录交接信息（见事务 return）
            nextUnlockedMilestoneId = nextMilestone.id;
            nextUnlockedStageNumber = nextMilestone.stageNumber;
          }
          const completedMilestones = await tx.milestones.count({
            where: { learningPathId: pathId, status: 'completed' }
          });
          await tx.learning_paths.update({
            where: { id: pathId },
            data: { completedMilestones, updatedAt: touchedAt }
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
            data: { status: 'completed', completedMilestones, updatedAt: touchedAt }
          });
          if (completedPath.count === 1) {
            await enqueueDomainEvent(tx, createDomainEvent({
              type: 'path:completed',
              aggregateType: 'path',
              aggregateId: pathId,
              userId: data.userId,
              source: 'learning-service',
              occurredAt: completedAt,
              data: { pathId, completedByTaskId: data.taskId, ...completionContext }
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
      // 渐进式（批次 D）：把「本阶段完成 → 下一阶段解锁」的交接信息带出事务，
      // 事务外据此触发 stage N+1 的后台设计（不拖长完成事务）。
      const nextUnlockedMilestone = typeof nextUnlockedStageNumber === 'number'
        ? { id: nextUnlockedMilestoneId!, stageNumber: nextUnlockedStageNumber }
        : null;
      return { task: updatedTask, alreadyCompleted: false, nextUnlockedMilestone };
    });

    const subtask = completionResult.task;
    const updatedSubtask = completionResult.task;

    // #204：教学快照的 eager 刷新叶子。教学链路（带 sessionId）默认把这一键的刷新留给同一节课的
    // lesson:completed 消费者；会话在本次结算前已闭合（end_only 补结算 / complete_task 重试）时
    // 不会再产出 lesson:completed，消费者又按 sessionId 跳过 task:completed —— 必须由这里补刷，
    // 否则该次收尾对投影键 0 次刷新（快照静默陈旧至 getLatest 的 10 分钟兜底）。
    // 注意 alreadyCompleted 早退（下面）也在其列：重进补结算时任务可能已由上一跳写完成。
    const scheduleEagerSnapshotRefresh = () => {
      runBackgroundTask('learner-snapshot.task-completed', () => learnerSnapshotRefreshService.refresh({
        userId: data.userId,
        pathId: subtask.milestones?.learningPathId || pathId || undefined,
        taskId: data.taskId,
        milestoneId: subtask.milestoneId,
        scope: 'teaching',
      }), { userId: data.userId, taskId: data.taskId });
    };

    if (completionResult.alreadyCompleted) {
      // #204：任务已由上一跳写完成 → 事务在入队前就早退（不产生 task:completed，其它副作用也不该重放），
      // 但「已闭合会话」这一支的刷新兜底仍要补做，否则重进补结算永远是 0 次刷新。
      if (data.sessionId && data.sessionClosedBeforeCompletion) scheduleEagerSnapshotRefresh();
      return {
        task: completionResult.task,
        learningReport: undefined,
        alreadyCompleted: true
      };
    }

    // 渐进式（批次 D）：stage N 完成 → 后台设计 stage N+1（append-only + 学习者信号注入）。
    // fail-open：设计失败不影响任务完成结果；冷启动兜底见 progressive-design 模块注释。
    if (completionResult.nextUnlockedMilestone && isProgressiveStageDesignEnabled()) {
      const next = completionResult.nextUnlockedMilestone;
      triggerNextStageDesign(
        pathId,
        data.userId,
        next.id,
        next.stageNumber,
        completionResult.task.milestones?.stageNumber ?? next.stageNumber - 1
      );
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
          // 台账 date 键按应用时区本地日（此前：模拟下 UTC、缺省机器本地日 —— 两套口径，已统一）
          const todayKey = dayKeyOf(nowDate);
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
      // 连击按**应用时区本地日**（与课量/配额/衰减同口径）：此前 toISOString 是 UTC 切日，
      // UTC+8 用户 00:00–08:00 的学习会被算进"昨天"，连击判定错一天。
      // 推进规则抽在 ./streak.ts（纯函数，跨日边界有独立测试）
      const user = await prisma.users.findUnique({
        where: { id: data.userId },
        select: { streakDays: true, streakLastDate: true, longestStreak: true }
      });

      if (user) {
        const next = advanceStreak(
          {
            streakDays: user.streakDays,
            streakLastDate: user.streakLastDate,
            longestStreak: user.longestStreak,
          },
          today,
        );

        if (next.changed) {
          await prisma.users.update({
            where: { id: data.userId },
            data: {
              streakDays: next.streakDays,
              streakLastDate: next.streakLastDate,
              longestStreak: next.longestStreak,
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

    // #147：带 sessionId = 教学收尾中的任务结算。该画像快照键（teaching:path:milestone:task）与同一节课
    // 的 lesson:completed 完全相同，刷新由 lesson:completed 的消费者的那一次承担（其在两条链路上都会
    // 刷新同一键）；这里再 eager 刷一次是同一 projectionKey 的重复重算，故教学链路默认不刷。
    // 例外（回归 #204）：本次结算前会话已闭合（end_only 补结算 / complete_task 重试）→ 不会再产出
    // lesson:completed，没有别的刷新方，必须在此 eager 刷新，否则该次收尾对投影键 0 次刷新
    // （alreadyCompleted 早退分支见上方同名兜底）。
    // 纯路径任务（无 sessionId，无 lesson:completed 事件）保持原有的立即刷新不变。
    if (!data.sessionId || data.sessionClosedBeforeCompletion) {
      scheduleEagerSnapshotRefresh();
    }
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
