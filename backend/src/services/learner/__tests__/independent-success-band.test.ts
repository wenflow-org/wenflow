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
  SUCCESS_BAND_WINDOW_DAYS,
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

  it('简答（short_answer，关键词判定、系统性低估）不进带（18 号报告 N6）', async () => {
    findMany.mockResolvedValue([
      { payload: JSON.stringify({ judgedBy: 'code', passed: true, type: 'single_choice' }) },
      { payload: JSON.stringify({ judgedBy: 'code', passed: false, type: 'short_answer' }) },
      { payload: JSON.stringify({ judgedBy: 'code', passed: false, type: 'short_answer' }) },
    ]);
    // 只算那道选择题：1/1，而不是 1/3 把成功率拖低触发误降档
    expect(await loadCodeJudgedSuccess('u1')).toEqual({ rate: 1, sample: 1, passed: 1 });
  });

  it('读取失败 → 按无样本处理（不让一次读失败影响档位）', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    expect(await loadCodeJudgedSuccess('u1')).toEqual({ rate: null, sample: 0, passed: 0 });
  });
});

/**
 * 口径钉子（D4 收口）：上面对「判据」有覆盖，但**取数边界**没有回归——
 * 窗口变了、路径归属丢了、或把非布尔 passed 当真，都能在测试全绿的情况下悄悄改掉难度控制行为。
 */
describe('loadCodeJudgedSuccess（取数边界口径）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('回看窗口 = SUCCESS_BAND_WINDOW_DAYS 天（默认 14）', async () => {
    const before = Date.now();
    findMany.mockResolvedValue([]);
    await loadCodeJudgedSuccess('u1');
    const where = findMany.mock.calls[0][0].where;
    const sinceMs = where.occurredAt.gte.getTime();
    const expected = before - SUCCESS_BAND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    expect(SUCCESS_BAND_WINDOW_DAYS).toBe(14);
    expect(Math.abs(sinceMs - expected)).toBeLessThan(5_000);
  });

  it('pathId 只在显式给出时收窄；未给出时不得加成 pathId=null（否则全局统计变"只看无归属"）', async () => {
    findMany.mockResolvedValue([]);
    await loadCodeJudgedSuccess('u1', { pathId: 'path_a' });
    expect(findMany.mock.calls[0][0].where.pathId).toBe('path_a');

    await loadCodeJudgedSuccess('u1', { pathId: null });
    expect(Object.prototype.hasOwnProperty.call(findMany.mock.calls[1][0].where, 'pathId')).toBe(false);

    await loadCodeJudgedSuccess('u1');
    expect(Object.prototype.hasOwnProperty.call(findMany.mock.calls[2][0].where, 'pathId')).toBe(false);
  });

  it('passed 只认严格 true（字符串/1 都不算通过）', async () => {
    findMany.mockResolvedValue([
      { payload: JSON.stringify({ judgedBy: 'code', passed: 'true', type: 'single_choice' }) },
      { payload: JSON.stringify({ judgedBy: 'code', passed: 1, type: 'single_choice' }) },
      { payload: JSON.stringify({ judgedBy: 'code', passed: true, type: 'single_choice' }) },
    ]);
    expect(await loadCodeJudgedSuccess('u1')).toEqual({ rate: 1 / 3, sample: 3, passed: 1 });
  });

  it('取最近 60 条（orderBy occurredAt desc + take 60）', async () => {
    findMany.mockResolvedValue([]);
    await loadCodeJudgedSuccess('u1');
    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ occurredAt: 'desc' });
    expect(args.take).toBe(60);
  });
});