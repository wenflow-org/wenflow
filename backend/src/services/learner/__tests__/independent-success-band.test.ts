/**
 * 独立成功率带（§7 P1-1）：带判定是纯函数；读取侧必须**只认代码裁决**（judgedBy='code'）——
 * 无答案键的检查点记为 model-reference，是模型自评，混进来就把自证回路又接回去了。
 */
const findMany = jest.fn();
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: { learner_evidence: { findMany } },
}));
jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  evaluateSuccessBand,
  loadCodeJudgedSuccess,
  SUCCESS_BAND_HIGH,
  SUCCESS_BAND_LOW,
  SUCCESS_BAND_MIN_SAMPLE,
} from '../independent-success-band.service';

describe('evaluateSuccessBand（带判定：双向 + 死区 + 样本下限）', () => {
  it('低于带下沿 → downgrade', () => {
    const verdict = evaluateSuccessBand(0.5, 10);
    expect(verdict.action).toBe('downgrade');
    expect(verdict.reason).toContain('低于带下沿');
  });

  it('高于带上沿 → upgrade', () => {
    expect(evaluateSuccessBand(0.97, 10).action).toBe('upgrade');
  });

  it('带内 → hold（死区，避免极限环）', () => {
    expect(evaluateSuccessBand(SUCCESS_BAND_LOW, 10).action).toBe('hold');
    expect(evaluateSuccessBand(0.85, 10).action).toBe('hold');
    expect(evaluateSuccessBand(SUCCESS_BAND_HIGH, 10).action).toBe('hold');
  });

  it('样本不足 → hold（SE 太大时动作就是放大噪声）', () => {
    const verdict = evaluateSuccessBand(1.0, SUCCESS_BAND_MIN_SAMPLE - 1);
    expect(verdict.action).toBe('hold');
    expect(verdict.reason).toContain('样本不足');
  });

  it('无样本（null）→ hold', () => {
    expect(evaluateSuccessBand(null, 0).action).toBe('hold');
    expect(evaluateSuccessBand(Number.NaN, 10).action).toBe('hold');
  });
});

describe('loadCodeJudgedSuccess（只认代码裁决）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('混合来源时只统计 judgedBy=code；model-reference 不计入', async () => {
    findMany.mockResolvedValue([
      { payload: JSON.stringify({ judgedBy: 'code', passed: true }) },
      { payload: JSON.stringify({ judgedBy: 'code', passed: false }) },
      { payload: JSON.stringify({ judgedBy: 'model-reference', passed: true }) },
      { payload: JSON.stringify({ judgedBy: 'model-reference', passed: true }) },
      { payload: 'not-json' },
    ]);
    const result = await loadCodeJudgedSuccess('u1');
    expect(result).toEqual({ rate: 0.5, sample: 2, passed: 1 });
  });

  it('全无代码裁决样本 → rate=null、sample=0（调用方据此 hold）', async () => {
    findMany.mockResolvedValue([{ payload: JSON.stringify({ judgedBy: 'model-reference', passed: true }) }]);
    expect(await loadCodeJudgedSuccess('u1')).toEqual({ rate: null, sample: 0, passed: 0 });
  });

  it('读取失败 → 按无样本处理（不让一次读失败影响档位）', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    expect(await loadCodeJudgedSuccess('u1')).toEqual({ rate: null, sample: 0, passed: 0 });
  });
});