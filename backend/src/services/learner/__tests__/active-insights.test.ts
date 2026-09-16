import { learnerStateReviewService } from '../LearnerStateReviewService';

const payloadWith = (insights: any[]) => ({
  diagnosis: { insights },
});

/** 用单例 + spy：类未导出，直接替换 getLatest（不触库、不调 LLM） */
function build(over: {
  payload?: any;
  throwOnLatest?: boolean;
} = {}) {
  jest.spyOn(learnerStateReviewService, 'getLatest').mockImplementation(async () => {
    if (over.throwOnLatest) throw new Error('projection down');
    return (over.payload ?? null) as any;
  });
  return learnerStateReviewService;
}

jest.mock('../insight-calibration.service', () => ({
  insightCalibrationService: {
    getRecords: jest.fn(async () => []),
    recordInsights: jest.fn(),
    resolvePending: jest.fn(),
    getReliability: jest.fn(),
  },
}));

import { insightCalibrationService } from '../insight-calibration.service';

describe('LearnerStateReviewService.getActiveInsights（诊断洞察回注教学）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (insightCalibrationService.getRecords as jest.Mock).mockResolvedValue([]);
  });

  it('按 confidence 降序取前 N 条，且只出 type/claim/action（剥离内部字段）', async () => {
    const service = build({
      payload: payloadWith([
        { type: 'fatigue', claim: '连续两节高负荷', action: '降密度', confidence: 0.4, evidenceRefs: ['ev-1'] },
        { type: 'prerequisite_gap', claim: '前置缺口：网络分层', action: '先补前置', confidence: 0.9, evidenceRefs: ['ev-2'] },
        { type: 'strategy_fit', claim: '偏好例子先行', action: '先给例子', confidence: 0.7 },
      ]),
    });
    const result = await service.getActiveInsights('u1', 'p1', { limit: 2 });
    expect(result).toEqual([
      { type: 'prerequisite_gap', claim: '前置缺口：网络分层', action: '先补前置' },
      { type: 'strategy_fit', claim: '偏好例子先行', action: '先给例子' },
    ]);
    // 内部字段不得外泄（evidenceRefs / confidence）
    expect(JSON.stringify(result)).not.toContain('ev-');
    expect(JSON.stringify(result)).not.toContain('confidence');
  });

  it('已被证伪的 claim 不再回注（校准 miss）——预测被现实打脸的部分不许继续影响教学', async () => {
    (insightCalibrationService.getRecords as jest.Mock).mockResolvedValue([
      { claim: '前置缺口：网络分层', outcome: 'miss' },
      { claim: '偏好例子先行', outcome: 'hit' },
    ]);
    const service = build({
      payload: payloadWith([
        { type: 'prerequisite_gap', claim: '前置缺口：网络分层', action: '先补前置', confidence: 0.9 },
        { type: 'strategy_fit', claim: '偏好例子先行', action: '先给例子', confidence: 0.7 },
      ]),
    });
    const result = await service.getActiveInsights('u1', 'p1');
    expect(result.map((item) => item.claim)).toEqual(['偏好例子先行']);
  });

  it('claim 比对忽略大小写与首尾空白', async () => {
    (insightCalibrationService.getRecords as jest.Mock).mockResolvedValue([
      { claim: '  前置缺口：网络分层 ', outcome: 'miss' },
    ]);
    const service = build({
      payload: payloadWith([{ type: 'x', claim: '前置缺口：网络分层', action: 'a', confidence: 1 }]),
    });
    expect(await service.getActiveInsights('u1', 'p1')).toEqual([]);
  });

  it('没有评审产物 / 没有洞察 → 空数组（教学照常）', async () => {
    expect(await build({ payload: null }).getActiveInsights('u1', 'p1')).toEqual([]);
    expect(await build({ payload: payloadWith([]) }).getActiveInsights('u1', 'p1')).toEqual([]);
    expect(await build({ payload: { diagnosis: null } }).getActiveInsights('u1', 'p1')).toEqual([]);
  });

  it('claim 为空串的洞察被丢弃；limit=0 直接返回空', async () => {
    const service = build({ payload: payloadWith([{ type: 'x', claim: '   ', action: 'a', confidence: 1 }]) });
    expect(await service.getActiveInsights('u1', 'p1')).toEqual([]);
    expect(await service.getActiveInsights('u1', 'p1', { limit: 0 })).toEqual([]);
  });

  it('读取失败 → 空数组，不抛错（不得因洞察缺失影响开课）', async () => {
    const service = build({ throwOnLatest: true });
    await expect(service.getActiveInsights('u1', 'p1')).resolves.toEqual([]);
  });

  it('默认最多 3 条', async () => {
    const service = build({
      payload: payloadWith(
        Array.from({ length: 6 }, (_, i) => ({ type: 'x', claim: `claim-${i}`, action: 'a', confidence: 1 - i * 0.1 })),
      ),
    });
    expect(await service.getActiveInsights('u1', 'p1')).toHaveLength(3);
  });
});
