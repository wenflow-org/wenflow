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

import { buildLearnerPrediction } from '../TeachingContextBuilder';

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
      Object.assign(new Error('Skill learning-predictor exceeded 8000ms timeout'), { code: 'SKILL_TIMEOUT' }),
    );

    const ctx = await run('timeout-user');
    expect(ctx).toBeNull();

    const opts = mockExecuteSkill.mock.calls[0][2] as { timeout: number; abortSignal: AbortSignal };
    // executor 硬超时 → SKILL_TIMEOUT → 计入 learning-predictor 失败率（executor.ts:363-381）
    expect(opts.timeout).toBe(8000);
    // 超时后确实中止底层请求（原 Promise.race 只是不再等待，请求继续烧 token）
    expect(opts.abortSignal.aborted).toBe(true);
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
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1); // 冷却期内跳过，避免再白等 8s
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
