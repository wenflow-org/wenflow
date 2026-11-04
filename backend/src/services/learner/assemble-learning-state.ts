/**
 * 共享学习状态聚合（去冗余：DashboardGuidanceSnapshotService 与 LearningStateGuidanceService
 * 的 user/paths/subtasks/sessions 查询、任务统计、时间聚合、learningState 构造与 summary 构建
 * 此前逐段重复，统一收敛到本 helper；两服务仅保留差异化尾部（executeSkill 视图/缓存策略/落库）。
 */
import prisma from '../../config/database';
import { learnerSnapshotRefreshService } from './LearnerSnapshotRefreshService';
import { learnerStateSummaryService } from './LearnerStateSummaryService';
import { notifyDeadlineBehindOnce } from './deadline-notify.service';
import stateTrackingService from '../learning/learning-state.service';
import { normalizeSessionDurationMinutes } from '../learning/learning.helpers';
import { loadTeachingMessagesForIds } from '../ai-teaching/teaching-session-message-store';
import { getLevelFromXp } from './level.util';
import { dayKeyOf } from '../time/day-boundary';

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

  const [user, paths, subtasks, sessions, timeSessions] = await Promise.all([
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
      where: { userId, status: { notIn: ['superseded'] } },
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
    // 时长/学习天数按全量口径（此前从 take:10 的样本里算，累计时长/天数会明显偏小）；
    // 与 /learning/stats、/users/me/sessions 同口径：只排除被回收重开的 superseded。
    prisma.teaching_sessions.findMany({
      where: { userId, status: { notIn: ['superseded'] } },
      select: {
        id: true,
        duration: true,
        startTime: true,
        endTime: true,
        // 未结束会话（active/paused）的时长需按活跃时长估算，
        // 见 normalizeSessionDurationMinutes（走查 P9）；
        // messages 大列已侧表化：下方经 store 批量水合（直读热表大列实测拖慢全表扫描）
        status: true,
        // messages 保留作回退源（侧表无行的老会话）；2026-10-01 侧表化清理后仅侧表有行的会话已置 NULL
        messages: true,
        teachingState: true,
        updatedAt: true,
      },
    }),
  ]);

  if (!user) return null;

  // messages 大列侧表化：store 批量权威读水合（无侧表行 → []，与「无消息=0」口径一致）。
  // 消息的消费者是 timeSessions（normalizeSessionDurationMinutes 的活跃时长估算分支）。
  const messagesById = await loadTeachingMessagesForIds(timeSessions.map((s) => s.id));
  const timeSessionsHydrated = timeSessions.map((s) => ({ ...s, messages: messagesById.get(s.id) ?? s.messages }));

  let primaryPath = pickPrimaryPath(paths) || paths[0] || null;
  // paths 查询已带 status:'active'，故 primaryPath 非空 ⇔ 存在 active 路径。
  const hasActivePath = Boolean(primaryPath);
  if (!primaryPath) {
    // #155：无 active 路径（路径已完成/归档）时，用户级画像不再整体清零。这里回退到该用户最近的
    // 非 abandoned 路径，让 dashboard / learning-state-guidance 仍有路径可展示、结构口径自洽
    // （globalSignals/globalBackground 按 userId 聚合、不依赖具体路径）；但**不**把它当作画像锚点
    // （见下方 refresh 的 #205 处理）。有 active 路径的用户不走这条回退，paths 口径不变。
    primaryPath = await prisma.learning_paths.findFirst({
      where: { userId, status: { not: 'abandoned' } },
      orderBy: { updatedAt: 'desc' },
      include: {
        milestones: {
          orderBy: { stageNumber: 'asc' },
          include: {
            subtasks: {
              orderBy: { order: 'asc' },
              select: { id: true, title: true, status: true, estimatedMinutes: true, completedAt: true },
            },
          },
        },
      },
    });
    if (primaryPath) paths.push(primaryPath);
  }

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

  // #205：快照锚点（currentPath）只对「用户当前的 active 路径」有意义。默认用 active 主路径；
  // 调用方显式传 pathId 时，仅当该路径确属本用户且 status='active' 才锚定——否则 archived/completed
  // 路径会被伪造成 currentPath，summary 据此给出指向「已下线不可继续学习」路径的 open-path /
  // continue-learning（复核第二轮点名：显式 pathId 逃生口仍能重现 #205）。非 active 一律走 global
  // 口径：globalSignals / globalBackground 仍非空（LearnerKnowledgeMemoryService #155 按 userId 聚合），
  // currentPath 留空、不伪造。
  let anchorPathId: string | undefined = hasActivePath ? primaryPath.id : undefined;
  if (pathId) {
    const requestedActive = await prisma.learning_paths.findFirst({
      where: { id: pathId, userId, status: 'active' },
      select: { id: true },
    });
    anchorPathId = requestedActive?.id ?? undefined;
  }
  const learnerSnapshot = await learnerSnapshotRefreshService.refresh({
    userId,
    pathId: anchorPathId,
    scope: anchorPathId ? snapshotScope : 'global',
  });

  // P1.6 落后触发器（TIME-TRUST-SCHEME-20261001）通知侧：快照带 deadline_pace_behind
  // 且主路径有外部截止时，发一条站内提醒（同 path 同类型只发一次，内部查重）。
  // fire-and-forget + fail-open：不 await、不阻断状态聚合；调用点自带缓存（15min），频率可控。
  void notifyDeadlineBehindOnce({
    userId,
    pathId: primaryPath.id,
    pathTitle: primaryPath.title ?? primaryPath.name ?? null,
    deadline: primaryPath.deadline ?? null,
    replanSignal: (learnerSnapshot as any)?.replanSignal ?? null,
  }).catch(() => undefined);

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
  const totalMinutes = timeSessionsHydrated.reduce((sum: number, session: any) => sum + normalizeSessionDurationMinutes(session), 0);
  const activeLearningDays = new Set(timeSessions.map((session: any) => dayKeyOf(session.startTime))).size;
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
      // 已启动 = 已完成 + 进行中：给文案层一个**可直接引用**的口径，
      // 避免把 completed/total 说成「已启动 X/总」（走查 P10）
      started: completedSubtasks.length + inProgressSubtasks.length,
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
