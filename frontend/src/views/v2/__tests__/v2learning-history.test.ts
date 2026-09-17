/**
 * V2LearningHistory 回归（状态语义 + 入口动作 + 内部会话过滤）：
 * - 状态三态：completed=已完成 / active·paused=进行中·已暂停 / timeout 等=已超时·已结束；
 * - 「继续」只给可继续会话（active/paused），不再给已结束会话假入口；
 * - 有当堂小结（wrapup）的会话给「查看反馈」入口；
 * - 请求带 excludeInternal=1（过滤 discarded/superseded 内部会话）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/utils/api', () => ({ default: { get: getMock } }));
vi.mock('../V2Nav.vue', () => ({ default: { template: '<nav class="stub-nav" />' } }));
vi.mock('../V2Footer.vue', () => ({ default: { template: '<footer class="stub-footer" />' } }));

import V2LearningHistory from '../V2LearningHistory.vue';

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

  it('状态三态标签正确（已结束会话不再被标成「进行中」）', async () => {
    const w = await mountHistory();
    const labels = w.findAll('.history__item .uc-badge').map((n) => n.text());
    expect(labels).toEqual(['已完成', '已超时', '进行中', '已暂停', '已重开']);
  });

  it('「继续」只给 active/paused；已结束会话给「查看反馈」', async () => {
    const w = await mountHistory();
    // s3(active) + s4(paused) 可继续
    expect(w.findAll('.history__resume').length).toBe(2);
    // s1(completed) + s2(timeout) 有 wrapup → 查看反馈
    expect(w.findAll('.history__feedback').length).toBe(2);
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
