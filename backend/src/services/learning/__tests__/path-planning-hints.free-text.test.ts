import { inferMaxWeeksFromTimeHorizon, derivePlanningHints } from '../path-planning-hints';
import { paceSignalRangeConfig } from '../../../config/pedagogy.config';

describe('inferMaxWeeksFromTimeHorizon（自由文本周数兜底）', () => {
  const cases: Array<{ input: string | null; expected: number | null; label: string }> = [
    { input: null, expected: null, label: 'null' },
    { input: '   ', expected: null, label: '空白' },
    { input: '三个月', expected: 12.9, label: '三个月→12.9周' },
    { input: '半年', expected: 26, label: '半年→26周' },
    { input: '一年', expected: 52, label: '一年→52周' },
    { input: '3个月', expected: 12.9, label: '3个月→12.9周' },
    { input: '两周', expected: 2, label: '两周→2周' },
    { input: '三个星期', expected: 3, label: '三个星期→3周' },
    { input: '四天', expected: 4 / 7, label: '四天→0.57周' },
    { input: '两三天', expected: 3 / 7, label: '两三天→0.43周（按3天）' },
    { input: '下周复诊前，剩四天', expected: 4 / 7, label: '下周复诊剩四天→0.57周' },
    { input: '明天早上就要交', expected: 1, label: '明天早上就要交→1周' },
    { input: '下周五上午', expected: 1, label: '下周五上午→1周（截止信号）' },
    { input: '周五见', expected: null, label: '周五是weekday不是5周→null' },
    { input: '上半年（1月到6月）', expected: 4.3, label: '上半年1到6月→4.3周（按1月）' },
    { input: '有空就剪，灵感来了能到半夜', expected: null, label: '无时间信号→null' },
    { input: '周末', expected: 1, label: '仅"周末"→1周（短周期信号）' },
  ];

  it.each(cases)('$label', ({ input, expected }) => {
    const actual = inferMaxWeeksFromTimeHorizon(input);
    if (expected === null) {
      expect(actual).toBeNull();
    } else {
      expect(actual).not.toBeNull();
      expect(actual).toBeCloseTo(expected, 1);
    }
  });
});

describe('derivePlanningHints maxWeeks 兜底链路', () => {
  it('timeDimensions 缺失时用自由文本钳制紧迫场景', () => {
    const hints = derivePlanningHints('下周复诊前，剩四天', '晚上量一次', '每晚10分钟', 'per_day', []);
    // 0.57 周 × 1.2 → ceil = 1，不再回退 extended 的 24
    expect(hints.maxWeeks).toBe(1);
  });

  it('自由文本无时间信号时保持 pace 默认值', () => {
    const hints = derivePlanningHints('有空就剪，灵感来了能到半夜', null, null, null, []);
    expect(hints.maxWeeks).toBe(24);
  });

  it('timeDimensions.totalWeeks 优先于自由文本', () => {
    const hints = derivePlanningHints(
      '三个月', '每周两次', '每周两次', 'per_week',
      [],
      { totalWeeks: 12, estimatedHours: null, sessionsPerWeek: null, sessionsLengthMin: null }
    );
    expect(hints.maxWeeks).toBe(Math.min(52, Math.max(1, Math.ceil(12 * 1.2)))); // 15
  });
});

describe('targetMilestones（强制里程碑数量，keyStages 直接透传）', () => {
  it('keyStages 数量直接作为 targetMilestones，milestoneRange 收紧为精确值', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3']);
    expect(hints.targetMilestones).toBe(3);
    expect(hints.milestoneRange).toEqual([3, 3]);
  });

  it('keyStages 缺失时 targetMilestones 为 null，沿用 pace 区间', () => {
    const hints = derivePlanningHints('三个月', null, null, null, [], null);
    expect(hints.targetMilestones).toBeNull();
    expect(hints.milestoneRange).toEqual(paceSignalRangeConfig.extended.milestoneRange);
  });

  it('keyStages 数量超出夹取范围时限制在 2-8 之间', () => {
    const low = derivePlanningHints(null, null, null, null, ['S1']);
    expect(low.targetMilestones).toBe(2);
    const high = derivePlanningHints(null, null, null, null, Array.from({ length: 12 }, (_, i) => `S${i}`));
    expect(high.targetMilestones).toBe(8);
  });
});
