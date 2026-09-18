import {
  DEFAULT_SIMULATION_LOG_MAX_BYTES,
  resolveSimulationLogMaxBytes,
  boundSimulationLog,
  appendSimulationLog,
} from '../simulation-log-buffer'

describe('simulation-log-buffer（virtual_sessions.logs 字节预算封顶）', () => {
  it('resolveSimulationLogMaxBytes：非法/过小回退默认，合法值生效', () => {
    expect(resolveSimulationLogMaxBytes({})).toBe(DEFAULT_SIMULATION_LOG_MAX_BYTES);
    expect(resolveSimulationLogMaxBytes({ SIMULATION_LOG_MAX_BYTES: 'abc' })).toBe(DEFAULT_SIMULATION_LOG_MAX_BYTES);
    expect(resolveSimulationLogMaxBytes({ SIMULATION_LOG_MAX_BYTES: '100' })).toBe(DEFAULT_SIMULATION_LOG_MAX_BYTES);
    expect(resolveSimulationLogMaxBytes({ SIMULATION_LOG_MAX_BYTES: '1048576' })).toBe(1048576);
  });

  it('boundSimulationLog：保留最新若干条，总长不超过预算', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ phase: 'p', index: i, detail: 'x'.repeat(100) }));
    const bounded = boundSimulationLog(entries, 1000);
    expect(bounded.length).toBeLessThan(entries.length);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(1000);
    // 保留的是**尾部（最新）**
    expect(bounded[bounded.length - 1].index).toBe(99);
  });

  it('boundSimulationLog：单条就超预算时仍保留最新一条（不裁成空）', () => {
    const huge = { phase: 'teaching-response', detail: 'x'.repeat(5000) };
    const bounded = boundSimulationLog([{ phase: 'old', detail: 'y' }, huge], 100);
    expect(bounded).toEqual([huge]);
  });

  it('boundSimulationLog：空/非数组安全', () => {
    expect(boundSimulationLog([], 100)).toEqual([]);
    expect(boundSimulationLog(undefined as unknown as unknown[], 100)).toEqual([]);
  });

  it('appendSimulationLog：追加后按预算封顶（真实场景：31MB 级 teaching-response）', () => {
    const big = (i: number) => ({ phase: 'teaching-response', index: i, aiResponse: 'z'.repeat(400 * 1024) });
    let logs: Array<ReturnType<typeof big>> = [];
    for (let i = 0; i < 40; i += 1) logs = appendSimulationLog(logs, big(i), 2 * 1024 * 1024);
    expect(JSON.stringify(logs).length).toBeLessThanOrEqual(2 * 1024 * 1024);
    // 最新一条在场
    expect(logs[logs.length - 1].index).toBe(39);
  });
});
