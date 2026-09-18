import {
  parseDateOnly,
  toDateOnly,
  resolveDayWindow,
  resolveSimulationClock,
  temporalContextFromClock,
  isCourseDay,
  collectCourseDayIndexes,
  previousCourseDayGap,
  planClockAdvance,
  resolutionEnteredLearn,
  summarizeDayLearning,
  shouldAdvanceSimulationClock,
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

  it('resolveSimulationClock：baseDate 优先级 session > profile（18 号报告观察项）', () => {
    const clock = resolveSimulationClock({
      // 会话级设置必须覆盖画像级——否则管理端在会话上设的日期会被静默忽略
      stageResultsClock: { baseDate: '2026-09-20', dayIndex: 2 },
      profileClock: { enabled: true, startDate: '2026-09-01' },
      settings: SETTINGS,
      sessionCreatedAt: new Date('2026-09-10T12:00:00Z'),
    });
    expect(clock.baseDate).toBe('2026-09-20');
    expect(clock.dayIndex).toBe(2);
  });

  it('temporalContextFromClock：未开启返回 null；开启时给出 simulatedDay = baseDate + dayIndex', () => {
    expect(temporalContextFromClock({ ...resolveSimulationClock({ settings: SETTINGS, sessionCreatedAt: new Date() }) })).toBeNull();
    const clock = resolveSimulationClock({
      stageResultsClock: { baseDate: '2026-09-01', dayIndex: 4 },
      profileClock: { enabled: true },
      settings: SETTINGS,
      sessionCreatedAt: new Date('2026-09-01T00:00:00Z'),
    });
    const ctx = temporalContextFromClock(clock);
    expect(ctx).toEqual(expect.objectContaining({
      simulatedDay: '2026-09-05',
      dayIndex: 4,
      timezone: 'Asia/Shanghai',
    }));
  });

  it('resolutionEnteredLearn：只有真正进入 teaching/learn 才算"这天上了课"', () => {
    // 正常进入 Learn
    expect(resolutionEnteredLearn({ success: true, currentStage: 'teaching' })).toBe(true);
    expect(resolutionEnteredLearn({ success: true, currentStage: 'learn' })).toBe(true);
    // decision=modify→重规划成功：success=true 但仍是 path（当天没上课 → 必须回滚）
    expect(resolutionEnteredLearn({ success: true, currentStage: 'path' })).toBe(false);
    // 评审失败 / 缺参
    expect(resolutionEnteredLearn({ success: false, currentStage: 'teaching' })).toBe(false);
    expect(resolutionEnteredLearn({ success: true })).toBe(false);
    expect(resolutionEnteredLearn(null)).toBe(false);
    expect(resolutionEnteredLearn(undefined)).toBe(false);
  });

  it('summarizeDayLearning：零节成功 → started=false（回滚当天，不白烧模拟日）', () => {
    // 会话已 failed/停止：executeAutoLearning 立即失败 → 旧实现仍记 started:true, chunks:1
    expect(summarizeDayLearning([{ success: false, error: '学习已停止（failed）' }]))
      .toEqual({ started: false, chunks: 0, error: '学习已停止（failed）' });
    // 缺省原因
    expect(summarizeDayLearning([])).toEqual({ started: false, chunks: 0, error: expect.stringContaining('未推进模拟日') });
    // 至少一节成功 → 当天成立，chunks 只数成功课次
    expect(summarizeDayLearning([{ success: true }, { success: false, error: 'x' }]))
      .toEqual({ started: true, chunks: 1 });
    expect(summarizeDayLearning([{ success: true }, { success: true }]))
      .toEqual({ started: true, chunks: 2 });
    // 容错：null/非数组
    expect(summarizeDayLearning([null, undefined])).toMatchObject({ started: false, chunks: 0 });
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

describe('shouldAdvanceSimulationClock（跑数观察 #4：不上课就不推进）', () => {
  it('runTasks=true：只有当天确实上了课才推进时钟', () => {
    expect(shouldAdvanceSimulationClock({ runTasks: true, learning: { started: true } })).toBe(true)
    expect(shouldAdvanceSimulationClock({ runTasks: true, learning: { started: false } })).toBe(false)
    expect(shouldAdvanceSimulationClock({ runTasks: true, learning: null })).toBe(false)
    expect(shouldAdvanceSimulationClock({ runTasks: true })).toBe(false)
  })

  it('runTasks=false（纯记账）：照旧推进', () => {
    expect(shouldAdvanceSimulationClock({ runTasks: false, learning: null })).toBe(true)
    expect(shouldAdvanceSimulationClock({ runTasks: false })).toBe(true)
  })
})

describe('buildDayEntry / buildDayTimeline（注入 deps）', () => {
  const NOW = new Date('2026-09-20T12:00:00Z');

  it('按 asOf 聚合出负担/节奏/信号/任务/调整/配额/记忆（且过滤未来痕迹）', async () => {
    const entry = await buildDayEntry('u1', '2026-09-16', 0, makeDeps(), NOW);
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
    }), NOW);
    expect(entry.metrics).toBeNull();
    expect(entry.pacing).toBeNull();
    expect(entry.dayLoad).toBeNull();
    expect(entry.signals).toEqual([]);
  });

  it('buildDayTimeline：from/to 夹紧，逐日展开', async () => {
    const timeline = await buildDayTimeline({ userId: 'u1', baseDate: '2026-09-16', fromDay: 0, toDay: 2 }, makeDeps(), NOW);
    expect(timeline.days.map((d) => d.simulatedDay)).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
    expect(timeline.baseDate).toBe('2026-09-16');

    const clamped = await buildDayTimeline({ userId: 'u1', baseDate: '2026-09-16', fromDay: 1, toDay: 99, maxDays: 2 }, makeDeps(), NOW);
    expect(clamped.days.map((d) => d.dayIndex)).toEqual([1, 2]);
  });

  it('P0 护栏：未来日返回空且不读（防把真实历史卷进聚合）', async () => {
    const deps = makeDeps();
    // baseDate 2026-09-16，dayIndex 3 = 2026-09-19；now=2026-09-17 → 未来日
    const entry = await buildDayEntry('u1', '2026-09-16', 3, deps, new Date('2026-09-17T00:00:00Z'));
    expect(entry.dayLoad).toBeNull();
    expect(entry.tasks).toEqual([]);
    expect(entry.memory.traceCount).toBe(0);
    expect(deps.getAggregatedState).not.toHaveBeenCalled();
  });
});

describe('课表与推进（isCourseDay / collectCourseDayIndexes / planClockAdvance）', () => {
  // 2026-09-14 是周一；WEEK = 周一..周五
  const WEEK = [1, 2, 3, 4, 5];

  it('isCourseDay：按 UTC 星期判定（周末非上课日）', () => {
    expect(isCourseDay('2026-09-14', 0, WEEK)).toBe(true); // Mon
    expect(isCourseDay('2026-09-14', 4, WEEK)).toBe(true); // Fri
    expect(isCourseDay('2026-09-14', 5, WEEK)).toBe(false); // Sat
    expect(isCourseDay('2026-09-14', 6, WEEK)).toBe(false); // Sun
  });

  it('collectCourseDayIndexes：跳过非上课日，收集 N 个上课日', () => {
    expect(collectCourseDayIndexes('2026-09-14', 0, WEEK, 3)).toEqual([1, 2, 3]);
    // 从周五(4) 起：周六/周日跳过 → 下周一(7)、周二(8)
    expect(collectCourseDayIndexes('2026-09-14', 4, WEEK, 2)).toEqual([7, 8]);
  });

  it('previousCourseDayGap：首日 null，跨周末给出 3 天（课表口径）', () => {
    // baseDate 2026-09-14 周一；day0=周一 … day4=周五、day5=周六、day6=周日、day7=下周一
    expect(previousCourseDayGap('2026-09-14', 0, WEEK)).toBeNull();
    expect(previousCourseDayGap('2026-09-14', 1, WEEK)).toBe(1); // 周二 ← 周一
    expect(previousCourseDayGap('2026-09-14', 4, WEEK)).toBe(1); // 周五 ← 周四
    expect(previousCourseDayGap('2026-09-14', 7, WEEK)).toBe(3); // 下周一 ← 周五（跨周末）
  });

  it('temporalContextFromClock：跨周末注入 sinceLastSessionDays；首日省略该键', () => {
    const firstDay = resolveSimulationClock({
      stageResultsClock: { baseDate: '2026-09-14', dayIndex: 0 },
      profileClock: { enabled: true },
      settings: { ...SETTINGS, courseWeekdays: WEEK },
      sessionCreatedAt: new Date('2026-09-14T00:00:00Z'),
    });
    expect(temporalContextFromClock(firstDay)).not.toHaveProperty('sinceLastSessionDays');

    const nextMonday = resolveSimulationClock({
      stageResultsClock: { baseDate: '2026-09-14', dayIndex: 7 },
      profileClock: { enabled: true },
      settings: { ...SETTINGS, courseWeekdays: WEEK },
      sessionCreatedAt: new Date('2026-09-14T00:00:00Z'),
    });
    expect(temporalContextFromClock(nextMonday)?.sinceLastSessionDays).toBe(3);
  });

  it('planClockAdvance：推进 N 个上课日；到上限返回 null', () => {
    const clock = resolveSimulationClock({
      stageResultsClock: { baseDate: '2026-09-14', dayIndex: 0 },
      profileClock: { enabled: true },
      settings: { ...SETTINGS, courseWeekdays: WEEK, lessonsPerDay: 2, maxSimulatedDays: 3 },
      sessionCreatedAt: new Date('2026-09-14T00:00:00Z'),
    });
    const plan = planClockAdvance(clock, { baseDate: '2026-09-14', dayIndex: 0 }, 2, new Date('2026-09-20T12:00:00Z'));
    expect(plan?.indexes).toEqual([1, 2]);
    expect(plan?.nextClock.dayIndex).toBe(2);
    expect(plan?.nextClock.advancedTimes).toBe(2);
    expect(plan?.nextClock.history).toHaveLength(2);
    expect(plan?.nextClock.simulatedNow).toBe('2026-09-16T23:59:59.999Z');

    const atLimit = resolveSimulationClock({
      stageResultsClock: { baseDate: '2026-09-14', dayIndex: 3 },
      profileClock: { enabled: true },
      settings: { ...SETTINGS, courseWeekdays: WEEK, maxSimulatedDays: 3 },
      sessionCreatedAt: new Date('2026-09-14T00:00:00Z'),
    });
    expect(planClockAdvance(atLimit, { baseDate: '2026-09-14', dayIndex: 3 }, 1, new Date('2026-09-20T12:00:00Z'))).toBeNull();
  });

  it('P0 护栏：planClockAdvance 不推进到未来日', () => {
    const clock = resolveSimulationClock({
      stageResultsClock: { baseDate: '2026-09-14', dayIndex: 0 },
      profileClock: { enabled: true },
      settings: { ...SETTINGS, courseWeekdays: WEEK },
      sessionCreatedAt: new Date('2026-09-14T00:00:00Z'),
    });
    // now = 09-14 当天：下一个上课日 09-15 的 dayStart 已 > now → 无可推进
    expect(planClockAdvance(clock, { baseDate: '2026-09-14', dayIndex: 0 }, 1, new Date('2026-09-14T12:00:00Z'))).toBeNull();
    // now = 09-15：第 1 天可推进
    expect(planClockAdvance(clock, { baseDate: '2026-09-14', dayIndex: 0 }, 1, new Date('2026-09-15T12:00:00Z'))?.indexes).toEqual([1]);
  });
});
