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
import { dayKeyOf, parseDayKeyStart, dayDiffInDays } from '../../time/day-boundary';
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

    // 日期模拟：任务结算的业务时间戳（subtasks.completedAt / 完成类 evidence / 里程碑）
    // 必须在模拟时钟下落到模拟日；无模拟上下文时 asOf 缺省 → new Date()，现网行为不变。
    const completedAt = data.asOf ?? new Date();
    const completionResult = await withTransaction(async (tx) => {
      // 渐进式（批次 D）：本阶段完成 → 下一阶段解锁时带出（事务外触发 stage N+1 设计）
      let nextUnlockedMilestoneId: string | null = null;
      let nextUnlockedStageNumber: number | undefined = undefined;
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
            // 渐进式（批次 D）：记录交接信息（见事务 return）
            nextUnlockedMilestoneId = nextMilestone.id;
            nextUnlockedStageNumber = nextMilestone.stageNumber;
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
      // 渐进式（批次 D）：把「本阶段完成 → 下一阶段解锁」的交接信息带出事务，
      // 事务外据此触发 stage N+1 的后台设计（不拖长完成事务）。
      const nextUnlockedMilestone = typeof nextUnlockedStageNumber === 'number'
        ? { id: nextUnlockedMilestoneId!, stageNumber: nextUnlockedStageNumber }
        : null;
      return { task: updatedTask, alreadyCompleted: false, nextUnlockedMilestone };
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
      const todayStr = dayKeyOf(today);

      const user = await prisma.users.findUnique({
        where: { id: data.userId },
        select: { streakDays: true, streakLastDate: true, longestStreak: true }
      });

      if (user) {
        let newStreak = user.streakDays;
        const lastDate = user.streakLastDate ? dayKeyOf(user.streakLastDate) : undefined;

        if (lastDate !== todayStr) {
          if (!lastDate) {
            newStreak = 1;
          } else {
            const diffDays = dayDiffInDays(parseDayKeyStart(lastDate), parseDayKeyStart(todayStr));
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
