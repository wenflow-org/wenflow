/**
 * 教学上下文 · 时间信号与前序回顾（2026-10-24 架构优化批 1 自 TeachingContextBuilder.ts 迁出，逐字未改）。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import type { ReviewPlan } from '../memory/review-plan.service';
import { DEFAULT_TEMPORAL_LONG_GAP_DAYS, parseJsonSafe } from './teaching-context-knowledge';
import type { TeachingScenarioContext, TeachingTemporalGap } from './teaching-context-types';

/** 长间隔阈值解析：env `TEACHING_TEMPORAL_LONG_GAP_DAYS` 优先，非法/缺失回退默认值。 */
export function resolveTemporalLongGapThresholdDays(raw?: string | null): number {
  const parsed = Number(String(raw ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TEMPORAL_LONG_GAP_DAYS;
}

/**
 * 纯函数：由"上一节相关课程 endTime"计算时间间隔信号。
 * - 无可用 endTime（null/undefined/非法）→ null（调用方省略字段，行为不变）
 * - now 早于 endTime（时钟漂移）→ 归零，不产生负数
 * - isLongGap 判定为 `>= thresholdDays`（默认 {@link DEFAULT_TEMPORAL_LONG_GAP_DAYS}）
 */
export function computeTemporalGap(
  lastSessionEndTime: Date | string | null | undefined,
  now: Date = new Date(),
  thresholdDays: number = DEFAULT_TEMPORAL_LONG_GAP_DAYS,
): TeachingTemporalGap | null {
  if (!lastSessionEndTime) return null;
  const end = lastSessionEndTime instanceof Date ? lastSessionEndTime : new Date(lastSessionEndTime);
  const endMs = end.getTime();
  if (!Number.isFinite(endMs)) return null;
  const threshold = Number.isFinite(thresholdDays) && thresholdDays > 0
    ? thresholdDays
    : DEFAULT_TEMPORAL_LONG_GAP_DAYS;
  const days = Math.max(0, (now.getTime() - endMs) / (24 * 60 * 60 * 1000));
  return {
    daysSinceLastSession: Math.round(days * 10) / 10,
    isLongGap: days >= threshold,
  };
}

/**
 * 取同一用户、同路径上**最近一节已完成课**的 endTime（排除当前进行中的会话）。
 * 供真实侧时间信号主数据源；查询异常静默降级为 null（教学照常）。
 */
export async function fetchLatestPriorSessionEndTime(params: {
  userId: string;
  learningPathId: string;
  excludeSessionId?: string | null;
}): Promise<Date | null> {
  const { userId, learningPathId, excludeSessionId } = params;
  try {
    const row = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        learningPathId,
        status: 'completed',
        endTime: { not: null },
        ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      },
      orderBy: { endTime: 'desc' },
      select: { endTime: true },
    });
    return row?.endTime ?? null;
  } catch (error) {
    logger.warn('[TeachingContext] 拉取上一节结束时间失败（静默降级）', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      learningPathId,
    });
    return null;
  }
}

/**
 * 复盘要点双形读取（P1-8 修复，2026-10-06 审计）：
 *
 * `session-wrapup` 产物把 topicSummary / knowledgeItems / actionPlan 嵌在 `wrapup.summary.*` 下
 * （DB 实测顶层键无这三样：129/129 条 recap 全空），但历史产物/别处写入仍可能走顶层结构。
 * 因此「嵌套优先、顶层兜底」两态都读——与 `teaching-session-lifecycle.ts:243` 的双形读取同款。
 */
export function readWrapupSummaryFields(wrapup: any): {
  topicSummary: string | null;
  actionPlan: string[];
  knowledgeItems: any[];
  unresolvedPoints: string[];
} {
  const summary = wrapup && typeof wrapup === 'object' && wrapup.summary && typeof wrapup.summary === 'object'
    ? wrapup.summary
    : null;
  const rawTopicSummary = summary?.topicSummary ?? wrapup?.topicSummary;
  const topicSummary = typeof rawTopicSummary === 'string' && rawTopicSummary.trim() ? rawTopicSummary.trim() : null;
  const rawActionPlan = summary?.actionPlan ?? wrapup?.actionPlan;
  const actionPlan = Array.isArray(rawActionPlan)
    ? rawActionPlan.filter((item: any) => typeof item === 'string' && item.trim())
    : [];
  const rawKnowledgeItems = summary?.knowledgeItems ?? wrapup?.knowledgeItems;
  const knowledgeItems = Array.isArray(rawKnowledgeItems) ? rawKnowledgeItems : [];
  const unresolvedPoints = knowledgeItems
    .filter((item: any) => item && typeof item.name === 'string' && item.name.trim() && item.status !== 'mastered')
    .map((item: any) => String(item.name).trim())
    .slice(0, 3);
  return { topicSummary, actionPlan, knowledgeItems, unresolvedPoints };
}

/**
 * 拉取前序课程摘要（跨节承接数据源），按路径位置选择：
 * 1) 同 milestone 前一任务（同阶段内顺序接续）
 * 2) 上一 milestone 最近完成课（跨阶段接续）
 * 3) 当前任务自己的历史（同任务重学，attemptCount ≥ 2 才有）
 * 4) 回退：同路径最近完成课（原行为，但带 relation='last-any'）
 * 只取轻量字段，任何异常都静默降级为 null，不影响开课主流程。
 */
export async function fetchPriorLearningRecap(params: {  userId: string;
  learningPathId: string;
  currentMilestoneId: string;
  currentTaskId: string;
  currentStageNumber: number;
  milestoneTitle: string;
}): Promise<{
  recap: TeachingScenarioContext['lastLessonRecap'];
  sameTaskSessions: number;
  /** 实际被选为 recap 源的那节课的 endTime（时间信号的兜底源；无 recap 时为 null） */
  lastSourceEndTime: Date | null;
}> {
  const {
    userId,
    learningPathId,
    currentMilestoneId,
    currentTaskId,
    currentStageNumber,
    milestoneTitle,
  } = params;
  const empty = (): { recap: null; sameTaskSessions: 0; lastSourceEndTime: null } =>
    ({ recap: null, sameTaskSessions: 0, lastSourceEndTime: null });

  try {
    // 同路径阶段顺序
    const pathMilestones = await prisma.milestones.findMany({
      where: { learningPathId },
      orderBy: { stageNumber: 'asc' },
      select: { id: true, stageNumber: true, title: true },
    });
    if (!pathMilestones.length) return empty();
    const currentIdx = pathMilestones.findIndex((m) => m.id === currentMilestoneId);
    const prevMilestone = currentIdx > 0 ? pathMilestones[currentIdx - 1] : null;

    // 当前 milestone 内前一任务（不含当前）
    const tasksInMilestone = await prisma.subtasks.findMany({
      where: { milestoneId: currentMilestoneId, userId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true },
    });
    const currentTaskPos = tasksInMilestone.findIndex((t) => t.id === currentTaskId);
    const prevTaskInMilestone = currentTaskPos > 0 ? tasksInMilestone[currentTaskPos - 1] : null;

    // 同任务历史（当前任务自己学过的所有终态会话）
    const sameTaskSessions = await prisma.teaching_sessions.findMany({
      where: {
        userId,
        taskId: currentTaskId,
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { endTime: 'desc' },
      select: { topic: true, wrapup: true, endTime: true, status: true },
    });
    const sameTaskLatest = sameTaskSessions[0] || null;
    const sameTaskWrapup = sameTaskLatest ? parseJsonSafe(sameTaskLatest.wrapup as any) : null;
    const sameTaskFields = sameTaskWrapup ? readWrapupSummaryFields(sameTaskWrapup) : null;
    const sameTaskUnresolved = sameTaskFields?.unresolvedPoints ?? [];
    const sameTaskActionPlan = sameTaskFields ? sameTaskFields.actionPlan.slice(0, 3) : [];

    // 从教学会话里提取 recap 数据
    const toRecap = (session: any, relation: TeachingScenarioContext['lastLessonRecap']['relation']) => {
      const wrapup = session.wrapup ? parseJsonSafe(session.wrapup) : null;
      if (!wrapup) return null;
      const { topicSummary, actionPlan, unresolvedPoints } = readWrapupSummaryFields(wrapup);
      return {
        sourceTopic: typeof session.topic === 'string' && session.topic.trim() ? session.topic.trim() : null,
        topicSummary,
        retrievalCue: actionPlan[0] || null,
        unresolvedPoints,
        relation,
        sameTaskHistory: relation === 'same-task'
          ? {
              attemptCount: sameTaskSessions.length,
              lastStatus: sameTaskLatest?.status || '',
              lastEndTime: sameTaskLatest?.endTime?.toISOString?.() || null,
              lastSummary: topicSummary,
              lastUnresolvedPoints: unresolvedPoints,
              lastActionPlan: actionPlan.slice(0, 3),
            }
          : undefined,
      };
    };

    // 候选源：同 milestone 前一任务（同路径最近完成课，且属于前一任务）
    // → 上一 milestone 最近完成课 → 同任务历史 → 全路径最近完成课
    const prevTaskSessions = prevTaskInMilestone
      ? await prisma.teaching_sessions.findFirst({
          where: {
            userId,
            learningPathId,
            taskId: prevTaskInMilestone.id,
            status: 'completed',
            wrapup: { not: null },
          },
          orderBy: { endTime: 'desc' },
          select: { topic: true, wrapup: true, endTime: true },
        })
      : null;
    if (prevTaskSessions) {
      const recap = toRecap(prevTaskSessions, 'same-milestone-prev-task');
      if (recap) {
        return {
          recap: {
            ...recap,
            sourceStageNumber: currentStageNumber,
            sourceMilestoneTitle: milestoneTitle,
            sourceTaskTitle: prevTaskInMilestone?.title || null,
          },
          sameTaskSessions: sameTaskSessions.length,
          lastSourceEndTime: prevTaskSessions.endTime ?? null,
        };
      }
    }

    // 上一 milestone：取该 milestone 下最近完成课
    if (prevMilestone) {
      const prevMsRecentTaskIds = await prisma.subtasks.findMany({
        where: { milestoneId: prevMilestone.id, userId },
        select: { id: true },
      });
      const prevMsSessions = prevMsRecentTaskIds.length
        ? await prisma.teaching_sessions.findFirst({
            where: {
              userId,
              learningPathId,
              taskId: { in: prevMsRecentTaskIds.map((t: any) => t.id) },
              status: 'completed',
              wrapup: { not: null },
            },
            orderBy: { endTime: 'desc' },
            select: { topic: true, wrapup: true, endTime: true },
          })
        : null;
      if (prevMsSessions) {
        const recap = toRecap(prevMsSessions, 'prev-milestone');
        if (recap) {
          return {
            recap: {
              ...recap,
              sourceStageNumber: prevMilestone.stageNumber,
              sourceMilestoneTitle: prevMilestone.title,
              sourceTaskTitle: null,
            },
            sameTaskSessions: sameTaskSessions.length,
            lastSourceEndTime: prevMsSessions.endTime ?? null,
          };
        }
      }
    }

    // 同任务历史（第二/多次学同一任务）
    if (sameTaskSessions.length > 0 && sameTaskWrapup) {
      const recap = toRecap(sameTaskLatest, 'same-task');
      if (recap) {
        return {
          recap: {
            ...recap,
            sourceStageNumber: currentStageNumber,
            sourceMilestoneTitle: milestoneTitle,
            sourceTaskTitle: null,
          },
          sameTaskSessions: sameTaskSessions.length,
          lastSourceEndTime: sameTaskLatest?.endTime ?? null,
        };
      }
    }

    // 回退：同路径最近完成课（排除当前任务，原行为）
    const lastEnded = await prisma.teaching_sessions.findFirst({
      where: {
        userId,
        learningPathId,
        taskId: { not: currentTaskId },
        status: 'completed',
        wrapup: { not: null },
      },
      orderBy: { endTime: 'desc' },
      select: { topic: true, wrapup: true, endTime: true },
    });
    if (lastEnded) {
      const recap = toRecap(lastEnded, 'last-any');
      if (recap) {
        return { recap, sameTaskSessions: sameTaskSessions.length, lastSourceEndTime: lastEnded.endTime ?? null };
      }
    }
    return { recap: null, sameTaskSessions: sameTaskSessions.length, lastSourceEndTime: null };
  } catch (error) {
    logger.warn('[TeachingContext] 拉取前序课程摘要失败（静默降级）', {
      error: error instanceof Error ? error.message : String(error),
      userId,
      learningPathId,
    });
    return empty();
  }
}

/**
 * 取**上一节课**留下的「连续受挫轮数」（§4.5 情感闭环：受挫 → 降档/减速的信号化）。
 *
 * 数据源：`teachingState.learnerStateContext.frustratedStreak`（回合级计算、随会话状态持久化）。
 * 防御式只读：任何缺失/非法都按 0（= 不降档），避免"读不到"被误当成"受挫"。
 *
 * @internal 导出供单测
 */
export function readRecentFrustrationStreak(previousSession: unknown): number {
  const raw = (previousSession as { teachingState?: unknown } | null | undefined)?.teachingState;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 0;
    }
  }
  const streak = (parsed as { learnerStateContext?: { frustratedStreak?: unknown } } | null | undefined)
    ?.learnerStateContext?.frustratedStreak;
  const n = Number(streak);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 汇总前序阶段掌握（供 priorLearningContext.priorMilestoneMastery）。
 *
 * 只保留**确有前序进展**的阶段（completedTasks > 0）：全新学习者的当前路径上
 * 所有阶段都是 `completedTasks: 0 / masteryState: 'unknown'`，若照单全收，
 * `priorLearningContext` 会恒为真值，开场就会凭空声称
 * 「前面关于 X 的基础已经建立好」（走查 P3 实测）。
 *
 * @internal 导出供单测锁定上述口径
 */
export function buildPriorMilestoneMastery(learnerSnapshot: any): TeachingScenarioContext['priorLearningContext'] extends infer _ ? NonNullable<TeachingScenarioContext['priorLearningContext']>['priorMilestoneMastery'] : never {
  const progress = learnerSnapshot?.knowledgeMemory?.currentPath?.milestoneProgress;
  if (!Array.isArray(progress)) return [];
  return progress
    .filter((item: any) =>
      item
      && typeof item.stageNumber === 'number'
      && typeof item.masteryState === 'string'
      && Number(item.completedTasks) > 0
    )
    .map((item: any) => ({
      stageNumber: item.stageNumber,
      title: typeof item.title === 'string' ? item.title : '',
      masteryState: item.masteryState,
      completedTasks: typeof item.completedTasks === 'number' ? item.completedTasks : 0,
      totalTasks: typeof item.totalTasks === 'number' ? item.totalTasks : 0,
    }));
}

