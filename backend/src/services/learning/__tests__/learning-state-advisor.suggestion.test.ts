/**
 * 学习建议的判据统一（2026-11-23 复核）。
 *
 * 原实现自写绝对阈值（lf>7 / lsb<0 / ktl>7&&lsb<2），与快照 paceMode 的 ACWR/form 判据不同源，
 * 会出现「后台已 recover、状态页一派祥和」这类分裂。现统一消费 classifyLoad：
 * - 高疲劳 = ACWR ≥ 1.5（相对量；ktl<3 冷启动不判）
 * - 状态不佳 = form<0 且基座成熟（冷启动 lsb<0 属正常，不再误报）
 * - 需要巩固 = 基座已厚（ktl≥7）且明显有余力（ACWR≤0.5）
 * - 状态良好 = 恢复良好（ACWR≤0.85）且本节压力低（lss<5）
 */
import { generateSuggestion } from '../learning-state-advisor';

const metrics = (lss: number, ktl: number, lf: number) => ({
  lss,
  ktl,
  lf,
  lsb: ktl - lf,
  totalSessions: 10,
  totalMessages: 100,
  avgSessionDuration: 20,
} as any);

describe('generateSuggestion · 与 classifyLoad 同源', () => {
  it('ACWR 高档（2.33）→ 需要休息', () => {
    expect(generateSuggestion(metrics(5, 3, 7)).type).toBe('fatigue');
  });

  it('负荷失衡（form<0 且基座成熟）→ 状态不佳', () => {
    expect(generateSuggestion(metrics(5, 6, 8)).type).toBe('lsb_negative');
  });

  it('冷启动（ktl<3）lsb<0 不再误报「状态不佳」（PMC 爬升期属正常）', () => {
    expect(generateSuggestion(metrics(5, 2, 9)).type).not.toBe('lsb_negative');
  });

  it('基座厚 + 明显有余力 → 建议巩固而非继续加新内容', () => {
    expect(generateSuggestion(metrics(3, 8, 2)).type).toBe('overstudy');
  });

  it('恢复良好 + 本节压力低 → 状态良好', () => {
    expect(generateSuggestion(metrics(3, 6, 3)).type).toBe('good');
  });
});
