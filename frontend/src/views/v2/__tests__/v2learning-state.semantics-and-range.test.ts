/**
 * 学习状态页 2026-11-11 语义/窗口回归：
 *  ① 四项指标只报分档时，读者仍要自己翻译成「今天该学还是该休息」——页面必须给一句结论；
 *  ② 整体状态在数据积累期不再用「积累中」掩盖参考值（-100），改说「暂不定档」；
 *  ③ 阈值图例按区间写清 20/40 是边界，而不是两个独立档位；
 *  ④ 趋势窗口写进 ?days=，刷新/返回后不丢，且会按 URL 重拉。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import V2LearningState from '../V2LearningState.vue';

const getMock = vi.hoisted(() => vi.fn());
const replaceSpy = vi.hoisted(() => vi.fn());
const routeState = vi.hoisted(() => ({ query: { days: '30' } as Record<string, string> }));

vi.mock('@/utils/api', () => ({
  default: { get: getMock, post: vi.fn() }
}));

vi.mock('@/api/metrics', () => ({
  metricsAPI: {
    getCurrentState: vi.fn(async () => ({ lss: 22.5, ktl: 22.93, lf: 100, lsb: -100, mature: false }))
  }
}));

vi.mock('@/api/learning', () => ({
  learningAPI: { getPaths: vi.fn(async () => []) }
}));

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ replace: replaceSpy, push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' }
}));

vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));
vi.mock('@/components/AiContentNote.vue', () => ({ default: { template: '<p class="stub-ai-note" />' } }));

function trends(days = 7) {
  const out: Array<Record<string, unknown>> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      ktl: 22.93,
      lf: i === 0 ? 100 : 10,
      lsb: i === 0 ? -100 : 12,
      mature: false
    });
  }
  return out;
}

function mockApi() {
  getMock.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/users/me/sessions')) {
      return Promise.resolve({ success: true, data: [{ startTime: new Date().toISOString(), durationMinutes: 64 }] });
    }
    if (u.includes('/learning/concept-graph')) {
      return Promise.resolve({ success: true, data: { nodes: [{ stability: 'learning', masteryScore: 0.2 }] } });
    }
    if (u.includes('/state/trends')) return Promise.resolve({ success: true, data: { trends: trends(), range: 'recent' } });
    if (u.includes('/state/warnings')) return Promise.resolve({ success: true, data: { warnings: [] } });
    if (u.includes('/ai-teaching/review/due')) return Promise.resolve({ success: true, data: { items: [] } });
    if (u.includes('/ai-teaching/review/plan')) return Promise.resolve({ success: true, data: { items: [] } });
    if (u.includes('/adaptive-guidance/copy')) return Promise.resolve({ success: true, data: { copy: null, decisions: [] } });
    return Promise.resolve({ success: true, data: {} });
  });
}

function trendCalls() {
  return getMock.mock.calls
    .filter(([url]) => String(url).includes('/state/trends'))
    .map(([, opts]) => (opts as { params?: { days?: number } } | undefined)?.params?.days);
}

describe('学习状态：读者能回答「今天该学还是该休息」', () => {
  beforeEach(() => {
    getMock.mockReset();
    replaceSpy.mockReset();
    routeState.query = { days: '30' };
    mockApi();
  });

  it('疲劳 100 过高时给休息/轻量结论，整体状态说明不再写「积累中」', async () => {
    const w = mount(V2LearningState, { global: { stubs: { 'router-link': true } } });
    await flushPromises();

    const text = w.text();
    expect(text).toContain('今天怎么安排');
    expect(text).toContain('优先休息');
    const lsb = w.findAll('.vitals__item').find((n) => n.text().includes('整体状态'));
    expect(lsb?.text()).toContain('暂不定档');
    expect(lsb?.text()).not.toContain('积累中');
    w.unmount();
  });

  it('阈值图例写清 20/40 是区间边界，并补纵轴/柱的口径', async () => {
    const w = mount(V2LearningState, { global: { stubs: { 'router-link': true } } });
    await flushPromises();
    const legend = w.find('.ff-legend').text();
    expect(legend).toContain('≥40 精力充沛');
    expect(legend).toContain('20–39 最优训练区');
    expect(legend).toContain('<20 需要休息');
    expect(legend).toContain('柱为当日学习时长（分钟）');
    w.unmount();
  });

  it('?days=30 进页即按 30 天拉趋势；切到 7 天后写回 URL 并按 7 天重拉', async () => {
    const w = mount(V2LearningState, { global: { stubs: { 'router-link': true } } });
    await flushPromises();
    expect(trendCalls()[0]).toBe(30);

    const seg = w.findAll('.seg__item');
    expect(seg.length).toBeGreaterThanOrEqual(2);
    await seg[0].trigger('click');
    await flushPromises();

    expect(replaceSpy).toHaveBeenCalled();
    expect(replaceSpy.mock.calls[0][0].query.days).toBe('7');
    expect(trendCalls().at(-1)).toBe(7);
    w.unmount();
  });
});
