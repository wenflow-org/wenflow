/**
 * VirtualLabLoadSettings（模型与接入 → 虚拟学习者页签）回归：
 * 2026-10-13 自「虚拟学习者」页迁入。三块设置——速率上限 / 最高并发 / 日期模拟；
 * 速率与最高并发各自独立保存（updateVirtualLabSettings 分字段），loadFailed 时禁用写控件。
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

async function mountCard() {
  const w = mount(VirtualLabLoadSettings);
  await flushPromises();
  return w;
}

describe('VirtualLabLoadSettings（压测参数卡）', () => {
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

  it('卡头：标题「压测参数」+ 三段视图切换；未选中的 pane 收起', async () => {
    const w = await mountCard();
    expect(w.find('.mk-card__head .mk-card__title').text()).toBe('压测参数');
    const seg = w.findAll('.mk-seg__item');
    expect(seg.map((s) => s.text())).toEqual(['速率上限', '最高并发', '日期模拟']);
    expect(seg[0].attributes('aria-pressed')).toBe('true');
    // 三段 pane 常驻（v-show），未选中的 display:none；切换后可见
    const panes = w.findAll('.vl-settings__pane');
    expect(panes).toHaveLength(3);
    expect((panes[0].element as HTMLElement).style.display).not.toBe('none');
    expect((panes[1].element as HTMLElement).style.display).toBe('none');
    await seg[1].trigger('click');
    expect(seg[1].attributes('aria-pressed')).toBe('true');
    expect((panes[1].element as HTMLElement).style.display).not.toBe('none');
    // 速率行有可见字段名（写控件不是裸输入框）
    expect(w.find('.mk-field__label').text()).toContain('出站速率上限');
    expect(w.text()).toContain('保存');
  });

  it('加载：速率上限与最高并发分别回填对应输入框', async () => {
    const w = await mountCard();
    const rpm = w.find('input[aria-label="虚拟学习者专属出站 RPM 上限"]').element as HTMLInputElement;
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]').element as HTMLInputElement;
    expect(rpm.value).toBe('120');
    expect(limit.value).toBe('25');
  });

  it('最高并发保存：只发 autopilotConcurrencyLimit，不夹带速率字段', async () => {
    const w = await mountCard();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    await limit.setValue(40);
    // 第二个 pane 是最高并发（第一个为速率上限）
    await w.findAll('.vl-settings__pane button')[1].trigger('click');
    await flushPromises();
    expect(updateSettingsMock).toHaveBeenCalledWith({ autopilotConcurrencyLimit: 40 });
  });

  it('速率保存：只发 virtualLearnerRpmLimit', async () => {
    const w = await mountCard();
    const rpm = w.find('input[aria-label="虚拟学习者专属出站 RPM 上限"]');
    await rpm.setValue(500);
    await w.findAll('.vl-settings__pane button')[0].trigger('click');
    await flushPromises();
    expect(updateSettingsMock).toHaveBeenCalledWith({ virtualLearnerRpmLimit: 500 });
  });

  it('并发保存越界被夹紧到 1..200', async () => {
    const w = await mountCard();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    await limit.setValue(999);
    await w.findAll('.vl-settings__pane button')[1].trigger('click');
    await flushPromises();
    expect(updateSettingsMock).toHaveBeenCalledWith({ autopilotConcurrencyLimit: 200 });
  });

  it('设置未加载：写控件禁用、保存不触发', async () => {
    getSettingsMock.mockRejectedValue(new Error('boom'));
    const w = await mountCard();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    expect((limit.element as HTMLInputElement).disabled).toBe(true);
    expect(w.find('.vl-rpm__failed').exists()).toBe(true);
    await w.findAll('.vl-settings__pane button')[1].trigger('click');
    await flushPromises();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });
});
