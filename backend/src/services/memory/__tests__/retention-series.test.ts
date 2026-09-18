import {
  RETENTION_CURVE_DAYS,
  buildRetentionSeries,
  buildRetentionSeriesForConcepts,
  fsrsStateOfTrace,
  type RetentionConceptInput,
} from '../retention-series';
import { fsrsRetrievability, fsrsStateFromLegacy, type FsrsMemoryState } from '../fsrs';

const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHOR = new Date('2026-09-01T09:00:00.000Z');

function fsrsSource(overrides: Partial<RetentionConceptInput> = {}): RetentionConceptInput {
  return {
    conceptKey: '概念A',
    label: '概念A',
    bucket: 'due',
    fsrsStability: 10,
    fsrsDifficulty: 5,
    fsrsLapses: 0,
    fsrsReps: 3,
    masteryScore: 0.7,
    extractionCount: 3,
    lastSeenAt: ANCHOR,
    ...overrides,
  };
}

describe('retention-series：遗忘曲线纯函数（Q2/Q8）', () => {
  it('采样日固定为 0/1/3/7/14/30', () => {
    expect([...RETENTION_CURVE_DAYS]).toEqual([0, 1, 3, 7, 14, 30]);
  });

  it('FSRS 状态：第 0 天恒为 1，随时间严格衰减', () => {
    const series = buildRetentionSeries(fsrsSource(), { asOf: ANCHOR });
    expect(series.days).toEqual([0, 1, 3, 7, 14, 30]);
    expect(series.retention[0]).toBe(1);
    for (let i = 1; i < series.retention.length; i++) {
      expect(series.retention[i]).toBeLessThan(series.retention[i - 1]);
      expect(series.retention[i]).toBeGreaterThanOrEqual(0);
    }
    // 与 fsrsRetrievability 同口径（不重造公式）
    const state: FsrsMemoryState = {
      stability: 10,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      lastReviewAt: ANCHOR,
    };
    for (const point of series.points) {
      const expected = fsrsRetrievability(state, new Date(ANCHOR.getTime() + point.day * DAY_MS));
      expect(point.retention).toBeCloseTo(expected, 4);
    }
  });

  it('elapsedDays / currentRetention 与 asOf 对齐（当前保留率同口径）', () => {
    const asOf = new Date(ANCHOR.getTime() + 5 * DAY_MS);
    const series = buildRetentionSeries(fsrsSource(), { asOf });
    const state = fsrsStateOfTrace(fsrsSource());
    expect(series.elapsedDays).toBe(5);
    expect(series.currentRetention).toBeCloseTo(fsrsRetrievability(state, asOf), 4);
  });

  it('legacy 行（无 FSRS 状态）走 fsrsStateFromLegacy，与快照口径一致', () => {
    const source = fsrsSource({ fsrsStability: null, fsrsDifficulty: null, fsrsLapses: null, fsrsReps: null });
    const series = buildRetentionSeries(source, { asOf: ANCHOR });
    const legacy = fsrsStateFromLegacy(source.masteryScore, source.extractionCount, source.lastSeenAt);
    expect(series.retention[0]).toBe(1);
    expect(series.retention[1]).toBeCloseTo(
      fsrsRetrievability(legacy, new Date(ANCHOR.getTime() + DAY_MS)),
      4,
    );
  });

  it('无 lastSeenAt 的痕迹不画曲线（全 0，不抛错）', () => {
    const series = buildRetentionSeries(fsrsSource({ lastSeenAt: null }), { asOf: ANCHOR });
    expect(series.retention.every((value) => value === 0)).toBe(true);
    expect(series.elapsedDays).toBe(0);
    expect(series.currentRetention).toBe(0);
  });

  it('确定性：同一输入重复构建结果完全一致', () => {
    const a = buildRetentionSeries(fsrsSource(), { asOf: ANCHOR });
    const b = buildRetentionSeries(fsrsSource(), { asOf: ANCHOR });
    expect(a).toEqual(b);
  });
});

describe('retention-series：批量概念排序与截断', () => {
  it('过滤无 lastSeenAt；到期优先、同组内当前保留率升序；max 截断', () => {
    const concepts = buildRetentionSeriesForConcepts(
      [
        // mastered 且保留率高
        fsrsSource({ conceptKey: '已掌握-高', bucket: 'mastered' }),
        // due 保留率最低（应排最前）
        fsrsSource({ conceptKey: '到期-低', bucket: 'due', lastSeenAt: new Date(ANCHOR.getTime() - 30 * DAY_MS) }),
        // due 保留率较高
        fsrsSource({ conceptKey: '到期-高', bucket: 'due' }),
        // other
        fsrsSource({ conceptKey: '其它', bucket: 'other' }),
        // 无 lastSeenAt → 过滤
        fsrsSource({ conceptKey: '无痕迹', lastSeenAt: null }),
        fsrsSource({ conceptKey: '已掌握-中', bucket: 'mastered', lastSeenAt: new Date(ANCHOR.getTime() - 20 * DAY_MS) }),
      ],
      { asOf: ANCHOR, max: 4 },
    );
    expect(concepts).toHaveLength(4);
    expect(concepts.map((c) => c.conceptKey)).toEqual(['到期-低', '到期-高', '已掌握-中', '已掌握-高']);
    // 数值稳定性与当前保留率已补齐
    for (const concept of concepts) {
      expect(typeof concept.stability).toBe('number');
      expect(concept.retention).toBe(concept.curve.currentRetention);
    }
    // 同组内保留率升序
    expect(concepts[0].retention).toBeLessThanOrEqual(concepts[1].retention);
    expect(concepts[2].retention).toBeLessThanOrEqual(concepts[3].retention);
  });

  it('空输入返回空数组（看板空态不抛错）', () => {
    expect(buildRetentionSeriesForConcepts([], { asOf: ANCHOR })).toEqual([]);
  });

  it('非法 max 回退默认 8', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      fsrsSource({ conceptKey: `c-${index}`, bucket: 'other' }),
    );
    expect(buildRetentionSeriesForConcepts(many, { asOf: ANCHOR, max: 0 })).toHaveLength(8);
  });
});
