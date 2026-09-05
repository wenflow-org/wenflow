/**
 * Settings（P3-7：API 接入表单预填示例值）回归测试：
 * 端点/API Key 输入框为空态 + 占位符示例（不得预填示例值，避免新用户误认为已配置）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import Settings from '../Settings.vue';

vi.mock('@/api/userCustom', () => ({
  getUserApiConfig: vi.fn(async () => ({ data: { enabled: false, endpoint: '', chatModel: 'deepseek-v4-flash', reasoningModel: 'deepseek-v4-pro', hasApiKey: false } })),
  updateUserApiConfig: vi.fn(async () => ({ data: {} })),
  disableUserApiConfig: vi.fn(async () => ({ data: {} })),
  testApiConnection: vi.fn(async () => ({ data: {} })),
  fetchApiModels: vi.fn(async () => ({ data: { models: [] } }))
}));

vi.mock('../../utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
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
  return w;
}

describe('Settings API 接入表单（P3-7）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('端点输入框：空值 + 占位符示例（非预填值）', async () => {
    const w = await mountSettings();
    const input = w.find<HTMLInputElement>('input.uc-field__input[placeholder="例如 https://api.openai.com/v1"]');
    expect(input.exists()).toBe(true);
    expect(input.element.value).toBe('');
  });

  it('API Key 输入框：空值 + 占位符示例（非预填值）', async () => {
    const w = await mountSettings();
    const input = w.find<HTMLInputElement>('input[placeholder^="例如 sk-"]');
    expect(input.exists()).toBe(true);
    expect(input.element.value).toBe('');
  });

  it('无「已保存密钥」提示（新用户空态）', async () => {
    const w = await mountSettings();
    expect(w.text()).not.toContain('已保存密钥');
  });

  it('端点占位符为「例如」引导而非可执行示例', async () => {
    const w = await mountSettings();
    const placeholder = w.find<HTMLInputElement>('input[placeholder*="api.openai.com"]').attributes('placeholder');
    expect(placeholder).toBe('例如 https://api.openai.com/v1');
  });
});
