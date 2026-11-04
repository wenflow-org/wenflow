/**
 * 「可继续的课堂」的活跃度分档（2026-11-03 通知面板改档抽出）。
 *
 * 分档阈值**不新造**：直接复用断线恢复窗口 `RECOVERY_WINDOW_MS`（48h），
 * 它的既有注释就是「超过则视为新会话，避免『几天前的课』被当成进行中」。
 * 所以「进行中 / 空闲中」与「同一个会话要不要当新会话开」用的是同一条界线。
 * 2026-11-04 补一条：界线只管「多久没动」，不管「课是不是已经结束」——已超时结束的课
 * （endTime 非空）另按 status 归「空闲中」，见 projectActiveSession。
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
  /** 2026-11-04：已超时结束的课带 endTime（进行中/暂停为 null），用于不把「已结束」读成「进行中」 */
  endTime?: Date | null;
}

/**
 * 活跃度分档：最近活跃在恢复窗口内 = 进行中；缺失/超窗 = 空闲中（不让无读数冒充进行中）。
 *
 * 负的 age（消息时间戳比"现在"还新）按**进行中**处理：写库时钟与应用时钟可能有毫秒级偏移，
 * 刚落的这一条消息被判成「空闲」是最不该出现的误伤。
 *
 * 只按时间判不出「这课是不是已经结束」——已超时结束的课（endTime 非空）由 projectActiveSession
 * 先行拦下，见那里的 2026-11-04 注释。
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
    // 2026-11-04：endTime 非空 = 已超时结束（timeout 行必然带 endTime），这类课即便 lastActiveAt
    // 还落在 48h 恢复窗口内也不能标「进行中」——旧口径只按时间分区，把一批已中断的旧课列进了
    // 通知面板「课堂进行中」，与顶部「上次那节是超时中断」互相矛盾。课仍可恢复，故归「空闲中」，不隐藏。
    activity: s.endTime ? 'idle' as SessionActivity : activityOf(s.lastActiveAt, now),
  };
}
