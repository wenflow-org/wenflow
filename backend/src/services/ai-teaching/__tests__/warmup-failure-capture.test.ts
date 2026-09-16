import {
  collectWarmupReviewItems,
  hasLearnerTurnAfter,
} from '../SessionFinalizationService';
import type { TeachingSessionRecord } from '../../ai-teaching/TeachingSessionRepository';

const sessionWithMessages = (messages: Array<{ role: string; timestamp: string }>) =>
  ({ messages } as unknown as TeachingSessionRecord);

describe('课内温故收束：失败的入库通道（回归 §3.9/§3.11 —— 失败此前永不入库）', () => {
  const after = () => true;
  const never = () => false;

  it('有结果的点按结果映射评分', () => {
    const items = [
      { conceptKey: 'a', label: 'A', outcome: { status: 'mastered', progress: 90 } },
      { conceptKey: 'b', label: 'B', outcome: { status: 'learning', progress: 40 } },
    ];
    expect(collectWarmupReviewItems(items, after)).toEqual([
      { conceptKey: 'a', label: 'A', status: 'mastered', progress: 90, masteryScore: 0.85, rating: 'good' },
      { conceptKey: 'b', label: 'B', status: 'learning', progress: 40, masteryScore: 0.5, rating: 'hard' },
    ]);
  });

  it('问过了但始终没推进 + 学习者之后有发言 → 判为没答出（again）', () => {
    const items = [{ conceptKey: 'c', label: 'C', askedAt: '2026-09-16T10:00:00.000Z' }];
    expect(collectWarmupReviewItems(items, after)).toEqual([
      { conceptKey: 'c', label: 'C', status: 'not-recalled', progress: 0, masteryScore: 0.5, rating: 'again' },
    ]);
  });

  it('最后一轮才问出来的点不算失败（没来得及答 ≠ 答不出）', () => {
    const items = [{ conceptKey: 'd', label: 'D', askedAt: '2026-09-16T10:00:00.000Z' }];
    expect(collectWarmupReviewItems(items, never)).toEqual([]);
  });

  it('压根没问过的点不留痕（没有回捞发生，就没有观测）', () => {
    expect(collectWarmupReviewItems([{ conceptKey: 'e', label: 'E' }], after)).toEqual([]);
  });

  it('没有 conceptKey 的脏数据跳过，不抛错', () => {
    expect(collectWarmupReviewItems([{ label: 'X' }, {}] as never, after)).toEqual([]);
    expect(collectWarmupReviewItems(null, after)).toEqual([]);
  });

  it('结果与失败可同时收集（一条计划里有成有败）', () => {
    const items = [
      { conceptKey: 'a', label: 'A', outcome: { status: 'mastered', progress: 100 } },
      { conceptKey: 'b', label: 'B', askedAt: '2026-09-16T10:00:00.000Z' },
    ];
    const collected = collectWarmupReviewItems(items, after);
    expect(collected.map((item) => `${item.conceptKey}:${item.rating}`)).toEqual(['a:easy', 'b:again']);
  });

  it('hasLearnerTurnAfter：只认该时刻之后的学生发言', () => {
    const session = sessionWithMessages([
      { role: 'assistant', timestamp: '2026-09-16T09:59:00.000Z' },
      { role: 'user', timestamp: '2026-09-16T10:01:00.000Z' },
    ]);
    expect(hasLearnerTurnAfter(session, '2026-09-16T10:00:00.000Z')).toBe(true);
    expect(hasLearnerTurnAfter(session, '2026-09-16T10:05:00.000Z')).toBe(false);
    // 助手发言不算"作答机会"
    expect(hasLearnerTurnAfter(session, '2026-09-16T09:58:00.000Z')).toBe(true);
    expect(hasLearnerTurnAfter(sessionWithMessages([{ role: 'assistant', timestamp: '2026-09-16T10:01:00.000Z' }]), '2026-09-16T10:00:00.000Z')).toBe(false);
    // 坏时间戳不误判
    expect(hasLearnerTurnAfter(session, 'not-a-date')).toBe(false);
  });
});
