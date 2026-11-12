/**
 * 注册设置弹层（2026-11-11 从「系统设置 → 访问与注册」迁到「用户账号」）。
 *
 * 它管的是业务层账号入口：开放/关闭自助注册、单 IP 每日配额。
 * 迁到用户页的理由：与「新建用户」是同一个入口的两条来路；网络策略留在系统设置。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import RegistrationSettingsDialog from '../RegistrationSettingsDialog.vue'
import { registrationEnabled, registerIpQuotaEnabled, registerIpDailyQuota } from '../live'

const { updateSettingsMock, getRegistrationStatusMock } = vi.hoisted(() => ({
  updateSettingsMock: vi.fn(),
  getRegistrationStatusMock: vi.fn(),
}))

vi.mock('@/api/adminApi', () => ({
  adminPlatformSettingsApi: {
    updateRegistrationSetting: updateSettingsMock,
  },
}))

vi.mock('@/api/auth', () => ({
  authAPI: { getRegistrationStatus: getRegistrationStatusMock },
}))

vi.mock('../useConfirm', () => ({ askConfirm: vi.fn(async () => true) }))

const mountOptions = { global: { stubs: { teleport: true } } }

function btn(w: ReturnType<typeof mount>, text: string) {
  return w.findAll('button').find((b) => b.text().trim() === text)!
}

describe('RegistrationSettingsDialog', () => {
  beforeEach(() => {
    updateSettingsMock.mockReset()
    getRegistrationStatusMock.mockReset()
    getRegistrationStatusMock.mockResolvedValue({ registrationEnabled: true, temporaryUnavailable: false })
    registrationEnabled.value = true
    registerIpQuotaEnabled.value = false
    registerIpDailyQuota.value = 5
  })

  it('关闭态不渲染内容；打开后两行都在（自助注册 + 单 IP 配额）', async () => {
    const off = mount(RegistrationSettingsDialog, { ...mountOptions, props: { open: false } })
    expect(off.find('[role="dialog"]').exists()).toBe(false)
    off.unmount()

    const w = mount(RegistrationSettingsDialog, { ...mountOptions, props: { open: true } })
    await flushPromises()
    expect(w.find('[role="dialog"][aria-label="注册设置"]').exists()).toBe(true)
    expect(w.text()).toContain('新用户注册')
    expect(w.text()).toContain('单 IP 每日注册配额')
    expect(w.find('[role="switch"][aria-label="新用户注册"]').attributes('aria-checked')).toBe('true')
    // 配额关闭时只给结论，不亮着可填输入框
    expect(w.find('.rs-quota input').exists()).toBe(false)
    expect(w.text()).toContain('当前不限制')
    w.unmount()
  })

  it('关闭注册走确认后落盘，并把全局状态同步为关', async () => {
    updateSettingsMock.mockResolvedValue({ data: { data: {} } })
    const w = mount(RegistrationSettingsDialog, { ...mountOptions, props: { open: true } })
    await flushPromises()
    await w.find('[role="switch"][aria-label="新用户注册"]').trigger('click')
    await flushPromises()
    expect(updateSettingsMock).toHaveBeenCalledWith({ registrationEnabled: false })
    expect(registrationEnabled.value).toBe(false)
    w.unmount()
  })

  it('配额开启后出现上限输入；改数字出现「保存上限」，提交新值', async () => {
    registerIpQuotaEnabled.value = true
    updateSettingsMock.mockResolvedValue({
      data: { data: { registerIpQuotaEnabled: true, registerIpDailyQuota: 20 } },
    })
    const w = mount(RegistrationSettingsDialog, { ...mountOptions, props: { open: true } })
    await flushPromises()

    const input = w.find('.rs-quota input')
    expect(input.exists()).toBe(true)
    ;(input.element as HTMLInputElement).value = '20'
    await input.trigger('change')
    await nextTick()

    const save = btn(w, '保存上限')
    expect(save, '改上限后应出现保存钮').toBeTruthy()
    await save.trigger('click')
    await flushPromises()
    expect(updateSettingsMock).toHaveBeenCalledWith({
      registerIpQuotaEnabled: true,
      registerIpDailyQuota: 20,
    })
    expect(registerIpDailyQuota.value).toBe(20)
    w.unmount()
  })

  it('核心服务阻断时状态词显示「暂不可用」（配置开 ≠ 实际可用）', async () => {
    getRegistrationStatusMock.mockResolvedValue({ registrationEnabled: true, temporaryUnavailable: true })
    const w = mount(RegistrationSettingsDialog, { ...mountOptions, props: { open: true } })
    await flushPromises()
    expect(w.text()).toContain('暂不可用')
    w.unmount()
  })
})
