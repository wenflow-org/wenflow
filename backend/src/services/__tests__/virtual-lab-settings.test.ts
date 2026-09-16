import {
  normalizeVirtualLabSettings,
  mergeVirtualLabSettings,
  DEFAULT_VIRTUAL_LAB_SETTINGS,
} from '../virtual-lab-settings.service';

describe('virtual-lab-settings · dateSimulation（默认关）', () => {
  it('未配置 → 默认关 + 全部默认值（现网零变化）', () => {
    const settings = normalizeVirtualLabSettings(undefined);
    expect(settings.virtualLearnerRpmLimit).toBe(0);
    expect(settings.dateSimulation).toEqual(DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation);
    expect(settings.dateSimulation.enabled).toBe(false);
  });

  it('旧库只有 rpm 字段 → dateSimulation 补默认', () => {
    const settings = normalizeVirtualLabSettings({ virtualLearnerRpmLimit: 120 } as any);
    expect(settings.virtualLearnerRpmLimit).toBe(120);
    expect(settings.dateSimulation).toEqual(DEFAULT_VIRTUAL_LAB_SETTINGS.dateSimulation);
  });

  it('越界数值/布尔/字符串被夹紧或回落', () => {
    const settings = normalizeVirtualLabSettings({
      dateSimulation: {
        enabled: true,
        defaultDailyMinutesCap: 999,
        defaultDaysPerWeek: 9,
        defaultPaceDaysPerAdvance: 0,
        maxSimulatedDays: 9999,
        pauseOnIntervention: 'true',
        timezone: '   ',
      },
    } as any);
    expect(settings.dateSimulation).toEqual(expect.objectContaining({
      enabled: true,
      defaultDailyMinutesCap: 480,
      defaultDaysPerWeek: 7,
      defaultPaceDaysPerAdvance: 1,
      maxSimulatedDays: 365,
      pauseOnIntervention: true,
      autoAdvanceEnabled: false,
      timezone: 'Asia/Shanghai',
    }));
  });

  it('课表字段：courseWeekdays 去重排序+范围过滤；lessonsPerDay 夹紧 1..10', () => {
    const s = normalizeVirtualLabSettings({
      dateSimulation: { courseWeekdays: [5, 1, 1, 9, -1, '3'], lessonsPerDay: 99 },
    } as any);
    expect(s.dateSimulation.courseWeekdays).toEqual([1, 3, 5]);
    expect(s.dateSimulation.lessonsPerDay).toBe(10);

    const fallback = normalizeVirtualLabSettings({ dateSimulation: { courseWeekdays: [] } } as any);
    expect(fallback.dateSimulation.courseWeekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it('merge：只发 rpm 不重置 dateSimulation；只发 dateSimulation 不重置 rpm', () => {    const existing = normalizeVirtualLabSettings({
      virtualLearnerRpmLimit: 300,
      dateSimulation: { enabled: true, maxSimulatedDays: 30 },
    } as any);

    const afterRpm = normalizeVirtualLabSettings(mergeVirtualLabSettings(existing, { virtualLearnerRpmLimit: 500 }));
    expect(afterRpm.virtualLearnerRpmLimit).toBe(500);
    expect(afterRpm.dateSimulation.enabled).toBe(true);
    expect(afterRpm.dateSimulation.maxSimulatedDays).toBe(30);

    const afterDate = normalizeVirtualLabSettings(
      mergeVirtualLabSettings(existing, { dateSimulation: { enabled: false } } as any),
    );
    expect(afterDate.virtualLearnerRpmLimit).toBe(300);
    expect(afterDate.dateSimulation.enabled).toBe(false);
    expect(afterDate.dateSimulation.maxSimulatedDays).toBe(30);
  });
});
