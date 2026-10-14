/**
 * 四读数口径单点（LearnerDetail 两处渲染点 + VirtualProfile 两处 + 学习端完课卡共用）。
 * 本用例锁三件事：
 *  ① 参考带只有一份（此前 LearnerDetail「0-10，越高越累」vs VirtualProfile「参考 4–7」两套并存）；
 *  ② 色调阈值各处一致（负荷类高=坏、低=好；LF ≥6 警戒；LSB 正=好）；
 *  ③ 出处文案说清「单次会话快照 ≠ 学习者级聚合」，并带上取样时刻。
 * 定义在 @/utils/learnerMetrics（纯定义，学习端组件也能引）；出处文案在 ../opsShared。
 */
import { describe, expect, it, vi } from 'vitest';
import { LEARNER_METRICS, LEARNER_METRIC_CODES, learnerMetric } from '@/utils/learnerMetrics';
import { loadCaliber } from '../opsShared';

describe('四读数共享口径', () => {
  it('四键齐全、标签无别名分叉（LF 不再一处「学习疲劳」一处「疲劳度」）', () => {
    expect(LEARNER_METRICS.map((m) => m.key)).toEqual(['lss', 'ktl', 'lf', 'lsb']);
    expect(learnerMetric('lf').label).toBe('LF 学习疲劳');
    expect(learnerMetric('ktl').label).toBe('KTL 训练负荷');
    expect(LEARNER_METRIC_CODES).toBe('LSS · KTL · LF · LSB');
  });

  it('每项都有可见参考带与悬停长释（且长释含参考带语义）', () => {
    for (const m of LEARNER_METRICS) {
      expect(m.band.length).toBeGreaterThan(0);
      expect(m.bandTitle.length).toBeGreaterThan(m.band.length);
    }
    expect(learnerMetric('lss').band).toBe('0–10 · 参考 4–7');
    expect(learnerMetric('lf').band).toBe('警戒 ≥ 6');
  });

  it('负荷类阈值：≥7 坏 / ≤4 好 / 中间 warn / 缺值不判色', () => {
    const lss = learnerMetric('lss');
    expect(lss.toneOf(null)).toBe('');
    expect(lss.toneOf(undefined)).toBe('');
    expect(lss.toneOf(0)).toBe('');
    expect(lss.toneOf(2.7)).toBe('ok');
    expect(lss.toneOf(5.5)).toBe('warn');
    expect(lss.toneOf(7.8)).toBe('bad');
  });

  it('LF 以 ≥6 为警戒（比负荷档更早翻红）；LSB 正=好、≤−3 坏', () => {
    const { lf, lsb } = { lf: learnerMetric('lf'), lsb: learnerMetric('lsb') };
    expect(lf.toneOf(4.5)).toBe('warn'); // 负荷档下是 ok，LF 自己的规则保住 warn
    expect(lf.toneOf(6)).toBe('bad');
    expect(lsb.toneOf(5.9)).toBe('ok');
    expect(lsb.toneOf(0)).toBe('');
    expect(lsb.toneOf(-1.9)).toBe('warn');
    expect(lsb.toneOf(-4)).toBe('bad');
  });
});

describe('读数出处（口径透明化）', () => {
  it('学习者级聚合：标签带「聚合」且长释点明另一页是单次会话快照', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
    const note = loadCaliber('aggregate', '2026-10-14T03:30:00Z');
    expect(note.label).toContain('学习者级聚合');
    expect(note.label).toContain('30 分钟前');
    expect(note.title).toContain('单次会话的运行时快照');
    expect(note.title).toContain('不是其中一处算错');
    vi.useRealTimers();
  });

  it('单次会话快照：标签带「单次会话」且长释点明另一页是聚合态', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T04:00:00Z'));
    const note = loadCaliber('session-snapshot', '2026-10-14T01:00:00Z');
    expect(note.label).toContain('单次会话快照');
    expect(note.label).toContain('3 小时前');
    expect(note.title).toContain('学习者级聚合');
    expect(note.title).toContain('不是其中一处算错');
    vi.useRealTimers();
  });

  it('无取样时刻时不硬造（标签退回纯口径，标题不出时间行）', () => {
    const note = loadCaliber('aggregate', null);
    expect(note.label).toBe('学习者级聚合');
    expect(note.title).not.toContain('取样时刻');
  });
});
