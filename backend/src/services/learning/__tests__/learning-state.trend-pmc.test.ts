/**
 * PMC 单一口径回归（2026-10-23 走查）：
 *   - /state/trends 必须与 /state/current 同源（PMC 逐日重放），不能再读落库行的旧 EWMA ktl/lf；
 *   - 冷启动（KTL 基座未成熟）form<0 不得展示/建议成「严重疲劳」。
 */
const mockPrisma = {
  users: { findUnique: jest.fn() },
  learning_metrics: { findMany: jest.fn() },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { LearningStateService, type LearningStateMetrics } from '../learning-state.service';
import { buildDisplaySuggestion } from '../learning-state-suggestion';

describe('getStateTrendWindow：趋势与 current 同走 PMC', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.users.findUnique.mockResolvedValue({ createdAt: new Date() });
  });

  it('趋势点用 PMC 重放值，而不是落库行的旧 EWMA 值', async () => {
    const service = new LearningStateService();
    const now = new Date();
    // 落库行故意写成旧模型的高值（display 90/20/70）；PMC 从 0 重放应得到 2.5/15/-12.5。
    const row = {
      lss: 5,
      ktl: 9,
      lf: 2,
      lsb: 7,
      calculatedAt: now,
      sourceKey: 'session-wrapup:s1',
      taskId: 't1',
      metadata: '{"version":"state-v2","committed":true}',
    };
    mockPrisma.learning_metrics.findMany.mockResolvedValue([row]);
    jest.spyOn(service, 'getTrendsSince').mockResolvedValue([
      { lss: 5, ktl: 9, lf: 2, lsb: 7, timestamp: now } as unknown as LearningStateMetrics,
    ]);
    jest.spyOn(service, 'getCurrentState').mockResolvedValue(null);
    jest.spyOn(service, 'getLatestCommittedMetricBefore').mockResolvedValue(null);

    const win = await service.getStateTrendWindow('u', { days: 7, mode: 'recent' });
    const last = win.trends[win.trends.length - 1];

    expect(last.ktl).toBeCloseTo(2.5, 5);
    expect(last.lf).toBeCloseTo(15, 5);
    expect(last.lsb).toBeCloseTo(-12.5, 5);
    expect(last.mature).toBe(false);
    // 旧口径（落库行）会把 ktl 显示成 90——回归必须拦住。
    expect(last.ktl).not.toBeCloseTo(90, 5);
  });
});

describe('buildDisplaySuggestion：冷启动不误报严重疲劳', () => {
  it('基座未成熟时给出「状态正在建立」，且不出现「精力充沛」', () => {
    const suggestion = buildDisplaySuggestion({ lss: 30, ktl: 2.5, lf: 15, lsb: -12.5 });

    expect(suggestion.level).toBe('normal');
    expect(suggestion.message).toBe('状态正在建立');
    expect(suggestion.categories.state.message).toContain('建立学习负荷基座');
    expect(suggestion.categories.duration.message).not.toContain('精力充沛');
    expect(suggestion.message).not.toContain('过度疲劳');
  });

  it('基座成熟 + ACWR 高时仍能报出高疲劳，且子项不与之矛盾', () => {
    const suggestion = buildDisplaySuggestion({ lss: 60, ktl: 40, lf: 70, lsb: -30 });

    expect(suggestion.level).toBe('critical');
    expect(suggestion.categories.state.message).toContain('急性负荷');
    expect(suggestion.categories.duration.message).not.toContain('精力充沛');
  });

  it('高 KTL 只按训练负荷解读，不再说「知识掌握优秀」', () => {
    const suggestion = buildDisplaySuggestion({ lss: 20, ktl: 80, lf: 20, lsb: 60 });

    expect(suggestion.categories.growth.message).toContain('训练负荷');
    expect(suggestion.categories.growth.message).not.toContain('掌握');
  });
});
