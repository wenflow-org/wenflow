/**
 * 日期模拟「推进」可操作 + 回执正确（2026-11-09 运营流程核查）
 *
 * 背景：DayTimeline 此前只以 readonly 嵌在虚拟学习者详情里，后端 advance-day /
 * simulation-config / reset 全都在，前端却没有入口；且「推进并上课」失败时后端返回
 * 200 + reverted:true，组件不看响应体，会把「没推进」读成「推进成功」。
 * 本测试钉住：写操作渲染出来、点击真的调接口、成功给确定回执、reverted 不谎报成功。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const api = vi.hoisted(() => ({
  getVirtualSessionSimulationClock: vi.fn(),
  getVirtualSessionDayTimeline: vi.fn(),
  advanceVirtualSessionDay: vi.fn(),
  resetVirtualSessionClock: vi.fn(),
  updateSessionSimulationConfig: vi.fn(),
}));
const confirm = vi.hoisted(() => ({ askConfirm: vi.fn() }));

vi.mock('@/api/adminApi', () => ({ adminVirtualLearnersApi: api }));
vi.mock('../useConfirm', () => confirm);

import DayTimeline from '../DayTimeline.vue';

const clock = {
  enabled: true,
  status: 'ready',
  baseDate: '2026-11-09',
  dayIndex: 2,
  maxSimulatedDays: 90,
  timezone: 'Asia/Shanghai',
  courseWeekdays: [1, 2, 3, 4, 5],
  lessonsPerDay: 2,
  autoAdvance: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getVirtualSessionSimulationClock.mockResolvedValue({ data: { data: clock } });
  api.getVirtualSessionDayTimeline.mockResolvedValue({ data: { data: { days: [] } } });
  api.advanceVirtualSessionDay.mockResolvedValue({ data: { data: { advancedDayIndexes: [3], clock: { dayIndex: 3 } } } });
  api.updateSessionSimulationConfig.mockResolvedValue({ data: { data: {} } });
  api.resetVirtualSessionClock.mockResolvedValue({ data: { data: {} } });
  confirm.askConfirm.mockResolvedValue(true);
});

async function mountTimeline() {
  const w = mount(DayTimeline, { props: { sessionId: 's1' } });
  await flushPromises();
  return w;
}
const btn = (w: Awaited<ReturnType<typeof mountTimeline>>, text: string) =>
  w.findAll('button').find((b) => b.text().includes(text))!;

describe('DayTimeline：写操作可直接使用（不再被 readonly 挡掉）', () => {
  it('渲染推进/推进并上课/自动推进/重置，且时钟状态可见', async () => {
    const w = await mountTimeline();
    expect(btn(w, '推进 1 天')).toBeTruthy();
    expect(btn(w, '推进 5 天')).toBeTruthy();
    expect(btn(w, '推进并上课')).toBeTruthy();
    expect(btn(w, '重置进度')).toBeTruthy();
    expect(w.text()).toContain('自动推进');
    expect(w.text()).toContain('已推进 2 / 90 天');
  });
});

describe('DayTimeline：推进回执', () => {
  it('推进 1 天：调接口（不跑课程）→ 成功回执含「现在在第 N 天」→ 通知宿主刷新', async () => {
    const w = await mountTimeline();
    await btn(w, '推进 1 天').trigger('click');
    await flushPromises();

    expect(api.advanceVirtualSessionDay).toHaveBeenCalledWith('s1', { days: 1, runTasks: false });
    expect(w.text()).toContain('已推进 1 个上课日');
    expect(w.text()).toContain('现在在第 4 天');
    expect(w.emitted('changed')).toBeTruthy();
  });

  it('后端 200 + reverted（当天课程没跑成功）→ 行内错误、不谎报成功', async () => {
    api.advanceVirtualSessionDay.mockResolvedValue({
      data: { data: { advancedDayIndexes: [], reverted: true, learning: { started: false, chunks: 0, error: 'Path 评审未进入 Learn' } } },
    });
    const w = await mountTimeline();
    await btn(w, '推进并上课').trigger('click');
    await flushPromises();

    expect(confirm.askConfirm).toHaveBeenCalled();
    expect(api.advanceVirtualSessionDay).toHaveBeenCalledWith('s1', { days: 1, runTasks: true });
    expect(w.text()).toContain('本次未推进');
    expect(w.text()).toContain('Path 评审未进入 Learn');
    expect(w.text()).not.toContain('已推进并运行当天课程');
  });

  it('推进并上课成功 → 回执说明已运行当天课程；取消确认则不调接口', async () => {
    const w = await mountTimeline();
    await btn(w, '推进并上课').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('已推进并运行当天课程');

    confirm.askConfirm.mockResolvedValue(false);
    api.advanceVirtualSessionDay.mockClear();
    await btn(w, '推进并上课').trigger('click');
    await flushPromises();
    expect(api.advanceVirtualSessionDay).not.toHaveBeenCalled();
  });

  it('自动推进开关：调 simulation-config 并给回执', async () => {
    const w = await mountTimeline();
    const checkbox = w.find('.dt-auto input');
    await checkbox.setValue(true);
    await flushPromises();
    expect(api.updateSessionSimulationConfig).toHaveBeenCalledWith('s1', { simulationClock: { autoAdvance: true } });
    expect(w.text()).toContain('已开启自动推进');
  });
});
