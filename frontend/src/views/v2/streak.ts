import { localDateKey } from '@/utils/date';

/**
 * 连续学习天数——全站唯一口径（P1-1，2026-10-04 全站设计评审）。
 *
 * 定义：从今天（今天没学则从昨天）往前数「学习分钟 > 0」的连续天数。
 * 消费方：学习台 streakDays（V2Dashboard）、学习状态 kpiStreak（V2LearningState）、
 * 账户页 KPI（Profile）。
 *
 * 此前学习台/账户页优先读 `users.streakDays` 库字段快照，该字段无实时刷新机制
 * （stale 快照），与本页实时推算跨页打架——同账号同天一处显 0 一处显 1。
 * 现统一为客户端推算单一口径，库字段不再参与展示。
 */
export function computeStreakDays(minutesByDate: Map<string, number>): number {
  let streak = 0;
  const d = new Date();
  if ((minutesByDate.get(localDateKey(d)) ?? 0) === 0) d.setDate(d.getDate() - 1);
  // 表只有有限天，往前数到第一个空档必然终止；上限仅防呆
  for (let i = 0; i < 3650; i++) {
    if ((minutesByDate.get(localDateKey(d)) ?? 0) <= 0) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
