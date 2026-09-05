/**
 * 共享学习状态聚合（去冗余：DashboardGuidanceSnapshotService 与 LearningStateGuidanceService
 * 的 user/paths/subtasks/sessions 查询、任务统计、时间聚合、learningState 构造与 summary 构建
 * 此前逐段重复，统一收敛到本 helper；两服务仅保留差异化尾部（executeSkill 视图/缓存策略/落库）。
 */
import prisma from '../../config/database';
import { learnerSnapshotRefreshService } from './LearnerSnapshotRefreshService';
import { learnerStateSummaryService } from './LearnerStateSummaryService';
import stateTrackingService from '../learning/learning-state.service';
import { getLevelFromXp } from './level.util';

export interface AssembledLearningState {
  user: { id: string; name: string | null; xp: number } | null;
  paths: any[];
  subtasks: any[];
  sessions: any[];
  primaryPath: any | null;
  learnerSnapshot: any;
  warnings: any[];
  currentState: any | null;
  suggestion: any | null;
  learningState: {
    user: { id: string; name: string | null; xp: number; level: number };
    tasks: {
      total: number;
      completed: number;
      inProgress: number;
      todo: number;
      completionRate: number;
    };
    paths: { total: number };
    time: {
      totalMinutes: number;
      totalEstimated: number;
      totalCompleted: number;
      activeLearningDays: number;
      avgDailyMinutes: number;
      progress: number;
      completionRate: string;
    };
    state: any | null;
    suggestion: any | null;
  };
  sessionWrapup: any | null;
  advisory: any | null;
}

export interface AssembleLearningStateOptions {
  /** learnerSnapshot 刷新范围：dashboard 用 path、learning-state 用 global */
  snapshotScope?: 'global' | 'path' | 'teaching';
  pathId?: string | null;
  /** learning_paths 查询条数（learning-state 用 3，dashboard 全量） */
  pathsTake?: number;
}

export async function assembleLearningState(
  userId: string,
  options: AssembleLearningStateOptions = {}
): Promise<AssembledLearningState | null> {
  const { snapshotScope = 'global', pathId = null, pathsTake } = options;

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
                completedAt: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...(pathsTake ? { take: pathsTake } : {}),
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
        id: true,
        learningPathId: true,
        duration: true,
        startTime: true,
        endTime: true,
        updatedAt: true,
        wrapup: true,
        advisory: true,
        status: true,
      },
      take: 10,
    }),
  ]);

  if (!user) return null;

  const primaryPath = pickPrimaryPath(paths) || paths[0] || null;
  if (!primaryPath) {
    return {
      user: { id: user.id, name: user.name, xp: user.xp },
      paths,
      subtasks,
      sessions,
      primaryPath: null,
      learnerSnapshot: null,
      warnings: [],
      currentState: null,
      suggestion: null,
      learningState: null as any,
      sessionWrapup: null,
      advisory: null,
    };
  }

  const learnerSnapshot = await learnerSnapshotRefreshService.refresh({
    userId,
    pathId: pathId ?? primaryPath.id,
    scope: snapshotScope,
  });

  const latestPathSession = sessions.find((session: any) => session.learningPathId === primaryPath.id) || sessions[0] || null;
  const sessionWrapup = latestPathSession?.wrapup ? parseJsonSafe(latestPathSession.wrapup) : null;
  const advisory = latestPathSession?.advisory ? parseJsonSafe(latestPathSession.advisory) : null;
  const warnings = await stateTrackingService.checkWarnings(userId).catch(() => []);
  const currentState = await stateTrackingService.getCurrentStateDisplay(userId).catch(() => null);
  const suggestion = currentState ? stateTrackingService.generateDisplaySuggestion(currentState) : null;

  const completedSubtasks = subtasks.filter((task: any) => task.status === 'completed');
  const inProgressSubtasks = subtasks.filter((task: any) => task.status === 'in_progress');
  const todoSubtasks = subtasks.filter((task: any) => task.status === 'todo');
  const totalEstimatedMinutes = subtasks.reduce((sum: number, task: any) => sum + (task.estimatedMinutes || 0), 0);
  const totalMinutes = sessions.reduce((sum: number, session: any) => {
    if (session.endTime) {
      return sum + Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000));
    }
    if ((session.duration || 0) > 24 * 60) {
      return sum + Math.round((session.duration || 0) / 60);
    }
    return sum + Math.max(0, session.duration || 0);
  }, 0);
  const activeLearningDays = new Set(sessions.map((session: any) => session.startTime.toISOString().split('T')[0])).size;
  const avgDailyMinutes = activeLearningDays > 0 ? Number((totalMinutes / activeLearningDays).toFixed(1)) : 0;

  const learningState = {
    user: {
      id: user.id,
      name: user.name,
      xp: user.xp,
      level: getLevelFromXp(user.xp),
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

  return {
    user: { id: user.id, name: user.name, xp: user.xp },
    paths,
    subtasks,
    sessions,
    primaryPath,
    learnerSnapshot,
    warnings,
    currentState,
    suggestion,
    learningState,
    sessionWrapup,
    advisory,
  };
}

/** 选主路径：有可做任务（非 completed 的 subtask）的 active 路径优先，否则第一个 */
export function pickPrimaryPath(paths: any[]) {
  const activePaths = paths.filter((path: any) => path.status === 'active');
  return activePaths.find((path: any) => Boolean(getPrimaryActionTask(path))) || activePaths[0] || null;
}

function getPrimaryActionTask(path: any) {
  for (const milestone of path.milestones || []) {
    const task = (milestone.subtasks || []).find((sub: any) => sub.status !== 'completed');
    if (task) return task;
  }
  return null;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T = null as any): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
