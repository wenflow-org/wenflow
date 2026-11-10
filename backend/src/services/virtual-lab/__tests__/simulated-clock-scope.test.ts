/**
 * 「模拟时刻作用域」回归（2026-11-09 跨日核查）
 *
 * 契约：非虚拟/未启用 → 不进模拟上下文（真墙钟，行为零变化）；
 *       启用 → 进上下文，且回调必须收到 realtimeScope=false（调用方据此走重算分支）。
 */
const resolveUserSimulatedNow = jest.fn();

jest.mock('../simulation-clock-resolver', () => ({
  resolveUserSimulatedNow: (...args: unknown[]) => resolveUserSimulatedNow(...args),
}));

import { withUserSimulatedClock } from '../simulated-clock-scope';
import { getSimulatedAsOf } from '../simulation-clock-context';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('withUserSimulatedClock', () => {
  it('未启用（resolver 返回 null）→ 不建上下文，realtimeScope=true', async () => {
    resolveUserSimulatedNow.mockResolvedValue(null);

    const seen = await withUserSimulatedClock('u-plain', async (realtimeScope) => ({
      realtimeScope,
      asOf: getSimulatedAsOf(),
    }));

    expect(seen.realtimeScope).toBe(true);
    expect(seen.asOf).toBeNull();
  });

  it('启用（resolver 返回时刻）→ 回调内 simulatedNowOr 口径即为该模拟时刻', async () => {
    const asOf = new Date('2026-11-12T15:59:59.999Z');
    resolveUserSimulatedNow.mockResolvedValue(asOf);

    const seen = await withUserSimulatedClock('u-vl', async (realtimeScope) => ({
      realtimeScope,
      asOf: getSimulatedAsOf()?.toISOString(),
    }));

    expect(seen.realtimeScope).toBe(false);
    expect(seen.asOf).toBe('2026-11-12T15:59:59.999Z');
  });

  it('resolver 抛错 → 回退真实墙钟，不把请求打成异常', async () => {
    resolveUserSimulatedNow.mockRejectedValue(new Error('lookup failed'));

    const seen = await withUserSimulatedClock('u-boom', async (realtimeScope) => ({
      realtimeScope,
      asOf: getSimulatedAsOf(),
    }));

    expect(seen.realtimeScope).toBe(true);
    expect(seen.asOf).toBeNull();
  });
});
