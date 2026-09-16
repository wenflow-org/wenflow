/**
 * 量纲防线：品牌类型（编译期）+ 落库/读取双向自检（运行期）
 *
 * 历史事故（2026-09-16）：`lss` 在落库侧是 0-10、在回调契约里是 0-100，两者都是 `number`
 * → "多除一个 10"静默通过全部测试，线上被压成 0.4，且消费侧阈值（按 0-10 写）整片失效。
 */
import prisma from '../../../config/database';
import { logger } from '../../../utils/logger';
import learningStateService, {
  asDisplayBalance,
  asDisplayHundred,
  guardInternalScale,
  internalTenToDisplay,
  toInternalBalance,
  toInternalTenScale,
} from '../learning-state.service';

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    learning_metrics: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    users: { findUnique: jest.fn(), update: jest.fn() },
    subtasks: { count: jest.fn() },
    teaching_sessions: { aggregate: jest.fn() },
  },
}));

describe('刻度转换（唯一入口，断言具体刻度而不是范围）', () => {
  it('0-10 原样；0-100 除以 10；越界 clamp', () => {
    expect(toInternalTenScale(4)).toBe(4);
    expect(toInternalTenScale(0.4)).toBe(0.4);
    expect(toInternalTenScale(40)).toBe(4);
    expect(toInternalTenScale(120)).toBe(10);
    expect(toInternalTenScale(-3)).toBe(0);
    expect(toInternalTenScale(Number.NaN)).toBe(0);
  });

  it('平衡值 -10..10；-100..100 除以 10', () => {
    expect(toInternalBalance(-0.9)).toBe(-0.9);
    expect(toInternalBalance(-90)).toBe(-9);
    expect(toInternalBalance(150)).toBe(10);
  });

  it('内部 0-10 → display 0-100：×10 且保留三位（这是回调契约的唯一出口）', () => {
    expect(internalTenToDisplay(4)).toBe(40);
    expect(internalTenToDisplay(4.8)).toBe(48);
    expect(internalTenToDisplay(0.4)).toBe(4);   // 0.4 是**内部**值 → display 是 4（不是 0.4×10=4 之外的任何东西）
    expect(internalTenToDisplay(12)).toBe(100);
  });

  it('已经是 display 的原始值只 clamp（不再换算）', () => {
    expect(asDisplayHundred(40)).toBe(40);
    expect(asDisplayHundred(120)).toBe(100);
    expect(asDisplayBalance(-120)).toBe(-100);
  });
});

describe('guardInternalScale（落库前后自检）', () => {
  const inRange = { lss: 4, ktl: 6, lf: 2, lsb: 4 };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('正常值原样通过，不告警', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    expect(guardInternalScale(inRange, 'test')).toEqual(inRange);
    expect(warn).not.toHaveBeenCalled();
  });

  it('越界值 → 告警（不静默）+ clamp 回权威刻度', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    const guarded = guardInternalScale({ lss: 40, ktl: 6, lf: -1, lsb: -90 }, 'write:test');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('scale-guard');
    expect(guarded).toEqual({ lss: 4, ktl: 6, lf: 0, lsb: -9 });
  });
});

describe('双向自检的接线位置', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('落库漏斗（buildMetricCreateData）：越界值被 clamp 后才落库', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    const data = await (learningStateService as any).buildMetricCreateData(
      'u1',
      { lss: 40, ktl: 6, lf: 1, lsb: 5, timestamp: new Date('2026-09-16T00:00:00Z') },
      {} as any,
      { source: 'test' }
    );
    expect(warn).toHaveBeenCalled();
    expect(data.lss).toBe(4);
    expect(data.ktl).toBe(6);
    expect(data.lsb).toBe(5);
  });

  it('读取漏斗：列里存了异刻度值（>10）→ 告警，且返回值仍是 0-10（值不静默消失）', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    (prisma.learning_metrics.findMany as jest.Mock).mockResolvedValue([
      { lss: 40, ktl: 30, lf: 10, lsb: 10, calculatedAt: new Date('2026-09-16T00:00:00Z'), pathId: 'lp-A' },
    ]);
    (prisma.learning_metrics.findFirst as jest.Mock).mockResolvedValue(null);

    const state = await learningStateService.getCurrentState('u1', { pathId: 'lp-A', asOf: new Date('2026-09-16T01:00:00Z') });

    expect(warn).toHaveBeenCalledTimes(1);
    const warnCall = warn.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(warnCall[1]).toMatchObject({ context: expect.stringContaining('read'), fields: ['lss', 'ktl'] });
    expect(state?.lss).toBe(4);
    expect(state?.ktl).toBe(3);
  });
});
