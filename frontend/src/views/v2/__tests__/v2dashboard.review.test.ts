/**
 * V2Dashboard「今日复习」卡重设计回归：
 * - 头部口径：以「今天课上实际接几个（课内温故计划）」为主，排队量单独说
 *   （避免把 due 接口上限 20 当成真实总数）；计划拿不到时回退到到期清单总数。
 * - 行内去掉由 retention 推导出来的假「约 X 分钟」，改为「到期原因 + 记忆强度」。
 * - 默认只预览前 5 条，其余折叠为「还有 N 个 · 展开全部」。
 * - 入口：复习藏在日常课里（默认去上课顺带温故），不再借壳开独立复习课。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const getMock = vi.hoisted(() => vi.fn());
const getStats = vi.hoisted(() => vi.fn());
const getPaths = vi.hoisted(() => vi.fn());
const getAdaptiveGuidance = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({
  default: { get: getMock },
}));
vi.mock('@/api/learning', () => ({
  learningAPI: {
    getStats,
    getPaths,
    getAdaptiveGuidance,
    retryPathEnrichment: vi.fn(),
    retryPathGeneration: vi.fn(),
  },
}));
vi.mock('@/stores/user', () => ({
  useUserStore: () => ({ user: null }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

import V2Dashboard from '../V2Dashboard.vue';

const DUE_ITEMS = [
  { conceptKey: 'c1', label: '翻页动作不依赖记得去翻', retention: 0.42, reason: 'below-threshold', estimatedMinutes: 8 },
  { conceptKey: 'c2', label: '收尾动作的完整流程', retention: 0.55, reason: 'below-threshold', estimatedMinutes: 11 },
  { conceptKey: 'c3', label: '触发载体的时效衰减与定期更新', retention: 0.87, reason: 'interval-elapsed', estimatedMinutes: 17 },
  { conceptKey: 'c4', label: '在动作层面设计无冲突的重启流程', retention: 0.88, reason: 'interval-elapsed', estimatedMinutes: 18 },
  { conceptKey: 'c5', label: '间隔复习对抗遗忘', retention: 0.89, reason: 'interval-elapsed', estimatedMinutes: 18 },
  { conceptKey: 'c6', label: '偷懒的评价滞后于动作', retention: 0.9, reason: 'interval-elapsed', estimatedMinutes: 18 },
  { conceptKey: 'c7', label: '模糊的正确比精确的错误更重要', retention: 0.91, reason: 'interval-elapsed', estimatedMinutes: 18 },
];

/** 课内温故计划：本节按负担预算只接 3 个，另有 4 个排队 */
const PLAN = {
  items: [
    { conceptKey: 'c1', label: '翻页动作不依赖记得去翻', retention: 0.42, load: 1, loadFactors: [], originPathTitle: '收尾习惯' },
    { conceptKey: 'c2', label: '收尾动作的完整流程', retention: 0.55, load: 1.5, loadFactors: ['type:process'], originPathTitle: null },
    { conceptKey: 'c3', label: '触发载体的时效衰减与定期更新', retention: 0.87, load: 1, loadFactors: [], originPathTitle: null },
  ],
  budget: 2,
  usedLoad: 3.5,
  backlogCount: 4,
  daily: { date: '2026-09-15', limitLoad: 6, usedLoad: 3.5, remainingLoad: 2.5 },
  tomorrowCount: 5,
  successRate: null,
  relearnSuggestions: [{ conceptKey: 'c9', label: '老卡点', consecutiveAgain: 3 }],
};

async function mountDashboard(options: { withPlan?: boolean; plan?: Record<string, unknown> } = {}) {
  getStats.mockResolvedValue({});
  getPaths.mockResolvedValue([
    {
      id: 'lp1',
      title: '测试路径',
      status: 'active',
      generationLifecycle: { phase: 'ready' },
      milestones: [
        { title: '阶段一', status: 'active', subtasks: [{ id: 't1', title: '任务一', status: 'in_progress', estimatedMinutes: 25 }] },
      ],
    },
  ]);
  getAdaptiveGuidance.mockResolvedValue(null);
  getMock.mockImplementation((url: string) => {
    if (String(url).includes('/ai-teaching/review/plan')) {
      return options.withPlan === false
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ data: options.plan ?? PLAN });
    }
    if (String(url).includes('/ai-teaching/review/due')) return Promise.resolve({ data: { items: DUE_ITEMS } });
    if (String(url).includes('/users/me/sessions')) return Promise.resolve({ data: [] });
    if (String(url).includes('/achievements/all')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  const w = mount(V2Dashboard, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return w;
}

describe('V2Dashboard 今日复习卡（重设计）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
  });

  it('头部口径：今天课上接几个 + 排队几个（不把接口上限当总数）', async () => {
    const w = await mountDashboard();
    expect(w.find('.review__title').text()).toBe('今天课上接 3 个 · 排队 4 个');
    expect(w.find('.review__stat--urgent').text()).toContain('记忆偏弱 2');
    const stats = w.findAll('.review__stat').map((n) => n.text());
    expect(stats).toContain('按计划到期 5');
  });

  it('温故计划拿不到时回退到到期清单总数（不显示 0/空）', async () => {
    const w = await mountDashboard({ withPlan: false });
    expect(w.find('.review__title').text()).toBe('7 个知识点待回捞');
  });

  it('行内用「到期原因 + 记忆强度」，不再出现由 retention 推导的假时长', async () => {
    const w = await mountDashboard();
    const list = w.find('.review__list');
    expect(list.text()).not.toContain('分钟');
    expect(list.text()).toContain('记忆偏弱');
    expect(list.text()).toContain('计划到期');
    expect(list.text()).toContain('42%');
    expect(w.findAll('.review__minutes').length).toBe(0);
  });

  it('默认预览前 5 条，可展开全部', async () => {
    const w = await mountDashboard();
    expect(w.findAll('.review__item').length).toBe(5);
    const more = w.find('.review__more');
    expect(more.text()).toContain('还有 2 个');
    await more.trigger('click');
    expect(w.findAll('.review__item').length).toBe(7);
    expect(w.find('.review__more').text()).toBe('收起');
  });

  it('入口是「去上课 · 顺带温故」，并说明课上会先花 1–2 分钟回捞 + 今日额度', async () => {
    const w = await mountDashboard();
    expect(w.find('.review__go').text()).toContain('去上课 · 顺带温故');
    expect(w.find('.review__hint').text()).toContain('回捞这 3 个');
    expect(w.find('.review__hint').text()).toContain('不用额外开一节复习课');
    expect(w.find('.review__hint').text()).toContain('今日额度 3.5/6');
  });

  it('明日预告：有明日到期点时显示「明天预计 N」', async () => {
    const w = await mountDashboard();
    const stats = w.findAll('.review__stat').map((n) => n.text());
    expect(stats).toContain('明天预计 5');
  });

  it('今日额度用完 → 提示顺延到明天', async () => {
    const w = await mountDashboard({ plan: { ...PLAN, items: [], daily: { date: '2026-09-15', limitLoad: 6, usedLoad: 6, remainingLoad: 0 } } });
    expect(w.find('.review__hint').text()).toContain('今日温故额度已用完');
    expect(w.find('.review__hint').text()).toContain('明天继续');
  });
});

