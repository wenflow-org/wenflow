/**
 * 跨日「周期边界」回归（2026-10-07）：本周节奏条与本月摘要。
 *
 * 为什么单独锁：学习系统的所有节奏视图都是「按本地日归桶再按周期求和」，
 * 周期边界（跨周、跨月、跨年、闰月）正是最容易错的地方，且错法对用户可见：
 * 周一早上打开应用，「本周」把上周的分钟也算进来；或 1 号打开，本月只显示一半。
 * 这页此前只测了「周行按周一~周日对齐」（v2dashboard.calendar.test.ts），
 * 没测「跨周/跨月的求和是否只含本周期」，也没测凌晨会话的归属。
 *
 * 与既有护栏同手法：日期一律用本地时间构造，实现里若混进 UTC 切日（toISOString），
 * 「跨周不计入上周」「凌晨算当天」两组会失败。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 把「现在」钉在某天某点（本地）；必须在 mount 之前调用，todayStr 是挂载期算的 */
function freezeAt(y: number, m: number, d: number, h = 12, min = 0) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(y, m - 1, d, h, min, 0, 0));
}

/** 本地某天某点的 ISO 串（startTime 用绝对时刻，页面再转回本地日） */
function at(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}
function session(id: string, startTime: string, durationMinutes: number) {
  return { id, taskId: `t-${id}`, taskTitle: `任务${id}`, status: 'completed', startTime, durationMinutes };
}

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
  const w = mount(V2Dashboard, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } });
  await flushPromises();
  return w;
}

/** 打开整月摘要（需要 hasAnyMinutes） */
async function openMonth(w: Awaited<ReturnType<typeof mountDash>>) {
  const toggle = w.findAll('button').find((b) => b.text().includes('展开整月'));
  expect(toggle, '没找到「展开整月」开关').toBeTruthy();
  await toggle!.trigger('click');
  await flushPromises();
  return w.find('.month-summary');
}

/** 周条 7 格的分钟文本（周一→周日） */
const weekCells = (w: Awaited<ReturnType<typeof mountDash>>) =>
  w.findAll('.week__grid .day .day__min').map((e) => e.text());

beforeEach(() => {
  setActivePinia(createPinia());
  getMock.mockReset();
  getStats.mockReset();
  getPaths.mockReset();
  getAdaptiveGuidance.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('跨周边界：本周条只含本周一~周日', () => {
  it('周一：上周日的学习不计入「本周」', async () => {
    freezeAt(2026, 10, 5, 12); // 周一
    const w = await mountDash([
      session('sun', at(2026, 10, 4, 20), 40), // 上周日
      session('mon', at(2026, 10, 5, 9), 25), // 本周一
    ]);
    const cells = weekCells(w);
    expect(cells).toHaveLength(7);
    expect(cells[0]).toBe('25分'); // 周一
    expect(cells[6]).toBe('—'); // 上周日不在本行
    expect(w.find('.month-summary').exists()).toBe(false);
    // 本周合计 = 25（上周日的 40 不算进来）
    expect(w.text()).toContain('本周 25 分钟');
  });

  it('周日：本周从周一开始算满 7 天，下周的会话不混入', async () => {
    freezeAt(2026, 10, 11, 20); // 周日
    const w = await mountDash([
      session('mon', at(2026, 10, 5, 10), 30), // 本周一
      session('sun', at(2026, 10, 11, 10), 20), // 今天（周日）
      session('next', at(2026, 10, 12, 10), 99), // 下周一（未来，不该出现）
    ]);
    const cells = weekCells(w);
    expect(cells[0]).toBe('30分'); // 周一
    expect(cells[6]).toBe('20分'); // 周日 = 今天
    expect(cells).not.toContain('99分');
    expect(w.text()).toContain('本周 50 分钟');
  });

  it('跨年那一周：本周一在去年 12/29，周条仍按周一对齐', async () => {
    freezeAt(2026, 1, 1, 12); // 2026-01-01 周四，本周一 = 2025-12-29
    const w = await mountDash([
      session('dec', at(2025, 12, 29, 10), 15), // 上周一（去年的）
      session('jan', at(2026, 1, 1, 10), 45), // 今天
    ]);
    const cells = weekCells(w);
    expect(cells[0]).toBe('15分'); // 周一 = 2025-12-29
    expect(cells[3]).toBe('45分'); // 周四 = 今天
    expect(w.text()).toContain('本周 60 分钟');
  });

  it('本地凌晨的学习算当天那一格（UTC 切日会把它挪到前一天）', async () => {
    freezeAt(2026, 10, 5, 12); // 周一中午
    const w = await mountDash([session('dawn', at(2026, 10, 5, 0, 30), 20)]);
    expect(weekCells(w)[0]).toBe('20分'); // 周一凌晨 → 周一格
    expect(w.find('.day--today').exists()).toBe(true);
    expect(w.find('.day--today').find('.day__min').text()).toBe('20分');
  });
});

describe('跨月边界：本月摘要只含当前自然月', () => {
  it('月初 1 号：上月月末的学习不计入本月', async () => {
    freezeAt(2026, 11, 1, 12); // 11/1 周日
    const w = await mountDash([
      session('oct', at(2026, 10, 31, 20), 50), // 上月末
      session('nov', at(2026, 11, 1, 10), 25), // 本月今天
    ]);
    const summary = await openMonth(w);
    expect(summary.text()).toContain('本月节奏：25 分钟');
    expect(summary.text()).toContain('1 天有学习');
    expect(summary.text()).toContain('1 次');
  });

  it('同一天内多次会话：分钟累加、天数只算 1 天、次数按会话数', async () => {
    freezeAt(2026, 10, 7, 21);
    const w = await mountDash([
      session('a', at(2026, 10, 7, 9), 20),
      session('b', at(2026, 10, 7, 14), 15),
      session('c', at(2026, 10, 7, 20), 10),
    ]);
    const summary = await openMonth(w);
    expect(summary.text()).toContain('本月节奏：45 分钟');
    expect(summary.text()).toContain('1 天有学习');
    expect(summary.text()).toContain('3 次');
  });

  it('跨月连续两天都学：分钟与天数都算两天', async () => {
    freezeAt(2026, 11, 1, 12);
    const w = await mountDash([
      session('d1', at(2026, 10, 31, 20), 30),
      session('d2', at(2026, 11, 1, 10), 30),
    ]);
    const summary = await openMonth(w);
    expect(summary.text()).toContain('本月节奏：30 分钟');
    expect(summary.text()).toContain('1 天有学习');
    // 连续天数从今天（11/1）往前数：今天 + 昨天 = 2
    expect(summary.text()).toContain('连续 2 天');
  });

  it('闰年 2/29 的学习计入 2028 年 2 月，不落到 3 月', async () => {
    freezeAt(2028, 3, 1, 12); // 3/1 周三，本周一 = 2/28
    const w = await mountDash([
      session('leap', at(2028, 2, 29, 10), 35), // 闰日
      session('mar', at(2028, 3, 1, 10), 25), // 本月
    ]);
    const summary = await openMonth(w);
    // 3 月只有 3/1 这一天
    expect(summary.text()).toContain('本月节奏：25 分钟');
    expect(summary.text()).toContain('1 天有学习');
  });

  it('今天没学、昨天学了：连续天数仍显示（当天宽限），不显示 0', async () => {
    freezeAt(2026, 10, 7, 12);
    const w = await mountDash([session('y', at(2026, 10, 6, 20), 30)]);
    const summary = await openMonth(w);
    expect(summary.text()).toContain('连续 1 天');
    // 今天 0 分钟，但连续不断
    expect(w.text()).toContain('今日已学 0 /');
  });
});