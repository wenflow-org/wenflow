/**
 * 日期模拟页签体（虚拟学习者页·压测参数卡）回归：
 * 2026-10-05 tab 化（用户拍板）：披露职责归 .tabs 页签，原折叠头（标题/▸/收起摘要/v-show）
 * 退役——表单在页签体内常驻；「启用日期模拟」开关升页签体首行；enabled 状态上抛宿主
 * （页签「已开启」徽标数据源）。loadFailed 守卫（ui-guard.test.ts）不变。
 */
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const state = vi.hoisted(() => ({
  dateSimulation: { enabled: false, defaultDailyMinutesCap: 45, defaultDaysPerWeek: 5, lessonsPerDay: 1, courseWeekdays: [1, 2, 3, 4, 5] } as Record<string, unknown>,
}));

vi.mock('@/api/adminApi', () => ({
  adminVirtualLearnersApi: {
    getVirtualLabSettings: vi.fn(async () => ({ data: { data: { settings: { dateSimulation: state.dateSimulation } } } })),
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

describe('SimulatedDaySettings 页签体（tab 化后）', () => {
  it('表单常驻：启用开关在首行，四格设置/上课星期/保存行全部直接可见（无折叠机制）', async () => {
    const w = await mountSettings();
    expect(w.find('.sd-settings__enable input[type="checkbox"]').exists()).toBe(true);
    expect(w.find('.sd-settings__enable span').text()).toBe('已关闭');
    expect(w.findAll('.sd-settings__grid .mk-field').length).toBe(5);
    expect(w.findAll('.sd-weekdays input[type="checkbox"]').length).toBe(7);
    expect(w.find('.sd-settings__foot button').exists()).toBe(true);
  });

  it('enabled 任何来源变化都上抛宿主（页签「已开启」徽标数据源）', async () => {
    const w = await mountSettings();
    // load 回填 enabled=false（immediate watch 首帧也发）
    expect(w.emitted('enabled')?.length).toBeGreaterThanOrEqual(1);
    expect(w.emitted('enabled')?.at(-1)).toEqual([false]);
    await w.find('.sd-settings__enable input[type="checkbox"]').setValue(true);
    expect(w.emitted('enabled')?.at(-1)).toEqual([true]);
  });

  it('服务端已开启的配置回填后开关如实显示已开启', async () => {
    const w = await mountSettings();
    expect(w.find('.sd-settings__enable span').text()).toBe('已关闭');
    state.dateSimulation = { enabled: true, defaultDailyMinutesCap: 45, defaultDaysPerWeek: 5, lessonsPerDay: 1, courseWeekdays: [1, 2, 3, 4, 5] };
    const w2 = mount(SimulatedDaySettings);
    await flushPromises();
    expect(w2.find('.sd-settings__enable span').text()).toBe('已开启');
    expect(w2.emitted('enabled')?.at(-1)).toEqual([true]);
  });
});
