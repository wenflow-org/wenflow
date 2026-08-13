/**
 * 终局评估分数可视化单源测试（ADMIN_DEEP_SESSION_AUDIT C2/C3）：
 * 0-1 小数 → 百分比 + 档位色阶（≥0.8 ok / ≥0.6 warn / 其余 bad）+ 条宽钳制
 */
import { describe, expect, it } from 'vitest';
import { scoreBadgeCls, scoreFillPct, scoreToPct, scoreTone } from '../evalScore';

describe('scoreToPct（分数转百分比）', () => {
  it('0-1 小数 → 百分比', () => {
    expect(scoreToPct(0.85)).toBe('85%');
    expect(scoreToPct(1)).toBe('100%');
    expect(scoreToPct(0.6)).toBe('60%');
    expect(scoreToPct(0.645)).toBe('65%');
  });

  it('兼容 0-100 整数口径', () => {
    expect(scoreToPct(85)).toBe('85%');
    expect(scoreToPct(100)).toBe('100%');
  });

  it('空值/非法 → —', () => {
    expect(scoreToPct(null)).toBe('—');
    expect(scoreToPct(undefined)).toBe('—');
    expect(scoreToPct(Number.NaN)).toBe('—');
  });
});

describe('scoreTone（档位色阶：≥80 ok / ≥60 warn / 其余 bad）', () => {
  it('高分 ok', () => {
    expect(scoreTone(0.85)).toBe('ok');
    expect(scoreTone(0.8)).toBe('ok');
    expect(scoreTone(95)).toBe('ok');
  });

  it('中分 warn', () => {
    expect(scoreTone(0.6)).toBe('warn');
    expect(scoreTone(0.75)).toBe('warn');
  });

  it('低分 bad', () => {
    expect(scoreTone(0.59)).toBe('bad');
    expect(scoreTone(0.2)).toBe('bad');
    expect(scoreTone(0)).toBe('bad');
  });

  it('空值 muted', () => {
    expect(scoreTone(null)).toBe('muted');
    expect(scoreTone(undefined)).toBe('muted');
  });
});

describe('scoreFillPct（条宽 0-100 钳制）', () => {
  it('正常换算', () => {
    expect(scoreFillPct(0.85)).toBe(85);
    expect(scoreFillPct(0.6)).toBe(60);
  });

  it('越界钳制', () => {
    expect(scoreFillPct(85)).toBe(85);
    expect(scoreFillPct(120)).toBe(100);
    expect(scoreFillPct(-0.2)).toBe(0);
  });

  it('空值 → 0', () => {
    expect(scoreFillPct(null)).toBe(0);
    expect(scoreFillPct(undefined)).toBe(0);
  });
});

describe('scoreBadgeCls（徽章档位类）', () => {
  it('档位 → mk-badge 类', () => {
    expect(scoreBadgeCls(0.9)).toBe('mk-badge--ok');
    expect(scoreBadgeCls(0.7)).toBe('mk-badge--warn');
    expect(scoreBadgeCls(0.3)).toBe('mk-badge--bad');
    expect(scoreBadgeCls(null)).toBe('mk-badge--muted');
  });
});
