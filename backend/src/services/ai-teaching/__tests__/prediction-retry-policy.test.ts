/**
 * issue #182：学习表现预测的失败可观测 / 超时取消 / 复用 TTL / 回合级冷却。
 *
 * 基线缺陷：超时只是「不再等待」（底层请求继续烧 token）、失败静默（debug）、
 * 复用无 TTL、预测器故障时每回合都白等一次超时。
 */
const mockPredictionFindFirst = jest.fn();
const mockEvidenceFindFirst = jest.fn();
const mockExecuteSkill = jest.fn();
const mockRecordPrediction = jest.fn();
const mockEmpiricalStats = jest.fn();

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    prediction_records: { findFirst: (...a: unknown[]) => mockPredictionFindFirst(...a) },
    learner_evidence: { findFirst: (...a: unknown[]) => mockEvidenceFindFirst(...a) },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../skills', () => ({
  ...jest.requireActual('../../../skills'),
  executeSkill: (...args: unknown[]) => mockExecuteSkill(...args),
}));

jest.mock('../../learner/PredictionCalibrationService', () => ({
  ...jest.requireActual('../../learner/PredictionCalibrationService'),
  predictionCalibrationService: {
    recordPrediction: (...a: unknown[]) => mockRecordPrediction(...a),
    empiricalStats: (...a: unknown[]) => mockEmpiricalStats(...a),
  },
}));

import { buildLearnerPrediction, PREDICTION_TIMEOUT_MS } from '../TeachingContextBuilder';

/** 与实现同口径的新鲜度上限（24h），仅用于断言查询时间窗落在其附近 */
const TTL_MS = 24 * 60 * 60 * 1000;

const freshRow = (over: Record<string, unknown> = {}) => ({
  stallRisk: 0.3,
  predictedTone: 'smooth',
  suggestedDepth: 'standard',
  focusConcepts: '["a","b"]',
  rationale: 'r',
  toneDetail: null,
  depthDetail: null,
  ...over,
});

const okPrediction = {
  stallRisk: 0.4,
  predictedTone: 'struggle',
  suggestedDepth: 'standard',
  focusConcepts: [],
  rationale: 'r',
};

const run = (key: string) =>
  buildLearnerPrediction(key, 'p', key, undefined, undefined, { taskContext: { title: 'T' } });

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordPrediction.mockResolvedValue('prd_1');
  mockEmpiricalStats.mockResolvedValue({ total: 0, stallHitRate: 0 });
});

describe('buildLearnerPrediction：issue #182 三重保护', () => {
  it('命中新鲜未回写记录 → 直接复用，不调预测器', async () => {
    mockPredictionFindFirst.mockResolvedValue(freshRow());

    const ctx = await run('reuse-user');

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(ctx).toMatchObject({
      stallRisk: 0.3,
      predictedTone: 'smooth',
      suggestedDepth: 'standard',
      focusConcepts: ['a', 'b'],
    });
  });

  it('复用查询带 24h 新鲜度下限（任务长期不完成时不再无限期复用）', async () => {
    const before = Date.now();
    mockPredictionFindFirst.mockResolvedValue(null);
    mockEvidenceFindFirst.mockResolvedValue(null);
    mockExecuteSkill.mockResolvedValue(okPrediction);

    await run('ttl-user');

    const where = mockPredictionFindFirst.mock.calls[0][0].where as { outcome: unknown; createdAt: { gte: Date } };
    expect(where.outcome).toBeNull();
    const age = before - where.createdAt.gte.getTime();
    expect(age).toBeGreaterThanOrEqual(TTL_MS - 2000);
    expect(age).toBeLessThanOrEqual(TTL_MS + 2000);
  });

  it('超时（SKILL_TIMEOUT）→ 返回 null，且已计入失败率口径并中止底层请求', async () => {
    mockPredictionFindFirst.mockResolvedValue(null);
    mockEvidenceFindFirst.mockResolvedValue(null);
    mockExecuteSkill.mockRejectedValue(
      Object.assign(new Error(`Skill profile-learning-predict exceeded ${PREDICTION_TIMEOUT_MS}ms timeout`), { code: 'SKILL_TIMEOUT' }),
    );

    const ctx = await run('timeout-user');
    expect(ctx).toBeNull();

    const opts = mockExecuteSkill.mock.calls[0][2] as { timeout: number; abortSignal: AbortSignal };
    // executor 硬超时 → SKILL_TIMEOUT → 计入 profile-learning-predict 失败率（executor.ts:363-381）
    // 超时线 15s：实测模型 p50≈8–10s，8s 封顶等于 0% 成功率（7 次尝试 7 次全败）
    expect(opts.timeout).toBe(PREDICTION_TIMEOUT_MS);
    expect(PREDICTION_TIMEOUT_MS).toBeGreaterThan(10_000);
    // 超时后确实中止底层请求（原 Promise.race 只是不再等待，请求继续烧 token）
    expect(opts.abortSignal.aborted).toBe(true);
  });

  it('网关把超时归一成 CALLER_ABORTED（调用时长贴着超时线）→ 仍按超时处理：中止请求 + 长冷却', async () => {
    // 2026-11-26 实录：executor 的硬超时先 abort 底层请求，网关把它归一成 CALLER_ABORTED，
    // 于是超时被当成「调用方取消」——不计失败、不冷却，7 回合里每回合都白等一次。
    const start = Date.parse('2026-11-26T08:00:00Z');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);
    try {
      mockPredictionFindFirst.mockResolvedValue(null);
      mockEvidenceFindFirst.mockResolvedValue(null);
      mockExecuteSkill.mockImplementation(async () => {
        nowSpy.mockReturnValue(start + PREDICTION_TIMEOUT_MS);
        throw Object.assign(new Error('API request canceled'), { code: 'CALLER_ABORTED' });
      });

      const first = await run('timeout-misclassified-user');
      expect(first).toBeNull();
      const opts = mockExecuteSkill.mock.calls[0][2] as { abortSignal: AbortSignal };
      expect(opts.abortSignal.aborted).toBe(true);

      // 10 分钟冷却：期间不再调预测器（通用失败的 60s 冷却一两个回合就过期，等于每回合再赌一次）
      nowSpy.mockReturnValue(start + PREDICTION_TIMEOUT_MS + 5 * 60 * 1000);
      const second = await run('timeout-misclassified-user');
      expect(second).toBeNull();
      expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('失败后短时冷却：同 task 下一回合不再重复调用预测器', async () => {
    mockPredictionFindFirst.mockResolvedValue(null);
    mockEvidenceFindFirst.mockResolvedValue(null);
    mockExecuteSkill.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'LLM_FAILED' }));

    const first = await run('cooldown-user');
    expect(first).toBeNull();
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);

    const second = await run('cooldown-user');
    expect(second).toBeNull();
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1); // 冷却期内跳过，避免再白等一个超时线
  });

  it('调用方取消（CALLER_ABORTED）不计失败、不冷却：下一回合仍重试', async () => {
    mockPredictionFindFirst.mockResolvedValue(null);
    mockEvidenceFindFirst.mockResolvedValue(null);
    mockExecuteSkill.mockRejectedValueOnce(Object.assign(new Error('API request canceled'), { code: 'CALLER_ABORTED' }));

    const first = await run('caller-abort-user');
    expect(first).toBeNull();
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);

    mockExecuteSkill.mockRejectedValueOnce(Object.assign(new Error('API request canceled'), { code: 'CALLER_ABORTED' }));
    await run('caller-abort-user');
    expect(mockExecuteSkill).toHaveBeenCalledTimes(2); // 未被冷却挡住
  });
});
