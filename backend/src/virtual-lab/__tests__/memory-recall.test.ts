import {
  buildMemoryRecallHints,
  buildSimulatedRecallReviewEvent,
  mapRecallStatusToReviewItem,
} from '../memory-recall';
import type { LearnerMemorySnapshot } from '../learner-memory';

function snapshot(dueReview: Array<{ name: string; progress: number }>): LearnerMemorySnapshot {
  return {
    mastered: [{ name: '已掌握', status: 'mastered' }],
    dueReview: dueReview.map((item) => ({ name: item.name, status: 'review', progress: item.progress })),
    struggling: [],
    recentCompleted: [],
    recentTaskTitles: [],
  };
}

const base = { experimentRunSeed: 'run1', virtualLearnerId: 'vl1', sessionId: 's1', stepIndex: 1 };

describe('buildMemoryRecallHints（Q4 概率化提取接线）', () => {
  it('确定性：同一组输入两次结果完全一致（可回放）', () => {
    const memory = snapshot([{ name: '数组二分', progress: 30 }]);
    expect(buildMemoryRecallHints({ ...base, memory })).toEqual(buildMemoryRecallHints({ ...base, memory }));
  });

  it('不同 stepIndex → 独立随机流', () => {
    const memory = snapshot(Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, progress: 40 })));
    const a = buildMemoryRecallHints({ ...base, stepIndex: 1, memory });
    const b = buildMemoryRecallHints({ ...base, stepIndex: 2, memory });
    expect(a).not.toEqual(b);
  });

  it('只对 dueReview 计算，且按 maxItems 截断', () => {
    const memory = snapshot([
      { name: 'a', progress: 30 },
      { name: 'b', progress: 30 },
      { name: 'c', progress: 30 },
    ]);
    const hints = buildMemoryRecallHints({ ...base, memory, maxItems: 2 });
    expect(hints.map((hint) => hint.conceptKey)).toEqual(['a', 'b']);
    expect(hints.every((hint) => ['CLEAR', 'VAGUE', 'CONFUSED', 'FAILED'].includes(hint.status))).toBe(true);
  });

  it('空/缺快照 → 空数组', () => {
    expect(buildMemoryRecallHints({ ...base, memory: null })).toEqual([]);
    expect(buildMemoryRecallHints({ ...base, memory: snapshot([]) })).toEqual([]);
  });

  it('保留率越低越可能"想不起来"（200 组种子的非 CLEAR 占比更高）', () => {
    let lowNonClear = 0;
    let highNonClear = 0;
    for (let i = 0; i < 200; i += 1) {
      const low = buildMemoryRecallHints({ ...base, experimentRunSeed: `r${i}`, memory: snapshot([{ name: 'x', progress: 15 }]) })[0];
      const high = buildMemoryRecallHints({ ...base, experimentRunSeed: `r${i}`, memory: snapshot([{ name: 'x', progress: 96 }]) })[0];
      if (low.status !== 'CLEAR') lowNonClear += 1;
      if (high.status !== 'CLEAR') highNonClear += 1;
    }
    expect(lowNonClear).toBeGreaterThan(highNonClear);
  });
});

describe('提取四态 → FSRS 复习条目（P2 效度闭环）', () => {
  const hint = (status: 'CLEAR' | 'VAGUE' | 'CONFUSED' | 'FAILED', conceptKey = '概念A') => ({
    conceptKey,
    status,
    outputConceptKey: conceptKey,
  });

  it('四态映射到不同 rating/status/mastery', () => {
    expect(mapRecallStatusToReviewItem(hint('CLEAR'))).toEqual(expect.objectContaining({
      status: 'mastered', progress: 100, masteryScore: 0.9, rating: 'good',
    }));
    expect(mapRecallStatusToReviewItem(hint('VAGUE'))).toEqual(expect.objectContaining({
      status: 'learning', progress: 50, masteryScore: 0.55, rating: 'hard',
    }));
    expect(mapRecallStatusToReviewItem(hint('CONFUSED'))).toEqual(expect.objectContaining({
      status: 'review', progress: 0, masteryScore: 0.35, rating: 'again',
    }));
    expect(mapRecallStatusToReviewItem(hint('FAILED'))).toEqual(expect.objectContaining({
      status: 'review', progress: 0, masteryScore: 0.3, rating: 'again',
    }));
  });

  it('构造 review:completed 事件：幂等键含 session+dayIndex，条目齐全', () => {
    const event = buildSimulatedRecallReviewEvent({
      userId: 'u1',
      teachingSessionId: 't1',
      pathId: 'p1',
      dayIndex: 1,
      hints: [hint('CLEAR', 'A'), hint('FAILED', 'B')],
      occurredAt: new Date('2026-10-09T12:00:00.000Z'),
    });
    expect(event).not.toBeNull();
    expect(event!.id).toBe('sim-recall:t1:1');
    expect(event!.type).toBe('review:completed');
    expect(event!.source).toBe('simulation-recall');
    expect(event!.data.reviewItems).toEqual([
      expect.objectContaining({ conceptKey: 'A', rating: 'good' }),
      expect.objectContaining({ conceptKey: 'B', rating: 'again' }),
    ]);
    // 跨天重抽 → 新事件；同一天重复调用 → 同幂等键
    const nextDay = buildSimulatedRecallReviewEvent({
      userId: 'u1', teachingSessionId: 't1', dayIndex: 2,
      hints: [hint('CLEAR', 'A')], occurredAt: new Date('2026-10-10T12:00:00.000Z'),
    });
    expect(nextDay!.id).toBe('sim-recall:t1:2');
  });

  it('无到期点 / 无课堂会话 → 不构造事件', () => {
    const occurredAt = new Date('2026-10-09T12:00:00.000Z');
    expect(buildSimulatedRecallReviewEvent({ userId: 'u1', teachingSessionId: 't1', dayIndex: 1, hints: [], occurredAt })).toBeNull();
    expect(buildSimulatedRecallReviewEvent({ userId: 'u1', teachingSessionId: '', dayIndex: 1, hints: [hint('CLEAR')], occurredAt })).toBeNull();
  });
});
