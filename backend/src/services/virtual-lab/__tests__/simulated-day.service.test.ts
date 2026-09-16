import {
  parseDateOnly,
  toDateOnly,
  resolveDayWindow,
  resolveSimulationClock,
  buildDayEntry,
  buildDayTimeline,
  type SimulatedDayDeps,
} from '../simulated-day.service';
import { DEFAULT_VIRTUAL_LAB_SETTINGS } from '../../virtual-lab-settings.service';

const SETTINGS = { ...DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation };

describe('simulated-day 纯函数', () => {
  it('parseDateOnly / toDateOnly：按 UTC 日历日归一', () => {
    expect(toDateOnly(parseDateOnly('2026-09-16'))).toBe('2026-09-16');
    expect(parseDateOnly('2026-09-16T23:30:00+08:00').toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(parseDateOnly(new Date('2026-09-16T10:00:00Z')).toISOString()).toBe('2026-09-16T00:00:00.000Z');
  });

  it('resolveDayWindow：第 N 天 = baseDate + N（UTC 日界，asOf 覆盖整日）', () => {
    const w0 = resolveDayWindow('2026-09-16', 0);
    expect(w0.simulatedDay).toBe('2026-09-16');
    expect(w0.dayStart.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    expect(w0.asOf.toISOString()).toBe('2026-09-16T23:59:59.999Z');

    const w3 = resolveDayWindow('2026-09-16', 3);
    expect(w3.simulatedDay).toBe('2026-09-19');
    expect(w3.dayStart.toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });

  it('resolveSimulationClock：默认关 → disabled，baseDate 取会话创建日', () => {
    const clock = resolveSimulationClock({
      settings: SETTINGS,
      sessionCreatedAt: new Date('2026-09-10T12:00:00Z'),
    });
    expect(clock.enabled).toBe(false);
    expect(clock.status).toBe('disabled');
    expect(clock.baseDate).toBe('2026-09-10');
    expect(clock.dayIndex).toBe(0);
    expect(clock.maxSimulatedDays).toBe(90);
  });

  it('resolveSimulationClock：profile 覆盖开启；baseDate/dayIndex 取会话时钟', () => {
    const clock = resolveSimulationClock({
      stageResultsClock: { baseDate: '2026-09-01', dayIndex: 4, timezone: 'Asia/Shanghai' },
      profileClock: { enabled: true, startDate: '2026-09-01' },
      settings: SETTINGS,
      sessionCreatedAt: new Date('2026-09-10T12:00:00Z'),
    });
    expect(clock.enabled).toBe(true);
    expect(clock.status).toBe('in_progress');
    expect(clock.baseDate).toBe('2026-09-01');
    expect(clock.dayIndex).toBe(4);
    expect(clock.simulatedNow).toBe('2026-09-05T23:59:59.999Z');
  });
});

function makeDeps(overrides: Partial<SimulatedDayDeps> = {}): SimulatedDayDeps {
  return {
    getAggregatedState: jest.fn(async () => ({
      metrics: { lss: 4, ktl: 6, lf: 7, lsb: -1, timestamp: new Date('2026-09-16T00:00:00Z') },
      perPath: [{ pathId: 'p1', metrics: { lss: 5, ktl: 6, lf: 7, lsb: -1, timestamp: new Date() }, calculatedAt: new Date() }],
      activePathIds: ['p1'],
      dayLoad: { lessons: 3, minutes: 90, fatigueBonus: 1 },
      latestAt: new Date(),
    })) as any,
    getDailyQuota: jest.fn(async () => ({
      date: '2026-09-16', limitLoad: 6, usedLoad: 4, usedCount: 2, remainingLoad: 2, reservedKeys: [],
    })) as any,
    getDueTraces: jest.fn(async () => [{ conceptKey: 'a' }, { conceptKey: 'b' }]) as any,
    getRetentionSnapshot: jest.fn(async () => [
      { stability: 'stable', retention: 0.95, lastSeenAt: new Date('2026-09-16T01:00:00Z') },
      { stability: 'fragile', retention: 0.4, lastSeenAt: new Date('2026-09-16T02:00:00Z') },
      // 未来痕迹（晚于 asOf）必须被排除，避免倒灌
      { stability: 'developing', retention: 0.7, lastSeenAt: new Date('2026-09-30T02:00:00Z') },
    ]) as any,
    findTasks: jest.fn(async () => [
      { id: 't1', title: '任务1', estimatedMinutes: 30, cognitiveLoad: 'medium', completedAt: new Date('2026-09-16T03:00:00Z') },
    ]) as any,
    findSessions: jest.fn(async () => [{ taskId: 't1', duration: 28 }]) as any,
    findEvidence: jest.fn(async () => [
      {
        taskId: 't1',
        payload: JSON.stringify({ baseline: 5, adjusted: 4, direction: 'decrease', reasons: ['lesson_stress_high'], applied: true, evidence: {} }),
        occurredAt: new Date('2026-09-16T03:00:00Z'),
      },
    ]) as any,
    ...overrides,
  };
}

describe('buildDayEntry / buildDayTimeline（注入 deps）', () => {
  it('按 asOf 聚合出负担/节奏/信号/任务/调整/配额/记忆（且过滤未来痕迹）', async () => {
    const entry = await buildDayEntry('u1', '2026-09-16', 0, makeDeps());
    expect(entry.simulatedDay).toBe('2026-09-16');
    expect(entry.dayLoad).toEqual({ lessons: 3, minutes: 90, fatigueBonus: 1 });
    expect(entry.metrics).toEqual({ lss: 4, ktl: 6, lf: 7, lsb: -1 });
    expect(entry.pacing).toBe('slow'); // lf>=6
    expect(entry.signals).toEqual(expect.arrayContaining(['fatigue_high', 'lsb_negative']));
    expect(entry.perPath).toEqual([{ pathId: 'p1', lss: 5, ktl: 6, lf: 7, lsb: -1 }]);
    expect(entry.tasks[0]).toEqual(expect.objectContaining({ taskId: 't1', actualMinutes: 28, cognitiveLoad: 'medium' }));
    expect(entry.difficultyAdjustments[0]).toEqual(expect.objectContaining({
      taskId: 't1', baseline: 5, adjusted: 4, direction: 'decrease', reasons: ['lesson_stress_high'], applied: true,
    }));
    expect(entry.reviewQuota).toEqual({ limitLoad: 6, usedLoad: 4, remainingLoad: 2, usedCount: 2 });
    expect(entry.memory).toEqual({ traceCount: 2, dueCount: 2, fragileCount: 1, stableCount: 1, avgRetention: 0.675 });
  });

  it('无状态行时 metrics/pacing 为 null，仍返回结构（不抛错）', async () => {
    const entry = await buildDayEntry('u1', '2026-09-16', 0, makeDeps({
      getAggregatedState: jest.fn(async () => null) as any,
    }));
    expect(entry.metrics).toBeNull();
    expect(entry.pacing).toBeNull();
    expect(entry.dayLoad).toBeNull();
    expect(entry.signals).toEqual([]);
  });

  it('buildDayTimeline：from/to 夹紧，逐日展开', async () => {
    const timeline = await buildDayTimeline({ userId: 'u1', baseDate: '2026-09-16', fromDay: 0, toDay: 2 }, makeDeps());
    expect(timeline.days.map((d) => d.simulatedDay)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
    expect(timeline.baseDate).toBe('2026-09-16');

    const clamped = await buildDayTimeline({ userId: 'u1', baseDate: '2026-09-16', fromDay: 1, toDay: 99, maxDays: 2 }, makeDeps());
    expect(clamped.days.map((d) => d.dayIndex)).toEqual([1, 2]);
  });
});
