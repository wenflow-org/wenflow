import { describe, expect, it } from 'vitest';
import { stripPseudoTime } from '../timeText';

describe('stripPseudoTime', () => {
  it('剥掉平台默认的单次分钟承诺', () => {
    expect(stripPseudoTime('每次约 25 分钟，从四场争论入手')).toBe('从四场争论入手');
    expect(stripPseudoTime('每天约30分钟。先看主干')).toBe('先看主干');
    expect(stripPseudoTime('节奏按每次二十来分钟一节排')).toBe('节奏按一节排');
  });

  it('没有伪时间时原样返回', () => {
    expect(stripPseudoTime('从苏格拉底受审到电车难题')).toBe('从苏格拉底受审到电车难题');
    expect(stripPseudoTime('')).toBe('');
    expect(stripPseudoTime(null)).toBe('');
  });
});
