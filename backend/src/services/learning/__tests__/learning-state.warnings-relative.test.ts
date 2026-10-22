/**
 * P2 回归（2026-10-22 审计）：/state/warnings 的疲劳/失衡判据必须用 PMC 相对量。
 *
 * 旧实现用绝对 LF>70 / KTL>60——PMC 日负荷口径下，习惯每天多课的学习者
 * KTL/LF 会被日负荷放大，绝对阈值会把他永久误报成疲劳。
 */
jest.mock('../../../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { LearningStateService } from '../learning-state.service';

function trend(day: number, ktl: number, lf: number) {
  return {
    date: new Date(2026, 9, day),
    lss: 5,
    ktl,
    lf,
    lsb: ktl - lf,
  };
}

describe('checkWarnings：相对量判据', () => {
  it('习惯每天 3 课（ACWR≈1、KTL/LF 都高）不误报疲劳', async () => {
    const service = new LearningStateService();
    (service as any).getStateTrends = jest.fn().mockResolvedValue([
      trend(1, 20, 20), trend(2, 20, 20), trend(3, 20, 20),
    ]);

    await expect(service.checkWarnings('u1')).resolves.toEqual([]);
  });

  it('连续 3 天 ACWR ≥ 1.5 → 报高疲劳', async () => {
    const service = new LearningStateService();
    (service as any).getStateTrends = jest.fn().mockResolvedValue([
      trend(1, 10, 16), trend(2, 10, 16), trend(3, 10, 16),
    ]);

    const warnings = await service.checkWarnings('u1');
    expect(warnings.some((warning) => warning.type === 'fatigue')).toBe(true);
  });

  it('冷启动 form<0 但适应基座未成熟（KTL<3）→ 不报失衡', async () => {
    const service = new LearningStateService();
    (service as any).getStateTrends = jest.fn().mockResolvedValue([
      trend(1, 1, 3), trend(2, 1, 3),
    ]);

    const warnings = await service.checkWarnings('u1');
    expect(warnings.some((warning) => warning.type === 'lsb_negative')).toBe(false);
  });
});
