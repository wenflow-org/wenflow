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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* 源码锁（归一换行：core.autocrlf 检出的 CRLF 会让 '\n' 切片失配） */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2Dashboard.vue'), 'utf8').replace(/\r\n/g, '\n');

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
    const today = w.find('.cal__cell--today');
    expect(today.exists()).toBe(true);
    expect(today.find('b').text()).toBe(String(new Date().getDate()));
    expect(today.classes()).toContain('cal__cell--h1');
    expect(today.find('.cal__min').text()).toBe('25分');
  });

  it('选中当天：学习次数按本地日期归组（含当天凌晨会话），明细在复盘抽屉', async () => {
    const w = await mountDash(todaySessions());
    await w.find('.cal__cell--today').trigger('click');
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
    const zeroCells = w.findAll('.cal__cell--h0');
    expect(zeroCells.length).toBeGreaterThan(0);
    for (const cell of zeroCells) expect(cell.attributes('style') || '').toBe('');
    // 今天 25 分 → h1
    expect(w.findAll('.cal__cell--h1').length).toBeGreaterThan(0);
  });

  it('周行按周一~周日；展开整月是把同一个网格换成整月（不再叠一份表头/2~8 号）', async () => {
    const w = await mountDash(todaySessions());

    /* 周视图：7 格 + 唯一表头 */
    const days = w.findAll('.cal__grid .cal__cell');
    expect(days.length).toBe(7);
    expect(w.findAll('.cal__wks').length).toBe(1);
    const expectedIndex = (new Date().getDay() + 6) % 7; // 周一 = 第 0 列
    expect(days[expectedIndex].classes()).toContain('cal__cell--today');
    expect(days[expectedIndex].find('b').text()).toBe(String(new Date().getDate()));

    // 展开整月
    const toggle = w.findAll('button').find((b) => b.text().includes('展开整月'));
    expect(toggle).toBeTruthy();
    await toggle!.trigger('click');
    await flushPromises();

    /* 关键：整卡仍然只有一份星期表头（此前周条 + 月历各画一份） */
    expect(w.findAll('.cal__wks').length).toBe(1);
    /* 月视图是「本月天数 + 月初空位占位格」，且不再和 7 天周条并存 */
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const inMonth = w.findAll('.cal__cell:not(.cal__cell--out)');
    expect(inMonth.length).toBe(daysInMonth);
    expect(w.findAll('.cal__cell--out').length).toBe((new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7);

    /* 月初占位格要显示上月尾日（26/27/28/29/30/31），不能是空的：
       v-for="b in lead" 的 b 从 1 开始，leadDays 数组下标从 0 开始 */
    const outLabels = w.findAll('.cal__cell--out').map((c) => c.text().trim());
    expect(outLabels.length).toBeGreaterThan(0);
    for (const label of outLabels) expect(label, `占位格出现空文本：${JSON.stringify(outLabels)}`).not.toBe('');

    /* 本月 1 号必须在（此前被读成「1 号失踪」） */
    expect(inMonth[0].find('b').text()).toBe('1');

    const summary = w.find('.cal__sum');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain('25 分钟');
    expect(summary.text()).toContain('1 天有学习');
    expect(summary.text()).toContain('1 次');
    /* 展开月视图后不再同时挂一行「本周」统计：两组同形状数字上下并排会被读成重复 */
    expect(w.find('.week__stats').exists(), '月视图里「本月」与「本周」两组统计同时上屏').toBe(false);
  });

  it('月历格子可点开当日抽屉（此前是静态 span）；选中日带高亮', async () => {
    const w = await mountDash(todaySessions());
    const toggle = w.findAll('button').find((b) => b.text().includes('展开整月'));
    await toggle!.trigger('click');
    await flushPromises();

    /* 所有当月日期格都是 button（可点），空位占位格不是 */
    const inMonth = w.findAll('.cal__cell:not(.cal__cell--out)');
    for (const cell of inMonth.slice(0, 5)) expect(cell.element.tagName).toBe('BUTTON');
    expect(w.findAll('.cal__cell--out')[0]?.element.tagName).toBe('SPAN');

    /* 点某一天 → 抽屉打开；该格带选中态 */
    await inMonth[0].trigger('click');
    await flushPromises();
    expect(w.find('.sheet').exists()).toBe(true);
    expect(w.find('.cal__cell--selected').exists()).toBe(true);
  });
});

describe('课堂事件文案：不裸露算法公式（2026-11-08 走查）', () => {
  it('存量 θ−d 文案在渲染处被兜底改写为自然语言', () => {
    expect(source).toContain('EVENT_SUMMARY_REWRITES');
    expect(source).toContain("知识状态低于任务难度（θ−d），进入干预");
    expect(source).toContain('当前任务略超掌握度，已切入针对性辅导');
    /* 渲染点必须过 rewriteEventSummary，不许直接吐 e.summary */
    expect(source).toMatch(/summary:\s*rewriteEventSummary\(e\.summary\)/);
    expect(source).not.toMatch(/summary:\s*e\.summary/);
  });
});
