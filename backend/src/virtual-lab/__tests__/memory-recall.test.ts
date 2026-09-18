import { buildMemoryRecallHints } from '../memory-recall';
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
