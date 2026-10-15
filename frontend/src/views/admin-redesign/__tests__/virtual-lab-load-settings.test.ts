/**
 * VirtualLabLoadSettings（虚拟学习者通道设置）回归：
 * 2026-10-13 自「虚拟学习者」页迁入「模型与接入」；2026-10-15 用户重组再收一刀——
 * 速率上限并入宿主「AI 调用与健康」卡的「出站速率」组（与平台全局上限同行），
 * 本组件只剩「最高并发 + 日期模拟」两项，卡片外壳与三段视图切换退役，渲染进宿主的调用参数栅格。
 * 保存链不变：只发 autopilotConcurrencyLimit；loadFailed 时禁用写控件。
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

async function mountBlock() {
  const w = mount(VirtualLabLoadSettings);
  await flushPromises();
  return w;
}

describe('VirtualLabLoadSettings（虚拟学习者通道设置）', () => {
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

  it('渲染两项设置：最高并发 + 日期模拟，不再自带卡片外壳与分段视图', async () => {
    const w = await mountBlock();
    expect(w.findAll('.vl-settings__block')).toHaveLength(2);
    expect(w.find('.mk-card').exists()).toBe(false);
    expect(w.find('.mk-seg').exists()).toBe(false);
    const labels = w.findAll('.vl-settings__label').map((l) => l.text());
    expect(labels).toEqual(['最高并发', '日期模拟']);
    // 写控件不是裸输入框：字段名可见
    expect(w.text()).toContain('个会话');
  });

  it('加载：最高并发回填对应输入框', async () => {
    const w = await mountBlock();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]').element as HTMLInputElement;
    expect(limit.value).toBe('25');
  });

  it('保存：只发 autopilotConcurrencyLimit，不夹带速率字段', async () => {
    const w = await mountBlock();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    await limit.setValue(40);
    await w.find('.vl-settings__row button').trigger('click');
    await flushPromises();
    expect(updateSettingsMock).toHaveBeenCalledWith({ autopilotConcurrencyLimit: 40 });
  });

  it('并发保存越界被夹紧到 1..200', async () => {
    const w = await mountBlock();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    await limit.setValue(999);
    await w.find('.vl-settings__row button').trigger('click');
    await flushPromises();
    expect(updateSettingsMock).toHaveBeenCalledWith({ autopilotConcurrencyLimit: 200 });
  });

  it('设置未加载：写控件禁用、保存不触发', async () => {
    getSettingsMock.mockRejectedValue(new Error('boom'));
    const w = await mountBlock();
    const limit = w.find('input[aria-label="自动驾驶最高并发上限"]');
    expect((limit.element as HTMLInputElement).disabled).toBe(true);
    expect(w.find('.vl-rpm__failed').exists()).toBe(true);
    await w.find('.vl-settings__row button').trigger('click');
    await flushPromises();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });
});
