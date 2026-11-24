/**
 * P0-1：低置信度向**同量纲先验**部分池化，而不是乘系数向 0 收缩。
 *
 * 旧行为：x * (0.6 + 0.4c)。c=0.1 时 6 分被压成 3.84——把"不确定"误读成"低负荷"。
 * 新行为：c*x + (1-c)*prior。LSS 先验取历史 raw sessionLss 中位数（首课 5.0），
 * KTL/LF 先验取上一份 committed 状态（同量纲），绝不拿慢性量当单课先验。
 */
const findMany = jest.fn();
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { teaching_sessions: { findMany } },
}));

import learningStateService from '../learning-state.service';
import {
  SESSION_LSS_PRIOR_FALLBACK,
  poolObservationWithPrior,
} from '../learning-state-types';

describe('poolObservationWithPrior（部分池化）', () => {
  it('低置信度重课 → 回落到个人先验，而不是压到 0 附近', () => {
    expect(poolObservationWithPrior(9, 5, 0.1)).toBeCloseTo(5.4, 6);
    expect(poolObservationWithPrior(9, 5, 0.1)).toBeGreaterThan(5);
  });

  it('高置信度基本等于观测值', () => {
    expect(poolObservationWithPrior(9, 5, 0.9)).toBeCloseTo(8.6, 6);
  });

  it('confidence 缺省 0.75；非法 prior 回落到中性 5.0', () => {
    expect(poolObservationWithPrior(9, 5, undefined)).toBeCloseTo(8, 6);
    expect(poolObservationWithPrior(9, Number.NaN, 0.5)).toBeCloseTo(7, 6);
    expect(SESSION_LSS_PRIOR_FALLBACK).toBe(5);
  });
});

describe('resolveSessionLssPrior（历史 raw sessionLss 中位数）', () => {
  beforeEach(() => findMany.mockReset());

  it('取最近已完成会话的 evaluation.sessionLss 中位数', async () => {
    findMany.mockResolvedValue([
      { wrapup: JSON.stringify({ evaluation: { sessionLss: 9 } }) },
      { wrapup: JSON.stringify({ evaluation: { sessionLss: 3 } }) },
      { wrapup: JSON.stringify({ evaluation: { sessionLss: 6 } }) },
    ]);
    await expect((learningStateService as any).resolveSessionLssPrior('u1')).resolves.toBe(6);
  });

  it('无历史/脏 JSON → 中性 5.0，不抛错', async () => {
    findMany.mockResolvedValue([
      { wrapup: null },
      { wrapup: '{bad json' },
      { wrapup: JSON.stringify({ evaluation: {} }) },
    ]);
    await expect((learningStateService as any).resolveSessionLssPrior('u1')).resolves.toBe(5);
  });

  it('查询失败（旧库/测试 mock 无表）→ 中性 5.0', async () => {
    findMany.mockRejectedValue(new Error('no table'));
    await expect((learningStateService as any).resolveSessionLssPrior('u1')).resolves.toBe(5);
  });
});
