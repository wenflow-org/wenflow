/**
 * 截止进度落后提醒（TIME-TRUST-SCHEME-20261001 P1.6 · 通知侧）。
 *
 * 何时发：快照 replanSignal 带上 deadline_pace_behind（落后判据在 LearnerSnapshotService
 * 的 judgeDeadlinePace，纯函数）且该路径确有外部截止（learning_paths.deadline）时，
 * 发一条站内提醒（kind='deadline'，notifications 既有 kind 体系上新增一枚），link 直达路径详情。
 *
 * 防重（同 path 同类型只发一次）：复用通知表现有列做幂等键——userId + kind='deadline'
 * + link 精确等于 `/learning-path/:pathId`，find一旦命中即跳过，不新增表/列。
 *
 * 纪律：fail-open——任何失败只打 warn 返回 outcome，绝不阻断学习状态聚合主流程；
 * 触发点是页面驱动的快照刷新（dashboard/learning-state，各带缓存），不做每日排程。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { DEADLINE_PACE_BEHIND_CODE } from './LearnerSnapshotService';

export const DEADLINE_NOTIFICATION_KIND = 'deadline';

/** 通知 link 既当跳转地址、也当防重幂等键（同一路径恒定） */
export function buildDeadlineNotificationLink(pathId: string): string {
  return `/learning-path/${pathId}`;
}

export interface DeadlineNotifyInput {
  userId: string;
  pathId: string;
  pathTitle?: string | null;
  deadline: Date | string | null | undefined;
  /** 快照信号：reasonCodes 含 deadline_pace_behind 才发 */
  replanSignal?: { reasonCodes?: string[]; priority?: string } | null;
  now?: Date;
}

export interface DeadlineNotifyOutcome {
  sent: boolean;
  reason?: 'empty-input' | 'no-deadline' | 'not-behind' | 'already-notified' | 'error';
}

export function buildDeadlineNotificationCopy(input: {
  pathTitle?: string | null;
  deadline: Date | string;
  now?: Date;
}): { title: string; body: string } {
  const deadlineMs = new Date(input.deadline).getTime();
  const nowMs = (input.now ?? new Date()).getTime();
  const daysLeft = Number.isFinite(deadlineMs) ? Math.max(0, Math.ceil((deadlineMs - nowMs) / 86_400_000)) : null;
  const title = daysLeft === null
    ? '学习进度落后于截止日'
    : `距截止日还有 ${daysLeft} 天，进度有点落后`;
  const name = (input.pathTitle || '').trim();
  const target = name ? `「${name}」` : '当前路径';
  return {
    title,
    body: `${target}按剩余时间本应完成更多。可以在学习台上确认一次后续安排（收缩范围或调整节奏），已完成的内容不受影响。`,
  };
}

/**
 * 落后信号首次产生时发一条站内提醒（同 path 同类型只发一次）。
 * 供学习状态聚合（assemble-learning-state）在快照刷新后 fire-and-forget 调用。
 */
export async function notifyDeadlineBehindOnce(input: DeadlineNotifyInput): Promise<DeadlineNotifyOutcome> {
  try {
    if (!input?.userId || !input?.pathId) return { sent: false, reason: 'empty-input' };
    if (!input.deadline) return { sent: false, reason: 'no-deadline' };
    const reasonCodes = input.replanSignal?.reasonCodes || [];
    if (!reasonCodes.includes(DEADLINE_PACE_BEHIND_CODE)) return { sent: false, reason: 'not-behind' };

    const link = buildDeadlineNotificationLink(input.pathId);
    // 防重：该用户 + deadline 类 + 该路径的提醒已存在 → 跳过（首次产生才发）
    const existing = await prisma.notifications.findFirst({
      where: { userId: input.userId, kind: DEADLINE_NOTIFICATION_KIND, link },
      select: { id: true },
    });
    if (existing) return { sent: false, reason: 'already-notified' };

    const { title, body } = buildDeadlineNotificationCopy({
      pathTitle: input.pathTitle,
      deadline: input.deadline,
      now: input.now,
    });
    await prisma.notifications.create({
      data: {
        userId: input.userId,
        title,
        body,
        kind: DEADLINE_NOTIFICATION_KIND,
        link,
      },
    });
    logger.info('[deadline-notify] 截止进度落后提醒已发送（同路径仅一次）', {
      userId: input.userId,
      pathId: input.pathId,
    });
    return { sent: true };
  } catch (error) {
    logger.warn('[deadline-notify] 截止进度落后提醒失败（fail-open，不阻断状态聚合）', {
      userId: input?.userId,
      pathId: input?.pathId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: 'error' };
  }
}
