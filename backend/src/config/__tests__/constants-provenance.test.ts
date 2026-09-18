/**
 * 常量来源登记表回归（审计 §7 P1-2）：
 * - 真实登记表必须自洽（value == resolve()，mirrors 不分叉，文献都带 ref）；
 * - 检查器本身要能抓到：漂移、无出处的"文献"、重复 key、同口径分叉。
 */
import { SCIENTIFIC_CONSTANTS, summarizeConstantSources, type ScientificConstant } from '../constants-provenance';
import { checkConstants } from '../../scripts/check-constants-provenance';

const base = (over: Partial<ScientificConstant>): ScientificConstant => ({
  key: 'k',
  value: 1,
  source: '工程启发式',
  resolve: () => 1,
  ...over,
});

describe('SCIENTIFIC_CONSTANTS（登记表自洽）', () => {
  it('真实登记表无违规（防漂移 / 防分叉）', () => {
    expect(checkConstants(SCIENTIFIC_CONSTANTS)).toEqual([]);
  });

  it('来源统计：文献 / 工程启发式 都非空，且总数一致', () => {
    const s = summarizeConstantSources();
    expect(s.total).toBe(SCIENTIFIC_CONSTANTS.length);
    expect(s.bySource['文献']).toBeGreaterThan(0);
    expect(s.bySource['工程启发式']).toBeGreaterThan(0);
    expect(s.bySource['文献'] + s.bySource['工程启发式']).toBe(s.total);
  });

  it('key 唯一', () => {
    const keys = SCIENTIFIC_CONSTANTS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('标「文献」的项都给了 ref', () => {
    for (const c of SCIENTIFIC_CONSTANTS.filter((x) => x.source === '文献')) {
      expect(c.ref && c.ref.trim().length).toBeGreaterThan(0);
    }
  });

  it('覆盖状态回路的关键区域（登记目标 ≥30 项）', () => {
    expect(SCIENTIFIC_CONSTANTS.length).toBeGreaterThanOrEqual(30);
    const keys = new Set(SCIENTIFIC_CONSTANTS.map((c) => c.key));
    // 抽查：状态聚合 / 难度上限 / 复习额度 / BKT 分档 / 检查点 都在册
    for (const key of [
      'state.aggregation.activeWindowDays',
      'difficulty.challengeCap.high',
      'review.dailyLoadLimit',
      'review.minBudgetSample',
      'belief.bkt.easy.pL0',
      'belief.bkt.hard.pT',
      'warmup.fuzzy.minLength',
    ]) {
      expect(keys.has(key)).toBe(true);
    }
  });
});

describe('checkConstants（检查器能抓到什么）', () => {
  it('标注漂移：value ≠ resolve() → 报错', () => {
    const problems = checkConstants([base({ value: 0.9, resolve: () => 0.7 })]);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain('标注漂移');
  });

  it('冒牌文献：source=文献 但无 ref → 报错', () => {
    const problems = checkConstants([base({ source: '文献', ref: undefined })]);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain('没给 ref');
  });

  it('key 重复 → 报错', () => {
    const problems = checkConstants([base({ key: 'dup' }), base({ key: 'dup' })]);
    expect(problems.some((p) => p.detail.includes('key 重复'))).toBe(true);
  });

  it('同口径分叉：mirrors 与主值不等 → 报错（"同一个量写两份"的护栏）', () => {
    const problems = checkConstants([
      base({ value: 0.7, resolve: () => 0.7, mirrors: [{ where: 'other/lambda', resolve: () => 0.85 }] }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain('同口径分叉');
  });

  it('数值容差：浮点等价不算漂移', () => {
    expect(checkConstants([base({ value: 0.3, resolve: () => 0.1 + 0.2 })])).toEqual([]);
  });
});
