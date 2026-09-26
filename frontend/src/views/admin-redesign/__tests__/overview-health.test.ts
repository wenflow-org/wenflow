/**
 * overviewHealth 兜底口径回归：
 * live 总览未就绪时必须如实显示空态（muted / score null），
 * 不得回落到写死的「92 运行平稳 / 61 429 限流」演示数据。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { overviewHealth, liveOverview } from '../store';

beforeEach(() => {
  liveOverview.value = null;
});

describe('overviewHealth 兜底口径', () => {
  it('live 数据未就绪 → 如实空态，不编造分数与结论', () => {
    const health = overviewHealth.value;
    expect(health.tone).toBe('muted');
    expect(health.score).toBeNull();
    expect(health.headline).not.toContain('运行平稳');
    expect(JSON.stringify(health)).not.toContain('429');
  });

  it('live 数据就绪 → 直出后端结论', () => {
    liveOverview.value = { tone: 'warn', score: 61, headline: '后端结论', subline: '来自真实统计' };
    expect(overviewHealth.value).toMatchObject({ tone: 'warn', score: 61, headline: '后端结论' });
  });
});
