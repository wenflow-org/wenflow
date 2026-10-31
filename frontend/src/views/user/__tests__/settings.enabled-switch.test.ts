/**
 * 设置页「自定义模型服务」开关的 DOM 回写：
 * 未填端点时点击开关会被 handler 拒绝（模型保持 false），
 * 但 Vue 对 false→false 不重绘 checked，DOM 会停在用户点出来的「开」，
 * 与右侧「关」标签自相矛盾。这里锁定拒绝/回滚后开关必须回到模型值。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Settings from '../Settings.vue';

const { getUserApiConfigMock, updateUserApiConfigMock, disableUserApiConfigMock, askConfirmMock, toastMock } = vi.hoisted(() => ({
  getUserApiConfigMock: vi.fn(),
  updateUserApiConfigMock: vi.fn(async () => ({ data: {} })),
  disableUserApiConfigMock: vi.fn(async () => ({ data: {} })),
  askConfirmMock: vi.fn(async () => false),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}));

vi.mock('@/api/userCustom', () => ({
  getUserApiConfig: getUserApiConfigMock,
  updateUserApiConfig: updateUserApiConfigMock,
  disableUserApiConfig: disableUserApiConfigMock,
  testApiConnection: vi.fn(async () => ({ data: {} })),
  fetchApiModels: vi.fn(async () => ({ data: { models: [] } })),
  getUserMcpConfig: vi.fn(async () => ({ data: { tools: [] } })),
  updateUserMcpConfig: vi.fn(async () => ({ data: {} })),
  executeMcpTool: vi.fn(async () => ({ data: {} }))
}));

vi.mock('@/utils/toast', () => ({ toast: toastMock }));

vi.mock('@/views/admin-redesign/useConfirm', () => ({
  askConfirm: askConfirmMock,
  doneConfirm: vi.fn(),
  failConfirm: vi.fn()
}));

vi.mock('@/components/user/CapabilityShell.vue', () => ({
  default: { template: '<div class="stub-shell"><slot /></div>' }
}));
vi.mock('@/components/user/UcConfirm.vue', () => ({
  default: { template: '<div class="stub-confirm" />' }
}));

async function mountSettings() {
  const w = mount(Settings);
  await flushPromises();
  await flushPromises();
  return w;
}

function switchInput(w: ReturnType<typeof mount>) {
  return w.find('.uc-switch input[type="checkbox"]');
}

describe('Settings 自定义模型服务开关', () => {
  beforeEach(() => {
    getUserApiConfigMock.mockReset();
    updateUserApiConfigMock.mockClear();
    disableUserApiConfigMock.mockClear();
    askConfirmMock.mockClear();
    Object.values(toastMock).forEach((fn) => fn.mockClear());
  });

  it('端点为空时拒绝启用：开关 DOM 回到关，且不发保存请求', async () => {
    getUserApiConfigMock.mockResolvedValue({ data: { enabled: false, endpoint: '', hasApiKey: false } });
    const w = await mountSettings();

    const input = switchInput(w);
    expect((input.element as HTMLInputElement).checked).toBe(false);
    await input.setValue(true);
    await flushPromises();

    expect(toastMock.info).toHaveBeenCalledWith('请先填写模型端点和 API Key，保存后再启用');
    expect(updateUserApiConfigMock).not.toHaveBeenCalled();
    // 关键：用户点出来的 DOM 选中态必须被显式回写
    expect((switchInput(w).element as HTMLInputElement).checked).toBe(false);
    expect(w.text()).toContain('自定义模型服务：关');
    w.unmount();
  });

  it('已启用时点关闭但取消确认：开关保持开，与服务端一致', async () => {
    getUserApiConfigMock.mockResolvedValue({
      data: { enabled: true, endpoint: 'https://gw.example/v1', hasApiKey: true }
    });
    const w = await mountSettings();

    const input = switchInput(w);
    expect((input.element as HTMLInputElement).checked).toBe(true);
    await input.setValue(false);
    await flushPromises();

    expect(askConfirmMock).toHaveBeenCalled();
    expect(disableUserApiConfigMock).not.toHaveBeenCalled();
    expect((switchInput(w).element as HTMLInputElement).checked).toBe(true);
    expect(w.text()).toContain('自定义模型服务：开');
    w.unmount();
  });
});
