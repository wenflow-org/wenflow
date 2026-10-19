/**
 * #106：可用时间权威（capacity-authority）单测 + 源码守卫。
 *
 * 守卫目标：可用时间的默认值/解析只能出现在 capacity-authority.ts，
 * 其他调用点不得再自写 `|| '1 小时'`、`?? 30`、本地 session 分钟常量或死旋钮。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  CAPACITY_DEFAULTS,
  parseSessionMinutes,
  resolveCapacity,
} from '../capacity-authority';

describe('resolveCapacity（#106 单一权威）', () => {
  it('无输入 → 全部取 CAPACITY_DEFAULTS（默认值只在一处）', () => {
    const c = resolveCapacity();
    expect(c).toEqual({
      sessionMinutes: CAPACITY_DEFAULTS.sessionMinutes,
      sessionsPerWeek: CAPACITY_DEFAULTS.sessionsPerWeek,
      daysPerWeek: CAPACITY_DEFAULTS.daysPerWeek,
      dailyMinutes: CAPACITY_DEFAULTS.dailyMinutes,
      display: CAPACITY_DEFAULTS.display,
      source: 'default',
    });
  });

  it('L1：time_dimensions.sessionsLengthMin 优先于自由文本', () => {
    const c = resolveCapacity({
      timeDimensions: { sessionsLengthMin: 30, sessionsPerWeek: 3 },
      timePerSession: '每次2小时',
    });
    expect(c.sessionMinutes).toBe(30);
    expect(c.sessionsPerWeek).toBe(3);
    expect(c.daysPerWeek).toBe(3);
    expect(c.dailyMinutes).toBe(30);
    expect(c.source).toBe('understanding.time_dimensions');
  });

  it('L2：understanding.available_resources.time_budget 成为权威来源', () => {
    const c = resolveCapacity({
      understanding: { available_resources: { time_budget: '每周5小时' } },
    });
    expect(c.display).toBe('每周5小时');
    expect(c.source).toBe('understanding.available_resources.time_budget');
    // 无单次时长信号 → 沿用 30 分钟日预算口径
    expect(c.dailyMinutes).toBe(CAPACITY_DEFAULTS.dailyMinutes);
  });

  it('L2：understanding.available_resources.time_per_session 优先于扁平输入', () => {
    const c = resolveCapacity({
      understanding: { available_resources: { time_per_session: '每次45分钟' } },
      timePerSession: '2小时',
    });
    expect(c.sessionMinutes).toBe(45);
    expect(c.source).toBe('understanding.available_resources.time_per_session');
  });

  it('L3/L4：collected.timePerDay、visibleSummary.resources 依次兜底', () => {
    const collected = resolveCapacity({ collected: { timePerDay: '每天1小时' } });
    expect(collected.display).toBe('每天1小时');
    expect(collected.source).toBe('collected.timePerDay');

    const visible = resolveCapacity({
      visibleSummary: { resources: { timeBudget: '每周10小时', timePerSession: '1小时' } },
    });
    expect(visible.display).toBe('每周10小时');
    expect(visible.sessionMinutes).toBe(60);
    expect(visible.source).toBe('visibleSummary.resources.time_per_session');
  });

  it('扁平输入（path-planning-hints / path.coordinator 口径）可解析中文时长', () => {
    const c = resolveCapacity({ timePerSession: '一天三小时' });
    expect(c.sessionMinutes).toBe(180);
    expect(c.source).toBe('timePerSession');
  });
});

describe('parseSessionMinutes（统一解析器）', () => {
  it.each([
    ['每次2小时', 120],
    ['3.5小时', 210],
    ['一个半小时', 90],
    ['三个半小时', 210],
    ['半小时', 30],
    ['三十分钟', 30],
    ['每天30分钟', 30],
    ['30', 30],
    ['一个钟头', 60],
    ['', null],
    ['很多时间', null],
  ])('%s → %s', (text, expected) => {
    expect(parseSessionMinutes(text)).toBe(expected);
  });
});

describe('源码守卫：默认值/解析不得回流到调用点', () => {
  const SRC = path.resolve(__dirname, '../../..');

  function read(rel: string): string {
    return fs.readFileSync(path.join(SRC, rel), 'utf-8');
  }

  /** 去掉注释后再断言，避免注释里的历史说明造成假阳性 */
  function code(rel: string): string {
    return read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  it("协调器不再写死 '1 小时'，且已改用 resolveCapacity", () => {
    for (const rel of ['coordinators/path.coordinator.ts', 'coordinators/requirement.coordinator.ts']) {
      const src = code(rel);
      expect(src).not.toContain('1 小时');
      expect(src).toContain('resolveCapacity(');
    }
  });

  it('path.coordinator 不再自行按 timePerDaySources 定义可用时间优先级', () => {
    expect(code('coordinators/path.coordinator.ts')).not.toContain('timePerDaySources');
  });

  it('goal-schedule 不再自写 plannedMinutesPerDay ?? 30', () => {
    const src = code('services/learning/goals/goal-schedule.service.ts');
    expect(src).not.toContain('plannedMinutesPerDay ?? 30');
    expect(src).toContain('resolveCapacity(');
  });

  it('path-planning-hints 不再保留本地 session 分钟常量', () => {
    const src = code('services/learning/path-planning-hints.ts');
    expect(src).not.toContain('DEFAULT_SESSION_MINUTES');
    expect(src).toContain('resolveCapacity(');
    expect(src).toContain('parseSessionMinutes(');
  });

  it('virtual-lab 不再保留无读者的死旋钮', () => {
    const src = code('services/virtual-lab-settings.service.ts');
    expect(src).not.toContain('defaultDailyMinutesCap');
    expect(src).not.toContain('defaultDaysPerWeek');
  });
});
