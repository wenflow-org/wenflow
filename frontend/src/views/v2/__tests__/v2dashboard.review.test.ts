/**
 * V2Dashboard「今日复习」卡重设计回归：
 * - 头部聚合：显示待回捞总数 + 「记忆偏弱 / 按计划到期」分布（来自后端 reason 字段）。
 * - 行内去掉由 retention 推导出来的假「约 X 分钟」，改为「到期原因 + 记忆强度」。
 * - 默认只预览前 5 条，其余折叠为「还有 N 个 · 展开全部」。
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

async function mountDashboard() {
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

  it('头部聚合：总数 + 记忆偏弱/按计划到期分布', async () => {
    const w = await mountDashboard();
    expect(w.find('.review__title').text()).toBe('7 个知识点待回捞');
    expect(w.find('.review__stat--urgent').text()).toContain('记忆偏弱 2');
    const stats = w.findAll('.review__stat').map((n) => n.text());
    expect(stats).toContain('按计划到期 5');
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

  it('复习课时长用今日任务的真实估算（约 25 分钟）', async () => {
    const w = await mountDashboard();
    expect(w.find('.review__hint').text()).toContain('约 25 分钟');
  });
});
