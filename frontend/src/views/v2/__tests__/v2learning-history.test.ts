/**
 * V2LearningHistory 回归（状态语义 + 入口动作 + 内部会话过滤）：
 * - 状态三态：completed=已完成 / active·paused=进行中·已暂停 / timeout 等=已超时·已结束；
 * - 「继续」只给可继续会话（active/paused），不再给已结束会话假入口；
 * - 有当堂小结（wrapup）的会话给「查看反馈」入口；
 * - 请求带 excludeInternal=1（过滤 discarded/superseded 内部会话）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({ default: { get: getMock } }));
// 页面已收进个人中心壳：壳负责导航/页头/页脚，测试只关心页面内容，用透传 slot 的桩替掉
vi.mock('@/components/user/CapabilityShell.vue', () => ({ default: { template: '<div><slot /></div>' } }));

import V2LearningHistory from '../V2LearningHistory.vue';

/* 下面这组是样式侧断言（摘要与动作链的可见性/热区），直接读 SFC 文本 */
const sfcSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../V2LearningHistory.vue'), 'utf8');
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** 取选择器后的声明块。不匹配「选择器 + 空格 + {」：分组选择器会跨行、工作区是 CRLF，
    换行符写死在断言里会假失败。 */
function styleRule(selector: string): string {
  const css = stripCssComments(sfcSource);
  const start = css.indexOf(selector);
  expect(start, `样式里没有 ${selector}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`${selector} 声明块不配平`);
}
function styleDecl(rule: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule);
  return m ? m[1].trim() : null;
}

const SESSIONS = [
  { id: 's1', taskId: 't1', taskTitle: '任务一', status: 'completed', startTime: '2026-09-14T09:00:00Z', durationMinutes: 20, wrapup: '{"summary":{}}' },
  { id: 's2', taskId: 't2', taskTitle: '任务二', status: 'timeout', startTime: '2026-09-14T10:00:00Z', durationMinutes: 10, wrapup: '{"summary":{}}' },
  { id: 's3', taskId: 't3', taskTitle: '任务三', status: 'active', startTime: '2026-09-14T11:00:00Z', durationMinutes: 0 },
  { id: 's4', taskId: 't4', taskTitle: '任务四', status: 'paused', startTime: '2026-09-14T12:00:00Z', durationMinutes: 0 },
  { id: 's5', taskId: 't5', taskTitle: '任务五', status: 'discarded', startTime: '2026-09-14T08:00:00Z', durationMinutes: 93 },
];

async function mountHistory(sessions: unknown[] = SESSIONS) {
  getMock.mockImplementation((url: string, config?: { params?: { limit?: number } }) => {
    if (String(url).includes('/learning/stats')) {
      return Promise.resolve({ data: { time: { totalMinutes: 120, activeLearningDays: 3 } } });
    }
    if (String(url).includes('/users/me/sessions')) {
      if (config?.params?.limit === 1) return Promise.resolve({ data: [], total: sessions.length });
      return Promise.resolve({ data: sessions, total: sessions.length });
    }
    return Promise.resolve({ data: {} });
  });
  const w = mount(V2LearningHistory, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return w;
}

describe('V2LearningHistory', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('状态标签人话化（含「已超时→中断未完成」「paused→上次停在这里」）', async () => {
    const w = await mountHistory();
    const labels = w.findAll('.history__item .uc-badge').map((n) => n.text());
    expect(labels).toEqual(['已完成', '中断未完成', '进行中', '上次停在这里', '已重开']);
  });

  it('动作与状态匹配：可继续→继续、中断→重新开始、完成且有小结→查看反馈', async () => {
    const w = await mountHistory();
    // s3(active) + s4(paused) 可继续
    expect(w.findAll('.history__resume').length).toBe(2);
    // s2(timeout) + s5(discarded) 中断未完成 → 重新开始（不再给无内容的「查看反馈」）
    expect(w.findAll('.history__restart').length).toBe(2);
    // 只有 s1(completed 且有 wrapup) 给「查看反馈」
    expect(w.findAll('.history__feedback').length).toBe(1);
  });

  it('同日同任务的多条会话聚合成一行（带 N 次会话与明细）', async () => {
    const sameTask = [
      { id: 'a1', taskId: 't9', taskTitle: '同一个任务', status: 'paused', startTime: '2026-09-14T09:00:00Z', durationMinutes: 0 },
      { id: 'a2', taskId: 't9', taskTitle: '同一个任务', status: 'completed', startTime: '2026-09-14T10:00:00Z', durationMinutes: 20, wrapup: '{"summary":{}}' },
    ];
    const w = await mountHistory(sameTask);
    expect(w.findAll('.history__item').length).toBe(1);
    expect(w.find('.history__item-meta').text()).toContain('2 次会话');
    expect(w.find('.history__subs').exists()).toBe(true);
    expect(w.findAll('.history__sublist li').length).toBe(2);
    // 聚合态：有可继续会话 → 行给「继续」
    expect(w.findAll('.history__resume').length).toBe(1);
  });

  it('列表请求带分页参数（page/limit），配合后端 skip 支持「加载更多」', async () => {
    await mountHistory();
    const listCalls = getMock.mock.calls.filter(([url, config]) =>
      String(url).includes('/users/me/sessions') && config?.params?.limit !== 1
    );
    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls[0][1]?.params).toMatchObject({ page: 1, limit: 30 });
  });

  /**
   * 日期归组口径（2026-09-18 走查）：刚上完的课必须归到「今天」。
   * 旧实现用 `String(iso).slice(0,10)`（UTC 切日），UTC+8 用户在 00:00–08:00
   * 学完的课会落到「昨天」——这条断言用「现在」来锁住该行为。
   */
  it('按本地日期归组：时间戳为「现在」的会话必须归到「今天」', async () => {
    const w = await mountHistory([
      { id: 's-now', taskId: 't-now', taskTitle: '刚上完的课', status: 'paused', startTime: new Date().toISOString(), durationMinutes: 0 },
    ]);
    const labels = w.findAll('.history__day-head strong').map((n) => n.text());
    expect(labels).toEqual(['今天']);
  });
});

/**
 * 样式护栏（2026-10-08 用户侧视觉检查）：两条都是「内容在页面上够不够得着」的问题，
 * 组件测试看不见，只能读样式锁住。
 */
describe('V2LearningHistory 样式护栏', () => {
  it('摘要两行封顶、不再是单行 nowrap（实测内容 651–713px 挤在 210–236px 栏里）', () => {
    const sub = styleRule('.history__item-sub');
    expect(styleDecl(sub, '-webkit-line-clamp'), '改成单行就等于把摘要藏掉').toBe('2');
    expect(styleDecl(sub, 'overflow')).toBe('hidden');
    expect(styleDecl(sub, 'white-space'), 'nowrap 会让第二行永远不出现').toBeNull();
    expect(styleDecl(sub, 'text-overflow')).toBeNull();
  });

  it('动作文字链左右等量外扩热区（「继续」实测宽仅 35px，够高不够宽）', () => {
    const rule = styleRule('.history__resume');
    expect(styleDecl(rule, 'padding')).toBe('0 6px');
    expect(styleDecl(rule, 'margin')).toBe('0 -6px');
    expect(styleDecl(rule, 'min-height'), '44px 高度地板不能被这次改动带走').toBe('44px');
  });
});
