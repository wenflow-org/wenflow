/**
 * V2LearningState（P3-3：学习状态英文内部指标词直出）回归测试：
 * 指标卡/图例/区间说明必须为中文标签（健康度/疲劳度/状态），不出现 fitness/fatigue/form 英文直出。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import V2LearningState from '../V2LearningState.vue';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({
  default: { get: getMock }
}));

vi.mock('@/api/metrics', () => ({
  metricsAPI: {
    getCurrentState: vi.fn(async () => ({ lss: 30, ktl: 1, lf: 20, lsb: 50 })),
    getTrends: vi.fn(async () => ({ days: 42, data: [] }))
  }
}));

vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

async function mountState(sessions: unknown[] = []) {
  getMock.mockImplementation((url: string) => {
    if (String(url).includes('/users/me/sessions')) {
      return Promise.resolve({ success: true, data: sessions });
    }
    if (String(url).includes('/state/warnings')) {
      return Promise.resolve({ success: true, data: { warnings: [] } });
    }
    if (String(url).includes('/users/me/learner-center')) {
      return Promise.resolve({ success: true, data: {} });
    }
    return Promise.resolve({ success: true, data: {} });
  });
  const w = mount(V2LearningState);
  await flushPromises();
  return w;
}

describe('V2LearningState 中文指标标签（P3-3）', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('四张指标卡全中文标签：整体状态/学习压力/掌握趋势/疲劳程度', async () => {
    const w = await mountState();
    const labels = w.findAll('.metric small').map((n) => n.text());
    expect(labels).toEqual(['整体状态', '学习压力', '掌握趋势', '疲劳程度']);
  });

  it('图例中文：健康度（约 13.5 天指数平均）/ 疲劳度（约 2 天指数平均）', async () => {
    const w = await mountState();
    const legend = w.find('.ff-legend');
    expect(legend.text()).toContain('健康度（约 13.5 天指数平均）');
    expect(legend.text()).toContain('疲劳度（约 2 天指数平均）');
  });

  it('有数据时状态图例为「状态」中文（非 form）', async () => {
    const w = await mountState([{ startTime: new Date().toISOString(), durationMinutes: 30 }]);
    expect(w.find('.ff-legend').text()).toContain('状态');
  });

  it('区间说明全中文（精力充沛/最优训练区/高风险区）', async () => {
    const w = await mountState([{ startTime: new Date().toISOString(), durationMinutes: 30 }]);
    const zones = w.find('.ff-zones');
    expect(zones.exists()).toBe(true);
    expect(zones.text()).toContain('精力充沛');
    expect(zones.text()).toContain('最优训练区');
    expect(zones.text()).toContain('高风险区');
  });

  it('页面可见文本无英文内部指标词直出', async () => {
    const w = await mountState();
    const text = w.text();
    expect(text).not.toMatch(/fitness|fatigue/i);
  });
});
