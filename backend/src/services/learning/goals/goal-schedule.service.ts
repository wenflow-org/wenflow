/**
 * 学习目标与今日日程域（架构审计 §5 行动 #2：learning.service.ts 按领域拆分——目标/日程域）
 *
 * 职责：学习目标 CRUD、今日预算视图（多目标调度台账）与今日台账写入。
 * 行为与拆分前 learning.service 同名方法逐一等价。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import type { CreateGoalData } from '../learning.types';

// 创建学习目标
export async function createLearningGoal(data: CreateGoalData) {
  try {
    const goal = await prisma.learning_goals.create({
      data: {
        id: `lg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        userId: data.userId,
        title: data.description,
        description: data.description,
        updatedAt: new Date()
      }
    });

    logger.info(`学习目标创建：${goal.id}`);

    return goal;
  } catch (error) {
    logger.error('创建学习目标失败:', error);
    throw error;
  }
}

// 获取用户的学习目标
export async function getLearningGoals(userId: string, status?: string) {
  try {
    const goals = await prisma.learning_goals.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
    });

    return goals;
  } catch (error) {
    logger.error('获取学习目标失败:', error);
    throw error;
  }
}

// 更新学习目标（多目标预算台账元数据：status/pathId/priority/plannedMinutesPerDay/cognitiveBandwidth）
export async function updateLearningGoal(
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
  const goal = await prisma.learning_goals.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw new Error('学习目标不存在');
  return prisma.learning_goals.update({
    where: { id: goalId },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.pathId !== undefined ? { pathId: data.pathId } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.plannedMinutesPerDay !== undefined ? { plannedMinutesPerDay: data.plannedMinutesPerDay } : {}),
      ...(data.cognitiveBandwidth !== undefined ? { cognitiveBandwidth: data.cognitiveBandwidth } : {}),
      updatedAt: new Date(),
    },
  });
}

/**
 * 今日预算视图（多目标调度 · learn agent 台账）：
 * active goals（含预算）+ 今日 ledger + 活跃教学会话，产出每个目标的预算/已耗/建议
 *
 * 口径（拍板 2026-08-21）：
 * - 日界按服务器本地时区（此前 UTC 导致 UTC+8 用户清晨的学习记进「昨天」）
 * - todayMinutes = 今日开课的教学会话时长（终态取 duration，进行中取已流逝分钟）
 * - consumedMinutes：ledger 有值用 ledger；否则从今日会话经 task→milestone→path 反查到目标推导
 */
export async function getTodaySchedule(userId: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [goals, ledgers, activeSessions, todaySessions] = await Promise.all([
    prisma.learning_goals.findMany({
      where: { userId, status: 'active' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.goal_scheduling_ledger.findMany({
      where: { userId, date: today },
    }),
    prisma.teaching_sessions.findMany({
      where: { userId, status: 'active' },
      select: { id: true, taskId: true, startTime: true },
    }),
    prisma.teaching_sessions.findMany({
      where: { userId, startTime: { gte: dayStart } },
      select: { taskId: true, duration: true, status: true, startTime: true },
    }),
  ]);

  const ledgerByGoal = new Map(ledgers.map((l) => [l.goalId, l]));

  // 今日真实学习分钟：终态会话取落库 duration；进行中的取「开课至今」流逝分钟
  const settledMinutes = todaySessions.reduce((sum, s) => sum + (s.duration ?? 0), 0);
  const activeElapsedMinutes = activeSessions.reduce((sum, s) => {
    const started = new Date(s.startTime).getTime();
    return Number.isFinite(started) ? sum + Math.max(0, Math.round((Date.now() - started) / 60000)) : sum;
  }, 0);
  const todayMinutes = settledMinutes + activeElapsedMinutes;

  // task → milestone → path 反查，把今日会话时长归账到对应目标（ledger 缺失时的诚实推导）
  const taskIds = [...new Set(todaySessions.map((s) => s.taskId).filter((id): id is string => !!id))];
  const minutesByPath = new Map<string, number>();
  if (taskIds.length) {
    const subtaskRows = await prisma.subtasks.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, milestoneId: true },
    });
    const milestoneIds = [...new Set(subtaskRows.map((s) => s.milestoneId).filter((id): id is string => !!id))];
    const milestoneRows = milestoneIds.length
      ? await prisma.milestones.findMany({ where: { id: { in: milestoneIds } }, select: { id: true, learningPathId: true } })
      : [];
    const milestoneToPath = new Map(milestoneRows.map((m) => [m.id, m.learningPathId]));
    const durationByTask = new Map<string, number>();
    for (const s of todaySessions) {
      if (!s.taskId) continue;
      durationByTask.set(s.taskId, (durationByTask.get(s.taskId) ?? 0) + (s.duration ?? 0));
    }
    for (const st of subtaskRows) {
      const pathId = milestoneToPath.get(st.milestoneId);
      if (!pathId) continue;
      minutesByPath.set(pathId, (minutesByPath.get(pathId) ?? 0) + (durationByTask.get(st.id) ?? 0));
    }
  }

  return {
    date: today,
    totalPlanned: goals.reduce((sum, g) => sum + (g.plannedMinutesPerDay ?? 0), 0),
    activeGoals: goals.map((goal) => {
      const ledger = ledgerByGoal.get(goal.id);
      // ledger 无记录时用今日会话推导，消除「恒 0 假进度条」
      const derivedMinutes = goal.pathId ? minutesByPath.get(goal.pathId) ?? 0 : 0;
      const consumedMinutes = ledger?.consumedMinutes ?? derivedMinutes;
      return {
        goalId: goal.id,
        title: goal.title,
        pathId: goal.pathId,
        priority: goal.priority,
        cognitiveBandwidth: goal.cognitiveBandwidth,
        plannedMinutes: goal.plannedMinutesPerDay ?? 30,
        consumedMinutes,
        loadAvg: ledger?.loadAvg ?? null,
        remainingMinutes: Math.max((goal.plannedMinutesPerDay ?? 30) - consumedMinutes, 0),
      };
    }),
    activeSessions: activeSessions.length,
    todayMinutes,
  };
}

/** 今日台账写入（幂等 upsert：userId×goalId×date） */
export async function planTodaySchedule(userId: string, plan: Array<{ goalId: string; budgetMinutes: number; plannedTasks?: string[] }>) {
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const item of plan) {
    const goal = await prisma.learning_goals.findFirst({ where: { id: item.goalId, userId } });
    if (!goal) continue;
    const ledger = await prisma.goal_scheduling_ledger.upsert({
      where: { userId_goalId_date: { userId, goalId: item.goalId, date: today } },
      update: {
        budgetMinutes: item.budgetMinutes,
        plannedTasks: item.plannedTasks?.length ? JSON.stringify(item.plannedTasks) : null,
        updatedAt: new Date(),
      },
      create: {
        id: `gsl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        userId,
        goalId: item.goalId,
        date: today,
        budgetMinutes: item.budgetMinutes,
        plannedTasks: item.plannedTasks?.length ? JSON.stringify(item.plannedTasks) : null,
      },
    });
    results.push(ledger);
  }
  return results;
}
