/**
 * 日期模拟设置（虚拟学习者页）折叠行为回归：
 * 2026-09-29 用户实测「应该设计出折叠的」——原实现只有第一格进了 v-show，
 * 上课星期 / 每天几节 / 保存按钮常驻可见（头部却显示「▸ 已关闭」），折叠形同虚设。
 * 契约：默认收起时设置体整体隐藏；展开后可见；收起态头部带当前配置摘要。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    getVirtualLabSettings: vi.fn(async () => ({ data: { data: { settings: { dateSimulation: { enabled: false, defaultDailyMinutesCap: 45, defaultDaysPerWeek: 5, lessonsPerDay: 1, courseWeekdays: [1, 2, 3, 4, 5] } } } } })),
    updateVirtualLabSettings: vi.fn()
  }
}));
vi.mock('@/utils/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SimulatedDaySettings from '../SimulatedDaySettings.vue';

const mountSettings = async () => {
  const w = mount(SimulatedDaySettings);
  await flushPromises();
  return w;
};

describe('SimulatedDaySettings 折叠', () => {
  it('默认收起：设置体（含上课星期/保存行）整体隐藏，头部带当前配置摘要', async () => {
    const w = await mountSettings();
    const body = w.find('.sd-settings__body');
    expect(body.exists()).toBe(true);
    // 折叠体存在且包含全部设置块（v-show 生效 = display:none）
    expect((body.element as HTMLElement).style.display).toBe('none');
    expect(body.find('.sd-weekdays').exists()).toBe(true);
    expect(body.find('.sd-settings__foot').exists()).toBe(true);
    // 未开启时摘要不渲染（开关已说「已关闭」，不重复占位）
    expect(w.find('.sd-settings__sum').exists()).toBe(false);
    w.unmount();
  });

  it('开启后收起：头部摘要展示当前课表（时长/天数/节次）；展开则摘要让位给表单', async () => {
    const w = await mountSettings();
    // 展开并打开开关（onToggleEnabled 会自动保持展开）
    await w.find('.sd-settings__head').trigger('click');
    await w.find('.sd-switch input').setValue(true);
    await w.find('.sd-settings__head').trigger('click');
    expect((w.find('.sd-settings__body').element as HTMLElement).style.display).toBe('none');
    expect(w.find('.sd-settings__sum').text()).toContain('45 分钟');
    expect(w.find('.sd-settings__sum').text()).toContain('每天 1 节');

    await w.find('.sd-settings__head').trigger('click');
    expect((w.find('.sd-settings__body').element as HTMLElement).style.display).not.toBe('none');
    expect(w.find('.sd-settings__sum').exists()).toBe(false);
    w.unmount();
  });
});
