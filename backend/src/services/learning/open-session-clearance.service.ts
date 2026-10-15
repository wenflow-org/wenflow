// 调整路径前「清场」服务：把调整范围内未结束的 AI 课堂按放弃（learner-abandoned）收尾。
// 独立于 learning.service（避免 SessionFinalizationService → learning.service 的循环依赖），
// 只依赖 prisma + teachingSessionRepository + sessionFinalizationService。
import prisma from '../../config/database';
import { teachingSessionRepository } from '../ai-teaching/TeachingSessionRepository';
import { sessionFinalizationService } from '../ai-teaching/SessionFinalizationService';
import { logger } from '../../utils/logger';

const OPEN_STATUSES = ['initializing', 'active', 'paused', 'timeout', 'finalizing'] as const;

export interface BlockingSessionItem {
  sessionId: string;
  taskId: string;
  taskTitle: string | null;
  status: string;
  revision: number;
  topic: string | null;
  updatedAt: string | null;
}

export interface OpenSessionClearanceInput {
  pathId: string;
  userId: string;
  /** 可选：仅收尾某个任务/阶段范围内的课堂（与 replan scope 对齐） */
  taskIds?: string[];
  milestoneIds?: string[];
  /** 可选：仅收尾指定的几个课堂（前端「结束这一课」）。与 taskIds/milestoneIds 互斥；
   *  2026-10-15 修复：此前路由收了该参数却从不传入，且存在时反而清空 stage 范围，
   *  导致"结束这一课"实际放弃整条路径的全部开放课堂。 */
  sessionIds?: string[];
  /** 收尾轮询上限（finalize 202 → 轮询终态），默认单次最多等 ~10s */
  pollAttempts?: number;
}

export interface OpenSessionClearanceResult {
  cleared: BlockingSessionItem[];
  failed: Array<{ sessionId: string; taskId: string; error: string }>;
  remaining: BlockingSessionItem[];
  /** 因本次放弃而复位的任务（in_progress → todo；P0-1 闭环） */
  resetTaskIds: string[];
}

async function waitForFinalization(
  pathId: string,
  userId: string,
  sessionId: string,
  sessionRevision: number,
  pollAttempts: number
): Promise<boolean> {
  // finalize 返回 processing（202）时轮询该会话状态直至非开放/超时；
  // 返回是否已进入终态（true = 收尾完成，可立即重试调整）
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const session = await prisma.teaching_sessions.findUnique({
      where: { id: sessionId },
      select: { status: true }
    });
    if (!session || !(OPEN_STATUSES as readonly string[]).includes(session.status)) return true;
    await sleep(1200);
  }
  logger.warn('[open-session-clearance] 课堂收尾等待超时（仍开放，交由后台最终化恢复兜底）', {
    pathId,
    sessionId
  });
  return false;
}

export class OpenSessionClearanceService {
  /** 查询路径调整范围内仍在开放（未结束）的课堂 */
  async listBlocking(
    input: OpenSessionClearanceInput
  ): Promise<BlockingSessionItem[]> {
    const { pathId, userId } = input;
    const tasks = await prisma.subtasks.findMany({
      where: {
        userId,
        milestones: { learningPathId: pathId }
      },
      select: { id: true, title: true }
    });
    const taskIds = input.taskIds && input.taskIds.length > 0
      ? tasks.filter((t) => input.taskIds!.includes(t.id)).map((t) => t.id)
      : tasks.map((t) => t.id);

    if (input.sessionIds && input.sessionIds.length > 0) {
      // 指定课堂模式：只看这几个会话（仍限定本路径 + 本人，防止跨路径误收尾）
      const sessions = await prisma.teaching_sessions.findMany({
        where: {
          userId,
          id: { in: input.sessionIds },
          learningPathId: pathId,
          status: { in: [...OPEN_STATUSES] }
        },
        select: {
          id: true,
          taskId: true,
          status: true,
          revision: true,
          topic: true,
          updatedAt: true
        }
      });
      const titleById = new Map(tasks.map((t) => [t.id, t.title]));
      return sessions.map((s) => ({
        sessionId: s.id,
        taskId: s.taskId,
        taskTitle: titleById.get(s.taskId) || null,
        status: s.status,
        revision: s.revision,
        topic: s.topic || null,
        updatedAt: s.updatedAt?.toISOString?.() || null
      }));
    }

    if (taskIds.length === 0) return [];

    const sessions = await prisma.teaching_sessions.findMany({
      where: {
        userId,
        status: { in: [...OPEN_STATUSES] },
        OR: [
          { taskId: { in: taskIds } },
          ...(input.milestoneIds && input.milestoneIds.length > 0
            ? [{ milestoneId: { in: input.milestoneIds } }]
            : [])
        ]
      },
      select: {
        id: true,
        taskId: true,
        status: true,
        revision: true,
        topic: true,
        updatedAt: true
      }
    });
    const titleById = new Map(tasks.map((t) => [t.id, t.title]));
    return sessions.map((s) => ({
      sessionId: s.id,
      taskId: s.taskId,
      taskTitle: titleById.get(s.taskId) || null,
      status: s.status,
      revision: s.revision,
      topic: s.topic || null,
      updatedAt: s.updatedAt?.toISOString?.() || null
    }));
  }

  /** 把范围内未结束课堂按放弃收尾（learner-abandoned），返回收尾结果与仍剩余项 */
  async abandonBlocking(
    input: OpenSessionClearanceInput
  ): Promise<OpenSessionClearanceResult> {
    const { pathId, userId, pollAttempts = 40 } = input;
    const blocking = await this.listBlocking(input);
    const cleared: BlockingSessionItem[] = [];
    const failed: Array<{ sessionId: string; taskId: string; error: string }> = [];

    for (const item of blocking) {
      try {
        // 服务端直接取库内 revision（不需要前端传）；幂等 operationId 防重复收尾
        const result = await sessionFinalizationService.finalize({
          sessionId: item.sessionId,
          userId,
          action: 'end_only',
          operationId: `abandon:${item.sessionId}`,
          revision: item.revision,
          endReason: 'learner-abandoned',
        });
        if (result.status === 'processing') {
          await waitForFinalization(pathId, userId, item.sessionId, item.revision, pollAttempts);
        }
        // 放弃收尾会生成 lesson:completed 证据；用户刚明确放弃该课堂并要重排同一任务，
        // 移除该条证据投影（会话历史保留在 teaching_sessions），否则重排会被
        // PATH_MUTATION_HAS_COMPLETED_TEACHING_EVIDENCE 再次拦截（无法闭环）。
        await prisma.learner_evidence.deleteMany({
          where: {
            sessionId: item.sessionId,
            taskId: item.taskId,
            pathId,
            evidenceType: 'lesson:completed'
          }
        }).catch((error) => {
          logger.warn('[open-session-clearance] 清除放弃课堂的 evidence 投影失败（不影响收尾）', {
            pathId,
            sessionId: item.sessionId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
        cleared.push(item);
      } catch (error: any) {
        logger.warn('[open-session-clearance] 放弃课堂失败', {
          pathId,
          sessionId: item.sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
        failed.push({
          sessionId: item.sessionId,
          taskId: item.taskId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // remaining：仍开放且不是刚被我们收尾（已终态/收尾中但 operation 归属本次放弃）的课堂
    const stillOpen = await this.listBlocking(input);
    const remaining = stillOpen.filter((item) => !cleared.some((c) => c.sessionId === item.sessionId));

    // P0-1（2026-10-15）：放弃收尾后把被打断的任务复位。end_only 的语义是「结束课堂、不计入完成」
    // ——会话落 completed，任务却永远停在 in_progress；而重排守卫对 replan-stage 拦 in_progress、
    // listBlocking 又只找开放会话 → 清场后必 409 且再点清场显示"没有需要结束的课堂"，永久死结
    //（审计 B2：四位里三位因此落不了地）。复位条件：该任务已无其他开放会话（多课堂任务要全部
    // 收完才复位）；只动 in_progress，不碰 completed。学习痕迹不受影响（会话行保留，
    // lesson:completed 证据本就按放弃语义删除）。
    const clearedTaskIds = [...new Set(cleared.map((item) => item.taskId).filter(Boolean))];
    const resetTasks: string[] = [];
    for (const taskId of clearedTaskIds) {
      const openLeft = await prisma.teaching_sessions.count({
        where: { taskId, userId, status: { in: [...OPEN_STATUSES] } }
      });
      if (openLeft > 0) continue;
      const updated = await prisma.subtasks.updateMany({
        where: { id: taskId, userId, status: 'in_progress' },
        data: { status: 'todo', updatedAt: new Date() }
      });
      if (updated.count > 0) resetTasks.push(taskId);
    }

    return { cleared, failed, remaining, resetTaskIds: resetTasks };
  }
}

export const openSessionClearanceService = new OpenSessionClearanceService();
