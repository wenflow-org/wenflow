/**
 * V2Dashboard「今日复习」区回归（2026-09-27 信噪比重设计版 + 同日二次去重）：
 * - 学习台只保留一行「下节课开头会发生什么」（课内温故计划为主口径，
 *   计划拿不到时回退偏弱计数，不显示 0 或空）；措辞明确「没有单独的复习课」，
 *   回捞是带在下一节课开头的。
 * - 概念明细、排队量、明日预告、逐条记忆强度全部移出学习台（归学习状态页），
 *   这里断言它们不再出现。
 * - 行动入口收归页面上方主 CTA（原来的「去上课」与之同课重复且漏 pathId，已删）；
 *   额度用完时提示顺延明天。
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

describe('V2Dashboard 今日复习区（信噪比重设计）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
  });

  it('主口径：下节课开头会先复习 N 个（以课内温故计划为准；「回捞」口语已改「复习」）', async () => {
    const w = await mountDashboard();
    expect(w.find('.review__plan-body strong').text()).toBe('下节课开头会先复习 3 个旧知识点');
  });

  it('温故计划拿不到时回退到偏弱计数（不显示 0/空）', async () => {
    const w = await mountDashboard({ withPlan: false });
    expect(w.find('.review__plan-body strong').text()).toBe('2 个知识点记忆偏弱，课开头会优先复习');
  });

  it('概念明细/排队量/明日预告/逐条强度不再出现在学习台', async () => {
    const w = await mountDashboard();
    const text = w.find('.agenda').text();
    expect(text).not.toContain('排队 4');
    expect(text).not.toContain('明天预计 5');
    expect(text).not.toContain('42%');
    expect(w.findAll('.review__item').length).toBe(0);
    expect(w.find('.review__more').exists()).toBe(false);
  });

  it('不再有重复的「去上课」入口（与主 CTA 同一节课）；指引点明没有单独复习课', async () => {
    const w = await mountDashboard();
    expect(w.find('.review__go').exists()).toBe(false);
    expect(w.find('.review__plan-body span').text()).toBe('没有单独的复习课，不用额外安排');
  });

  it('今日额度用完 → 提示顺延到明天', async () => {
    const w = await mountDashboard({ plan: { ...PLAN, items: [], daily: { date: '2026-09-15', limitLoad: 6, usedLoad: 6, remainingLoad: 0 } } });
    const hint = w.find('.review__plan-body span').text();
    expect(hint).toContain('今日温故额度已用完');
    expect(hint).toContain('明天继续');
  });
});
