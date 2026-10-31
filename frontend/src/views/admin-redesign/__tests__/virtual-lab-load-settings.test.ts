/**
 * VirtualLabLoadSettings（虚拟学习者容量与实验环境）回归：
 * 2026-10-25 从「模型与接入 · 虚拟学习者」页签搬回虚拟学习者页。
 * 2026-10-26 用户「改了两项只按一个保存，另一项没生效」：三个保存钮合成卡级一个——
 * 本组件只出字段与脏态，保存由宿主（VirtualLearners.vue 卡头）经 expose 的 save() 触发，
 * 一次提交 RPM / 并发 / 日期模拟三组字段。loadFailed 时禁用写控件、保存不触发。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { getSettingsMock, updateSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    getVirtualLabSettings: getSettingsMock,
    updateVirtualLabSettings: updateSettingsMock,
  },
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import VirtualLabLoadSettings from '../VirtualLabLoadSettings.vue';

async function mountBlock(props: Record<string, unknown> = {}) {
  const w = mount(VirtualLabLoadSettings, { props });
  await flushPromises();
  return w;
}

describe('VirtualLabLoadSettings（容量与实验环境）', () => {
  beforeEach(() => {
    getSettingsMock.mockReset();
    updateSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({
      data: {
        data: {
          settings: { virtualLearnerRpmLimit: 120, autopilotConcurrencyLimit: 25, dateSimulation: { enabled: false } },
          rpm: { rpm: 0, inFlight: 0, queued: 0 },
        },
      },
    });
    updateSettingsMock.mockResolvedValue({ data: { data: { settings: {}, rpm: {} } } });
  });

  it('渲染三项设置：最高 RPM + 最高并发 + 日期模拟，不自带卡片外壳与保存钮', async () => {
    const w = await mountBlock();
    expect(w.findAll('.vl-settings__block')).toHaveLength(3);
    expect(w.find('.mk-card').exists()).toBe(false);
    const labels = w.findAll('.vl-settings__label').map((l) => l.text());
    expect(labels).toEqual(['最高 RPM', '最高并发', '日期模拟']);
    // 单位与口径可见；保存钮在宿主卡头，组件里不再各带一个
    expect(w.text()).toContain('个会话');
    expect(w.text()).toContain('次 / 分 · 0 = 不限');
    // 2026-10-28 用户「rpm 全站共享，虚拟学习者单独设置最高 rpm 就行了」：
    // 这里是虚拟学习者自己的上限，与全站共享额度同时生效。
    expect(w.text()).toContain('全站 RPM 共享额度');
    expect(w.findAll('button')).toHaveLength(0);
  });

  it('加载：最高并发回填对应输入框', async () => {
    const w = await mountBlock();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]').element as HTMLInputElement;
    expect(limit.value).toBe('25');
  });

  it('卡级保存：一次提交三项（RPM / 并发 / 日期模拟），越界夹紧', async () => {
    const w = await mountBlock();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    const rpm = w.find('input[aria-label="虚拟学习者最高出站 RPM"]');
    await limit.setValue(999);
    await rpm.setValue(120);
    await flushPromises();
    expect(w.emitted('dirty')?.at(-1)).toEqual([true]);

    (w.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();
    expect(updateSettingsMock).toHaveBeenCalledTimes(1);
    const payload = updateSettingsMock.mock.calls[0][0];
    expect(payload.autopilotConcurrencyLimit).toBe(200);
    expect(payload.virtualLearnerRpmLimit).toBe(120);
    expect(payload.dateSimulation).toMatchObject({ enabled: false });
    // 保存成功后脏态清掉（卡头「未保存」随之消失）
    expect(w.emitted('dirty')?.at(-1)).toEqual([false]);
  });

  it('RPM 0 = 不限，原样提交 0', async () => {
    const w = await mountBlock();
    await w.find('input[aria-label="虚拟学习者最高出站 RPM"]').setValue(0);
    await flushPromises();
    (w.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();
    expect(updateSettingsMock.mock.calls[0][0].virtualLearnerRpmLimit).toBe(0);
  });

  it('设置未加载：写控件禁用、保存不触发', async () => {
    getSettingsMock.mockRejectedValue(new Error('boom'));
    const w = await mountBlock();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    expect((limit.element as HTMLInputElement).disabled).toBe(true);
    expect(w.find('.vl-rpm__failed').exists()).toBe(true);
    expect(w.emitted('failed')?.at(-1)).toEqual([true]);
    (w.vm as unknown as { save: () => Promise<void> }).save();
    await flushPromises();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('读数挂在对应输入行：在途 / 排队与在跑 / 已满', async () => {
    const w = await mountBlock({
      rpm: { inFlight: 3, queued: 2, rpm: 120 },
      rpmSavedLimit: 200,
      concurrency: { used: 10, limit: 10, queued: 1 }
    });
    const readouts = w.findAll('.vl-settings__read').map((r) => r.text());
    expect(readouts[0]).toContain('在途 3 / 上限 200/分');
    expect(readouts[0]).toContain('排队 2');
    expect(readouts[1]).toContain('在跑 10 / 上限 10');
    expect(readouts[1]).toContain('已满');
  });
});
