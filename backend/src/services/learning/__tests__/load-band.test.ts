import {
  LOAD_BAND_INDEX,
  isLoadBand,
  loadBandFromIndex,
  resolveLoadBand,
} from '../load-band';

describe('loadBand 单一映射（P1-5）', () => {
  it('边界：<0.3 under / 0.3-0.6 flow / 0.6-0.8 hint / >0.8 overload', () => {
    expect(loadBandFromIndex(0)).toBe('under');
    expect(loadBandFromIndex(0.29)).toBe('under');
    expect(loadBandFromIndex(0.3)).toBe('flow');
    expect(loadBandFromIndex(0.59)).toBe('flow');
    expect(loadBandFromIndex(0.6)).toBe('hint');
    expect(loadBandFromIndex(0.8)).toBe('hint');
    expect(loadBandFromIndex(0.81)).toBe('overload');
    expect(loadBandFromIndex(1)).toBe('overload');
  });

  it('非法/缺失数值 → unknown（绝不落 under/hint）', () => {
    expect(loadBandFromIndex(null)).toBe('unknown');
    expect(loadBandFromIndex(undefined)).toBe('unknown');
    expect(loadBandFromIndex(Number.NaN)).toBe('unknown');
    expect(loadBandFromIndex('')).toBe('unknown');
  });

  it('unknown 固定映射到 0.5（与 prompt「无证据取 0.5 / absent」一致）', () => {
    expect(LOAD_BAND_INDEX.unknown).toBe(0.5);
    expect(LOAD_BAND_INDEX.under).toBeLessThan(0.3);
    expect(LOAD_BAND_INDEX.flow).toBeGreaterThanOrEqual(0.3);
    expect(LOAD_BAND_INDEX.flow).toBeLessThan(0.6);
    expect(LOAD_BAND_INDEX.hint).toBeGreaterThanOrEqual(0.6);
    expect(LOAD_BAND_INDEX.hint).toBeLessThanOrEqual(0.8);
    expect(LOAD_BAND_INDEX.overload).toBeGreaterThan(0.8);
  });

  it('resolveLoadBand：显式档位优先，legacy 数值可回落，都没有 → unknown', () => {
    expect(resolveLoadBand('overload', 0.1)).toBe('overload');
    expect(resolveLoadBand('bogus', 0.75)).toBe('hint');
    expect(resolveLoadBand(undefined, 0.2)).toBe('under');
    expect(resolveLoadBand(undefined, null)).toBe('unknown');
    expect(resolveLoadBand('unknown', 0.9)).toBe('unknown');
  });

  it('isLoadBand 只认五档', () => {
    for (const band of ['under', 'flow', 'hint', 'overload', 'unknown']) {
      expect(isLoadBand(band)).toBe(true);
    }
    expect(isLoadBand('high')).toBe(false);
    expect(isLoadBand(0.5)).toBe(false);
  });
});
