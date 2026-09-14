/**
 * V2Dashboard 日历口径回归（本地日期，非 UTC）：
 * - 本周节奏的日期键必须用本地日期。此前用 d.toISOString().slice(0,10)（UTC），
 *   UTC+8 凌晨会把整周前移一天，与 minutesByDate 的本地口径对不上；
 * - 选中某天时学习次数按本地日期归组。此前用 String(startTime).startsWith(date) 前缀匹配
 *   （ISO 是 UTC），当天凌晨的会话会被算到前一天。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const getMock = vi.hoisted(() => vi.fn());
const getStats = vi.hoisted(() => vi.fn());
const getPaths = vi.hoisted(() => vi.fn());
const getAdaptiveGuidance = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({ default: { get: getMock } }));
vi.mock('@/api/learning', () => ({
  learningAPI: {
    getStats,
    getPaths,
    getAdaptiveGuidance,
    retryPathEnrichment: vi.fn(),
    retryPathGeneration: vi.fn(),
  },
}));
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ user: null }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

import V2Dashboard from '../V2Dashboard.vue';

async function mountDash(sessions: unknown[]) {
  getStats.mockResolvedValue({});
  getPaths.mockResolvedValue([
    { id: 'lp1', title: '测试路径', status: 'active', generationLifecycle: { phase: 'ready' }, milestones: [] },
  ]);
  getAdaptiveGuidance.mockResolvedValue(null);
  getMock.mockImplementation((url: string) => {
    if (String(url).includes('/users/me/sessions')) {
      return Promise.resolve({ data: sessions, total: (sessions as unknown[]).length });
    }
    return Promise.resolve({ data: {} });
  });
  const w = mount(V2Dashboard, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return w;
}

const todaySessions = () => ([{
  id: 's1', taskId: 't1', taskTitle: '任务一', status: 'completed',
  startTime: new Date().toISOString(), durationMinutes: 25,
}]);

describe('V2Dashboard 日历口径（本地日期）', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMock.mockReset();
    getStats.mockReset();
    getPaths.mockReset();
    getAdaptiveGuidance.mockReset();
  });

  it('本周节奏把分钟归到本地当天（不被 UTC 换算前移一天）', async () => {
    const w = await mountDash(todaySessions());
    const today = w.find('.day--today');
    expect(today.exists()).toBe(true);
    expect(today.find('.day__cell').text()).toBe('25');
    expect(today.find('.day__min').text()).toBe('25分');
  });

  it('选中当天：学习次数按本地日期归组（含当天凌晨会话）', async () => {
    const w = await mountDash(todaySessions());
    await w.find('.day--today').trigger('click');
    await flushPromises();
    const detail = w.find('.day-detail');
    expect(detail.text()).toContain('学习次数');
    expect(detail.text()).toContain('1 次');
  });
});
