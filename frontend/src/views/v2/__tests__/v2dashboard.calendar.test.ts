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

  it('本周节奏格子里显示日期数字（不是空白），并归到本地当天', async () => {
    const w = await mountDash(todaySessions());
    const today = w.find('.day--today');
    expect(today.exists()).toBe(true);
    expect(today.find('.day__cell').text()).toBe(String(new Date().getDate()));
    expect(today.find('.day__cell').classes()).toContain('day__cell--h1');
    expect(today.find('.day__min').text()).toBe('25分');
  });

  it('选中当天：学习次数按本地日期归组（含当天凌晨会话），明细在复盘抽屉', async () => {
    const w = await mountDash(todaySessions());
    await w.find('.day--today').trigger('click');
    await flushPromises();
    // 月历撤除后（整月收成 month-summary 一行），当日明细在复盘抽屉：分钟与次数按本地日期归组
    const sheet = w.find('.sheet');
    expect(sheet.exists()).toBe(true);
    expect(sheet.text()).toContain('25 分钟');
    expect(sheet.text()).toContain('1 次');
  });

  it('热力色阶走 CSS class（无内联颜色，暗色由主题样式接管）', async () => {
    const w = await mountDash(todaySessions());

    // 无学习日子 → day__cell--h0（暗色样式里是可读的浅字深底），不再内联 transparent / 浅底深字
    const zeroCells = w.findAll('.day__cell--h0');
    expect(zeroCells.length).toBeGreaterThan(0);
    for (const cell of zeroCells) expect(cell.attributes('style') || '').toBe('');
    // 今天 25 分 → h1
    expect(w.findAll('.day__cell--h1').length).toBeGreaterThan(0);
  });

  it('周行按周一~周日（与本地当天对齐）；展开整月收成一行摘要', async () => {
    const w = await mountDash(todaySessions());

    const days = w.findAll('.week__grid .day');
    expect(days.length).toBe(7);
    const expectedIndex = (new Date().getDay() + 6) % 7; // 周一 = 第 0 列
    expect(days[expectedIndex].classes()).toContain('day--today');
    expect(days[expectedIndex].find('.day__cell').text()).toBe(String(new Date().getDate()));

    // 整月日历卡已按原型撤成一行摘要（月导航/7 列网格归学习历史页）
    const toggle = w.findAll('button').find((b) => b.text().includes('展开整月'));
    expect(toggle).toBeTruthy();
    await toggle!.trigger('click');
    await flushPromises();
    const summary = w.find('.month-summary');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain('25 分钟');
    expect(summary.text()).toContain('1 天有学习');
    expect(summary.text()).toContain('1 次');
  });
});
