/**
 * 「可继续的课堂」的活跃度分档（2026-11-03 通知面板改档抽出）。
 *
 * 分档阈值**不新造**：直接复用断线恢复窗口 `RECOVERY_WINDOW_MS`（48h），
 * 它的既有注释就是「超过则视为新会话，避免『几天前的课』被当成进行中」。
 * 所以「进行中 / 空闲中」与「同一个会话要不要当新会话开」用的是同一条界线。
 *
 * 抽出原因：`ai-teaching.routes.ts` 受超大文件棘轮约束（只许缩短），
 * 这段纯投影不依赖路由上下文，放在这里路由只剩一次 map。
 */
import { RECOVERY_WINDOW_MS } from './teaching-session-lifecycle';

export type SessionActivity = 'active' | 'idle';

/** 会话在活跃端点上的入参（来自 getSessionHistory 的投影） */
export interface ActiveSessionSource {
  id: string;
  subject: string;
  topic: string;
  startTime: Date;
  messageCount: number;
  lastActiveAt: Date | null;
}

/**
 * 活跃度分档：最近活跃在恢复窗口内 = 进行中；缺失/超窗 = 空闲中（不让无读数冒充进行中）。
 *
 * 负的 age（消息时间戳比"现在"还新）按**进行中**处理：写库时钟与应用时钟可能有毫秒级偏移，
 * 刚落的这一条消息被判成「空闲」是最不该出现的误伤。
 */
export function activityOf(lastActiveAt: Date | null | undefined, now: number = Date.now()): SessionActivity {
  if (!lastActiveAt) return 'idle';
  const age = now - new Date(lastActiveAt).getTime();
  return Number.isFinite(age) && age <= RECOVERY_WINDOW_MS ? 'active' : 'idle';
}

/** 活跃端点的一条会话（含 lastActiveAt 原值与 activity 分档） */
export function projectActiveSession(s: ActiveSessionSource, now: number = Date.now()) {
  return {
    sessionId: s.id,
    subject: s.subject,
    topic: s.topic,
    startTime: s.startTime,
    messageCount: s.messageCount,
    lastActiveAt: s.lastActiveAt,
    activity: activityOf(s.lastActiveAt, now),
  };
}
