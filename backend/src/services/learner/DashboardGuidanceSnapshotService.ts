import prisma from '../../config/database';
import { adaptiveGuidanceCopy, type AdaptiveGuidanceCopyOutput } from '../../skills/adaptive-guidance-copy';
import { learnerSnapshotRefreshService } from './LearnerSnapshotRefreshService';
import { learnerStateSummaryService, type LearnerStateSummaryOutput } from './LearnerStateSummaryService';
import stateTrackingService from '../learning/state-tracking.service';
import { logger } from '../../utils/logger';

type DashboardGuidanceTrigger =
  | 'path-created'
  | 'task-completed'
  | 'lesson-wrapup'
  | 'path-replanned'
  | 'path-deleted'
  | 'manual';

interface DashboardGuidancePath {
  id: string;
  userId: string;
  title: string | null;
  name: string | null;
  description: string | null;
  status: string;
  updatedAt: Date;
  milestones: Array<{
    id: string;
    stageNumber: number;
    title: string | null;
    goal: string | null;
    subtasks: Array<{
      id: string;
      title: string;
      status: string | null;
    }>;
  }>;
}

interface DashboardLearningState {
  user: {
    id: string;
    name: string;
    xp: number;
    level: number;
  };
  tasks: {
    total: number;
    completed: number;
    inProgress: number;
    todo: number;
    completionRate: number;
  };
  paths: {
    total: number;
  };
  time: {
    totalMinutes: number;
    totalEstimated: number;
    totalCompleted: number;
    activeLearningDays: number;
    avgDailyMinutes: number;
    progress: number;
    completionRate: string;
  };
  state: Awaited<ReturnType<typeof stateTrackingService.getCurrentState>> | null;
  suggestion: ReturnType<typeof stateTrackingService.generateSuggestion> | null;
}

export interface DashboardGuidanceSnapshotPayload {
  schemaVersion: 'dashboard-guidance-v1';
  view: 'dashboard';
  generatedAt: string;
  trigger: DashboardGuidanceTrigger;
  pathId: string | null;
  source: 'model' | 'fallback';
  copy: AdaptiveGuidanceCopyOutput;
  summary: LearnerStateSummaryOutput;
  debug?: {
    skillId: string;
    model: string | null;
    systemPromptVersion: number | null;
    durationMs: number;
    cached: boolean;
    generatedAt: string;
  } | null;
  freshness?: {
    latestGoalConversationAt?: string;
    latestMetricAt?: string;
    latestTeachingSessionAt?: string;
    latestTaskCompletionAt?: string;
    latestPathUpdateAt?: string;
  };
}

function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getActiveStage(path: DashboardGuidancePath | null | undefined) {
  if (!path?.milestones?.length) return null;
  return path.milestones.find((stage) => (stage.subtasks || []).some((task) => task.status !== 'completed'))
    || path.milestones[0]
    || null;
}

function getPrimaryActionTask(path: DashboardGuidancePath | null | undefined) {
  const tasks = getActiveStage(path)?.subtasks || [];
  return tasks.find((task) => task.status === 'todo')
    || tasks.find((task) => task.status === 'in_progress')
    || null;
}

function pickPrimaryPath(paths: DashboardGuidancePath[]) {
  const activePaths = paths.filter((path) => path.status === 'active');
  return activePaths.find((path) => Boolean(getPrimaryActionTask(path))) || activePaths[0] || null;
}

class DashboardGuidanceSnapshotService {
  async get(userId: string): Promise<DashboardGuidanceSnapshotPayload | null> {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { dashboardGuidanceSnapshot: true },
    });
    return parseJsonSafe<DashboardGuidanceSnapshotPayload>(user?.dashboardGuidanceSnapshot);
  }

  async clear(userId: string): Promise<void> {
    await prisma.users.update({
      where: { id: userId },
      data: { dashboardGuidanceSnapshot: null },
    });
  }

  async backfillMissingForActiveUsers(limit = 100): Promise<{ total: number; refreshed: number }> {
    const users = await prisma.users.findMany({
      where: {
        dashboardGuidanceSnapshot: null,
        learning_paths: {
          some: { status: 'active' },
        },
      },
      select: { id: true },
      take: Math.max(1, Math.min(500, limit)),
      orderBy: { updatedAt: 'desc' },
    });

    let refreshed = 0;
    for (const user of users) {
      const result = await this.refresh(user.id, 'manual');
      if (result) refreshed += 1;
    }

    return {
      total: users.length,
      refreshed,
    };
  }

  async refresh(userId: string, trigger: DashboardGuidanceTrigger): Promise<DashboardGuidanceSnapshotPayload | null> {
    try {
      const [user, paths, subtasks, sessions] = await Promise.all([
        prisma.users.findUnique({
          where: { id: userId },
          select: { id: true, name: true, xp: true },
        }),
        prisma.learning_paths.findMany({
          where: { userId, status: 'active' },
          include: {
            milestones: {
              orderBy: { stageNumber: 'asc' },
              include: {
                subtasks: {
                  orderBy: { order: 'asc' },
                  select: {
                    id: true,
                    title: true,
                    status: true,
                    estimatedMinutes: true,
                  },
                },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.subtasks.findMany({
          where: { userId },
          select: {
            status: true,
            estimatedMinutes: true,
            completedAt: true,
          },
        }),
        prisma.teaching_sessions.findMany({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: {
            learningPathId: true,
            duration: true,
            startTime: true,
            endTime: true,
            updatedAt: true,
            wrapup: true,
            advisory: true,
          },
          take: 10,
        }),
      ]);

      if (!user) {
        return null;
      }

      const primaryPath = pickPrimaryPath(paths as DashboardGuidancePath[]);
      if (!primaryPath) {
        await this.clear(userId);
        return null;
      }

      const learnerSnapshot = await learnerSnapshotRefreshService.refresh({
        userId,
        pathId: primaryPath.id,
        scope: 'path',
      });

      const latestPathSession = sessions.find((session) => session.learningPathId === primaryPath.id) || sessions[0] || null;
      const sessionWrapup = latestPathSession?.wrapup ? parseJsonSafe(latestPathSession.wrapup) : null;
      const advisory = latestPathSession?.advisory ? parseJsonSafe(latestPathSession.advisory) : null;
      const warnings = await stateTrackingService.checkWarnings(userId).catch(() => []);
      const currentState = await stateTrackingService.getCurrentState(userId).catch(() => null);
      const suggestion = currentState ? stateTrackingService.generateSuggestion(currentState) : null;

      const completedSubtasks = subtasks.filter((task) => task.status === 'completed');
      const inProgressSubtasks = subtasks.filter((task) => task.status === 'in_progress');
      const todoSubtasks = subtasks.filter((task) => task.status === 'todo');
      const totalEstimatedMinutes = subtasks.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0);
      const totalMinutes = sessions.reduce((sum, session) => {
        if (session.endTime) {
          return sum + Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000));
        }
        if ((session.duration || 0) > 24 * 60) {
          return sum + Math.round((session.duration || 0) / 60);
        }
        return sum + Math.max(0, session.duration || 0);
      }, 0);
      const activeLearningDays = new Set(sessions.map((session) => session.startTime.toISOString().split('T')[0])).size;
      const avgDailyMinutes = activeLearningDays > 0 ? Number((totalMinutes / activeLearningDays).toFixed(1)) : 0;

      const learningState: DashboardLearningState = {
        user: {
          id: user.id,
          name: user.name,
          xp: user.xp,
          level: Math.floor(Math.sqrt(user.xp / 100)) + 1,
        },
        tasks: {
          total: subtasks.length,
          completed: completedSubtasks.length,
          inProgress: inProgressSubtasks.length,
          todo: todoSubtasks.length,
          completionRate: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0,
        },
        paths: {
          total: paths.length,
        },
        time: {
          totalMinutes,
          totalEstimated: totalEstimatedMinutes,
          totalCompleted: totalMinutes,
          activeLearningDays,
          avgDailyMinutes,
          progress: subtasks.length > 0 ? Number((completedSubtasks.length / subtasks.length * 100).toFixed(1)) : 0,
          completionRate: subtasks.length > 0 ? (completedSubtasks.length / subtasks.length * 100).toFixed(1) : '0',
        },
        state: currentState,
        suggestion,
      };

      const summary = learnerStateSummaryService.build({
        learnerSnapshot,
        learningState,
        path: primaryPath,
        warningCount: warnings.length,
      });

      const result = await adaptiveGuidanceCopy({
        view: 'dashboard',
        learnerSnapshot,
        learningState,
        path: primaryPath,
        sessionWrapup,
        advisory,
      });

      const generatedAt = new Date().toISOString();
      const payload: DashboardGuidanceSnapshotPayload = {
        schemaVersion: 'dashboard-guidance-v1',
        view: 'dashboard',
        generatedAt,
        trigger,
        pathId: primaryPath.id,
        source: result.cached ? 'fallback' : 'model',
        copy: result.output,
        summary,
        debug: {
          skillId: result.debug?.skillId || 'adaptive-guidance-copy',
          model: result.debug?.model || null,
          systemPromptVersion: result.debug?.systemPromptVersion || null,
          durationMs: result.debug?.durationMs || result.duration || 0,
          cached: result.cached === true,
          generatedAt,
        },
        freshness: learnerSnapshot.freshness?.basedOn,
      };

      await prisma.users.update({
        where: { id: userId },
        data: {
          dashboardGuidanceSnapshot: JSON.stringify(payload),
        },
      });

      return payload;
    } catch (error: any) {
      logger.warn('[dashboard-guidance-snapshot] refresh failed', {
        userId,
        trigger,
        error: error?.message || String(error),
      });
      return null;
    }
  }
}

export const dashboardGuidanceSnapshotService = new DashboardGuidanceSnapshotService();
export default dashboardGuidanceSnapshotService;
