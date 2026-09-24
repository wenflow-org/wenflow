import {
  runWithSimulatedClock,
  getSimulatedAsOf,
  simulatedNowOr,
  isSimulatedClockActive,
} from '../simulation-clock-context';

describe('simulation-clock-context（模拟时钟上下文）', () => {
  it('无上下文：getSimulatedAsOf=null，simulatedNowOr 等价真墙钟', () => {
    expect(getSimulatedAsOf()).toBeNull();
    expect(isSimulatedClockActive()).toBe(false);
    const before = Date.now();
    expect(simulatedNowOr().getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('上下文内：取模拟 asOf，跨 await 传播；退出后恢复真墙钟', async () => {
    const asOf = new Date('2026-09-01T23:59:59.999Z');
    await runWithSimulatedClock(asOf, async () => {
      await Promise.resolve();
      expect(isSimulatedClockActive()).toBe(true);
      expect(getSimulatedAsOf()?.toISOString()).toBe('2026-09-01T23:59:59.999Z');
      expect(simulatedNowOr().toISOString()).toBe('2026-09-01T23:59:59.999Z');
    });
    expect(getSimulatedAsOf()).toBeNull();
    expect(simulatedNowOr().getTime()).not.toBe(asOf.getTime());
  });

  it('返回拷贝：调用方原地修改（setHours 等）不污染共享的模拟时刻', () => {
    // 学习状态的趋势窗口会做 `today.setHours(0,0,0,0)`；若返回共享引用，模拟时刻会被改到当天零点
    const asOf = new Date('2026-09-01T12:00:00.000Z');
    runWithSimulatedClock(asOf, () => {
      const mutated = simulatedNowOr();
      mutated.setHours(0, 0, 0, 0);
      expect(simulatedNowOr().toISOString()).toBe('2026-09-01T12:00:00.000Z');
      expect(getSimulatedAsOf()?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
    });
    expect(asOf.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });
});
